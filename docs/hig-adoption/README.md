# Chart adoption · HIG 0.1.0 candidate

Owner: Chart maintainers. Recorded 2026-10-13; exceptions reviewed by 2026-11-13.

This repository owns the Chart row of [hig#34](https://github.com/bloxwap/hig/issues/34) and its repository-level evidence for [hig#36](https://github.com/bloxwap/hig/issues/36). It supplies a token-themed embedded chart for the #33 Pro pilot, but cannot certify any product origin. #35's React Native application is outside this repository; the HIG candidate explicitly does not support a native canvas chart.

## Version and installation

HIG source: [1a776b9326c6ba03702894943b3edbfd178c4b40](https://github.com/bloxwap/hig/tree/1a776b9326c6ba03702894943b3edbfd178c4b40), 0.1.0 candidate. Read its `migrations/README.md`, `docs/migration/sdk-docs.md`, `docs/components/chart.md` and `docs/governance/adoption.md`. The candidate is unpublished: `apps/docs/vendor/hig` retains the approved plain CSS distribution, generated manifest and MIT license byte-for-byte, with SHA-256 provenance. It does not pretend to be a stable npm package. No React/native/feedback dependency is added to the SDK.

The shell imports the distribution explicitly. `scripts/hig-tokens.mjs` derives the Fumadocs aliases, spacing, geometry, density, type roles, durations and canvas-compatible sRGB chart theme from that manifest. Fonts stay on the existing exact `@bloxwap/font@0.1.2` dependency; Bloxwap Sans now also supplies headings. The chart iframe receives its own CSS/font assets and the same theme for initial config, toolbar theme mapping and settings reset. Docs embed dark mode explicitly; the standalone SDK playground still owns its theme preferences.

## Migrated surfaces and preserved behavior

Landing/docs shell, navigation/search palette, code/install/copy actions, callout surfaces, typography, focus rings and reduced-motion presentation follow HIG. Custom docs controls use compact 36px desktop targets and comfortable 48px coarse-pointer targets. Copy actions share one implementation, protect pending activation, announce success and show actionable failure text. Search exposes index failure and keeps Fumadocs' keyboard/focus behavior. The chart preview has a text description and loading status; the chart's existing market failure status and offline random-walk recovery remain intact.

The existing SDK engine, exports, API examples, static base paths, metadata, deep links, drawings, settings, pan/zoom/crosshair and persisted preferences remain owned by Chart. No audio/haptic adapter is installed and no cues are emitted on chart ticks, focus or control actions. Existing saved choices are not rewritten. The copied 5,921-byte palette and unused 116,056-byte Space Grotesk source font were removed after reference checks. The two static Bloxwap OG font instances remain used and retain their OFL notice.

## Validation and measured evidence

Run on Node 24: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run coverage`, and `NEXT_PUBLIC_BASE_PATH=/chart NEXT_PUBLIC_SITE_URL=https://bloxwap.github.io npm run docs:build`, then `npm run docs:test`. The browser tests use installed Chrome (Linux) and an ephemeral static-preview port. They cover install keyboard selection, copy success/denial/pending protection, HIG variables/fonts/reduced motion, offline chart data and settings dismissal, search results, RTL/200% root text, coarse-pointer copy targets and mobile navigation. Landing control and mobile shell checks intentionally block the iframe; the distinctive demo is validated separately on its docs page. Mobile shell checks they do not certify mobile chart gestures.

See `browser.json`, `size-report.json` and 1440×1000 before/after landing/playground captures (landing shell isolates the iframe; playground uses the same offline synthetic market and browser, with live timestamps and interaction state rather than a pixel-diff assertion) in this folder. Reproduce totals with `node apps/docs/scripts/measure-hig.mjs <saved-baseline-export-directory> e08198bcff27451defeca238e832d4be54be1896`. Size totals count uncompressed emitted CSS/JavaScript/font files across the complete export, not transfer size or per-route bundles. The baseline is `e08198bcff27451defeca238e832d4be54be1896`, built using the same Node/Next/base-path settings. All 1,869 SDK tests pass; coverage is 100% line/branch/function across 138 reported files. Static-export verification checks 30 HTML pages, links/assets, search, social cards and the configured `/chart` paths.

## Matrix row, exceptions and rollback

| Repository/surface | Applicability | Version | Owner | Status | Residual work / review date |
| --- | --- | --- | --- | --- | --- |
| chart / apps/docs | SDK docs shell and embedded DOM chart | HIG 0.1.0 candidate; Font 0.1.2 | Chart maintainers | Owning implementation and automated Linux evidence in this PR | Physical touch/mobile chart gestures, assistive technology and iOS hardware review; 2026-11-13 |
| chart / published SDK | Engine and optional DOM UI | SDK 0.3.0 | Chart maintainers | Public SDK remains host-configurable; docs-only HIG presentation | Product owners must configure HIG theme for their host; 2026-11-13 |

The canonical org matrix is in `bloxwap/hig/planning/adoption.json`; its Chart row needs this owning PR link and validated version copied upstream by HIG maintainers. No other repository is modified. The decorative OG spectrum retains purple/pink/yellow brand colors absent from the candidate's semantic manifest; these are illustration assets, not a second control palette (Chart maintainers, review 2026-11-13). Fumadocs remains the shell/search primitive owner; wholesale folder copying is unnecessary.

Linux Chromium screenshots and touch emulation are not physical-device or assistive-technology proof. iOS hardware, VoiceOver, TalkBack, tactile feedback, real mobile chart gesture responsiveness and wide-gamut display appearance are unperformed. The candidate still lacks stable publication and the product source audit. #33 needs owning app/Pro/marketing migrations and evidence; #34 needs the other four SDK docs rows and physical/AT follow-up; #35 needs real native migrations/builds/device evidence; #36 needs the canonical matrix update and organization-wide completion review. None of those whole issues is declared satisfied here.

Rollback is an atomic revert of this PR to the baseline commit; restore its CSS/font references and controls together. There are no storage/schema changes. During rollout the host can use the baseline static export; production deployment is not a step in this migration procedure.

## Contribution and upgrade contract

HIG owns semantic tokens/type/density/motion/state contracts; Font owns fonts; Chart owns the engine/demo. Upgrade by selecting a reviewed HIG source commit, replacing only the canonical CSS/manifest/license, updating provenance hashes, regenerating the adapter, running the checks above and comparing screenshots/bytes. Once stable packages exist, replace the vendored distribution with pinned `@bloxwap/hig-tokens/css` and manifest imports; do not copy component folders or feedback engines. Token/type/geometry or interaction timing changes require HIG semver review.

`npm run lint` checks pinned hashes, generated adapter freshness, obsolete imports and copied palette declarations in the shell/components. New exceptions require an owner, exact scope, reason and expiry in this report and a narrowly scoped check update. Run browser tests whenever shell, controls, assets or demo preparation change; CI gates the production export, typecheck, drift checks and browser suite. Link the owning PR and preserve explicit gaps during HIG's v1 completion review rather than closing upstream issues from this repo.
