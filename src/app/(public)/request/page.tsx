import { getTranslations } from 'next-intl/server';

import { EmergencyRequestForm } from '@/components/public/emergency-request-form';
import { getPublicFacilities } from '@/lib/data/server-facilities';

/**
 * /request — the public emergency intake form.
 *
 * Built against `POST /public/emergency-requests` from the real careOS API
 * (see src/components/public/emergency-request-form.tsx for the contract
 * re-alignment). No fixture data and no invented endpoint.
 *
 * When the facility list cannot be loaded the form is not rendered at all: the
 * facility is a required field, and presenting a select with nothing in it invites a
 * submission that can only fail.
 */
export default async function EmergencyRequestPage() {
  const t = await getTranslations('intake');
  const result = await getPublicFacilities();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-public-heading font-semibold text-primary">{t('pageTitle')}</h1>
        <p className="text-public-body text-secondary">{t('pageIntro')}</p>
      </div>

      {result.ok ? (
        <EmergencyRequestForm facilities={result.facilities} />
      ) : (
        <section aria-labelledby="unavailable" className="max-w-2xl">
          <h2 id="unavailable" className="text-public-heading font-semibold text-primary">
            {t('facilitiesUnavailable.title')}
          </h2>
          <p className="mt-2 text-public-body text-secondary">{t('facilitiesUnavailable.body')}</p>
          {/* No link to an alternative and no list of phone numbers: both would be
              invented, and in an emergency a wrong number is worse than none. */}
        </section>
      )}
    </div>
  );
}
