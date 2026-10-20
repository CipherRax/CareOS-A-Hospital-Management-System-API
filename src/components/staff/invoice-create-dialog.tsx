'use client';

import { Plus, Trash2 } from 'lucide-react';
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
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useBranchOptions, useCreateInvoice, usePatientSearch } from '@/lib/data/queries';
import type { PatientListItem } from '@/lib/data/patients';

/**
 * Raise an invoice (F7 — `POST /invoices`).
 *
 * The one place in the app that picks a branch: every invoice belongs to a
 * branch, so `branchId` comes from `GET /branches` (GAP-018) instead of the
 * forced EXAMPLE branch the older create dialogs assume. The patient is chosen
 * from the same search the other desks use, and each line is priced free-hand
 * (`description` + `unitPrice`) — the server accepts a line with neither a
 * billable item nor a medication when it carries both, so this slice needs no
 * price-list read.
 *
 * The new invoice is always DRAFT: the contract offers one create call and
 * separate issue/cancel moves, so the composer does not jump the lifecycle — the
 * invoice's own screen carries the next move.
 */

interface DraftLine {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: Omit<DraftLine, 'key'> = { description: '', quantity: '1', unitPrice: '' };

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

export function CreateInvoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('billing.create');
  const create = useCreateInvoice();
  const branches = useBranchOptions();

  const activeBranches = (branches.data?.data ?? []).filter((branch) => branch.status === 'ACTIVE');

  const [branchId, setBranchId] = useState('');
  const [query, setQuery] = useState('');
  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);

  const search = usePatientSearch(query);

  const close = () => {
    setBranchId('');
    setQuery('');
    setPatient(null);
    setDueAt('');
    setNotes('');
    setLines([{ key: 1, ...EMPTY_LINE }]);
    setError(null);
    create.reset();
    onOpenChange(false);
  };

  let nextKey = 1000;
  const updateLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: number) =>
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));
  const addLine = () => setLines((current) => [...current, { key: nextKey++, ...EMPTY_LINE }]);

  const submit = () => {
    setError(null);
    if (!branchId) {
      setError(t('errorBranch'));
      return;
    }
    if (!patient) {
      setError(t('errorPatient'));
      return;
    }
    const filled = lines.filter((line) => line.description.trim() !== '' || line.unitPrice.trim() !== '');
    if (filled.length === 0) {
      setError(t('errorNoLines'));
      return;
    }
    const items = [];
    for (const line of filled) {
      if (line.description.trim() === '') {
        setError(t('errorLineDescription'));
        return;
      }
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setError(t('errorLineQuantity'));
        return;
      }
      const unitPrice = line.unitPrice.trim();
      if (!AMOUNT_PATTERN.test(unitPrice)) {
        setError(t('errorLinePrice'));
        return;
      }
      items.push({ description: line.description.trim(), quantity, unitPrice });
    }
    create.mutate(
      {
        branchId,
        patientId: patient.id,
        items,
        ...(dueAt ? { dueAt } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('title')} description={t('body')} />
        <DialogBody className="flex flex-col gap-4">
          {create.isError ? (
            <p
              role="alert"
              className="border border-status-critical px-3 py-2 text-meta text-status-critical"
            >
              {create.error?.code === 'VALIDATION_ERROR' ? t('invalid') : t('failed')}
            </p>
          ) : null}

          <Field id="invoice-branch" label={t('branch')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.target.value);
                  if (error) setError(null);
                }}
              >
                <option value="">{t('chooseBranch')}</option>
                {activeBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {activeBranches.length === 0 && branches.isSuccess ? (
            <p role="alert" className="text-caption text-status-critical">
              {t('errorBranch')}
            </p>
          ) : null}

          {patient ? (
            <div className="flex items-center justify-between gap-3 border border-border px-3 py-2">
              <span className="text-body text-primary">{patient.displayName}</span>
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => {
                  setPatient(null);
                  setQuery('');
                }}
              >
                {t('changePatient')}
              </Button>
            </div>
          ) : (
            <>
              <Field id="invoice-patient-search" label={t('patient')} required>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    value={query}
                    placeholder={t('patientPlaceholder')}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                )}
              </Field>
              {query.trim() ? (
                search.isLoading ? (
                  <p role="status" className="text-meta text-tertiary">
                    {t('searching')}
                  </p>
                ) : (search.data?.data.items.length ?? 0) === 0 ? (
                  <p className="text-meta text-secondary">{t('noPatients')}</p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto border border-border">
                    {search.data?.data.items.map((item) => (
                      <li key={item.id} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            setPatient(item);
                            if (error) setError(null);
                          }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-hover"
                        >
                          <span className="text-body text-primary">{item.displayName}</span>
                          <span className="text-caption tabular-nums text-tertiary">
                            {item.patientNumber}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}

          <fieldset className="flex flex-col gap-3 border border-border px-3 py-3">
            <legend className="text-meta font-medium text-primary">{t('linesTitle')}</legend>
            <ul className="flex flex-col gap-3">
              {lines.map((line, index) => (
                <li key={line.key} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-48 flex-1">
                    <Field id={`invoice-line-description-${line.key}`} label={t('lineDescription')}>
                      {({ controlId }) => (
                        <Input
                          id={controlId}
                          value={line.description}
                          onChange={(event) => {
                            updateLine(line.key, { description: event.target.value });
                            if (error) setError(null);
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="w-24">
                    <Field id={`invoice-line-quantity-${line.key}`} label={t('lineQuantity')}>
                      {({ controlId }) => (
                        <Input
                          id={controlId}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="w-32">
                    <Field id={`invoice-line-price-${line.key}`} label={t('lineUnitPrice')}>
                      {({ controlId }) => (
                        <Input
                          id={controlId}
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(event) => {
                            updateLine(line.key, { unitPrice: event.target.value });
                            if (error) setError(null);
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <Button
                    variant="tertiary"
                    size="sm"
                    aria-label={t('removeLine', { index: index + 1 })}
                    disabled={lines.length === 1}
                    onClick={() => removeLine(line.key)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button variant="secondary" size="sm" onClick={addLine}>
                <Plus aria-hidden className="size-4" />
                {t('addLine')}
              </Button>
            </div>
          </fieldset>

          <Field id="invoice-due" label={t('due')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            )}
          </Field>

          <Field id="invoice-notes" label={t('notes')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
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
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={create.isPending} onClick={submit}>
            {create.isPending ? t('creating') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
