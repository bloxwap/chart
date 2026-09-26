# Design review: `apps/` (Chart SDK docs + playground)

Reviewed on 2026-09-26 against the 30-check zandesign catalog. The reference is the sister site
<https://bloxwap.github.io/hyperliquid/> (source: `hyperliquid-ts/website/app/global.css`), which went through the
same review and a fix pass (hyperliquid-ts #120).

**Scope**

- `docs/`: the Next.js + Fumadocs site. This is where every finding lives.
- `playground/index.html`: a host page for the chart. Its look comes from `packages/chart` (the toolbar and settings UI),
  so it is out of scope for an `apps/` pass.

**How it was reviewed**

- **Static pass:** `docs/app/global.css`, `page.tsx`, `lib/layout.shared.tsx`, `app/docs/layout.tsx`, and
  `components/*`.
- **Visual pass:** desktop at 1193 px, plus 390 px mobile shown side by side with the sister site (iframes). Screenshots
  are in `design-review/`.
- **Light mode:** not reviewed. It is forced off (`forcedTheme: 'dark'`), and the sister site does the same by brand
  decision.

## Verdict

The docs shell already matches the sister site. The landing page is the part that looks busier, and the fix is mostly
**subtraction and alignment to the sister site's system**:

- **Width:** the content column is 1600 px, against 1180 px on the sister site.
- **Hero layout:** the headline and the copy that belongs to it sit in opposite columns.
- **Lines:** rules separate every band and every list row.
- **Duplicate content:** two feature sections say the same thing.
- **Styling:** components use raw brand primitives and one-off sizes, where the sister site uses a small semantic token
  layer.

Porting that token layer and the sister site's button and feature-grid recipes fixes most of what follows at once.

## Findings

| ID | Sev | Check | Where | Finding | Fix |
|---|---|---|---|---|---|
| F1 | P1 | LAY-2 / LAY-1 | `global.css:192,226,239,246,253`; `02-landing-lower-desktop.jpg` | Rules everywhere: preview header and footer bars, `.principles` top and bottom rules, a rule under each of the 4 guide rows, a footer rule, and the brand divider in the nav (`:149`). The sidebar footer adds another rule and a bordered box (`:124-138`). | Keep the chart frame as the page's one bordered emphasis surface and delete the other rules. Group with spacing instead, as the sister site does. |
| F2 | P1 | HIER-2 / LAY-5 | `page.tsx:11-18`; `01-landing-hero-desktop.jpg` | The hero splits its message: the h1 sits in the left column, and its description, CTAs and install block sit vertically centered in the right one. The eye jumps across 600 px to find the action. | Stack eyebrow → h1 → description → actions → install in one left-aligned column, as the sister site does. The chart below is the visual. |
| F3 | P1 | HIER-2 | `page.tsx:22-37` | Two sections sell the same thing: three "principles", then a second eyebrow, heading and paragraph plus four guide rows. There are three feature lists (principles, guides, preview footer copy) and two eyebrows. | Merge them into one sister-style `feature-grid`: 3 (or 4) linked cards with a number, title + arrow and one line of copy. Drop the `start-grid` heading block. |
| F4 | P1 | LAY-6 | `global.css:153` | `.home` is `min(1600px, 100%)`. At 1440 px and up, lines run past 1,400 px and the three-column text spreads thin. | `max-width: 1180px; margin: auto`, the same as `.landing` on the sister site. The chart preview then sits at a readable size, and fullscreen stays available. |
| F5 | P1 | COL-1 | `global.css` (13 × `var(--bloxwap-*)`, and a mix of `--card`, `--color-fd-*` and `--muted-foreground`) | Components reach straight to brand primitives, and three naming layers are used interchangeably. | Port the sister site's semantic layer (`--color-surface`, `--color-surface-raised`, `--color-text(-muted)`, `--color-line`, `--color-fill-subtle`, `--color-accent(-on)`, `--ease-out`, `--duration-interactive`) and sweep the rules onto it. |
| F6 | P1 | BTN-1 / BTN-3 | `global.css:161-164`; hero | The primary CTA is a square-cornered block with a 24 px icon gap. The secondary action is bare muted text, so the two don't read as a pair. On mobile they look like a button and a stray link (`03-mobile-390-vs-hyperliquid.jpg`). | Use the sister site's `.button-primary` and `.button-secondary`: pills, 48 px tall, 176 px min width, 12 px icon gap, neutral filled secondary. |
| F7 | P1 | IMG-1 | `page.tsx:16,32`; `chart-preview.tsx:62`; `docs/layout.tsx:10`; `not-found.tsx:4` | Unicode glyphs (`↓ → ↗`) stand in for icons, next to Fumadocs' Lucide icons. `↗` marks both internal guide links and external ones. | Use `lucide-react` `ArrowRight`, `ArrowDown` and `ArrowUpRight`, keeping `ArrowUpRight` for external links only. Add it as a docs dependency; today it is only nested under `fumadocs-ui`. |
| F8 | P2 | TYPE-4 | `global.css` (12 raw px sizes: 10, 11, 12, 13, 14, 15, 16, 18, 32, 40, 44, 56) | Sizes sit outside the scale, and the eyebrow and feature numbers are 10 px. | Map them to `--text-2xs`, `xs`, `sm`, `base`, `lg`, `xl` and `2xl`, as the sister site does. Raise the 10 px labels to `text-2xs` (11 px). |
| F9 | P2 | LAY-3 | `global.css:161` (13/18), `:168` (7/14), `:171` (10), `:192` (14/20), `:239` (38), `:243` (70), `:246` (18/20), `.start-grid h2` (22), `.guide-links h3` (5) | Spacing values are off the 4 px grid. | Use `--spacing(n)`. |
| F10 | P2 | BTN-5 | `global.css:162,217` | The primary button fades toward the background on hover (`opacity: .85`). The fullscreen button draws a neon border on hover. Guide rows, footer links and nav links snap with no transition. There are no `:active` states. | Use the sister site's single interaction recipe: 160 ms `--ease-out`, `filter: brightness(1.1)` on the primary, a neutral fill shift on the secondary, and `scale(.98)` on `:active`. |
| F11 | P2 | HIER-4 | `lib/layout.shared.tsx:15-18`; `docs` sidebar screenshot | The nav adds "Documentation" and "Playground" links. In the docs sidebar, "Documentation" and the current page are **both** highlighted green, which gives the sidebar two active states. | Drop the `links` array, as the sister site does (its nav is the lockup, search and GitHub). Playground is already a sidebar page. |
| F12 | P2 | MOT-2 | `page.tsx` hero | The hero appears all at once. | `landing-rise` stagger: the headline, then the copy and actions after 200 ms, then the chart preview after 400 ms. Respect `prefers-reduced-motion`. |
| F13 | P2 | BTN-4 / LAY-1 | `chart-preview.tsx:58-68`; `global.css:192-237` | The preview adds a header bar (a title, a "Simulated live data" chip, a link and a bordered button) and a footer bar of marketing copy around the chart. The copy repeats the hero. | Collapse to a slim toolbar row: title + live dot on the left; "Open" (ArrowUpRight) and fullscreen as quiet icon or text actions on the right. Delete the footer bar. |

No P0 findings.

**Verified clean:** TYPE-1, TYPE-2, TYPE-3, COL-4, COL-6, BTN-2, FORM-1, FORM-2, FORM-3, MODAL-1, MOT-1, IMG-3,
HIER-5. The site has no forms and no destructive actions. The docs page shell (`#nd-page`, prose, TOC) already matches
the sister site line for line.

## P1 detail

### F1: Rules and boxes (LAY-2 / LAY-1)

**Evidence.** `02-landing-lower-desktop.jpg` shows these lines between the chart and the footer:

- the preview footer bar
- the preview frame
- the principles' top and bottom rules
- four guide-row rules
- the footer rule

That makes eight horizontal lines in about 600 px. The sister site's landing page draws exactly one bordered surface.

**Why:** the eye reads the borders before the content, and hierarchy flattens into bands.
<https://x.com/zander_supafast/status/2080000671781110136>

```css
.principles, .guide-links a, .site-footer { border: 0; }   /* then F3 replaces these sections */
.brand-product { border-left: 0; padding-left: 0; color: var(--color-text); font-size: var(--text-base); font-weight: 600; }
.docs-sidebar-footer { border-top: 0; padding-top: --spacing(2); }
.docs-app-link { border: 0; }
```

### F2: Split hero (HIER-2 / LAY-5)

**Evidence.** In `01-landing-hero-desktop.jpg`, the h1 sits at x≈30 and its description at x≈617, vertically centered
against each other. On mobile, the same content already stacks correctly, which shows the split is the wide-screen
layout rather than the content order.

**Why:** proximity is what tells the eye that a headline, its copy and its action belong together.
<https://x.com/zander_supafast/status/2053925539019165904>

```tsx
<section className="hero-copy">
  <p className="eyebrow"><span /> DEVELOPER PREVIEW · v0.1</p>
  <h1>Financial charts.<br /><span>Your interface.</span></h1>
  <p className="hero-description">Your next trading interface starts here. …</p>
  <div className="hero-actions">
    <a href="#playground" className="button-primary">Play with the chart <ArrowDown size={16} aria-hidden /></a>
    <Link href="/docs/getting-started" className="button-secondary">Start building <ArrowRight size={16} aria-hidden /></Link>
  </div>
  <InstallCommand />
</section>
```

### F3: Duplicate feature sections (HIER-2)

**Evidence.** `02-landing-lower-desktop.jpg` shows "One typed config / Your stack / Built for interaction", then "From
your first candle to a complete workspace" plus four guide rows. They are two lists making overlapping points.

**Why:** extra content dilutes the one message. <https://x.com/zander_supafast/status/2053925539019165904>

**Fix.** Use one grid of linked cards in the sister site's `.feature-card` style: a number, then an h2 with
`ArrowRight`, then one line of copy. For example: *Quick start*, *Use it with React*, *Build the chart workspace*,
*Configuration reference*, using `repeat(4, 1fr)`, or keep three. Merge the principles' copy into those descriptions.

### F4: 1600 px column (LAY-6)

```css
.home { width: 100%; max-width: 1180px; margin: auto; padding: --spacing(24) --spacing(8) --spacing(6); }
```

<https://x.com/zander_supafast/status/1675855870356344838>

### F5: Semantic tokens (COL-1)

Copy the `:root { --color-surface … --duration-interactive }` block and the `--color-fd-*` mapping from
`hyperliquid-ts/website/app/global.css:23-66` verbatim. Then replace every `var(--bloxwap-green)` with
`var(--color-accent)`, `var(--card)` with `var(--color-surface-raised)`, `var(--border)` and `var(--color-fd-border)`
with `var(--color-line)`, and so on. <https://x.com/zander_supafast/status/1875103802082382115>

### F6: Button pair (BTN-1 / BTN-3)

Port `.button-primary` and `.button-secondary` from `hyperliquid-ts/website/app/global.css:158-195`, including the
≤540 px rule that lets them flex to fill the row. Delete `.primary-link` and `.secondary-link`, and switch `not-found`
to `.button-primary`. <https://x.com/zander_supafast/status/1802684455670136954>

### F7: Icons (IMG-1)

```sh
npm --workspace @bloxwap/chart-docs install lucide-react
```

In `install-command.tsx`, the inline copy and check SVG can become `Copy` and `Check`, matching the sister site.
<https://x.com/zander_supafast/status/1836024015778918554>

## Systemic recommendations

1. **Token layer (F5):** one block in `global.css`. It also fixes F10 (it provides the shared easing and duration) and
   gives F1, F6 and F13 the names they use.
2. **Reuse the sister site's landing recipes:** `.landing`, `.hero`, `.eyebrow`, `.button-*`, `.install-*`,
   `.feature-grid` and `.feature-card`, the entrance keyframes, and the media queries. Together they fix F2, F3, F4, F6,
   F8, F9, F10 and F12, and they make the two SDK sites read as one family. The chart-specific rules that remain are
   `.chart-preview`, `.chart-frame` and fullscreen.
3. **Nav config (F11):** remove `links` from `baseOptions()`.
4. **Longer term:** both sites now carry the same ~300 lines of CSS. A shared `@bloxwap/docs-theme` stylesheet (or
   putting the rules in the tokens package) would keep them from drifting.

## Outside catalog (reviewer judgment)

- **Hero headline casing:** the sister site sets its h1 at 72 px with `-0.045em` tracking. This site uses
  `clamp(44px, 4.4vw, 64px)` with `-0.04em`, so it reads slightly smaller and looser. Match the sister site's values for
  family consistency.
- **Next.js dev indicator:** the "N" badge overlaps the chart's left rail in dev screenshots. It only appears in dev,
  but it hides toolbar buttons during local QA. Set `devIndicators: false` in `next.config.mjs` if that gets in the way.
