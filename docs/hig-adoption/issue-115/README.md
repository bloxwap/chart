# HIG consumer refresh · issue 115

The docs use coordinated HIG `0.1.0-candidate.shae3390bbd` archives. `candidate-report.json` and `vendor/bloxwap-hig/provenance.json` preserve the source commit, clean-start report and SHA-256 hashes. The build loads Sans Bold/Black from `@bloxwap/hig-og-fonts/node` instead of the complete native-font package. Their bytes and all 25 resulting social cards match the previous build.

Normal lockfile regeneration was tested without force or legacy peer flags from empty generated dependency directories. The committed lock keeps all existing non-HIG versions, recomputes normal peer metadata and passes `npm ci`; the chart workspace symlink survives. Whole-page docs opt in to `css/base`, then load the scoped component stylesheet. The guard verifies source/report/archive/installed versions.

`verification.json` records installation, 1,869 tests, lint/types, the 30-page/1,530-link/25-card production export, existing browser checks and asset sizes. Browser captures retain exact desktop home and mobile pixels. The playground differs only in its running countdown and time-axis labels. Vendored archives shrink by 3,573,511 bytes; exported web fonts are unchanged.

Reproduce with `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `NEXT_PUBLIC_BASE_PATH=/chart NEXT_PUBLIC_SITE_URL=https://bloxwap.github.io npm run docs:build`, then `NEXT_PUBLIC_BASE_PATH=/chart HIG_EVIDENCE_DIR=docs/hig-adoption/issue-115/after-browser npm run docs:test`.

These are local automated observations. No merge, registry publication, device approval or deployment is recorded here.
