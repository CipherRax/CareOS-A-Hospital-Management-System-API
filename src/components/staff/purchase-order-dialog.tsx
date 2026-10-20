'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useBranchOptions,
  useCreatePurchaseOrder,
  useMedications,
  useStockOnHand,
  useSuppliers,
} from '@/lib/data/queries';

/**
 * Raise a purchase order (F6 — procurement write, `POST /purchase-orders`).
 *
 * The order is always created DRAFT: the contract offers one create call and
 * separate submit/approve/order moves, so this composer does not offer to jump
 * the workflow — the new order's own screen carries the next move.
 *
 * The order is raised against a branch picked from `GET /branches`
 * (`useBranchOptions()`, GAP-018), defaulting to the branch the stock read reports
 * so the common case needs no change. A medication may appear on only one line:
 * the service rejects duplicates by comparing the distinct id count, so the form
 * refuses them before the request goes out. `unitCost` is the one field the API's
 * DTO genuinely wants as a number (`z.coerce.number().nonnegative()`); the server
 * stores it as `Decimal(12, 2)`, and nothing here reads a money value back.
 */

interface DraftLine {
  key: number;
  medicationId: string;
  quantity: string;
  unitCost: string;
}

const EMPTY_LINE: Omit<DraftLine, 'key'> = { medicationId: '', quantity: '', unitCost: '' };

export function RaisePurchaseOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('pharmacy.purchaseOrders');
  const create = useCreatePurchaseOrder();
  const suppliers = useSuppliers({ limit: 100 });
  const medications = useMedications({ isActive: 'true' });
  const stock = useStockOnHand({});
  const branches = useBranchOptions();

  const stockBranchId = stock.data?.data[0]?.branchId ?? null;
  const activeBranches = (branches.data?.data ?? []).filter((branch) => branch.status === 'ACTIVE');
  const catalog = medications.data?.data.items ?? [];
  const supplierRows = suppliers.data?.data.rows.filter((supplier) => supplier.isActive) ?? [];

  const [branchId, setBranchId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);

  // Seed the picker from the stock branch once either read settles, but never
  // overwrite a choice the operator has already made.
  useEffect(() => {
    if (!branchId && stockBranchId) setBranchId(stockBranchId);
  }, [branchId, stockBranchId]);

  const close = () => {
    setBranchId('');
    setSupplierId('');
    setExpectedAt('');
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
    if (!supplierId) {
      setError(t('errorSupplier'));
      return;
    }
    const filled = lines.filter((line) => line.medicationId !== '' || line.quantity.trim() !== '');
    if (filled.length === 0) {
      setError(t('errorNoLines'));
      return;
    }
    if (filled.some((line) => line.medicationId === '')) {
      setError(t('errorNoLines'));
      return;
    }
    const distinct = new Set(filled.map((line) => line.medicationId));
    if (distinct.size !== filled.length) {
      setError(t('errorDuplicate'));
      return;
    }
    const items = [];
    for (const line of filled) {
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setError(t('errorQuantity'));
        return;
      }
      const unitCost = line.unitCost.trim() === '' ? undefined : Number(line.unitCost);
      if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) {
        setError(t('errorUnitCost'));
        return;
      }
      items.push({ medicationId: line.medicationId, quantityOrdered: quantity, ...(unitCost !== undefined ? { unitCost } : {}) });
    }
    if (!branchId) {
      setError(t('errorNoBranch'));
      return;
    }
    create.mutate(
      {
        branchId,
        supplierId,
        ...(expectedAt ? { expectedAt } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items,
      },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('createTitle')} description={t('createBody')} />
        <DialogBody className="flex flex-col gap-4">
          {create.isError ? (
            <p
              role="alert"
              className="border border-status-critical px-3 py-2 text-meta text-status-critical"
            >
              {create.error?.code === 'VALIDATION_ERROR' ? t('createInvalid') : t('createFailed')}
            </p>
          ) : null}

          <Field id="po-branch" label={t('branchLabel')} required>
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

          <Field id="po-supplier" label={t('supplierLabel')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={supplierId}
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  if (error) setError(null);
                }}
              >
                <option value="">{t('chooseSupplier')}</option>
                {supplierRows.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {supplierRows.length === 0 && !suppliers.isLoading ? (
            <p className="text-caption text-secondary">{t('noSuppliers')}</p>
          ) : null}

          <Field id="po-expected" label={t('expectedLabel')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="date"
                value={expectedAt}
                onChange={(event) => setExpectedAt(event.target.value)}
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-3 border border-border px-3 py-3">
            <legend className="text-meta font-medium text-primary">{t('linesTitle')}</legend>
            <ul className="flex flex-col gap-3">
              {lines.map((line, index) => (
                <li key={line.key} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-48 flex-1">
                    <Field id={`po-line-medication-${line.key}`} label={t('lineMedication')}>
                      {({ controlId }) => (
                        <Select
                          id={controlId}
                          value={line.medicationId}
                          onChange={(event) => {
                            updateLine(line.key, { medicationId: event.target.value });
                            if (error) setError(null);
                          }}
                        >
                          <option value="">{t('chooseMedication')}</option>
                          {catalog.map((medication) => (
                            <option key={medication.id} value={medication.id}>
                              {medication.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  </div>
                  <div className="w-28">
                    <Field id={`po-line-quantity-${line.key}`} label={t('lineQuantity')}>
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
                    <Field id={`po-line-cost-${line.key}`} label={t('lineUnitCost')}>
                      {({ controlId }) => (
                        <Input
                          id={controlId}
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={line.unitCost}
                          onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
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

          <Field id="po-notes" label={t('notesLabel')}>
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
            {create.isPending ? t('creating') : t('createSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
