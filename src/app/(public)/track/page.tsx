import { getTranslations } from 'next-intl/server';

import { EmergencyIntakeTracker } from '@/components/public/emergency-intake-tracker';

/**
 * /track — the public emergency intake tracker.
 *
 * Built against `POST /public/emergency-requests/track` from the real careOS API
 * (see src/components/public/emergency-intake-tracker.tsx). The token this screen
 * asks for is the `trackingToken` from the /request receipt — the reference is
 * for talking to a person, the token is what proves the request is the caller's.
 * No fixture data and no invented endpoint.
 */
export default async function TrackPage() {
  const t = await getTranslations('track');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-public-heading font-semibold text-primary">{t('pageTitle')}</h1>
        <p className="text-public-body text-secondary">{t('pageIntro')}</p>
      </div>

      <EmergencyIntakeTracker />
    </div>
  );
}