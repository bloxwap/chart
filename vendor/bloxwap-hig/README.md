# Vendored Bloxwap HIG candidate packages

`@bloxwap/hig-*` is not published to npm. The docs site installs these packed candidate tarballs with
`file:` dependencies (`apps/docs/package.json`); no HIG source, component folders, palettes, fonts or
feedback engines are copied into this repository.

| Tarball | Used for |
| --- | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.shad7ff4780.tgz` | `@bloxwap/hig-tokens/css` (shell and chart demo, including the radius/type/motion/density roles), typed manifest (chart theme, OG colors). No font binaries since bloxwap/hig#64 |
| `bloxwap-hig-native-fonts-0.1.0-candidate.shad7ff4780.tgz` | Static Bloxwap Sans Bold/Black TTFs for the OG card renderer only (build time, never served) |
| `bloxwap-hig-contracts-0.1.0-candidate.shad7ff4780.tgz` | runtime dependency of `@bloxwap/hig-react` |
| `bloxwap-hig-react-0.1.0-candidate.shad7ff4780.tgz` | `@bloxwap/hig-react/css`, `button`, `navigation`, `surface`, `status` entries |

Provenance: [bloxwap/hig@d7ff478](https://github.com/bloxwap/hig/tree/d7ff478049bbe71056d9248dc48e08166be4431e),
built with `npm ci && npm run build && npm run release:dry-run -- --channel candidate` (plus
`npm run generate:fonts` for the TTFs in `@bloxwap/hig-native-fonts`). SHA-256 hashes are in `provenance.json`
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
`file:` specs, run `npm install`, then
`npm run lint`, `npm run typecheck`, the docs build and `npm run docs:test`. Rolling back is an atomic
revert of the commit that changed this folder, the lockfile and the docs imports together.
