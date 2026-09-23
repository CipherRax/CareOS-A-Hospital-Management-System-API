import type { Prisma } from '@prisma/client';

/**
 * Typed reader for OrganizationSetting.data. Phase 3 settings (waitlist).
 * Unknown/missing values fall back to safe defaults, so an empty settings row
 * behaves the same as no row.
 */

export interface WaitlistSettings {
  /** Offer window customers have to accept a cancelled slot. */
  offerExpiryMinutes: number;
  /** When true, an offer is booked immediately instead of waiting for a reply. */
  autoBook: boolean;
  /** Per-department maximum; 0 disables the cap. */
  maxPerDepartment: number;
}

export const DEFAULT_WAITLIST_SETTINGS: WaitlistSettings = {
  offerExpiryMinutes: 15,
  autoBook: false,
  maxPerDepartment: 0,
};

export interface OrgSettings {
  waitlist: WaitlistSettings;
}

export function parseOrgSettings(data: Prisma.JsonValue | null | undefined): OrgSettings {
  const raw = data as
    | {
        waitlist?: Partial<WaitlistSettings> | null;
      }
    | null
    | undefined;

  return {
    waitlist: {
      offerExpiryMinutes:
        raw?.waitlist?.offerExpiryMinutes ?? DEFAULT_WAITLIST_SETTINGS.offerExpiryMinutes,
      autoBook: raw?.waitlist?.autoBook ?? DEFAULT_WAITLIST_SETTINGS.autoBook,
      maxPerDepartment:
        raw?.waitlist?.maxPerDepartment ?? DEFAULT_WAITLIST_SETTINGS.maxPerDepartment,
    },
  };
}