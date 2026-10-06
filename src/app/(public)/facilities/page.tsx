import { getTranslations } from 'next-intl/server';

import { FacilitySearch } from '@/components/public/facility-search';

/**
 * /facilities — the public facility directory.
 *
 * Built against `GET /public/facilities`, which documents `q` and `type` query
 * parameters, so the search is a real server query rather than a client-side
 * filter over a dumped list. The screen renders the API's published fields and
 * nothing else: no map coordinates (not in the contract), no hours, no invented
 * numbers.
 */
export default async function FacilitiesPage() {
  const t = await getTranslations('facilities');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-public-heading font-semibold text-primary">{t('pageTitle')}</h1>
        <p className="max-w-2xl text-public-body text-secondary">{t('pageIntro')}</p>
      </div>

      <FacilitySearch />
    </div>
  );
}
