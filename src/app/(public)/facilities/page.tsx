import { getTranslations } from 'next-intl/server';

import { FacilitySearch } from '@/components/public/facility-search';

/**
 * /facilities — the public facility directory.
 *
 * Built against `GET /public/facilities/search` from the real careOS API. The
 * server does the `q` query; the facets (`open24h`, `emergency24h`,
 * `ambulanceAvailable`) are the API's own fields and apply client-side. The
 * screen renders the API's published fields and nothing else: no map coordinates,
 * no invented hours, no invented numbers.
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
