import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '../../../config/config.module';
import { ENV } from '../../../config/config.module';

/**
 * Facility-directory source feed (ADR-038; brief §6.14). Rows ingested by the
 * admin importer become partner:false stand-ins until staff confirm details
 * into a public listing. The live CSV feed is a data URI/env-configured URL;
 * without one the feed is simply disabled (empty).
 */

export interface FacilityDirectoryRow {
  /** Stable external id — the dedup key across runs. */
  sourceId: string;
  name: string;
  address?: string;
  county?: string;
  town?: string;
  phone?: string;
  email?: string;
  website?: string;
  locationLat?: number;
  locationLng?: number;
  licence?: string;
}

export interface FacilityDirectoryProvider {
  readonly name: string;
  readonly enabled: boolean;
  fetchRows(): Promise<FacilityDirectoryRow[]>;
}

export const FACILITY_DIRECTORY_PROVIDER = Symbol('FACILITY_DIRECTORY_PROVIDER');

/** Raw external feed is uncontrolled — every field is treated as untrusted. */
@Injectable()
export class RemoteCsvFacilityDirectoryProvider implements FacilityDirectoryProvider {
  readonly name = 'csv';
  readonly enabled: boolean;
  private readonly logger = new Logger(RemoteCsvFacilityDirectoryProvider.name);

  constructor(@Inject(ENV) private readonly env: Env) {
    this.enabled = Boolean(this.env.PUBLIC_FACILITY_SOURCE_CSV_URL);
  }

  async fetchRows(): Promise<FacilityDirectoryRow[]> {
    const url = this.env.PUBLIC_FACILITY_SOURCE_CSV_URL;
    if (!url) return [];
    const text = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
        return r.text();
      })
      .catch((err: unknown) => {
        this.logger.warn({ err: String(err) }, 'facility directory feed unavailable');
        return null;
      });
    if (text === null) return [];
    const rows = parseFacilityCsv(text);
    this.logger.log(`facility directory feed: ${rows.length} rows (${url})`);
    return rows;
  }
}

/**
 * Minimal RFC4180-ish CSV parser for the facility feed (quoted fields, escaped
 * quotes, CRLF/LF). Headers: sourceId,name,address,county,town,phone,email,
 * website,lat,lng,licence. Skips malformed lines rather than failing the run.
 */
export function parseFacilityCsv(text: string): FacilityDirectoryRow[] {
  const records = csvRecords(text);
  if (records.length === 0) return [];
  const first = records[0];
  if (!first) return [];
  const header = first.map((h) => h.trim().toLowerCase());
  const build = (row: string[], fields: string[]): Record<string, string> =>
    Object.fromEntries(fields.map((f, i) => [f, (row[i] ?? '').trim()]));

  const out: FacilityDirectoryRow[] = [];
  for (const row of records.slice(1)) {
    if (row.length === 0) continue;
    if (row.length === 1 && (row[0] ?? '').trim() === '') continue;
    const f = build(row, header);
    const sourceId = f['sourceid'] ?? f['id'] ?? f['facilityid'];
    if (!sourceId || !f['name']) continue;
    const num = (v: string | undefined): number | undefined => {
      const n = Number(v);
      return v !== undefined && v !== '' && Number.isFinite(n) ? n : undefined;
    };
    out.push({
      sourceId,
      name: f['name'],
      address: f['address'] || undefined,
      county: f['county'] || undefined,
      town: f['town'] || undefined,
      phone: f['phone'] || undefined,
      email: f['email'] || undefined,
      website: f['website'] || undefined,
      locationLat: num(f['lat']),
      locationLng: num(f['lng']),
      licence: f['licence'] || undefined,
    });
  }
  return out;
}

function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      current.push(field);
      field = '';
    } else if (c === '\n') {
      current.push(field);
      records.push(current);
      current = [];
      field = '';
    } else if (c === '\r') {
      // swallow; \n terminates
    } else {
      field += c;
    }
  }
  if (field !== '' || current.length > 0) {
    current.push(field);
    records.push(current);
  }
  return records.filter((r) => r.some((c) => c.trim() !== ''));
}