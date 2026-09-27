import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PublicFacilityListing } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { distanceKm } from '../domain/directory';

/**
 * Geo search for the public directory (ADR-039). Lat/lng are the canonical
 * doubles; PostGIS is optional. The repository probes for the extension once
 * (cached) and then serves two equivalent paths:
 *   - PostGIS: ST_DWithin on cast geography for accurate radial candidates.
 *   - fallback (any PostgreSQL): a clamped bounding-box narrowing.
 * Both paths only narrow candidates; the exact great-circle distance is
 * computed in application code so results are identical across replicas and
 * extensions. Only PUBLISHED rows are ever reachable from here.
 */
@Injectable()
export class GeoRepository {
  private readonly logger = new Logger(GeoRepository.name);
  private postgisProbe?: Promise<boolean>;

  constructor(private readonly prisma: PrismaService) {}

  private postgisAvailable(): Promise<boolean> {
    if (this.postgisProbe === undefined) {
      this.postgisProbe = this.prisma
        .unscoped()
        .$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`SELECT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'st_makepoint'
        ) AS exists`)
        .then((rows) => rows[0]?.exists === true)
        .catch((err: unknown) => {
          this.logger.debug({ err: String(err) }, 'postgis probe failed; using fallback');
          return false;
        });
    }
    return this.postgisProbe;
  }

  async nearby(input: {
    latitude: number;
    longitude: number;
    radiusKm: number;
    limit: number;
  }): Promise<PublicFacilityListing[]> {
    const db = this.prisma.unscoped();
    const { latitude, longitude, radiusKm, limit } = input;

    const ids = await this.radiusCandidateIds({ latitude, longitude, radiusKm, limit });
    if (ids.length === 0) return [];

    const rows = await db.publicFacilityListing.findMany({
      where: { id: { in: ids }, status: 'PUBLISHED' },
    });

    const withDistance = rows
      .filter(
        (r) => r.locationLat !== null && r.locationLng !== null,
      )
      .map((r) => ({
        row: r as PublicFacilityListing,
        distance: distanceKm(latitude, longitude, r.locationLat as number, r.locationLng as number),
      }))
      .filter((c) => c.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((c) => c.row);

    return withDistance;
  }

  /** Narrowing only — exact filtering/sorting happens in application code. */
  private async radiusCandidateIds(input: {
    latitude: number;
    longitude: number;
    radiusKm: number;
    limit: number;
  }): Promise<string[]> {
    const db = this.prisma.unscoped();
    const { latitude, longitude, radiusKm, limit } = input;
    const radiusMeters = Math.max(1, Math.round(radiusKm * 1000));
    const probe = await this.postgisAvailable();
    const wanted = Math.max(limit * 2, 30);

    if (probe) {
      const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "public_facility_listings"
        WHERE "status" = 'PUBLISHED'
          AND "locationLat" IS NOT NULL AND "locationLng" IS NOT NULL
          AND ST_DWithin(
            ST_MakePoint("locationLng", "locationLat")::geography,
            ST_MakePoint(${longitude}, ${latitude})::geography,
            ${radiusMeters}
          )
        ORDER BY "locationLat" - ${latitude} + "locationLng" - ${longitude}
        LIMIT ${wanted}
      `);
      return rows.map((r) => r.id);
    }

    const kmPerDegLat = 110.574;
    const kmPerDegLng = 111.32 * Math.cos((latitude * Math.PI) / 180);
    const dLat = radiusKm / kmPerDegLat || 0.01;
    const dLng = radiusKm / kmPerDegLng || 0.01;
    const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "public_facility_listings"
      WHERE "status" = 'PUBLISHED'
        AND "locationLat" IS NOT NULL AND "locationLng" IS NOT NULL
        AND "locationLat" BETWEEN ${latitude - dLat} AND ${latitude + dLat}
        AND "locationLng" BETWEEN ${longitude - dLng} AND ${longitude + dLng}
      LIMIT ${wanted}
    `);
    return rows.map((r) => r.id);
  }
}