'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useCreateIncident } from '@/lib/data/queries';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  QUALITY_BRANCH_ID,
  type IncidentCategory,
  type IncidentSeverity,
} from '@/lib/data/quality';

/**
 * Report an incident (Phase 10 — `POST /incidents`).
 *
 * The incident always opens OPEN — unlike a complaint there is no assignee — and
 * the service offers no create-time status. The create DTO requires a `branchId`
 * and there is no branch picker in the app (GAP-018), so it is raised against the
 * single example branch the same way admissions and appointments are. The response
 * is `{ incident }` (GAP-020), validated in `src/lib/data/quality.ts`.
 */

export function ReportIncidentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('quality.incidents');
  const create = useCreateIncident();

  const [category, setCategory] = useState<IncidentCategory>('EQUIPMENT');
  const [severity, setSeverity] = useState<IncidentSeverity>('MEDIUM');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCategory('EQUIPMENT');
    setSeverity('MEDIUM');
    setDescription('');
    setError(null);
    create.reset();
    onOpenChange(false);
  };

  const submit = () => {
    setError(null);
    if (description.trim() === '') {
      setError(t('create.errors.descriptionRequired'));
      return;
    }
    create.mutate(
      {
        branchId: QUALITY_BRANCH_ID,
        category,
        severity,
        description: description.trim(),
      },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('create.title')} description={t('create.body')} />
        <DialogBody className="flex flex-col gap-4">
          {create.isError ? (
            <p
              role="alert"
              className="border border-status-critical px-3 py-2 text-meta text-status-critical"
            >
              {create.error?.code === 'VALIDATION_ERROR'
                ? t('create.errors.invalid')
                : t('create.errors.failed')}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-4">
            <div className="w-56">
              <Field id="incident-category" label={t('create.categoryLabel')} required>
                {({ controlId }) => (
                  <Select
                    id={controlId}
                    value={category}
                    onChange={(event) => setCategory(event.target.value as IncidentCategory)}
                  >
                    {INCIDENT_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {t(`category.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="w-56">
              <Field id="incident-severity" label={t('create.severityLabel')} required>
                {({ controlId }) => (
                  <Select
                    id={controlId}
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as IncidentSeverity)}
                  >
                    {INCIDENT_SEVERITIES.map((value) => (
                      <option key={value} value={value}>
                        {t(`severity.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </div>

          <Field id="incident-description" label={t('create.descriptionLabel')} required>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={4}
                maxLength={5000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>

          {error ? (
            <p role="alert" className="text-caption text-status-critical">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {t('create.cancel')}
          </Button>
          <Button variant="primary" disabled={create.isPending} onClick={submit}>
            {create.isPending ? t('create.submitting') : t('create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
