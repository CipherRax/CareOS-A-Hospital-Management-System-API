import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';
import { hashPassword } from '../../src/common/security/password';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Public facility directory acceptance (brief §6.14 / patch P2): listing
 * settings → publish → anonymous nearby/search/profile reads → platform
 * suspend/unsuspend. Proves the public path never requires auth and honors the
 * PUBLISHED-only projection (suspended listings 404).
 */
describe('public facility directory (patch P2)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let organizationId: string;
  let branchId: string;
  let adminToken: string;
  let listingId: string | null = null;
  let listingSlug: string | null = null;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    organizationId = newId();
    await sc.organization.create({ data: { id: organizationId, name: 'Directory Org A' } });

    const passwordHash = await hashPassword('DemoPass123!');

    const role = await sc.role.create({
      data: {
        id: newId(),
        organizationId,
        key: 'DIRECTORY_ADMIN',
        name: 'Directory Admin',
        permissions: [
          'public_listing.manage',
          'platform.facilities.manage',
          'organizations.read',
        ],
        isSystem: false,
      },
    });
    const user = await sc.user.create({
      data: {
        id: newId(),
        organizationId,
        email: 'dir-admin@directory.test',
        firstName: 'Dir',
        lastName: 'Admin',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await sc.userRole.create({
      data: { id: newId(), organizationId, userId: user.id, roleId: role.id },
    });

    branchId = newId();
    await sc.branch.create({
      data: {
        id: branchId,
        organizationId,
        name: 'St Matthews Care',
        code: 'DIR01',
        address: '1 Main Street',
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId, email: 'dir-admin@directory.test', password: 'DemoPass123!' },
    });
    expect(login.statusCode).toBe(200);
    adminToken = login.json().data.tokens.accessToken;
  }, 30_000);

  afterAll(async () => {
    // Cross-tenant projection + audit rows are append-only/referencing; the
    // container is disposable.
    await app.close();
  });

  it('denies anonymous access to the listing settings surface', async () => {
    const res = await app.inject({ method: 'GET', url: url('/settings/listing') });
    expect(res.statusCode).toBe(401);
  });

  it('denies listing management without the right permission', async () => {
    // A caller with only organizations.read must not touch the directory feed.
    const sc = prisma.unscoped();
    const limitedRole = await sc.role.create({
      data: {
        id: newId(),
        organizationId,
        key: 'DIRECTORY_READER',
        name: 'Directory Reader',
        permissions: ['organizations.read'],
        isSystem: false,
      },
    });
    await sc.userRole.create({
      data: {
        id: newId(),
        organizationId,
        userId: (
          await sc.user.create({
            data: {
              id: newId(),
              organizationId,
              email: 'reader@directory.test',
              firstName: 'Rea',
              lastName: 'Der',
              status: 'ACTIVE',
              passwordHash: await hashPassword('DemoPass123!'),
            },
          })
        ).id,
        roleId: limitedRole.id,
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: {
        organizationId,
        email: 'reader@directory.test',
        password: 'DemoPass123!',
      },
    });
    const limitedToken = login.json().data.tokens.accessToken;
    const res = await app.inject({
      method: 'GET',
      url: url('/settings/listing'),
      headers: bearer(limitedToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('saves per-branch listing settings and reads them back', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: url('/settings/listing'),
      headers: bearer(adminToken),
      payload: {
        county: 'Nairobi',
        town: 'Westlands',
        locationLat: -1.26,
        locationLng: 36.81,
        emergency24h: true,
        ambulanceAvailable: true,
        insurance: ['NHIF'],
        departments: [{ name: 'Outpatient', services: ['General consultation'] }],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.branchId).toBe(branchId);
    expect(put.json().data.settings.county).toBe('Nairobi');

    const get = await app.inject({
      method: 'GET',
      url: url('/settings/listing'),
      headers: bearer(adminToken),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.settings.town).toBe('Westlands');
    expect(get.json().data.settings.emergency24h).toBe(true);
  });

  it('rejects a single dangling coordinate', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: url('/settings/listing'),
      headers: bearer(adminToken),
      payload: { locationLat: -1.26 },
    });
    expect(put.statusCode).toBe(422);
    expect(put.json().error.code).toBe('INVALID_COORDINATES');
  });

  it('publishes the branch into the public directory', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url('/admin/listings/publish'),
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.slug).toBe('st-matthews-care');
    expect(data.name).toBe('St Matthews Care');
    expect(data.location).toEqual({ lat: -1.26, lng: 36.81 });
    listingId = data.id;
    listingSlug = data.slug;
    expect(listingSlug).toMatch(/^st-matthews-care$/);

    const row = await prisma.unscoped().publicFacilityListing.findFirst({
      where: { sourceOrganizationId: organizationId, sourceBranchId: branchId },
      select: { status: true, sourceOrganizationId: true },
    });
    expect(row?.status).toBe('PUBLISHED');
    expect(row?.sourceOrganizationId).toBe(organizationId);
  });

  it('serves the published profile anonymously', async () => {
    const res = await app.inject({
      method: 'GET',
      url: url(`/public/facilities/${listingSlug}`),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.slug).toBe(listingSlug);
    expect(data.county).toBe('Nairobi');
    expect(data.location).toEqual({ lat: -1.26, lng: 36.81 });
    expect(data.emergency24h).toBe(true);
  });

  it('returns 404 PUBLIC_LISTING_NOT_PUBLISHED for unknown slugs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: url('/public/facilities/does-not-exist'),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PUBLIC_LISTING_NOT_PUBLISHED');
  });

  it('finds the facility near a location with a distance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: url('/public/facilities/nearby?lat=-1.27&lng=36.82&radiusKm=25'),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data;
    expect(items.length).toBeGreaterThan(0);
    const found = items.find((f: { slug: string }) => f.slug === listingSlug);
    expect(found).toBeTruthy();
    expect(typeof found.distanceKm).toBe('number');
    expect(found.distanceKm).toBeGreaterThan(0);
  });

  it('finds the facility by keyword search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: url('/public/facilities/search?q=Matthews&town=Westlands'),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data;
    expect(items.some((f: { slug: string }) => f.slug === listingSlug)).toBe(true);
  });

  it('returns public config without auth', async () => {
    const res = await app.inject({ method: 'GET', url: url('/public/facilities/config') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.acceptsOnlineBooking).toBe(true);
  });

  it('accepts and stores a facility suggestion', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url('/public/facilities/suggest'),
      payload: {
        facilityName: 'Kawangware Clinic',
        county: 'Nairobi',
        contactEmail: 'someone@example.test',
        notes: 'Small private clinic missing from the feed.',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe('PENDING');
    expect(res.json().data.locationLat).toBeUndefined();

    const row = await prisma.unscoped().onboardingInquiry.findFirst({
      where: { kind: 'FACILITY_SUGGESTION', contactEmail: 'someone@example.test' },
      select: { facilityName: true },
    });
    expect(row?.facilityName).toBe('Kawangware Clinic');
  });

  it('reports geocoding as currently unavailable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: url('/public/geocode?query=Westlands, Nairobi'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.supported).toBe(false);
    expect(res.json().data.results).toEqual([]);
  });

  it('refuses the feed sync when the source CSV is not configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url('/admin/listings/import/run'),
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('DIRECTORY_SOURCE_UNAVAILABLE');
  });

  it('platform suspend hides the listing; unsuspend restores it', async () => {
    expect(listingId).toBeTruthy();

    const suspend = await app.inject({
      method: 'POST',
      url: url(`/admin/listings/${listingId}/suspend`),
      headers: bearer(adminToken),
    });
    expect(suspend.statusCode).toBe(201);
    expect(
      (
        await prisma.unscoped().publicFacilityListing.findUnique({
          where: { id: listingId as string },
          select: { status: true },
        })
      )?.status,
    ).toBe('SUSPENDED');

    const hidden = await app.inject({
      method: 'GET',
      url: url(`/public/facilities/${listingSlug}`),
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error.code).toBe('PUBLIC_LISTING_NOT_PUBLISHED');

    const confirm = await app.inject({
      method: 'POST',
      url: url(`/admin/listings/${listingId}/confirm`),
      headers: bearer(adminToken),
    });
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json().data.verification).toBe('DETAILS_CONFIRMED');

    const unsuspend = await app.inject({
      method: 'POST',
      url: url(`/admin/listings/${listingId}/unsuspend`),
      headers: bearer(adminToken),
    });
    expect(unsuspend.statusCode).toBe(201);
    expect(
      (
        await prisma.unscoped().publicFacilityListing.findUnique({
          where: { id: listingId as string },
          select: { status: true },
        })
      )?.status,
    ).toBe('PUBLISHED');

    const visible = await app.inject({
      method: 'GET',
      url: url(`/public/facilities/${listingSlug}`),
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().data.verification).toBe('DETAILS_CONFIRMED');
  });
});