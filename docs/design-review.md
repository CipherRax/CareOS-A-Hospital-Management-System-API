# careOS web — design review (F12)

Reviewed `/design-system` and `DESIGN.md` against the F0 contract, in all four
theme × density combinations.

**Status: passed.**

## What this review could not eyeball is wired, not trusted

| Claim in `DESIGN.md`                                   | Where it is enforced, so it cannot silently regress                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour pairs already meet WCAG (§2, §8)                | `npm run tokens:verify` fails the build on any contrast regression. Tightest passing pair is 3.25:1 against a 3:1 requirement — margin, not the bare minimum   |
| Focus is styled once, globally (§2.6)                  | single `:focus-visible` rule in `globals.css:80`; components never restate it                                                                                  |
| Radius is 2/3/4px, nothing above in the staff set (§4) | `tokens.scale.css`: `--radius-*` = 2/2/3/4px; `--radius-public` and `--radius-full` live outside the Tailwind `@theme` block                                   |
| Motion is 0/120/180ms and nothing else (§4)            | `tokens.scale.css` defines only `--duration-instant: 0ms`, `--duration-fast: 120ms`, `--duration-normal: 180ms`. No token exists for the banned 400–600ms band |
| Exactly one shadow (§4)                                | `--shadow-overlay` is the only shadow token; reserved for popovers/dialogs/toasts and removed under `forced-colors`                                            |
| Tabular numerals everywhere (§3.3)                     | `font-variant-numeric: tabular-nums` set on `body` (`globals.css:36`), inherited rather than opted into                                                        |
| The page is accessible in every variant                | the a11y suite runs `axe` over `/design-system` in all four theme/density pairs, under the production CSP                                                      |

Automating these is what makes a review repeatable: a reviewer's eye cannot hold
their margins stable from screen to screen, but the gate can.

## Findings

1. **Four of the twenty signature components were absent from the live review
   surface.** `/design-system` demonstrated sixteen — `StatusPill`, `DataTable`,
   `Timeline` and `BedTile` were built, unit-tested and used in the workspaces
   but had no showcase, so the page the brief points a reviewer at no longer
   covered the set the tally claims. **Resolved in this slice:** all four are now
   demonstrated — the pill carries every tone and both sizes; the data table
   shows a required caption, a status cell and tabular numeric figures; the
   timeline carries absolute timestamps, an author and a tagged escalation; the
   bed tile shows all five states as border-and-label, never fill.
2. **`DESIGN.md`'s opening status was stale.** It still read "awaiting design
   review" after five feature slices had shipped past the F0 gate, which made
   the document contradict the repository's own roadmap. **Resolved:** the
   status line now records the pass and points at this artefact.

## Found sound, verified during review

- **Borders, not fills, separate.** Rows, cards and bed tiles separate by rules
  and surface value; the board's occupied bed uses `surface-selected` as a tint
  behind an explicit label, never as the status itself.
- **Anti-patterns (§7) did not appear.** No emoji, no gradients, no KPI-card
  dashboards, no uppercase/letter-spaced labels, no icon-only buttons, no
  colour-only validation. Status is never chromatic alone — the mandatory label
  is in the component type signatures (`StatusPill` requires `label`;
  `BedTile` renders `BED_STATE_LABEL`).
- **The bold-weight question resolves to "no 700".** Weights 400/500/600 are
  used throughout the showcase and workspaces; no 700 utility is reached for.
  This is enforced by convention rather than a lint (a weight rule is not yet
  worth the machinery), and is called out here so a future screen knows the
  constraint is real.
- **Number handling.** All figures render tabular; figures right-align in the
  table; dates and identifiers are mono; the timeline renders absolute
  timestamps (`timeZone`, never server-relative).
- **The one deliberately unexercised affordance.** `DataTable`'s stretched-link
  row navigation is exercised and tested in the triage workspace, not re-played
  on the showcase (a showcase row linking somewhere real would be dishonest, and
  linking to nothing is worse). The workspace is the demonstration.

## What a design review still cannot claim

- A visual/mechanical pass is not a clinical-usage validation. F2–F9 have no
  real records against which to verify the realistic failure modes of these
  components; that validation happens when the workspaces meet the live API.
- `system` theme resolves to a deterministic light first paint corrected by an
  inline script (§6), which was designed before the strict CSP landed; the
  pairing is covered by the CSP e2e suite but is worth one look on an actual
  device before the public surface ships.

## Verdict

The system is internally consistent with its written contract, the contract
holds up under the mechanical checks, and the two drift points this review
found are fixed. F0's gate is passed.
