'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useSubmitPortalFeedback } from '@/lib/data/queries';
import { PORTAL_FEEDBACK_CATEGORIES, type PortalFeedbackCategory } from '@/lib/data/portal';

/**
 * Portal feedback `POST /portal/me/feedback` — the portal's only write.
 *
 * Deliberately small: a rating, a category and an optional comment. `branchId` is
 * left out rather than guessed at — the DTO marks it optional, the portal has no
 * branch picker (GAP-018), and inventing a branch would file the feedback in the
 * wrong place. The patient id is stamped server-side from the session, so the form
 * sends no id at all.
 *
 * Errors are inline `role="alert"`, never a toast, and the rating is a labelled
 * radio group (fieldset + legend) rather than a star widget with no accessible
 * name. The button's label changes to "Sending…" while in flight so a slow tap
 * does not read as a dead one.
 */

const RATING_VALUES = [1, 2, 3, 4, 5] as const;

const CATEGORY_LABEL_KEYS: Record<PortalFeedbackCategory, string> = {
  SERVICE: 'service',
  WAITING_TIME: 'waitingTime',
  STAFF: 'staff',
  BILLING: 'billing',
  FACILITY: 'facility',
  PHARMACY: 'pharmacy',
  LABORATORY: 'laboratory',
  OTHER: 'other',
};

export function PortalFeedback() {
  const t = useTranslations('portal');
  const mutation = useSubmitPortalFeedback();
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState<PortalFeedbackCategory | ''>('');
  const [comment, setComment] = useState('');
  const [ratingError, setRatingError] = useState<string | undefined>(undefined);
  const [categoryError, setCategoryError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missingRating = rating === null;
    const missingCategory = category === '';
    if (missingRating || missingCategory) {
      setRatingError(missingRating ? t('feedback.ratingError') : undefined);
      setCategoryError(missingCategory ? t('feedback.categoryError') : undefined);
      return;
    }
    setRatingError(undefined);
    setCategoryError(undefined);
    mutation.mutate(
      { rating, category, comment: comment.trim() || null },
      {
        onSuccess: () => {
          setSent(true);
          setRating(null);
          setCategory('');
          setComment('');
        },
      },
    );
  }

  if (sent) {
    return (
      <section aria-labelledby="portal-feedback-title" className="flex flex-col gap-6">
        <header>
          <h1 id="portal-feedback-title" className="text-heading-sm font-semibold text-primary">
            {t('feedback.title')}
          </h1>
        </header>
        <div
          role="status"
          className="rounded-lg border border-status-success bg-surface px-4 py-3 text-body text-primary"
        >
          {t('feedback.success')}
        </div>
        <div>
          <Button type="button" onClick={() => setSent(false)}>
            {t('feedback.sendAnother')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="portal-feedback-title" className="flex flex-col gap-6">
      <header>
        <h1 id="portal-feedback-title" className="text-heading-sm font-semibold text-primary">
          {t('feedback.title')}
        </h1>
        <p className="mt-1 text-body text-secondary">{t('feedback.description')}</p>
      </header>

      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6"
      >
        <fieldset
          className="flex flex-col gap-3"
          aria-describedby={ratingError ? 'portal-feedback-rating-error' : undefined}
        >
          <legend className="text-meta font-medium text-secondary">{t('feedback.ratingLegend')}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {RATING_VALUES.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 text-body text-primary"
              >
                <input
                  type="radio"
                  name="portal-feedback-rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => {
                    setRating(value);
                    setRatingError(undefined);
                  }}
                  className="size-4 accent-brand"
                />
                {t(`feedback.rating${value}`)}
              </label>
            ))}
          </div>
          {ratingError ? (
            <p
              id="portal-feedback-rating-error"
              role="alert"
              className="text-meta text-status-critical"
            >
              {ratingError}
            </p>
          ) : null}
        </fieldset>

        <Field
          id="portal-feedback-category"
          label={t('feedback.categoryLabel')}
          required
          error={categoryError}
        >
          {(ids) => (
            <Select
              id={ids.controlId}
              aria-describedby={ids.describedBy}
              aria-invalid={ids.invalid || undefined}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as PortalFeedbackCategory | '');
                setCategoryError(undefined);
              }}
            >
              <option value="">{t('feedback.categoryPlaceholder')}</option>
              {PORTAL_FEEDBACK_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`feedback.category.${CATEGORY_LABEL_KEYS[value]}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="portal-feedback-comment"
          label={t('feedback.commentLabel')}
          hint={t('feedback.commentHint')}
        >
          {(ids) => (
            <Textarea
              id={ids.controlId}
              aria-describedby={ids.describedBy}
              value={comment}
              rows={4}
              maxLength={500}
              placeholder={t('feedback.commentPlaceholder')}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>

        {mutation.isError ? (
          <p
            role="alert"
            className="rounded-lg border border-status-critical bg-surface px-4 py-3 text-body text-status-critical"
          >
            {t('feedback.error')}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('feedback.sending') : t('feedback.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}
