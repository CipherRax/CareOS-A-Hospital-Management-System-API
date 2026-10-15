'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { AdminActionAlert } from '@/components/staff/admin-alert';
import { useOrganization, useUpdateOrganization } from '@/lib/data/queries';
import type { OrganizationRow, OrganizationStatus } from '@/lib/data/admin';

/**
 * Organization profile (F9 administration).
 *
 * The single organization the signed-in account belongs to. The read answers
 * `{ organization }` while the export types the bare entity (GAP-020), so the body
 * is validated in `src/lib/data/admin.ts`. Only the identity-block fields the
 * service accepts are editable (`PATCH /organizations/me`); `name`, `status`,
 * `currency`, `timezone` and `country` are set upstream and shown read-only. An
 * email that collides with an account is refused with a 409 `CONFLICT`.
 */

const ORGANIZATION_STATUS_TONE: Record<OrganizationStatus, StatusTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'critical',
};

export function OrganizationScreen() {
  const t = useTranslations('admin');
  const organization = useOrganization();

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold text-primary">{t('organizationTitle')}</h1>
        <p className="text-meta text-secondary">{t('organizationIntro')}</p>
      </header>

      {organization.isLoading && !organization.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingOrganization')}
        </p>
      ) : organization.error ? (
        <EmptyState
          title={t('organizationUnavailableTitle')}
          description={t('organizationUnavailableBody')}
          headingLevel={2}
        />
      ) : !organization.data ? (
        <EmptyState
          title={t('organizationUnavailableTitle')}
          description={t('organizationUnavailableBody')}
          headingLevel={2}
        />
      ) : (
        <OrganizationBody organization={organization.data.data} />
      )}
    </div>
  );
}

function OrganizationBody({ organization }: { organization: OrganizationRow }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const update = useUpdateOrganization();

  const [legalName, setLegalName] = useState(organization.legalName ?? '');
  const [tradingName, setTradingName] = useState(organization.tradingName ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(organization.registrationNumber ?? '');
  const [kraPin, setKraPin] = useState(organization.kraPin ?? '');
  const [phone, setPhone] = useState(organization.phone ?? '');
  const [email, setEmail] = useState(organization.email ?? '');
  const [website, setWebsite] = useState(organization.website ?? '');
  const [logoUrl, setLogoUrl] = useState(organization.logoUrl ?? '');
  const [address, setAddress] = useState(organization.address ?? '');
  const [county, setCounty] = useState(organization.county ?? '');
  const [town, setTown] = useState(organization.town ?? '');

  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  const save = () => {
    update.mutate({
      legalName: legalName.trim() || undefined,
      registrationNumber: registrationNumber.trim() || undefined,
      kraPin: kraPin.trim() || undefined,
      tradingName: tradingName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
      logoUrl: logoUrl.trim() || null,
      address: address.trim() || null,
      county: county.trim() || null,
      town: town.trim() || null,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-subheading font-semibold text-primary">{organization.name}</h2>
          <StatusPill
            tone={ORGANIZATION_STATUS_TONE[organization.status]}
            label={t(`organizationStatus.${organization.status}`)}
          />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-meta sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('organizationFieldCurrency')}</dt>
            <dd className="text-primary">{organization.currency || t('organizationUnset')}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('organizationFieldTimezone')}</dt>
            <dd className="text-primary">{organization.timezone || t('organizationUnset')}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('organizationFieldCountry')}</dt>
            <dd className="text-primary">{organization.country || t('organizationUnset')}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('organizationFieldCreated')}</dt>
            <dd className="tabular-nums text-primary">
              {organization.createdAt ? formatDateTime(organization.createdAt) : t('organizationUnset')}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('organizationFieldUpdated')}</dt>
            <dd className="tabular-nums text-primary">
              {organization.updatedAt ? formatDateTime(organization.updatedAt) : t('organizationUnset')}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-subheading font-semibold text-primary">
          {t('organizationDetailsHeading')}
        </h2>
        <AdminActionAlert error={update.error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="org-legal-name" label={t('organizationFieldLegalName')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-trading-name" label={t('organizationFieldTradingName')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={tradingName}
                onChange={(event) => setTradingName(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-registration" label={t('organizationFieldRegistrationNumber')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={registrationNumber}
                onChange={(event) => setRegistrationNumber(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-kra" label={t('organizationFieldKraPin')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={kraPin}
                onChange={(event) => setKraPin(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-phone" label={t('organizationFieldPhone')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-email" label={t('organizationFieldEmail')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-website" label={t('organizationFieldWebsite')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-logo" label={t('organizationFieldLogoUrl')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-county" label={t('organizationFieldCounty')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={county}
                onChange={(event) => setCounty(event.target.value)}
              />
            )}
          </Field>
          <Field id="org-town" label={t('organizationFieldTown')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={town}
                onChange={(event) => setTown(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field id="org-address" label={t('organizationFieldAddress')}>
          {({ controlId }) => (
            <Textarea
              id={controlId}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" disabled={update.isPending} onClick={save}>
            {t('saveOrganization')}
          </Button>
        </div>
      </section>
    </div>
  );
}
