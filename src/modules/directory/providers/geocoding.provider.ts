/**
 * Geocoding seam for the public directory (ADR-039). Coordinates stored on
 * listings/imports come from staff entry or the directory feed; the provider
 * is an opt-in external resolver. Until a real geocoder is wired the Noop
 * answers `supported:false` with no results, so consumers cannot mistake
 * absence for precision.
 */

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  county?: string;
  town?: string;
}

export interface GeocodingProvider {
  readonly name: string;
  readonly supported: boolean;
  /** Best-effort address → coordinates. Untrusted by construction. */
  geocode(query: { address?: string; town?: string; county?: string }): Promise<GeocodeResult[]>;
}

export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');

export class NoopGeocodingProvider implements GeocodingProvider {
  readonly name = 'noop';
  readonly supported = false;

  async geocode(): Promise<GeocodeResult[]> {
    return [];
  }
}