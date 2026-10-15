# Chart docs adoption · HIG 0.1.0 candidate

Owner: Chart maintainers. Updated 2026-10-14; exceptions reviewed by 2026-11-13.

This repository owns the Chart row of [hig#34](https://github.com/bloxwap/hig/issues/34) and its
repository-level evidence for [hig#36](https://github.com/bloxwap/hig/issues/36).

| Step | PR | HIG source | How HIG is consumed |
| --- | --- | --- | --- |
| 1 | [#52](https://github.com/bloxwap/chart/pull/52) ([evidence](https://github.com/bloxwap/chart/tree/c4dff80/docs/hig-adoption)) | [1a776b9](https://github.com/bloxwap/hig/tree/1a776b9326c6ba03702894943b3edbfd178c4b40) | Copied plain-CSS snapshot + manifest, alias adapter, local `.btn`/copy/install primitives |
| 2 | this migration | [7c67a07](https://github.com/bloxwap/hig/tree/7c67a07ce20c02264b0fdc57e5f27d020cfd6fdc) | Packed `@bloxwap/hig-tokens`, `-contracts`, `-react` tarballs ([vendor/bloxwap-hig](../../vendor/bloxwap-hig/README.md)) |

## What changed in step 2

- **Tokens and fonts.** The shell imports `@bloxwap/hig-tokens/css` and `@bloxwap/hig-react/css` and
  uses `--hig-*` roles directly. The shadcn-style alias layer (`--card`, `--bloxwap-green`, `--space-*`, …)
  and the copied token snapshot are gone. Radius/type/motion/density roles come from `@bloxwap/hig-tokens/css`
  itself since bloxwap/hig#66, so the generated `styles/hig-roles.generated.css` is gone. Body and
  code fonts stay on `@bloxwap/font@0.1.2`; the social-card renderer now reads the static Bloxwap Sans faces
  from `@bloxwap/hig-native-fonts` (moved out of the web tokens tarball in bloxwap/hig#64) instead of copied TTFs.
- **Shell, navigation and search.** Fumadocs keeps layout, sidebar, mobile navigation and the static
  search index. HIG roles theme it; search failure renders HIG `Alert`, no results renders HIG `EmptyState`.
- **Code, install and copy.** Install tabs are HIG `Tabs`; each command follows the HIG `InstallCommand`
  recipe (HIG `Surface` + `Button`, "Copied" / manual-selection recovery). The code-window copy is a HIG
  `IconButton` with `busy`. A shared `useClipboard` joins repeat activations to the pending write.
- **Callouts, forms and states.** MDX `<Callout>` renders HIG `Callout` (static, not a live region); the
  quick start uses it for the developer-preview notice. The playground loading status is HIG `Spinner`.
  The docs have no forms besides Fumadocs search; the chart settings forms belong to the SDK demo.
- **Distinctive demo.** The iframe playground still runs the SDK's own controls and engine. It receives
  `@bloxwap/hig-tokens/css` unmodified and a chart theme from the typed package manifest. Base path,
  metadata, deep links, API examples and capability wording are unchanged.

## Measured before/after

Baseline `c4dff80` (main), same Node 24 / Next 16.3.6 / `/chart` export settings. Full numbers are in
[`hig-7c67a07/size-report.json`](hig-7c67a07/size-report.json); reproduce with
`node apps/docs/scripts/measure-hig.mjs <baseline-out> c4dff80`.

| Measure | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Emitted CSS (bytes, whole export) | 145,759 | 152,712 | +6,953 |
| Emitted JS (bytes, whole export) | 2,172,631 | 2,188,721 | +16,090 |
| Emitted fonts (bytes) | 14,205,712 | 14,205,712 | 0 |
| Static export total (bytes / files) | 29,653,520 / 826 | 29,686,679 / 827 | +33,159 / +1 |
| Hand-maintained docs CSS (files / lines) | 2 / 460 | 1 / 406 | −1 / −54 |
| Generated token adapter (bytes) | 2,172 | 1,046 | −1,126 |
| Docs source files removed | | 9 files, 904,638 bytes | copied tokens, manifest, adapter, 2 TTFs + notices |
| Docs direct dependencies | 16 | 19 | +3 (`@bloxwap/hig-*`) |
| Lockfile packages | 400 | 403 | +3, no transitive additions |

The output grows slightly: HIG's component stylesheet and its OKLCH token block now ship (+7 KB CSS),
and HIG `Button`/`Tabs`/`Surface`/`status` modules replace the local primitives (+16 KB JS, uncompressed,
whole export). In exchange, nine copied files and the alias layer are gone, and tokens/controls now
update with the HIG package instead of by hand. The repository also carries the 4.2 MB tokens tarball,
most of which is native TTFs the docs do not use.

Screenshots in [`hig-7c67a07/`](hig-7c67a07/) show home, quick start, configuration reference and
playground at 1440×1000 and 390×844, before and after (Chrome via Playwright, external requests
blocked so both playground captures use the offline synthetic market; timestamps differ).

## Validation

See [`hig-7c67a07/validation.txt`](hig-7c67a07/validation.txt) and
[`hig-7c67a07/browser.json`](hig-7c67a07/browser.json). CI (`.github/workflows/docs.yml`) runs
`npm ci`, the `/chart` production export with link/asset checks, `docs:check`, `lint` (HIG provenance and
copy guards) and `docs:test` (browser checks).

## Matrix row, exceptions and rollback

| Repository/surface | Applicability | Version | Owner | Status | Residual work / review date |
| --- | --- | --- | --- | --- | --- |
| chart / apps/docs | SDK docs shell and embedded DOM chart | HIG 0.1.0-candidate.sha7c67a07c (tokens, contracts, react); Font 0.1.2 | Chart maintainers | Migrated to HIG packages; automated + browser evidence | Physical touch/mobile chart gestures, VoiceOver/TalkBack, iOS/Android hardware; stable HIG publication; 2026-11-13 |
| chart / published SDK | Engine and optional DOM UI | SDK 0.3.0 | Chart maintainers | Unchanged; standalone themes stay host-configurable | Product owners configure the HIG theme in their host; 2026-11-13 |

Exceptions (Chart maintainers, review 2026-11-13):

- `.npmrc` `legacy-peer-deps=true`: HIG React's optional exact Radix peers conflict with Fumadocs.
- `InstallCommand`/`CodeWindow` recipes are composed from HIG primitives because the `recipes` entry pulls
  the overlay entry's Radix dropdown-menu/tooltip peers. Upstream follow-up: split that entry.
- Decorative OG brand-spectrum colors (purple/pink/yellow) are illustration assets, not a control palette.
- HIG tokens are unpublished candidates, vendored as packed tarballs with SHA-256 provenance.

The canonical org matrix lives in `bloxwap/hig/planning/adoption.json`; HIG maintainers copy this row,
PR link and version there. This repository does not close or declare hig#34 complete; the other four
SDK docs rows and physical/assistive-technology review stay open upstream.

Rollback: revert this migration's commits together (tarballs, lockfile, `.npmrc`, imports and CSS). There
are no storage or schema changes. No release, tag, npm publish or manual deployment is part of it.
