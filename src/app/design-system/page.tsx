'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import {
  Badge,
  Button,
  Checkbox,
  CheckboxField,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogClose,
  DialogTrigger,
  Field,
  Label,
  LabelledInput,
  Panel,
  PanelHeader,
  Select,
  Separator,
  Skeleton,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui';
import {
  AmendmentDialog,
  AuditNote,
  BatchRow,
  BreakGlassBanner,
  BreakGlassDialog,
  Can,
  CommandPalette,
  ConflictDialog,
  EmptyState,
  EstimateBadge,
  FormSection,
  KeyValueGrid,
  MoneyText,
  NowServing,
  PatientBanner,
  type PatientBannerProps,
  QueueTicket,
  WardBoard,
} from '@/components/clinical';
import { DENSITIES, type Density, type ThemePreference } from '@/design/theme/preferences';
import { useTheme } from '@/design/theme/provider';
import { PALETTE } from '@/design/tokens/palette.mts';

const GROUPS: readonly { id: string; label: string }[] = [
  { id: 'surface', label: 'Surfaces' },
  { id: 'border', label: 'Borders' },
  { id: 'text', label: 'Text' },
  { id: 'brand', label: 'Brand' },
  { id: 'status', label: 'Status' },
  { id: 'rail', label: 'Nav rail' },
  { id: 'focus', label: 'Focus' },
  { id: 'public', label: 'Public layer' },
];

function Swatch({ name }: { name: string }) {
  const token = PALETTE.find((t) => t.name === name);
  if (!token) return null;
  return (
    <div className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      <span
        aria-hidden="true"
        className="size-9 shrink-0 rounded-md border border-border"
        style={{ backgroundColor: `var(--c-${token.name})` }}
      />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-caption text-primary">{`--c-${token.name}`}</p>
        <p className="text-caption text-tertiary">{token.group}</p>
      </div>
      <code className="shrink-0 font-mono text-caption text-secondary">
        {token.light} / {token.dark}
      </code>
      {token.deviation ? (
        <span
          title="Deviates from the brief; see DESIGN.md"
          className="shrink-0 rounded-full bg-status-warning-bg px-2 py-0.5 text-caption text-status-warning"
        >
          adjusted
        </span>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border py-3 last:border-b-0">
      <p className="w-40 shrink-0 font-mono text-caption text-secondary">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * /design-system
 *
 * The review surface for the token and primitive layer. It renders every token in
 * both themes and lets density be switched without leaving the page, which is the
 * only practical way to check that compact density is still legible.
 *
 * This route is reachable in production. It carries no patient data and no
 * authentication yet, so it is safe to expose now — but that stops being true the
 * moment real screens land behind it, and it must move behind the staff session
 * check in F1. Until then it is `noindex` and unenumerable by search. See
 * docs/limitations.md.
 */
/**
 * Demo patient rows for the PatientBanner examples.
 *
 * Three rows rather than one, because the difference between "checked and found
 * none" and "never checked" exists only when the two are shown next to each other.
 * A component library documenting only the recorded case teaches the reader that
 * the other two are the same case.
 */
const BANNER_DEMO: Record<
  'recorded' | 'noneRecorded' | 'notRecorded',
  PatientBannerProps['patient']
> = {
  recorded: {
    reference: 'EX-0001',
    displayName: 'EXAMPLE Achieng Otieno',
    dateOfBirth: '1984-03-11',
    age: 42,
    sex: 'Female',
    allergies: { status: 'recorded', allergies: ['Penicillin', 'Latex'] },
    flags: ['Falls risk'],
    location: 'In ward, bed 4',
    insurance: { providerName: 'SHA', scheme: 'Inpatient', memberNumber: 'SHA-4471' },
    statusLabel: 'In ward',
    statusTone: 'info',
  },
  noneRecorded: {
    reference: 'EX-0002',
    displayName: 'EXAMPLE Brian Otieno',
    dateOfBirth: '1996-11-02',
    age: 29,
    sex: 'Male',
    allergies: { status: 'none-recorded' },
    location: 'Waiting room',
    statusLabel: 'Waiting',
    statusTone: 'neutral',
  },
  notRecorded: {
    reference: 'EX-0003',
    displayName: 'EXAMPLE Chweya Wafula',
    dateOfBirth: '1971-01-25',
    age: 55,
    sex: 'Male',
    allergies: { status: 'not-recorded' },
    possibleDuplicate: true,
    legalHold: true,
    location: 'Seen and discharged',
    statusLabel: 'Discharged',
    statusTone: 'success',
  },
};

export default function DesignSystemPage() {
  const { preference, resolved, density, setPreference, setDensity } = useTheme();
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');
  const [previewDensity, setPreviewDensity] = useState<Density>(density);

  // Follow the real preference until the reviewer overrides the preview.
  const [overridden, setOverridden] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [breakGlassOpen, setBreakGlassOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    if (overridden) return;
    setPreviewTheme(resolved);
    setPreviewDensity(density);
  }, [resolved, density, overridden]);

  const onTheme = useCallback(
    (next: 'light' | 'dark') => {
      setPreviewTheme(next);
      setOverridden(true);
    },
    [setPreviewTheme],
  );

  const onDensity = useCallback(
    (next: Density) => {
      setPreviewDensity(next);
      setOverridden(true);
    },
    [setPreviewDensity],
  );

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        tokens: PALETTE.filter((t) => t.group === g.id),
      })).filter((g) => g.tokens.length > 0),
    [],
  );

  return (
    // axe rule `landmark-one-main`: every page needs exactly one main landmark,
    // and without it assistive technology has no entry point into the content.
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-heading font-semibold text-primary">careOS design system</h1>
        <p className="mt-1 max-w-2xl text-body text-secondary">
          Phase F0 foundations: colour tokens, type scale, radius, motion, density, and the
          re-skinned primitive layer. Every value below is asserted by{' '}
          <code className="font-mono text-caption">npm run tokens:verify</code>.
        </p>
      </header>

      <section
        aria-labelledby="prefs-heading"
        className="mb-10 rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="prefs-heading" className="mb-3 text-heading-xs font-semibold text-primary">
          Your preference
        </h2>
        <p className="mb-3 text-caption text-tertiary">
          Persisted in a cookie and applied server-side, so there is no flash on reload.
        </p>
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <span className="text-caption text-secondary">Theme</span>
            {(['light', 'dark', 'system'] as const).map((t: ThemePreference) => (
              <Button
                key={t}
                size="sm"
                variant={preference === t ? 'primary' : 'secondary'}
                onClick={() => setPreference(t)}
                aria-pressed={preference === t}
              >
                {t}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-caption text-secondary">Density</span>
            {DENSITIES.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={density === d ? 'primary' : 'secondary'}
                onClick={() => setDensity(d)}
                aria-pressed={density === d}
              >
                {d}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-3">
        <p className="text-caption font-medium text-secondary">Preview below:</p>
        <div className="flex items-center gap-2">
          <span className="text-caption text-tertiary">theme</span>
          {(['light', 'dark'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={previewTheme === t ? 'primary' : 'secondary'}
              onClick={() => onTheme(t)}
              aria-pressed={previewTheme === t}
            >
              {t}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-caption text-tertiary">density</span>
          {DENSITIES.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={previewDensity === d ? 'primary' : 'secondary'}
              onClick={() => onDensity(d)}
              aria-pressed={previewDensity === d}
            >
              {d}
            </Button>
          ))}
        </div>
        {!overridden ? (
          <span className="text-caption text-tertiary">following your preference</span>
        ) : (
          <Button size="sm" variant="tertiary" onClick={() => setOverridden(false)}>
            follow preference
          </Button>
        )}
      </div>

      {/* The preview region is a theming scope in its own right: it can set
          data-theme/data-density independently of the rest of the page, which is
          what makes side-by-side review possible. */}
      <div
        data-theme={previewTheme}
        data-density={previewDensity}
        className={cn(
          'space-y-8 rounded-lg border border-border p-6',
          previewTheme === 'light' ? 'bg-canvas text-primary' : 'bg-canvas text-primary',
        )}
        style={{ colorScheme: previewTheme }}
      >
        <section>
          <h2 className="mb-2 text-heading-xs font-semibold text-primary">Colour tokens</h2>
          <p className="mb-4 text-caption text-tertiary">
            Marked <span className="text-status-warning">adjusted</span> where the brief&apos;s
            value failed WCAG 2.2 AA and was retuned in OKLab.
          </p>
          {groups.map((g) => (
            <div key={g.id} className="mb-5 rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-1 text-meta font-semibold text-secondary">{g.label}</h3>
              {g.tokens.map((t) => (
                <Swatch key={t.name} name={t.name} />
              ))}
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-3 text-heading-xs font-semibold text-primary">Type scale</h2>
          <div className="rounded-lg border border-border bg-surface p-4">
            <Row label="display / public h1">
              <span className="text-public-display font-semibold">Bed 4 open</span>
            </Row>
            <Row label="heading">
              <span className="text-heading font-semibold">Admissions today</span>
            </Row>
            <Row label="heading-sm">
              <span className="text-heading-sm font-semibold">Awaiting review</span>
            </Row>
            <Row label="heading-xs">
              <span className="text-heading-xs font-semibold">Panel title</span>
            </Row>
            <Row label="body">
              <span className="text-body">Chest pain, onset 2 hours ago.</span>
            </Row>
            <Row label="meta">
              <span className="text-meta">Updated 14:32 · Ward 3</span>
            </Row>
            <Row label="caption">
              <span className="text-caption">Last edited by K. Otieno</span>
            </Row>
            <Row label="mono / numeric">
              <span className="font-mono text-body tabular-nums">1,204 mg · 08:45 · 37.5 °C</span>
            </Row>
            <Row label="public body">
              <span className="text-public-body" data-prose>
                Your care team has reviewed your results and will call you shortly.
              </span>
            </Row>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-heading-xs font-semibold text-primary">Primitives</h2>
          <div className="rounded-lg border border-border bg-surface p-4">
            <Row label="button variants">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tertiary">Tertiary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </Row>
            <Row label="button states">
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button variant="secondary" aria-disabled="true">
                Aria disabled
              </Button>
            </Row>
            <Row label="button sizes">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </Row>
            <Row label="badge tones">
              {(['neutral', 'info', 'success', 'warning', 'critical', 'brand'] as const).map(
                (tone) => (
                  <Badge key={tone} tone={tone}>
                    {tone}
                  </Badge>
                ),
              )}
            </Row>
            <Row label="status chips">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-critical-bg px-2.5 py-0.5 text-meta text-status-critical">
                Critical
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-warning-bg px-2.5 py-0.5 text-meta text-status-warning">
                Needs review
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success-bg px-2.5 py-0.5 text-meta text-status-success">
                Cleared
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-info-bg px-2.5 py-0.5 text-meta text-status-info">
                Assigned
              </span>
            </Row>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-heading-xs font-semibold text-primary">Form controls</h2>
          <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-2">
            <LabelledInput
              label="Patient name"
              hint="As recorded on the referral."
              placeholder="Full name"
            />
            <LabelledInput
              label="Date of birth"
              hint="Ambiguous dates need an explicit format."
              placeholder="YYYY-MM-DD"
            />
            <Field id="ds-summary" label="Clinical summary" hint="Free text, never a diagnosis.">
              {({ controlId, describedBy }) => (
                <Textarea id={controlId} aria-describedby={describedBy} rows={3} />
              )}
            </Field>
            <Field id="ds-team" label="Assigned team">
              {({ controlId }) => (
                <Select id={controlId} defaultValue="">
                  <option value="" disabled>
                    Choose a team
                  </option>
                  <option value="ed">Emergency</option>
                  <option value="ward">Ward</option>
                </Select>
              )}
            </Field>
            <LabelledInput
              label="Field with an error"
              error="This field is required."
              placeholder="Required"
            />
            <LabelledInput
              label="Disabled field"
              hint="Disabled, not readonly."
              value="Locked by policy"
              readOnly
              disabled
            />
            <div className="md:col-span-2">
              <CheckboxField
                label="Send the patient a notification"
                description="Uses the contact preference recorded at intake."
              />
              <div className="mt-3 flex items-center gap-3">
                <Label htmlFor="ds-bare-checkbox">Bare checkbox with a label</Label>
                <Checkbox id="ds-bare-checkbox" />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-heading-xs font-semibold text-primary">
            Surfaces, loading and overlays
          </h2>
          <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
            <Panel>
              <PanelHeader title="Panel" description="A quiet container for grouped content." />
              <div className="px-5 py-4 text-body text-secondary">
                Panel body copy sits at the public-layer-adjacent reading size rather than shrinking
                further, even in compact density.
              </div>
            </Panel>
            <Separator />
            <div>
              <p className="mb-2 text-meta text-secondary">Skeleton</p>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="secondary">Hover or focus me</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Supplementary only. Never put information here that is needed to act.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="secondary">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader
                    title="Discharge summary"
                    description="A plain dialog. The header states the subject before the body."
                  />
                  <DialogBody>
                    <p className="text-body text-secondary">
                      Focus is trapped here and returns to the trigger on close.
                    </p>
                  </DialogBody>
                  <DialogFooter>
                    {/* Wrapped in DialogClose: a plain button here rendered as a
                        working control and did nothing at all. */}
                    <DialogClose asChild>
                      <Button variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button variant="primary">Continue</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                Open confirm
              </Button>
            </div>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              onConfirm={() => setConfirmOpen(false)}
              title="Discard this draft?"
              description="The draft is not saved anywhere else. This cannot be undone."
              confirmLabel="Discard draft"
            />
          </div>

          <h3 className="mt-8 mb-2 text-body font-semibold text-primary">WardBoard</h3>
          <div className="mb-6">
            <WardBoard
              ward="Ward 4"
              beds={[
                { bed: '4A', state: 'occupied', patientName: 'EXAMPLE Akech' },
                { bed: '4B', state: 'occupied' },
                { bed: '4C', state: 'cleaning', flag: 'O2' },
                { bed: '4D', state: 'vacant' },
                { bed: '4E', state: 'reserved' },
                { bed: '4F', state: 'out-of-service' },
              ]}
            />
          </div>

          <h3 className="mt-8 mb-2 text-body font-semibold text-primary">BatchRow</h3>
          <p className="mb-3 max-w-prose text-meta text-secondary">
            One row per operation: state lives on the row, undo is differential, and a failed row
            reports its own error.
          </p>
          <ul className="mb-6 flex max-w-2xl flex-col">
            <BatchRow rowId="1" label="Furosemide 40 mg IV once" detail="RX-2217" state="pending" />
            <BatchRow
              rowId="2"
              label="Amoxicillin 500 mg TDS for 5 days"
              detail="RX-2218"
              state="succeeded"
              onUndo={() => {}}
            />
            <BatchRow
              rowId="3"
              label="Metformin 500 mg BD"
              detail="RX-2219"
              state="failed"
              error="Stock check refused the dose"
            />
            <BatchRow rowId="4" label="Omeprazole 20 mg OD" detail="RX-2220" state="reverted" />
          </ul>

          <h3 className="mt-8 mb-2 text-body font-semibold text-primary">CommandPalette</h3>
          <div className="mb-6 flex items-center gap-3">
            <Button variant="primary" onClick={() => setPaletteOpen(true)}>
              Open CommandPalette
            </Button>
            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              onSelect={() => setPaletteOpen(false)}
              options={[
                { id: 'intake', label: 'New er intake', hint: 'Register in the waiting room' },
                {
                  id: 'record',
                  label: 'Open the current patient record',
                  hint: 'EXAMPLE Achieng Otieno',
                },
                { id: 'release', label: 'Release results, Bay 3', hint: 'Verified, 2 rows' },
                { id: 'lock', label: 'Lock the workstation', danger: true },
              ]}
            />
          </div>
        </section>

        {/* The brief requires every signature component to appear here in both
            themes and both densities, so each one added in F1 gets a live example
            rather than a description of one. */}
        <section aria-labelledby="signature-heading" className="mt-10">
          <h2 id="signature-heading" className="mb-2 text-heading-xs font-semibold text-primary">
            Signature components
          </h2>
          <p className="mb-4 max-w-prose text-meta text-secondary">
            The clinical building blocks each workspace is assembled from.
          </p>

          <h3 className="mb-2 text-body font-semibold text-primary">MoneyText</h3>
          <div className="mb-6 flex flex-wrap items-baseline gap-6">
            <MoneyText amount="1234.5" currency="KES" />
            <MoneyText amount="12345678901234567890.99" currency="KES" />
            <MoneyText amount="-500.00" currency="KES" accounting />
            <MoneyText amount="0.00" currency="KES" />
            <MoneyText amount="not-a-number" currency="KES" />
          </div>

          <h3 className="mb-2 text-body font-semibold text-primary">EstimateBadge</h3>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <span className="text-body text-primary">
              Estimated wait 20–30 min{' '}
              <EstimateBadge
                method="Median of recorded waiting times"
                dataPeriod="1–30 September 2026"
              />
            </span>
            <span className="text-body text-primary">
              Forecast beds 42{' '}
              <EstimateBadge
                method="Linear trend over daily admissions"
                dataPeriod="Last 12 weeks"
                model="bed-demand"
                version="v3"
                uncertainty="p50–p90: 38–49"
              />
            </span>
          </div>

          <h3 className="mb-2 text-body font-semibold text-primary">KeyValueGrid</h3>
          <div className="mb-6">
            <KeyValueGrid
              label="Patient details"
              items={[
                { label: 'Patient number', value: 'PT-000123', mono: true },
                { label: 'Date of birth', value: '1991-04-02' },
                { label: 'Sex', value: 'Female' },
                { label: 'Insurance', value: '' },
              ]}
            />
          </div>

          <h3 className="mb-2 text-body font-semibold text-primary">AuditNote</h3>
          <div className="mb-6 max-w-xl">
            <AuditNote>the patient access log</AuditNote>
          </div>

          <h3 className="mb-2 text-body font-semibold text-primary">EmptyState</h3>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <EmptyState
              title="No results awaiting verification"
              description="Verified results appear here before release."
              action={<Button variant="secondary">Open worklist</Button>}
            />
            <EmptyState title="No encounters recorded today" />
          </div>

          <h3 className="mb-2 text-body font-semibold text-primary">FormSection</h3>
          <div className="mb-6 max-w-xl">
            <FormSection
              title="Contact details"
              description="Used only for follow-up about this visit."
              required
            >
              <LabelledInput label="Phone number" inputMode="tel" placeholder="+254 7…" />
              <LabelledInput label="Preferred time to call" placeholder="Morning" />
            </FormSection>
          </div>

          <h3 className="mb-2 text-body font-semibold text-primary">Can</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Can principal={{ permissions: ['results:release'] }} permission="results:release">
              <Button variant="danger">Release result</Button>
            </Can>
            <Can principal={{ permissions: ['lab:verify'] }} permission="results:release">
              <Button variant="danger">Release result</Button>
            </Can>
            <Can
              principal={{ permissions: ['lab:verify'] }}
              allOf={['lab:verify', 'results:release']}
            >
              <Button variant="danger">Release result</Button>
            </Can>
          </div>

          <h3 className="mt-8 mb-2 text-body font-semibold text-primary">NowServing</h3>
          <div className="mb-6 flex flex-wrap items-end gap-8">
            <NowServing ticket="A024" desk="Triage" />
            <NowServing ticket="A025" desk="Bay 3" size="display" />
            <NowServing ticket="A026" label="Next at phlebotomy" desk="Room 4" size="sm" />
          </div>

          <h3 className="mb-2 text-body font-semibold text-primary">QueueTicket</h3>
          <div className="mb-6 flex flex-wrap items-end gap-8">
            <QueueTicket ticket="A025" label="Your queue number" size="sm" />
            <QueueTicket ticket="A025" label="Your queue number" />
            <QueueTicket ticket="A025" label="Your queue number" size="lg" />
            <QueueTicket ticket="A025" label="Your queue number" size="display" />
          </div>

          <h3 className="mt-8 mb-2 text-body font-semibold text-primary">PatientBanner</h3>
          <p className="mb-3 max-w-prose text-meta text-secondary">
            The three allergy states are shown in sequence, because an unrecorded allergy list must
            never look like an empty one.
          </p>
          <div className="mb-6 border border-border">
            <PatientBanner patient={BANNER_DEMO.recorded} headingLevel={4} />
            <PatientBanner
              patient={BANNER_DEMO.noneRecorded}
              headingLevel={4}
              className="border-t border-border"
            />
            <PatientBanner
              patient={BANNER_DEMO.notRecorded}
              headingLevel={4}
              className="border-t border-border"
            />
          </div>

          <h3 className="mt-8 mb-2 text-body font-semibold text-primary">BreakGlassBanner</h3>
          <div className="mb-6 max-w-xl">
            <BreakGlassBanner minutesRemaining={18} onEnd={() => {}} />
          </div>

          <h3 className="mt-8 mb-2 text-body font-semibold text-primary">
            Safety-critical dialogs
          </h3>
          <p className="mb-3 max-w-prose text-meta text-secondary">
            None of these can be confirmed with a default. Each requires a typed reason before the
            action can proceed, and each names the action rather than saying “OK”.
          </p>
          <div className="mb-6 flex flex-wrap gap-3">
            <Button variant="danger" onClick={() => setBreakGlassOpen(true)}>
              Open BreakGlassDialog
            </Button>
            <Button variant="secondary" onClick={() => setAmendOpen(true)}>
              Open AmendmentDialog
            </Button>
            <Button variant="secondary" onClick={() => setConflictOpen(true)}>
              Open ConflictDialog
            </Button>

            <BreakGlassDialog
              open={breakGlassOpen}
              onOpenChange={setBreakGlassOpen}
              resourceLabel="the patient record for EXAMPLE Achieng Otieno (EX-0001)"
              onRequest={() => setBreakGlassOpen(false)}
            />
            <AmendmentDialog
              open={amendOpen}
              onOpenChange={setAmendOpen}
              resourceLabel="the consultation note from 5 October"
              changes={[
                {
                  field: 'Assessment',
                  before: 'Community-acquired pneumonia, likely',
                  after: 'Community-acquired pneumonia. Chest x-ray reviewed; no consolidation.',
                },
                {
                  field: 'Dose',
                  before: 'Amoxicillin 500 mg TDS for 5 days',
                  after: 'Amoxicillin 500 mg TDS for 7 days',
                },
              ]}
              onAmend={() => setAmendOpen(false)}
            />
            <ConflictDialog
              open={conflictOpen}
              onOpenChange={setConflictOpen}
              resourceLabel="Vitals for EX-0001"
              serverVersion={8}
              yourVersion={7}
              fields={[
                {
                  field: 'Blood pressure',
                  server: '128/82 mmHg',
                  mine: '132/84 mmHg',
                },
                {
                  field: 'Pulse',
                  server: '76 bpm',
                  mine: '76 bpm',
                },
                {
                  field: 'Temperature',
                  server: '37.1 °C',
                  mine: '38.4 °C',
                },
              ]}
              onResolve={() => setConflictOpen(false)}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
