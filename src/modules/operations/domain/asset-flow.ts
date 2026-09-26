import type { Asset } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Asset lifecycle (brief Phase 10 §7.11). Assets carry an org-unique asset tag
 * and a status; retiring (or disposing) is a one-way trip. Actors record the
 * change, RLS keeps the rows tenant-scoped.
 */

export function assertAssetTag(value: string): string {
  const tag = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(tag)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message:
        'assetTag must be 1-40 characters using A-Z, 0-9 and dashes (letters are upper-cased).',
      silent: true,
    });
  }
  return tag;
}

/** Retiring/disposing requires the asset to still be in service. */
export function assertAssetRetirable(
  asset: Pick<Asset, 'status'>,
): void {
  if (asset.status === 'RETIRED' || asset.status === 'DISPOSED') {
    throw new AppError({
      code: ErrorCodes.ASSET_STATE_CONFLICT,
      message: `An asset in ${asset.status} state cannot be retired again.`,
      silent: true,
    });
  }
}