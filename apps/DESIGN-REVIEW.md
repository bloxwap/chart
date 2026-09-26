# Design review: `apps/docs` against the Bloxwap monorepo design system

Reviewed on 2026-09-26 against the zandesign catalog. The reference is the Bloxwap monorepo, not an outside site:

- **Tokens:** `monorepo/packages/tokens` (radius, type scale, 4 px spacing, motion, icon sizes, Maple Mono) and the
  plain-UI variable layer generated from it (`packages/plain-ui/scripts/gen-tokens-css.mjs`): `--radius-*`, `--text-*`,
  `--space-*`, `--duration-*`, `--ease-spring`, `--icon-*`.
- **Controls:** `packages/plain-ui/styles/buttons.css` (the web `Button`: a pill, 48 px, 16 px semibold, active
  `scale(.98)`, 180 ms spring), with control sizes and the focus ring from `workers/*/client/styles.css`
  (`--control-h: 3rem`, `-sm: 2.25rem`, `-md: 2.75rem`, `--control-min-w: 6rem`).
- **Primary color in use:** the product's primary actions are brand-green pills with black text: `workers/www`
  `.nav-cta` and `.submit`, and the app's onboarding "Let me try it" (`design-review/06-ref-bloxwap-app-cta.jpg`).
- **Docs shell:** `workers/docs` (the same Fumadocs stack, fonts and palette; `design-review/05-ref-bloxwap-docs.jpg`).
- **Icons:** `lucide-react@0.545.0`, used by `workers/docs`, `plain-ui` and `ui`.

The earlier review in this file (against the Hyperliquid docs) is superseded where the two overlap. Its layout
findings that this pass leaves open are carried forward under **Open layout items**.

## Verdict

The docs shell (`#nd-page`, prose, sidebar, fonts, palette) already matches `workers/docs` line for line, because it
started as a copy. The landing page and its controls do not: they use a square green block for the primary action,
bare text for the secondary one, Unicode arrows for icons, and raw pixel sizes and timings. The fix is to adopt the
monorepo's control and token system as a whole: one `.btn` family, the plain-UI scale variables, and Lucide icons.

## Findings

| ID | Sev | Check | Where | Finding | Fix |
|---|---|---|---|---|---|
| M1 | P1 | BTN-1 / BTN-3 / BTN-5 | `app/global.css` `.primary-link`, `.secondary-link`, `.preview-actions button`, `.install-copy`; `04-chart-landing-before.jpg` | Buttons ignore the monorepo control spec. The primary action is a `var(--radius)` block with 13/18 px padding and its icon pushed 24 px away; hover fades it to 85 % opacity; there is no pressed state. The secondary action is bare muted text, so the pair does not read as a pair. The fullscreen button is a square outlined box that turns neon on hover. | Port plain-UI's `.btn` family: pill, `--control-h`, 16 px semibold, `--space-xl` padding, `--control-min-w`, 180 ms spring, `scale(.98)` when pressed, shared focus ring. Primary fill is brand green with black text (as in `www` and the app); `.btn--secondary` uses the card fill; `.btn--ghost`, `.btn--sm` and `.btn--icon` cover the preview and copy controls. |
| M2 | P1 | COL-1 | `app/global.css` (landing rules) | The landing rules hard-code their scale: 12 raw font sizes, radii of `var(--radius)`, `calc(var(--radius) - 4px)`, `6px` and `50%`, and transitions of `.15s` and `.2s`. None of the plain-UI scale variables exist in this app. | Add the plain-UI scale layer (`--radius-*`, `--text-*`, `--space-*`, `--duration-*`, `--ease-*`, `--control-*`, `--focus-ring`) with the monorepo's values and sweep the landing rules onto it. |
| M3 | P1 | IMG-1 | `app/page.tsx` (`↓`, `→`), `components/chart-preview.tsx` (`↗`), `app/docs/layout.tsx` (`↗`), `app/not-found.tsx` (`→`), `components/install-command.tsx` (hand-drawn copy and check SVGs) | Unicode glyphs and hand-drawn SVGs stand in for icons, next to Fumadocs' Lucide icons. The monorepo uses Lucide everywhere. | Add `lucide-react@0.545.0` (the monorepo's version) and use `ArrowDown`, `ArrowRight`, `ArrowUpRight`, `ArrowLeft`, `Copy` and `Check` at the token icon sizes. |
| M4 | P1 | HIER-4 | `lib/layout.shared.tsx` `links` | The nav adds "Documentation" and "Playground" links that `workers/docs` does not have. Inside the docs, "Documentation" and the current sidebar page are both highlighted, so the sidebar shows two active states. | Remove `links`, as `workers/docs` does. Playground is already a sidebar page. |
| M5 | P2 | TYPE-4 | `app/global.css` | Sizes sit off the type scale, and the eyebrow and feature numbers are 10 px. | Map every size to `--text-*`; raise the 10 px labels to `--text-2xs` (11 px). |
| M6 | P2 | LAY-3 | `app/global.css` | Spacing is off the 4 px grid (7, 13, 14, 18, 22, 38, 70 px). | Use `--space-*`. |
| M7 | P2 | MOT-4 | `app/global.css` | Transitions use ad hoc linear-ish timings rather than the shared motion tokens. | `--duration-fast` with `--ease-spring`, as `.btn` does. |
| M8 | P2 | LAY-6 | `app/global.css` `.home`, `.site-footer` | The landing column (1600 px) and the footer (40 px inset) do not line up with the header, which uses Fumadocs' `--fd-layout-width` box with 16 px padding. | Give `.home` and the footer content the header's box: `max-width: var(--fd-layout-width)` with `--space-lg` padding, so every edge aligns with the nav. |
| M9 | P2 | HIER-3 | `app/docs/layout.tsx` sidebar footer | The sidebar footer has "Open Bloxwap" but not the quiet link row that `workers/docs` shows under it. | Add the same row. GitHub already has an icon button in this sidebar, so the row is About, Contact, Privacy. |

No P0 findings. **Verified clean:** TYPE-1, TYPE-2, TYPE-3, COL-2 (dark forced by brand decision, as in `workers/docs`),
COL-4, COL-6, BTN-2, FORM-1, FORM-2, FORM-3, MODAL-1, MOT-1, IMG-3, HIER-5, LAY-4 (install tabs: outer radius equals
inner radius plus padding).

## P1 detail

### M1: One button family (BTN-1 / BTN-3 / BTN-5)

**Evidence.** `04-chart-landing-before.jpg`: "Play with the chart ↓" is a square-cornered green block with its arrow at
the far edge, beside a bare "Start building →" text link. The app's primary action is a full-width green pill with
black text (`06-ref-bloxwap-app-cta.jpg`).

**Why:** one clearly primary action, with secondary and tertiary tiers that still read as buttons.
<https://x.com/zander_supafast/status/1802684455670136954>

```css
.btn { height: var(--control-h); min-width: var(--control-min-w); padding: 0 var(--space-xl);
  border-radius: var(--radius-full); background: var(--bloxwap-green); color: var(--bloxwap-black);
  font: 600 var(--text-base) / 1 var(--font-sans); transition: … var(--duration-fast) var(--ease-spring); }
.btn:active { transform: scale(0.98); }
.btn--secondary { background: var(--card); color: var(--foreground); }
```

### M2: Scale tokens (COL-1)

The chart docs import `@workspace/tokens`' generated palette but not the plain-UI scale layer that the monorepo's
components are written against. Adding that layer once lets every landing rule use the monorepo's names and values.
<https://x.com/zander_supafast/status/1875103802082382115>

### M3: Lucide icons (IMG-1)

`↗` currently marks both internal and external links. With Lucide, `ArrowUpRight` is kept for links that leave the
site, `ArrowRight` for in-site navigation, and `ArrowDown` for the jump to the playground.
<https://x.com/zander_supafast/status/1836024015778918554>

### M4: Nav links (HIER-4)

`workers/docs` keeps its nav to the lockup, search and GitHub. Two nav links plus a sidebar give the docs two
navigation systems and two simultaneous active states.

## Systemic recommendations

1. **Scale layer + `.btn` family (M1, M2, M5, M6, M7):** one block of variables and one button stylesheet, copied from
   the monorepo's generated values, fix most findings at once.
2. **Longer term:** `apps/docs`, `workers/docs` and the Hyperliquid docs now carry the same Fumadocs overrides. Publishing
   them from the monorepo (for example as a `@workspace/docs-theme` stylesheet next to `plain-ui`) would stop the drift
   at the source.

## Applied

All nine findings (M1–M9) are applied:

- **`app/global.css`:** the plain-UI scale layer and `.btn` family; every landing size, space, radius and transition moved
  onto it; the landing column and footer content share the header's box, so their edges line up with the nav.
- **Components:** the hero pair is `.btn` + `.btn--secondary`; the playground actions are `.btn--ghost` and
  `.btn--secondary .btn--sm`; copy is `.btn--ghost .btn--icon`; install tabs and command are pills.
- **Icons:** `lucide-react@0.545.0` (`ArrowDown`, `ArrowRight`, `ArrowUpRight`, `Maximize2`, `Minimize2`, `Copy`,
  `Check`) replaces every Unicode arrow and hand-drawn SVG.
- **Nav:** the `links` array is gone; the sidebar footer gained the About / Contact / Privacy row.
- **Cards, not rules (LAY-2, applied later):** the principles and guide rows are plain-UI cards (card fill, hairline
  border, `--radius-xl`) with the `workers/docs` hover tint, replacing the rules that separated them.
- **Mobile (390 px):** the two hero actions take their natural width and wrap to full-width pills when they don't fit,
  matching the app's full-width primary action.

Before: `04-chart-landing-before.jpg`. After: `07-chart-hero-after.png` (desktop hero) and `08-docs-page-after.jpg`
(docs page with one active state).

## Open layout items (carried forward, not changed in this pass)

These come from the earlier review and are layout decisions rather than design-system alignment:

- **Split hero (HIER-2 / LAY-5):** the h1 and its copy and actions sit in opposite columns on wide screens.
- **Duplicate feature sections (HIER-2):** "principles" and the guide list make overlapping points.
- **Preview chrome (LAY-1):** the preview's footer bar repeats the hero copy.
- **Entrance motion (MOT-2):** the hero appears all at once.

## Outside catalog (reviewer judgment)

- **Install tabs advertise an unpublished package.** The homepage shows `bun add @bloxwap/chart` (and npm, pnpm and
  yarn equivalents), but the quick start and `llms.txt` both state the package is not yet on npm, so these commands fail
  today. Either publish the package or show the build-from-source steps until it is.
