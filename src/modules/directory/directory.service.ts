import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import type { PublicListingStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { RealtimeService } from '../../database/realtime.service';
import { REDIS_CLIENT } from '../../database/redis.tokens';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import {
  DEFAULT_BRANCH_LISTING_SETTINGS,
  distanceKm,
  parseDirectorySettings,
  serializePublicListing,
  slugify,
  type BranchListingSettings,
} from './domain/directory';
import { GeoRepository } from './geo/geo.repository';
import {
  FACILITY_DIRECTORY_PROVIDER,
  type FacilityDirectoryProvider,
} from './providers/facility-directory.provider';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
} from './providers/geocoding.provider';
import type {
  NearbyFacilitiesQueryDto,
  SearchFacilitiesQueryDto,
  SuggestFacilityDto,
  UpdateListingBodyDto,
  UpdateListingSettingsDto,
} from './dto/directory.dto';

const DIRECTORY_CACHE_TTL_SECONDS = 60;
const REV_KEY = 'directory:rev';

/**
 * Public facility directory (brief §6.14; ADR-038/039).
 *
 * Ownership model:
 *  - ORG-published listings: built from Branch + per-branch listing settings,
 *    owned by (sourceOrganizationId, sourceBranchId). Publishing emits the
 *    `Directory.PublicListingChanged` outbox event (the consumer keeps the
 *    public cache in sync).
 *  - PLATFORM-administered listings: cross-tenant suspend/confirm/update and
 *    the directory-feed importer. These write the read model directly (an
 *    affirmative override), so they invalidate the cache inline instead of
 *    re-emitting a projection event.
 *
 * The projection is served only from the cross-tenant `PublicFacilityListing`
 * table; no tenant table is ever read on the public path.
 */
@Injectable()
export class DirectoryService {
  private readonly logger = new Logger(DirectoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly realtime: RealtimeService,
    private readonly geo: GeoRepository,
    @Inject(FACILITY_DIRECTORY_PROVIDER)
    private readonly feed: FacilityDirectoryProvider,
    @Inject(GEOCODING_PROVIDER) private readonly geocoding: GeocodingProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // -------------------------------------------------------------------------
  // anonymous public reads
  // -------------------------------------------------------------------------

  async nearby(query: NearbyFacilitiesQueryDto) {
    const { lat, lng, radiusKm, limit } = query;
    const cacheKey = await this.publicKey('nearby', [lat, lng, radiusKm, limit]);
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const rows = await this.geo.nearby({
      latitude: lat,
      longitude: lng,
      radiusKm: radiusKm ?? 10,
      limit: limit ?? 20,
    });
    const items = rows
      .map((r) =>
        serializePublicListing(r, {
          distanceKm:
            r.locationLat !== null && r.locationLng !== null
              ? distanceKm(r.locationLat, r.locationLng, lat, lng)
              : null,
        }),
      )
      .filter((r) => r.distanceKm !== undefined && r.distanceKm !== null);

    const result = {
      items: items.slice(0, limit ?? 20),
      meta: {
        latitude: lat,
        longitude: lng,
        radiusKm: radiusKm ?? 10,
        count: items.length,
        rank: 'distance',
      },
    };
    await this.redis.setex(cacheKey, DIRECTORY_CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
    return result;
  }

  async search(query: SearchFacilitiesQueryDto) {
    const { q, county, town, lat, lng, limit } = query;
    const cacheKey = await this.publicKey('search', [q, county, town, lat, lng, limit]);
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const db = this.prisma.unscoped();
    const where: Record<string, unknown> = { status: 'PUBLISHED' };
    if (county) where.county = county;
    if (town) where.town = town;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { town: { contains: q, mode: 'insensitive' } },
        { county: { contains: q, mode: 'insensitive' } },
      ];
    }

    const wanted = limit ?? 20;
    const rows = await db.publicFacilityListing.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      take: wanted,
    });

    const geolocated = lat !== undefined && lng !== undefined;
    const items = rows
      .map((r) => {
        const d =
          geolocated && r.locationLat !== null && r.locationLng !== null
            ? distanceKm(r.locationLat, r.locationLng, lat as number, lng as number)
            : undefined;
        return { serialized: serializePublicListing(r, { distanceKm: d }), distanceKm: d };
      })
      .sort((a, b) => {
        if (geolocated) return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
        return 0;
      })
      .slice(0, wanted)
      .map((x) => x.serialized);

    const result = { items, meta: { count: items.length, ranked: geolocated } };
    await this.redis.setex(cacheKey, DIRECTORY_CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
    return result;
  }

  async profile(slug: string) {
    const cacheKey = await this.publicKey('listing', [slug]);
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const row = await this.prisma.unscoped().publicFacilityListing.findFirst({
      where: { slug, status: 'PUBLISHED' },
    });
    if (!row) {
      throw new AppError({
        code: ErrorCodes.PUBLIC_LISTING_NOT_PUBLISHED,
        message: 'No published listing for this facility.',
        silent: true,
      });
    }
    const result = serializePublicListing(row);
    await this.redis.setex(cacheKey, DIRECTORY_CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
    return result;
  }

  config() {
    return {
      appName: 'CareOS public facility directory',
      directoryNote:
        'Directory entries are sanitized facility listings published by the provider organizations.',
      emergencyStatement:
        'This directory is informational only. In an emergency, call your national emergency number or go to the nearest emergency facility immediately.',
      acceptsOnlineBooking: true,
      suggestionNotice:
        'Suggestions are reviewed by directory staff and are not immediately visible.',
    };
  }

  async geocode(query: { query: string }) {
    const parts = query.query.split(',').map((s) => s.trim()).filter(Boolean);
    const [address, town = undefined, county = undefined] = parts as [
      string,
      string | undefined,
      string | undefined,
    ];
    const results = this.geocoding.supported
      ? await this.geocoding.geocode({ address, town, county })
      : [];
    return {
      supported: this.geocoding.supported,
      provider: this.geocoding.name,
      results,
      note: this.geocoding.supported ? 'untrusted' : 'geocoding unavailable',
    };
  }

  async suggest(
    body: SuggestFacilityDto,
    kind: 'FACILITY_SUGGESTION' | 'LISTING_CORRECTION' | 'ONBOARDING_REQUEST' = 'FACILITY_SUGGESTION',
  ) {
    const inquiry = await this.prisma.unscoped().onboardingInquiry.create({
      data: {
        id: newId(),
        kind,
        facilityName: body.facilityName,
        address: body.address ?? null,
        county: body.county ?? null,
        town: body.town ?? null,
        contactName: body.contactName ?? null,
        contactEmail: body.contactEmail ?? null,
        contactPhone: body.contactPhone ?? null,
        notes: body.notes ?? null,
      },
      select: { id: true, status: true, createdAt: true },
    });
    return {
      id: inquiry.id,
      status: inquiry.status,
      receivedAt: inquiry.createdAt,
      message: 'Thanks — this will be reviewed by directory staff.',
    };
  }

  // -------------------------------------------------------------------------
  // org-owned listing settings + publication
  // -------------------------------------------------------------------------

  async settingsOf(forBranchId?: string) {
    const organizationId = this.tenantContext.requireOrg();
    const branchId = await this.resolveBranchId(forBranchId);
    const db = this.prisma.tenantFor(organizationId);
    const row = await db.organizationSetting.findUnique({
      where: { organizationId },
      select: { data: true },
    });
    const settings = parseDirectorySettings(row?.data ?? null).listings[branchId] ?? {
      ...DEFAULT_BRANCH_LISTING_SETTINGS,
    };
    return { branchId, settings };
  }

  async updateSettings(body: UpdateListingSettingsDto, forBranchId?: string) {
    const organizationId = this.tenantContext.requireOrg();
    const branchId = await this.resolveBranchId(forBranchId);
    assertCoordinatePair(body.locationLat, body.locationLng);

    const branch = await this.prisma
      .tenantFor(organizationId)
      .branch.findFirst({
        where: { id: branchId, organizationId },
        select: { id: true },
      });
    if (!branch) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Branch not found.', silent: true });
    }

    const updated = await this.txRunner.run(async (ctx: TxContext) => {
      const row = await ctx.db.organizationSetting.findUnique({
        where: { organizationId },
        select: { id: true, data: true },
      });
      const existing = parseDirectorySettings(row?.data ?? null).listings[branchId];
      const merged: BranchListingSettings = {
        ...DEFAULT_BRANCH_LISTING_SETTINGS,
        ...existing,
        ...cleanPartial(body),
      };
      const data = (row?.data ?? {}) as Record<string, unknown>;
      const listings = (data.listings ?? {}) as Record<string, unknown>;
      listings[branchId] = merged;

      if (row) {
        await ctx.db.organizationSetting.update({
          where: { id: row.id },
          data: { data: { ...data, listings } },
        });
      } else {
        await ctx.db.organizationSetting.create({
          data: { id: newId(), organizationId, data: { listings } },
        });
      }
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'directory.listing_settings_updated',
          resource: 'listing_settings',
          resourceId: `${organizationId}:${branchId}`,
          newState: { branchId },
        },
        select: { id: true },
      });
      return merged;
    });

    return { branchId, settings: updated };
  }

  /** Publishes the current branch as a public listing (DRAFT→PUBLISHED). */
  async publish(forBranchId?: string) {
    const organizationId = this.tenantContext.requireOrg();
    const branchId = await this.resolveBranchId(forBranchId);
    const db = this.prisma.tenantFor(organizationId);

    const [branch, settingsRow] = await Promise.all([
      db.branch.findFirst({ where: { id: branchId, organizationId } }),
      db.organizationSetting.findUnique({ where: { organizationId }, select: { data: true } }),
    ]);
    if (!branch) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Branch not found.', silent: true });
    }
    const settings = parseDirectorySettings(settingsRow?.data ?? null).listings[branchId] ?? {
      ...DEFAULT_BRANCH_LISTING_SETTINGS,
    };

    const listing = await this.txRunner.run(async (ctx: TxContext) => {
      const existing = await ctx.db.publicFacilityListing.findFirst({
        where: { sourceOrganizationId: organizationId, sourceBranchId: branchId },
      });
      const hasCoordinates =
        settings.locationLat !== null &&
        settings.locationLat !== undefined &&
        settings.locationLng !== null &&
        settings.locationLng !== undefined;
      const data = {
        name: branch.name,
        summary: settings.summary,
        description: settings.description,
        address: settings.address ?? branch.address,
        county: settings.county,
        town: settings.town,
        phone: settings.phone,
        email: settings.email,
        website: settings.website,
        timezone: 'Africa/Nairobi',
        hours: toJson(settings.hours),
        departments: toJson(settings.departments),
        insurance: settings.insurance ?? [],
        accessibility: settings.accessibility ?? [],
        services: toJson(settings.services ? { list: settings.services } : null),
        feeNote: toJson(settings.feeNote ? { note: settings.feeNote } : null),
        open24h: settings.open24h ?? false,
        emergency24h: settings.emergency24h ?? false,
        ambulanceAvailable: settings.ambulanceAvailable ?? false,
        emergencyIntakeEnabled: settings.emergencyIntakeEnabled ?? false,
        acceptsOnlineBooking: settings.acceptsOnlineBooking ?? false,
        emergencyIntakeIndex: null,
        locationLat: hasCoordinates ? settings.locationLat : null,
        locationLng: hasCoordinates ? settings.locationLng : null,
        status: 'PUBLISHED' as PublicListingStatus,
        partner: true,
      };

      const saved = existing
        ? await ctx.db.publicFacilityListing.update({
            where: { id: existing.id },
            data: { ...data, verificationStatus: existing.verificationStatus },
          })
        : await ctx.db.publicFacilityListing.create({
            data: {
              id: newId(),
              sourceOrganizationId: organizationId,
              sourceBranchId: branchId,
              slug: await this.uniqueSlug(branch.name),
              ...data,
            },
          });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'directory.listing_published',
          resource: 'public_listing',
          resourceId: saved.id,
          newState: { slug: saved.slug, branchId },
        },
        select: { id: true },
      });
      ctx.emit({
        type: EventTypes.PublicListingChanged,
        aggregateType: 'public_facility_listing',
        aggregateId: saved.id,
        payload: { listingId: saved.id, slug: saved.slug, organizationId, branchId },
      });
      return saved;
    });

    this.notify(organizationId, EventTypes.PublicListingChanged, listing.id, {
      listingId: listing.id,
      slug: listing.slug,
      organizationId,
      branchId,
    });
    await this.bumpRevision();
    return serializePublicListing(listing);
  }

  /** The current org's own published/DRAFT listings (partner-owned only). */
  async myListings(query: { status?: string; page?: number; limit?: number }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);
    const where: Record<string, unknown> = { sourceOrganizationId: organizationId };
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      db.publicFacilityListing.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.publicFacilityListing.count({ where }),
    ]);
    return pageOf(rows.map((r) => serializePublicListing(r)), total, page, limit);
  }

  // -------------------------------------------------------------------------
  // platform facilities management (cross-tenant)
  // -------------------------------------------------------------------------

  async listAll(query: { status?: string; partner?: string; page?: number; limit?: number }) {
    const db = this.prisma.unscoped();
    const { page, limit } = paginate(query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.partner) where.partner = query.partner === 'true';

    const [rows, total] = await Promise.all([
      db.publicFacilityListing.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.publicFacilityListing.count({ where }),
    ]);
    return pageOf(rows.map((r) => serializePublicListing(r)), total, page, limit);
  }

  async setStatus(id: string, status: PublicListingStatus, auditAction: string) {
    const db = this.prisma.unscoped();
    const current = await db.publicFacilityListing.findUnique({ where: { id } });
    if (!current) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Listing not found.', silent: true });
    }
    const updated = await db.publicFacilityListing.update({
      where: { id },
      data: { status },
    });
    const orgId = current.sourceOrganizationId;
    if (orgId) {
      await this.prisma
        .tenantFor(orgId)
        .auditLog.create({
          data: {
            id: newId(),
            organizationId: orgId,
            action: auditAction,
            resource: 'public_listing',
            resourceId: id,
            newState: { slug: current.slug, from: current.status, to: status },
          },
          select: { id: true },
        })
        .catch(() => {});
      this.notify(orgId, EventTypes.PublicListingChanged, id, { listingId: id, slug: updated.slug });
    }
    await this.bumpRevision();
    return serializePublicListing(updated);
  }

  async confirmListing(id: string) {
    const db = this.prisma.unscoped();
    const current = await db.publicFacilityListing.findUnique({ where: { id } });
    if (!current) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Listing not found.', silent: true });
    }
    const updated = await db.publicFacilityListing.update({
      where: { id },
      data: { verificationStatus: 'DETAILS_CONFIRMED', lastConfirmedAt: new Date() },
    });
    const orgId = current.sourceOrganizationId;
    if (orgId) {
      await this.prisma
        .tenantFor(orgId)
        .auditLog.create({
          data: {
            id: newId(),
            organizationId: orgId,
            action: 'directory.listing_verified',
            resource: 'public_listing',
            resourceId: id,
            newState: { slug: current.slug, verification: 'DETAILS_CONFIRMED' },
          },
          select: { id: true },
        })
        .catch(() => {});
      this.notify(orgId, EventTypes.PublicListingChanged, id, { listingId: id, slug: updated.slug });
    }
    await this.bumpRevision();
    return serializePublicListing(updated);
  }

  /** Direct field correction (partner/imported staging or platform override). */
  async updateListing(id: string, body: UpdateListingBodyDto) {
    const db = this.prisma.unscoped();
    const current = await db.publicFacilityListing.findUnique({ where: { id } });
    if (!current) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Listing not found.', silent: true });
    }
    assertCoordinatePair(body.locationLat, body.locationLng);
    const patch = cleanPartial(body) as Record<string, unknown>;
    const updated = await db.publicFacilityListing.update({
      where: { id },
      data: patch,
    });
    if (current.sourceOrganizationId) {
      this.notify(current.sourceOrganizationId, EventTypes.PublicListingChanged, id, {
        listingId: id,
        slug: updated.slug,
      });
    }
    await this.bumpRevision();
    return serializePublicListing(updated);
  }

  // -------------------------------------------------------------------------
  // directory feed importer
  // -------------------------------------------------------------------------

  async importRun() {
    if (!this.feed.enabled) {
      throw new AppError({
        code: ErrorCodes.DIRECTORY_SOURCE_UNAVAILABLE,
        message: 'The facility directory feed is not configured.',
        silent: true,
      });
    }
    const rows = await this.feed.fetchRows();
    const db = this.prisma.unscoped();
    let imported = 0;
    for (const row of rows) {
      await db.importedFacility.upsert({
        where: { sourceId: row.sourceId },
        create: {
          id: newId(),
          sourceId: row.sourceId,
          name: row.name,
          address: row.address ?? null,
          county: row.county ?? null,
          town: row.town ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          website: row.website ?? null,
          hours: Prisma.DbNull,
          locationLat: row.locationLat ?? null,
          locationLng: row.locationLng ?? null,
          provider: this.feed.name,
          licence: row.licence ?? null,
          partner: false,
          raw: { name: row.name, address: row.address },
        },
        update: {
          name: row.name,
          address: row.address ?? null,
          county: row.county ?? null,
          town: row.town ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          website: row.website ?? null,
          locationLat: row.locationLat ?? null,
          locationLng: row.locationLng ?? null,
          licence: row.licence ?? null,
          raw: { name: row.name, address: row.address },
        },
      });
      imported++;
    }
    return { enabled: true, provider: this.feed.name, imported, total: rows.length };
  }

  /** Stage an imported row into the current org's DRAFT listing pool. */
  async importOne(sourceId: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.unscoped();
    const imported = await db.importedFacility.findUnique({ where: { sourceId } });
    if (!imported) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Imported source row not found.', silent: true });
    }
    const existing = await db.publicFacilityListing.findFirst({
      where: { importedSourceId: imported.id },
    });
    if (existing) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'This source row is already staged as a listing.',
        silent: true,
      });
    }
    const listing = await db.publicFacilityListing.create({
      data: {
        id: newId(),
        slug: await this.uniqueSlug(imported.name),
        name: imported.name,
        summary: null,
        description: null,
        address: imported.address,
        county: imported.county,
        town: imported.town,
        phone: imported.phone,
        email: imported.email,
        website: imported.website,
        timezone: 'Africa/Nairobi',
        hours: toJson(imported.hours),
        departments: Prisma.DbNull,
        insurance: [],
        accessibility: [],
        services: Prisma.DbNull,
        feeNote: Prisma.DbNull,
        open24h: false,
        emergency24h: false,
        ambulanceAvailable: false,
        emergencyIntakeEnabled: false,
        acceptsOnlineBooking: false,
        emergencyIntakeIndex: null,
        locationLat: imported.locationLat,
        locationLng: imported.locationLng,
        status: 'DRAFT',
        verificationStatus: 'UNVERIFIED',
        partner: false,
        sourceOrganizationId: organizationId,
        importedSourceId: imported.id,
      },
    });
    return serializePublicListing(listing);
  }

  async listImported(query: { county?: string; page?: number; limit?: number }) {
    const db = this.prisma.unscoped();
    const { page, limit } = paginate(query);
    const where: Record<string, unknown> = {};
    if (query.county) where.county = query.county;
    const [rows, total] = await Promise.all([
      db.importedFacility.findMany({ where, orderBy: { importedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      db.importedFacility.count({ where }),
    ]);
    return pageOf(rows.map(serializeImported), total, page, limit);
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private async resolveBranchId(forBranchId?: string): Promise<string> {
    const organizationId = this.tenantContext.requireOrg();
    if (forBranchId) {
      return forBranchId;
    }
    if (this.tenantContext.scope.branchId) {
      return this.tenantContext.scope.branchId;
    }
    const first = await this.prisma
      .tenantFor(organizationId)
      .branch.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
    if (!first) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'No branch in this organization.', silent: true });
    }
    return first.id;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    let n = 2;
    while (
      await this.prisma.unscoped().publicFacilityListing.findUnique({
        where: { slug },
        select: { id: true },
      })
    ) {
      slug = `${base}-${n}`;
      n++;
    }
    return slug;
  }

  private async bumpRevision(): Promise<void> {
    await this.redis.incr(REV_KEY).catch(() => {});
  }

  private async publicKey(base: string, parts: Array<number | string | undefined>): Promise<string> {
    const rev = (await this.redis.get(REV_KEY).catch(() => null)) ?? '0';
    return `directory:v${rev}:${base}:${hashParts(parts)}`;
  }

  private notify(
    organizationId: string,
    event: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): void {
    this.realtime.publish(organizationId, 'directory', {
      version: 1,
      event,
      aggregateId,
      payload,
    });
  }
}

function cleanPartial(
  body: UpdateListingSettingsDto | UpdateListingBodyDto,
): BranchListingSettings {
  const out: BranchListingSettings = {};
  for (const key of Object.keys(body) as Array<keyof typeof body>) {
    const value = body[key];
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** null/undefined → SQL NULL for a nullable JSON column via Prisma.DbNull. */
function toJson(v: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/** A latitude without a longitude is always an error (and vice-versa). */
function assertCoordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
): void {
  const hasLat = lat !== undefined && lat !== null;
  const hasLng = lng !== undefined && lng !== null;
  if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
    throw new AppError({
      code: ErrorCodes.INVALID_COORDINATES,
      message: 'locationLat and locationLng must be provided together.',
      silent: true,
    });
  }
  if (hasLat && !Number.isFinite(lat as number)) {
    throw new AppError({ code: ErrorCodes.INVALID_COORDINATES, message: 'Invalid coordinates.', silent: true });
  }
}

function serializeImported(r: {
  id: string;
  sourceId: string;
  name: string;
  address: string | null;
  county: string | null;
  town: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  locationLat: number | null;
  locationLng: number | null;
  provider: string;
  licence: string | null;
  importedAt: Date;
}): Record<string, unknown> {
  return {
    id: r.id,
    sourceId: r.sourceId,
    name: r.name,
    address: r.address,
    county: r.county,
    town: r.town,
    phone: r.phone,
    email: r.email,
    website: r.website,
    locationLat: r.locationLat,
    locationLng: r.locationLng,
    provider: r.provider,
    licence: r.licence,
    importedAt: r.importedAt,
  };
}

function hashParts(parts: Array<number | string | undefined>): string {
  let h = 0;
  for (const p of parts) {
    const s = String(p ?? '_');
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
  }
  return (h >>> 0).toString(36);
}