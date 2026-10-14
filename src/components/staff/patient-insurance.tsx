'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/primitives';
import { useCreatePolicy, useInsurancePayers, useInsurancePolicies } from '@/lib/data/queries';
import type { CoverageType, InsurancePolicyRow } from '@/lib/data/insurance';

/**
 * Patient insurance panel (F7) — a patient's payer policies.
 *
 * Rendered inside the patient master record's Insurance tab. `GET
 * /insurance/policies` mis-types its 200 as the request DTO while the service
 * answers a `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/insurance.ts`. Enrolling posts to `POST /insurance/policies`,
 * which answers `{ policy }`; a `PARTIAL` policy without a coverage percent is a
 * 400 and an unknown payer a 404, both surfaced in the dialog.
 */

export function PatientInsurancePanel({ patientId }: { patientId: string }) {
  const t = useTranslations('insurance');
  const policies = useInsurancePolicies({ patientId });
  const payers = useInsurancePayers();

  const [enrolOpen, setEnrolOpen] = useState(false);

  const payerName = (id: string) =>
    payers.data?.data.rows.find((payer) => payer.id === id)?.name ?? id;

  const rows = policies.data?.data.rows ?? [];
  const columns: readonly DataTableColumn<InsurancePolicyRow>[] = [
    {
      key: 'policy',
      header: t('policies.columnPolicy'),
      cell: (row) => <span className="font-medium tabular-nums text-primary">{row.policyNumber}</span>,
    },
    {
      key: 'payer',
      header: t('policies.columnPayer'),
      cell: (row) => <span className="text-secondary">{payerName(row.payerId)}</span>,
    },
    {
      key: 'coverage',
      header: t('policies.columnCoverage'),
      cell: (row) => (
        <span className="text-secondary">
          {row.coverageType === 'FULL'
            ? t('policies.coverageFull', { percent: row.coveragePercent })
            : t('policies.coveragePartial', { percent: row.coveragePercent })}
        </span>
      ),
    },
    {
      key: 'validity',
      header: t('policies.columnValidity'),
      cell: (row) => <ValidityCell policy={row} />,
    },
    {
      key: 'status',
      header: t('policies.columnStatus'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={row.isActive ? 'success' : 'neutral'}
          label={row.isActive ? t('policies.active') : t('policies.inactive')}
        />
      ),
    },
  ];

  return (
    <div
      id="panel-insurance"
      role="tabpanel"
      aria-labelledby="tab-insurance"
      className="flex flex-col gap-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading-xs font-semibold text-primary">{t('policies.heading')}</h2>
        <Button variant="secondary" size="sm" onClick={() => setEnrolOpen(true)}>
          {t('policies.enroll')}
        </Button>
      </header>

      {policies.error ? (
        <p className="text-meta text-secondary">{t('policies.unavailable')}</p>
      ) : rows.length === 0 && !policies.isLoading ? (
        <p className="text-meta text-secondary">{t('policies.empty')}</p>
      ) : (
        <DataTable<InsurancePolicyRow>
          caption={t('policies.heading')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={policies.isLoading}
          emptyMessage={t('policies.empty')}
        />
      )}

      <EnrolPolicyDialog
        key={`enrol-${patientId}`}
        open={enrolOpen}
        patientId={patientId}
        onOpenChange={setEnrolOpen}
      />
    </div>
  );
}

function ValidityCell({ policy }: { policy: InsurancePolicyRow }) {
  const t = useTranslations('insurance');
  const locale = useLocale();

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));

  if (policy.validityStart && policy.validityEnd) {
    return (
      <span className="whitespace-nowrap tabular-nums text-secondary">
        {t('policies.validRange', {
          start: format(policy.validityStart),
          end: format(policy.validityEnd),
        })}
      </span>
    );
  }
  if (policy.validityStart) {
    return (
      <span className="whitespace-nowrap tabular-nums text-secondary">
        {t('policies.validFrom', { start: format(policy.validityStart) })}
      </span>
    );
  }
  if (policy.validityEnd) {
    return (
      <span className="whitespace-nowrap tabular-nums text-secondary">
        {t('policies.validUntil', { end: format(policy.validityEnd) })}
      </span>
    );
  }
  return <span className="text-tertiary">{t('policies.noValidity')}</span>;
}

function EnrolPolicyDialog({
  open,
  patientId,
  onOpenChange,
}: {
  open: boolean;
  patientId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('insurance');
  const payers = useInsurancePayers();
  const createPolicy = useCreatePolicy();
  const active = (payers.data?.data.rows ?? []).filter((payer) => payer.isActive);

  const [payerId, setPayerId] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [coverageType, setCoverageType] = useState<CoverageType>('PARTIAL');
  const [coveragePercent, setCoveragePercent] = useState('');
  const [validityStart, setValidityStart] = useState('');
  const [validityEnd, setValidityEnd] = useState('');
  const [policyActive, setPolicyActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPayerId('');
    setPolicyNumber('');
    setCoverageType('PARTIAL');
    setCoveragePercent('');
    setValidityStart('');
    setValidityEnd('');
    setPolicyActive(true);
    setError(null);
    createPolicy.reset();
    onOpenChange(false);
  };

  const submit = () => {
    if (!payerId) {
      setError(t('policies.payerRequired'));
      return;
    }
    const trimmedPolicy = policyNumber.trim();
    if (!trimmedPolicy) {
      setError(t('policies.policyNumberRequired'));
      return;
    }
    let percent: number | undefined;
    if (coverageType === 'PARTIAL') {
      const trimmed = coveragePercent.trim();
      const parsed = Number(trimmed);
      if (!trimmed || !Number.isInteger(parsed) || parsed < 1 || parsed > 99) {
        setError(t('policies.coveragePercentInvalid'));
        return;
      }
      percent = parsed;
    }
    createPolicy.mutate(
      {
        patientId,
        payerId,
        policyNumber: trimmedPolicy,
        coverageType,
        coveragePercent: percent,
        validityStart: validityStart || undefined,
        validityEnd: validityEnd || undefined,
        isActive: policyActive,
      },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('policies.dialogTitle')} description={t('policies.dialogBody')} />
        <DialogBody className="flex flex-col gap-4">
          {payers.isLoading ? (
            <p className="text-meta text-tertiary">{t('policies.loading')}</p>
          ) : active.length === 0 ? (
            <p className="text-meta text-secondary">{t('policies.noPayers')}</p>
          ) : (
            <Field id="policy-payer" label={t('policies.payer')} required>
              {({ controlId }) => (
                <Select
                  id={controlId}
                  value={payerId}
                  onChange={(event) => {
                    setPayerId(event.target.value);
                    if (error) setError(null);
                  }}
                >
                  <option value="">{t('policies.choosePayer')}</option>
                  {active.map((payer) => (
                    <option key={payer.id} value={payer.id}>
                      {payer.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field id="policy-number" label={t('policies.policyNumber')} required>
            {({ controlId, invalid }) => (
              <Input
                id={controlId}
                invalid={invalid}
                value={policyNumber}
                onChange={(event) => {
                  setPolicyNumber(event.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>
          <Field id="policy-coverage-type" label={t('policies.coverageType')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={coverageType}
                onChange={(event) => {
                  setCoverageType(event.target.value as CoverageType);
                  if (error) setError(null);
                }}
              >
                <option value="FULL">{t('policies.coverageFullOption')}</option>
                <option value="PARTIAL">{t('policies.coveragePartialOption')}</option>
              </Select>
            )}
          </Field>
          {coverageType === 'PARTIAL' ? (
            <Field id="policy-coverage-percent" label={t('policies.coveragePercent')} required>
              {({ controlId, invalid }) => (
                <Input
                  id={controlId}
                  invalid={invalid}
                  inputMode="numeric"
                  value={coveragePercent}
                  onChange={(event) => {
                    setCoveragePercent(event.target.value);
                    if (error) setError(null);
                  }}
                />
              )}
            </Field>
          ) : null}
          <Field id="policy-validity-start" label={t('policies.validityStart')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="date"
                value={validityStart}
                onChange={(event) => setValidityStart(event.target.value)}
              />
            )}
          </Field>
          <Field id="policy-validity-end" label={t('policies.validityEnd')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="date"
                value={validityEnd}
                onChange={(event) => setValidityEnd(event.target.value)}
              />
            )}
          </Field>
          <CheckboxField
            id="policy-active"
            label={t('policies.active')}
            checked={policyActive}
            onCheckedChange={(next) => setPolicyActive(next === true)}
          />
          {error ? (
            <p role="alert" className="text-caption text-status-critical">
              {error}
            </p>
          ) : null}
          {createPolicy.isError && !error ? (
            <p role="alert" className="text-caption text-status-critical">
              {t('policies.failedBody')}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={createPolicy.isPending || active.length === 0}
            onClick={submit}
          >
            {t('policies.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
