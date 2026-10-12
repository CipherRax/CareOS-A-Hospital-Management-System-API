'use client';

import { FileText, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useAmendNote,
  useClinicalNote,
  useClinicalNotes,
  useCreateNote,
  useFinalizeNote,
  useNoteTemplates,
  useUpdateNote,
} from '@/lib/data/queries';
import {
  NOTE_SECTION_KEYS,
  type NoteRow,
  type NoteSections,
  type NoteVersionRow,
} from '@/lib/data/clinical-notes';

/**
 * Clinical notes panel (F4).
 *
 * Sits inside the encounter workspace. Notes are structured (the API's
 * `NOTE_SECTION_KEYS`), created as DRAFT against an open encounter, edited in
 * place while DRAFT, finalized into the ORIGINAL version, and afterwards only
 * amended — a superseding version with a mandatory reason, never an in-place
 * edit. The panel mirrors that exactly: a DRAFT offers edit + finalize, a FINAL
 * offers amend, and a COMPLETED encounter offers neither creation nor edits.
 *
 * The list carries only the working snapshot, so version history is loaded on
 * demand from `GET /clinical-notes/{id}` (the one read that includes it) and
 * shown when a card is expanded.
 */

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  DRAFT: 'warning',
  FINAL: 'success',
};

type ComposerState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; note: NoteRow }
  | { mode: 'amend'; note: NoteRow };

export function ClinicalNotesPanel({
  encounterId,
  encounterStatus,
}: {
  encounterId: string;
  encounterStatus: string;
}) {
  const t = useTranslations('notes');
  const [composer, setComposer] = useState<ComposerState>({ mode: 'closed' });
  const [finalizeTarget, setFinalizeTarget] = useState<NoteRow | null>(null);

  const notes = useClinicalNotes({ encounterId });
  const rows = notes.data?.data.items ?? [];
  const encounterOpen = encounterStatus === 'OPEN' || encounterStatus === 'IN_PROGRESS';
  const finalize = useFinalizeNote();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('title')}</h2>
        {encounterOpen && composer.mode === 'closed' ? (
          <Button variant="secondary" size="sm" onClick={() => setComposer({ mode: 'create' })}>
            <Plus aria-hidden className="size-4" />
            {t('newNote')}
          </Button>
        ) : null}
      </div>
      <p className="max-w-prose text-meta text-secondary">{t('intro')}</p>

      {!encounterOpen && composer.mode === 'closed' ? (
        <p className="text-meta text-tertiary">{t('locked')}</p>
      ) : null}

      {composer.mode !== 'closed' ? (
        <NoteComposer
          key={composer.mode === 'create' ? 'create' : composer.note.id}
          encounterId={encounterId}
          state={composer}
          onClose={() => setComposer({ mode: 'closed' })}
        />
      ) : null}

      {notes.isLoading && rows.length === 0 ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : notes.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={FileText}
          headingLevel={3}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty')} headingLevel={3} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((note) => (
            <li key={note.id}>
              <NoteCard
                note={note}
                encounterOpen={encounterOpen}
                onEdit={() => setComposer({ mode: 'edit', note })}
                onAmend={() => setComposer({ mode: 'amend', note })}
                onFinalize={() => setFinalizeTarget(note)}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={finalizeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFinalizeTarget(null);
        }}
        onConfirm={() => {
          if (finalizeTarget) finalize.mutate({ id: finalizeTarget.id });
          setFinalizeTarget(null);
        }}
        title={t('confirmFinalizeTitle')}
        description={t('confirmFinalizeBody')}
        confirmLabel={t('confirmFinalize')}
        cancelLabel={t('composer.cancel')}
        pending={finalize.isPending}
      />
    </section>
  );
}

function NoteCard({
  note,
  encounterOpen,
  onEdit,
  onAmend,
  onFinalize,
}: {
  note: NoteRow;
  encounterOpen: boolean;
  onEdit: () => void;
  onAmend: () => void;
  onFinalize: () => void;
}) {
  const t = useTranslations('notes');
  const locale = useLocale();
  const [historyOpen, setHistoryOpen] = useState(false);

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  const sectionEntries = Object.entries(note.sections);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-semibold text-primary">{note.title ?? t('untitled')}</h3>
          <StatusPill tone={STATUS_TONE[note.status] ?? 'neutral'} label={t(`status.${note.status}`)} />
        </div>
        <p className="text-caption text-tertiary">
          {t('created', { date: format(note.createdAt) })}
          {note.finalizedAt ? ` · ${t('finalized', { date: format(note.finalizedAt) })}` : ''}
        </p>
      </header>

      {sectionEntries.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {sectionEntries.map(([key, text]) => (
            <div key={key} className="flex flex-col">
              <dt className="text-caption font-medium text-tertiary">{t(`section.${key}`)}</dt>
              <dd className="text-meta whitespace-pre-wrap text-primary">{text}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {note.reason ? (
        <p className="border-l-2 border-strong pl-3 text-meta text-secondary">
          <span className="font-medium text-primary">{t('amendedReason')}: </span>
          {note.reason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {encounterOpen && note.status === 'DRAFT' ? (
          <>
            <Button variant="secondary" size="sm" onClick={onEdit}>
              {t('edit')}
            </Button>
            <Button variant="tertiary" size="sm" onClick={onFinalize}>
              {t('finalize')}
            </Button>
          </>
        ) : null}
        {note.status === 'FINAL' ? (
          <Button variant="secondary" size="sm" onClick={onAmend}>
            {t('amend')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          {historyOpen ? t('hideHistory') : t('history')}
        </Button>
      </div>

      {historyOpen ? <NoteHistory noteId={note.id} /> : null}
    </article>
  );
}

function NoteHistory({ noteId }: { noteId: string }) {
  const t = useTranslations('notes');
  const locale = useLocale();
  const detail = useClinicalNote(noteId);
  const versions = detail.data?.data.versions ?? [];

  if (detail.isLoading) {
    return (
      <p role="status" className="text-meta text-tertiary">
        {t('loading')}
      </p>
    );
  }
  if (detail.error) {
    return <p className="text-meta text-secondary">{t('historyUnavailable')}</p>;
  }
  if (versions.length === 0) {
    return <p className="text-meta text-tertiary">{t('historyEmpty')}</p>;
  }

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  return (
    <ol className="flex flex-col gap-2 border-t border-border pt-3">
      {versions.map((version: NoteVersionRow) => (
        <li key={version.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-meta font-medium text-primary">
            {t('version', { number: version.versionNumber })}
          </span>
          <span className="text-meta text-secondary">{t(`versionKind.${version.kind}`)}</span>
          <span className="text-caption tabular-nums text-tertiary">{format(version.createdAt)}</span>
          {version.reason ? <span className="text-caption text-secondary">— {version.reason}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function NoteComposer({
  encounterId,
  state,
  onClose,
}: {
  encounterId: string;
  state: Exclude<ComposerState, { mode: 'closed' }>;
  onClose: () => void;
}) {
  const t = useTranslations('notes');
  const editing = state.mode === 'edit';
  const amending = state.mode === 'amend';
  const source = state.mode === 'create' ? null : state.note;

  const templates = useNoteTemplates();
  const create = useCreateNote();
  const update = useUpdateNote();
  const amend = useAmendNote();

  const [title, setTitle] = useState(source?.title ?? '');
  const [sections, setSections] = useState<NoteSections>(() =>
    source ? { ...source.sections } : Object.fromEntries(NOTE_SECTION_KEYS.map((key) => [key, ''])),
  );
  const [visibleKeys, setVisibleKeys] = useState<readonly string[]>(() =>
    source && Object.keys(source.sections).length > 0 ? Object.keys(source.sections) : NOTE_SECTION_KEYS,
  );
  const [templateId, setTemplateId] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = amending ? amend : editing ? update : create;
  const pending = mutation.isPending;

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const template = templates.data?.data.items.find((candidate) => candidate.id === id);
    const keys = template ? template.sections : NOTE_SECTION_KEYS;
    setVisibleKeys(keys);
    setSections((current) => {
      const next: Record<string, string> = {};
      for (const key of keys) next[key] = current[key] ?? '';
      return next;
    });
  }

  function submit() {
    setFormError(null);
    const content: Record<string, string> = {};
    for (const [key, text] of Object.entries(sections)) {
      const trimmed = text.trim();
      if (trimmed.length > 0) content[key] = trimmed;
    }
    if (Object.keys(content).length === 0) {
      setFormError(t('composer.noContent'));
      return;
    }
    if (amending && reason.trim().length === 0) {
      setFormError(t('composer.noReason'));
      return;
    }
    const onSuccess = () => onClose();
    const onSubmitError = () => undefined;

    if (amending && source) {
      amend.mutate(
        { id: source.id, title: title.trim() || undefined, sections: content, reason: reason.trim() },
        { onSuccess, onError: onSubmitError },
      );
    } else if (editing && source) {
      update.mutate(
        { id: source.id, title: title.trim() || undefined, sections: content },
        { onSuccess, onError: onSubmitError },
      );
    } else {
      create.mutate(
        {
          encounterId,
          title: title.trim() || undefined,
          sections: content,
          templateId: templateId || undefined,
        },
        { onSuccess, onError: onSubmitError },
      );
    }
  }

  const errorCode = (mutation.error as { code?: string } | null)?.code;
  const errorCopy =
    formError !== null
      ? { title: t('error.validationTitle'), body: formError }
      : errorCode === 'INVALID_WORKFLOW_TRANSITION'
        ? { title: t('error.lockedTitle'), body: t('error.lockedBody') }
        : errorCode === 'VALIDATION_ERROR'
          ? { title: t('error.validationTitle'), body: t('error.validationBody') }
          : mutation.isError
            ? { title: t('error.failedTitle'), body: t('error.failedBody') }
            : null;

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-primary bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-body font-semibold text-primary">
        {amending ? t('composer.amendTitle') : editing ? t('composer.editTitle') : t('composer.createTitle')}
      </h3>

      {errorCopy ? (
        <div role="alert" className="border border-status-critical px-3 py-2">
          <p className="text-body font-semibold text-status-critical">{errorCopy.title}</p>
          <p className="text-meta text-secondary">{errorCopy.body}</p>
        </div>
      ) : null}

      {!editing && !amending ? (
        <Field id="note-template" label={t('composer.templateLabel')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={templateId}
              onChange={(event) => chooseTemplate(event.target.value)}
            >
              <option value="">{t('composer.templateNone')}</option>
              {(templates.data?.data.items ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <Field id="note-title" label={t('composer.titleLabel')}>
        {({ controlId }) => (
          <Input
            id={controlId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
          />
        )}
      </Field>

      <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="mb-1 text-meta font-medium text-secondary">
          {t('composer.sectionsLegend')}
        </legend>
        {visibleKeys.map((key) => (
          <Field key={key} id={`note-section-${key}`} label={t(`section.${key}`)}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                value={sections[key] ?? ''}
                onChange={(event) =>
                  setSections((current) => ({ ...current, [key]: event.target.value }))
                }
                rows={3}
              />
            )}
          </Field>
        ))}
      </fieldset>

      {amending ? (
        <Field
          id="note-amend-reason"
          label={t('composer.reasonLabel')}
          hint={t('composer.reasonHint')}
          required
        >
          {({ controlId, describedBy }) => (
            <Textarea
              id={controlId}
              aria-describedby={describedBy}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={2}
            />
          )}
        </Field>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {amending ? t('composer.saveAmend') : editing ? t('composer.saveEdit') : t('composer.save')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          {t('composer.cancel')}
        </Button>
      </div>
    </form>
  );
}