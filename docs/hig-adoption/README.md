# Chart docs adoption · HIG 0.1.0

Owner: Chart maintainers. Updated 2026-10-23; exceptions reviewed by 2026-11-13.

This repository owns the Chart row of [hig#34](https://github.com/bloxwap/hig/issues/34) and its
repository-level evidence for [hig#36](https://github.com/bloxwap/hig/issues/36).

| Step | PR | HIG source | How HIG is consumed |
| --- | --- | --- | --- |
| 1 | [#52](https://github.com/bloxwap/chart/pull/52) ([evidence](https://github.com/bloxwap/chart/tree/c4dff80/docs/hig-adoption)) | [1a776b9](https://github.com/bloxwap/hig/tree/1a776b9326c6ba03702894943b3edbfd178c4b40) | Copied plain-CSS snapshot + manifest, alias adapter, local `.btn`/copy/install primitives |
| 2 | [#53](https://github.com/bloxwap/chart/pull/53) | [7c67a07](https://github.com/bloxwap/hig/tree/7c67a07ce20c02264b0fdc57e5f27d020cfd6fdc) | Packed `@bloxwap/hig-tokens`, `-contracts`, `-react` tarballs (historical archives retained in Git history) |
| 3 | [#56](https://github.com/bloxwap/chart/pull/56) | [872906a](https://github.com/bloxwap/hig/tree/872906a9071469af8714b3b6fb5cc7bd64d2d6f3) | Same packages plus build-time `@bloxwap/hig-native-fonts`; upstream fixes replace the step 2 workarounds |
| 4 | [#58](https://github.com/bloxwap/chart/pull/58) | [e3390bbd](https://github.com/bloxwap/hig/tree/e3390bbd0ac12b9d4b371175bd250d01ea866abe) | Scoped OG-font candidate; normal npm workspace resolution |
| 5 | Registry adoption | [v0.1.0](https://github.com/bloxwap/hig/releases/tag/v0.1.0) | Exact npm `0.1.0` for tokens, contracts, React and build-time OG fonts |

## Current registry installation

The docs install four coordinated HIG packages directly from npm. Vendored candidate archives
are removed. `package-lock.json` and [`registry-release.json`](registry-release.json) record the
registry URLs and integrity hashes; `npm ci` verifies downloaded package bytes and `npm run lint`
checks the coordinated declarations, lockfile and installed versions. This release used token
publishing and has no npm provenance attestation. Earlier candidate evidence below remains historical.
The current install, test, export and browser results are in [`registry-verification.json`](registry-verification.json).

`@bloxwap/hig-react` has no chart peer, so ordinary peer resolution preserves the repository's
`@bloxwap/chart` workspace. OG cards use only `@bloxwap/hig-og-fonts/node`; no native-font package
is installed. Whole-page docs retain the explicit `@bloxwap/hig-react/css/base` import.

For upgrades, update all four exact versions, regenerate the lockfile and registry record, then run
`npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `NEXT_PUBLIC_BASE_PATH=/chart npm run docs:build`
and `NEXT_PUBLIC_BASE_PATH=/chart npm run docs:test`. Roll back by reverting the dependency migration.

## What changed in step 2

- **Tokens and fonts.** The shell imports `@bloxwap/hig-tokens/css` and `@bloxwap/hig-react/css` and
  uses `--hig-*` roles directly. The shadcn-style alias layer (`--card`, `--bloxwap-green`, `--space-*`, …)
  and the copied token snapshot are gone. Radius/type/motion/density roles, which the CSS distribution
  does not emit yet, are generated from the package manifest (`styles/hig-roles.generated.css`). Body and
  code fonts stay on `@bloxwap/font@0.1.2`; the social-card renderer now reads the static Bloxwap Sans faces
  from `@bloxwap/hig-tokens/fonts` instead of copied TTFs.
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

## What changed in step 3 (HIG 872906a candidate)

Upstream fixes from [hig#63](https://github.com/bloxwap/hig/issues/63), [#64](https://github.com/bloxwap/hig/issues/64),
[#65](https://github.com/bloxwap/hig/issues/65), [#66](https://github.com/bloxwap/hig/issues/66) and
[#69](https://github.com/bloxwap/hig/issues/69) let the docs drop their workarounds:

- **Roles (#66).** `@bloxwap/hig-tokens/css` emits `--hig-radius-*`, `--hig-type-*`, `--hig-motion-*` and
  `--hig-density-*`. `styles/hig-roles.generated.css`, its generator and its lint drift guard are deleted; the shell
  uses the package names (`--hig-motion-duration-fast`, `--hig-density-compact-control`,
  `--hig-type-body-line-height`, …). The undefined local `--ease-spring` is replaced by `--hig-motion-easing-standard`.
  `npm run lint` now rejects local role declarations and the retired generated names instead.
- **Peers and recipes (#63).** `.npmrc` (`legacy-peer-deps=true`) is deleted: `npm ci` installs with one Radix tree
  and the `packages/chart` workspace link intact. Install commands render the HIG `recipes/install-command` entry and
  the hero code renders `recipes/code-window`; neither entry imports the overlay or a Radix peer.
- **Fonts (#64, #65).** HIG CSS reads `--hig-font-sans`/`--hig-font-mono`, which resolve to the `@bloxwap/font` Next
  loader variables, so the `.hig-button { font-family }` bridge is gone; the browser test asserts the button's first
  family is a loaded Bloxwap face. The tokens tarball has no TTFs (4,428,734 → 8,108 bytes). Social cards read their
  two static faces from the build-time `@bloxwap/hig-native-fonts` devDependency (Satori cannot read WOFF2).
- **Callout and Tabs (#69).** MDX `<Callout>` passes ReactNode titles through and maps `note`/`idea` to HIG `note`/`tip`;
  the local info/success edge rules are deleted. HIG Tabs no longer adds a second tab stop before the install
  command; the browser test checks that Tab from the selected tab lands on the command, then on Copy.
- **Touch targets.** HIG buttons are now 44 px by default (hig#80). On coarse pointers the compact install/code regions
  set `--hig-button` to the comfortable 48 px target role, so the existing 48 px touch check still holds.

| Measure (baseline `a3b0f6b`, same `/chart` export settings) | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Vendored tarballs (bytes) | 4,446,466 (3) | 4,454,889 (4) | +8,423 |
| … web packages only (tokens + contracts + react) | 4,446,466 | 34,514 | −4,411,952 |
| Lockfile packages | 403 | 404 | +1 (`@bloxwap/hig-native-fonts`) |
| Lockfile Radix entries (nested) | 34 (0) | 34 (0) | 0, without `legacy-peer-deps` |
| Emitted CSS (bytes, whole export) | 152,712 | 163,176 | +10,464 |
| Emitted JS (bytes, whole export) | 2,188,721 | 2,191,579 | +2,858 |
| Emitted fonts (bytes) | 14,205,712 | 14,205,712 | 0 |
| Static export total (bytes / files) | 29,686,679 / 827 | 29,701,348 / 827 | +14,669 / 0 |
| Hand-maintained docs CSS (lines / bytes) | 406 / 23,456 | 403 / 23,752 | −3 / +296 |
| Generated role adapter (bytes) | 1,046 | 0 | −1,046 |
| Repo config/workaround files | `.npmrc`, `hig-roles.generated.css` | none | −2 |

CSS grows because HIG's own stylesheet now carries the role variables, density/motion selectors and Callout severities
the docs used to generate or patch locally; JS grows by the recipe modules. Hand-written CSS bytes rise slightly
because the package role names are longer. The repository carries about the same tarball bytes as before only
because the OG renderer still needs two static TTFs, which now come from the native-fonts package instead of the web
tokens package. Full numbers: [`hig-872906a9/size-report.json`](hig-872906a9/size-report.json); screenshots before/after
at 1440×1000 and 390×844 are in [`hig-872906a9/`](hig-872906a9/) (visually equivalent; buttons are 4 px shorter on
desktop per hig#80). Validation: [`hig-872906a9/validation.txt`](hig-872906a9/validation.txt).

## Measured before/after (step 2)

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
`npm ci`, the `/chart` production export with link/asset checks, `docs:check`, `lint` (HIG registry integrity and
copy guards) and `docs:test` (browser checks).

## Matrix row, exceptions and rollback

| Repository/surface | Applicability | Version | Owner | Status | Residual work / review date |
| --- | --- | --- | --- | --- | --- |
| chart / apps/docs | SDK docs shell and embedded DOM chart | HIG 0.1.0 from npm (tokens, contracts, react; og-fonts build-time); Font 0.1.2 | Chart maintainers | Migrated to HIG packages; automated + browser evidence | Physical touch/mobile chart gestures, VoiceOver/TalkBack, iOS/Android hardware; 2026-11-13 |
| chart / published SDK | Engine and optional DOM UI | SDK 0.4.0 | Chart maintainers | Unchanged; standalone themes stay host-configurable | Product owners configure the HIG theme in their host; 2026-11-13 |

Exceptions (Chart maintainers, review 2026-11-13):

- Resolved in step 3: `.npmrc` `legacy-peer-deps=true`, primitive-composed `InstallCommand`/`CodeWindow`,
  generated role CSS, the button font bridge and local Callout edges.
- Resolved in step 4: normal lockfile regeneration keeps the Chart workspace; scoped OG fonts replace the native-font archive.
- Resolved in step 5: all HIG dependencies use the published npm release, with no vendored tarballs.
- Decorative OG brand-spectrum colors (purple/pink/yellow) are illustration assets, not a control palette.

The canonical org matrix lives in `bloxwap/hig/planning/adoption.json`; HIG maintainers copy this row,
PR link and version there. This repository does not close or declare hig#34 complete; the other four
SDK docs rows and physical/assistive-technology review stay open upstream.

Rollback: revert the step's commits together (tarballs, lockfile, `.npmrc`, imports and CSS). There
are no storage or schema changes. No release, tag, npm publish or manual deployment is part of it.
