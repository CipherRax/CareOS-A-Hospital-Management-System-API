'use client';

import { useTranslations } from 'next-intl';

import type { QueryError } from '@/lib/data/queries';

/**
 * Renders the outcome of an administration write in the API's own error
 * vocabulary, so a conflict, a denied escalation and a validation failure read as
 * different problems rather than one generic "something went wrong".
 *
 * `role="alert"` because these appear after an action the operator just took,
 * without moving focus.
 */
export function AdminActionAlert({ error }: { error: QueryError | null | undefined }) {
  const t = useTranslations('admin');
  if (!error) return null;

  if (error.code === 'CONFLICT') {
    return <AlertBlock title={t('conflictTitle')} body={t('conflictBody')} />;
  }
  if (error.code === 'PERMISSION_DENIED') {
    return <AlertBlock title={t('deniedTitle')} body={t('deniedBody')} />;
  }
  if (error.code === 'VALIDATION_ERROR') {
    return <AlertBlock title={t('validationTitle')} body={t('validationBody')} />;
  }
  return <AlertBlock title={t('writeFailed')} body={t('writeFailedBody')} />;
}

function AlertBlock({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
      <h3 className="text-body font-semibold text-status-critical">{title}</h3>
      <p className="text-meta text-secondary">{body}</p>
    </div>
  );
}
