import type { Prisma } from '@prisma/client';

/**
 * Typed reader for OrganizationSetting.data (laboratory settings).
 * Unknown/missing values fall back to safe defaults so an empty row behaves
 * like no row.
 */
export interface LaboratorySettings {
  /**
   * When true, a lab technician cannot verify their own entered results — a
   * different user must verify (the brief's "authorized reviewer ... different
   * user than the enterer when the org policy requires").
   */
  requireDifferentVerifier: boolean;
}

export const DEFAULT_LABORATORY_SETTINGS: LaboratorySettings = {
  requireDifferentVerifier: false,
};

export interface OrgSettings {
  laboratory: LaboratorySettings;
}

export function parseLabOrgSettings(
  data: Prisma.JsonValue | null | undefined,
): OrgSettings {
  const raw = data as
    | {
        laboratory?: Partial<LaboratorySettings> | null;
      }
    | null
    | undefined;

  return {
    laboratory: {
      requireDifferentVerifier:
        raw?.laboratory?.requireDifferentVerifier ??
        DEFAULT_LABORATORY_SETTINGS.requireDifferentVerifier,
    },
  };
}