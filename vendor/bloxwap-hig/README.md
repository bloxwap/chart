# Vendored Bloxwap HIG candidate packages

The docs install four checksummed file dependencies from unpublished HIG candidate `0.1.0-candidate.shae3390bbd`, source [`e3390bbd`](https://github.com/bloxwap/hig/commit/e3390bbd0ac12b9d4b371175bd250d01ea866abe). No component sources or font binaries are copied into the app.

| Tarball | Bytes | Use |
| --- | ---: | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.shae3390bbd.tgz` | 8,227 | Canonical CSS roles and typed manifest |
| `bloxwap-hig-contracts-0.1.0-candidate.shae3390bbd.tgz` | 7,205 | Shared React runtime contracts |
| `bloxwap-hig-react-0.1.0-candidate.shae3390bbd.tgz` | 21,918 | DOM components, scoped component CSS and opt-in page base |
| `bloxwap-hig-og-fonts-0.1.0-candidate.shae3390bbd.tgz` | 844,028 | Build-time only: byte-identical Sans Bold/Black for social cards |

`provenance.json` records exact archive hashes and the retained candidate report hash. `npm run lint` verifies the archives, report and installed coordinated versions. The report was produced from a clean source input state and records no publication, release or tag.

## Install and validation

`npm install` can regenerate the lockfile from scratch with normal peer resolution. `@bloxwap/hig-react` has no chart peer; the adapter lives in the separate `@bloxwap/hig-chart` package. These docs use their own chart workspace and do not need that adapter. `npm ci` preserves `@bloxwap/chart -> ./packages/chart`.

OG cards load only the canonical Latin subset through `readOgFont` from `@bloxwap/hig-og-fonts/node`. Its SHA-256 checks preserve the existing Bold/Black bytes, family names and weights. The full native-font tarball is no longer needed. Whole-page docs retain the explicit `@bloxwap/hig-react/css/base` import before the scoped component CSS.

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `NEXT_PUBLIC_BASE_PATH=/chart npm run docs:build` and `NEXT_PUBLIC_BASE_PATH=/chart npm run docs:test`. Evidence and before/after OG hashes are in `docs/hig-adoption/issue-115/`.

## Upgrade or roll back

Replace the coherent tarballs, file specs, provenance/report and lockfile together. Re-run clean installation, docs checks and browser/card comparisons. Roll back by reverting that atomic change.
