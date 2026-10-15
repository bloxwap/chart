# Vendored Bloxwap HIG candidate packages

`@bloxwap/hig-*` is not published to npm. The docs site installs these packed candidate tarballs with
`file:` dependencies (`apps/docs/package.json`); no HIG source, component folders, palettes, fonts or
feedback engines are copied into this repository.

| Tarball | Used for |
| --- | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.sha7c67a07c.tgz` | `@bloxwap/hig-tokens/css` (shell and chart demo), typed manifest (chart theme, generated roles, OG colors), static OG font faces |
| `bloxwap-hig-contracts-0.1.0-candidate.sha7c67a07c.tgz` | runtime dependency of `@bloxwap/hig-react` |
| `bloxwap-hig-react-0.1.0-candidate.sha7c67a07c.tgz` | `@bloxwap/hig-react/css`, `button`, `navigation`, `surface`, `status` entries |

Provenance: [bloxwap/hig@7c67a07](https://github.com/bloxwap/hig/tree/7c67a07ce20c02264b0fdc57e5f27d020cfd6fdc),
built with `npm ci && npm run build && npm run release:dry-run -- --channel candidate` (plus
`npm run generate:fonts` for the native TTFs the dry run packs). SHA-256 hashes are in `provenance.json`
and checked by `npm run lint`. MIT licenses travel inside each tarball.

## Notes

- `.npmrc` sets `legacy-peer-deps=true`. `@bloxwap/hig-react` declares optional exact Radix peers
  (`react-dialog`/`react-popover` 1.1.15) that conflict with Fumadocs' 1.1.23. Without the flag npm
  nests a second Radix tree and drops the `packages/chart` workspace link in favor of the registry
  build. The docs import no HIG overlay entry, so the peers are unused.
- `@bloxwap/hig-react/recipes` imports the overlay entry, which needs `@radix-ui/react-dropdown-menu`
  and `@radix-ui/react-tooltip`. Instead of adding those, the docs compose the `InstallCommand` and
  `CodeWindow` recipe markup from the `button`/`surface` primitives. Switch to the recipe imports when
  HIG ships them without overlay peers.

## Upgrade or roll back

Rebuild the tarballs from a reviewed HIG commit, replace them here, update `provenance.json` and the
three `file:` specs, run `npm install`, `node apps/docs/scripts/hig-tokens.mjs --write`, then
`npm run lint`, `npm run typecheck`, the docs build and `npm run docs:test`. Rolling back is an atomic
revert of the commit that changed this folder, the lockfile and the docs imports together.
