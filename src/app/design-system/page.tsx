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
export default function DesignSystemPage() {
  const { preference, resolved, density, setPreference, setDensity } = useTheme();
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');
  const [previewDensity, setPreviewDensity] = useState<Density>(density);

  // Follow the real preference until the reviewer overrides the preview.
  const [overridden, setOverridden] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
                    <Button variant="secondary">Cancel</Button>
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
              title="Discard this draft?"
              description="The draft is not saved anywhere else. This cannot be undone."
              confirmLabel="Discard draft"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
