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
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useCreateComplaint, useUsers } from '@/lib/data/queries';
import { COMPLAINT_ORIGINS, type ComplaintOrigin } from '@/lib/data/quality';

/**
 * Raise a complaint (Phase 10 — `POST /complaints`).
 *
 * The complaint is created OPEN; an assignee may be chosen here, which opens it
 * ASSIGNED as the service does when an assignee is given. There is no branch or
 * patient picker in the app (GAP-018), so those fields are left to the server
 * defaults; the origin and the description are the fields an officer actually
 * enters. The response is `{ complaint }` (GAP-020), validated in
 * `src/lib/data/quality.ts`.
 */

export function RaiseComplaintDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('quality.complaints');
  const create = useCreateComplaint();
  const users = useUsers({ limit: 100 });

  const assignees = users.data?.data.rows.filter((user) => user.status === 'ACTIVE') ?? [];

  const [origin, setOrigin] = useState<ComplaintOrigin>('PATIENT');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOrigin('PATIENT');
    setCategory('');
    setDescription('');
    setDueAt('');
    setAssignedToId('');
    setError(null);
    create.reset();
    onOpenChange(false);
  };

  const submit = () => {
    setError(null);
    if (category.trim() === '') {
      setError(t('create.errors.categoryRequired'));
      return;
    }
    if (description.trim() === '') {
      setError(t('create.errors.descriptionRequired'));
      return;
    }
    create.mutate(
      {
        origin,
        category: category.trim(),
        description: description.trim(),
        ...(dueAt ? { dueAt } : {}),
        ...(assignedToId ? { assignedToId } : {}),
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

          <Field id="complaint-origin" label={t('create.originLabel')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={origin}
                onChange={(event) => setOrigin(event.target.value as ComplaintOrigin)}
              >
                {COMPLAINT_ORIGINS.map((value) => (
                  <option key={value} value={value}>
                    {t(`origin.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="complaint-category" label={t('create.categoryLabel')} required>
            {({ controlId }) => (
              <Input
                id={controlId}
                maxLength={200}
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>

          <Field id="complaint-description" label={t('create.descriptionLabel')} required>
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

          <div className="flex flex-wrap gap-4">
            <div className="w-56">
              <Field id="complaint-due" label={t('create.dueLabel')}>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    type="date"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="w-56">
              <Field id="complaint-assignee" label={t('create.assigneeLabel')}>
                {({ controlId }) => (
                  <Select
                    id={controlId}
                    value={assignedToId}
                    onChange={(event) => setAssignedToId(event.target.value)}
                  >
                    <option value="">{t('create.chooseAssignee')}</option>
                    {assignees.map((user) => (
                      <option key={user.id} value={user.id}>
                        {`${user.firstName} ${user.lastName}`.trim()}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </div>

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
