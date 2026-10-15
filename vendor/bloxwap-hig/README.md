# Vendored Bloxwap HIG candidate packages

`@bloxwap/hig-*` is not published to npm. The docs site installs these packed candidate tarballs with
`file:` dependencies (`apps/docs/package.json`); no HIG source, component folders, palettes, fonts or
feedback engines are copied into this repository.

| Tarball | Bytes | Used for |
| --- | ---: | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.sha872906a9.tgz` | 8,108 | `@bloxwap/hig-tokens/css` (palette plus radius/type/motion/density and font roles) for the shell and chart demo; typed manifest (chart theme, OG colors) |
| `bloxwap-hig-contracts-0.1.0-candidate.sha872906a9.tgz` | 6,119 | runtime dependency of `@bloxwap/hig-react` |
| `bloxwap-hig-react-0.1.0-candidate.sha872906a9.tgz` | 20,287 | `@bloxwap/hig-react/css`, `button`, `navigation`, `surface`, `status`, `recipes/install-command`, `recipes/code-window` entries |
| `bloxwap-hig-native-fonts-0.1.0-candidate.sha872906a9.tgz` | 4,420,375 | build-time only (devDependency): static `BloxwapSans-{Bold,Black}.ttf` for the Satori social-card renderer |

Provenance: [bloxwap/hig@872906a](https://github.com/bloxwap/hig/tree/872906a9071469af8714b3b6fb5cc7bd64d2d6f3),
built with `npm ci && npm run build && npm run generate:fonts && npm run release:dry-run -- --channel candidate`
(`generate:fonts` needs fonttools 4.61.1 and brotli; it produces the faces packed into
`@bloxwap/hig-native-fonts`). The dry run reported `published: false`, no tags or releases. SHA-256 hashes
are in `provenance.json` and checked by `npm run lint`. MIT/OFL licenses travel inside each tarball.

## Notes

- No `.npmrc` override. Since hig#63 the optional Radix peers are caret ranges, so `npm ci` installs
  next to Fumadocs with one Radix tree (34 lockfile Radix entries, none nested) and keeps the
  `packages/chart` workspace link.
- Known npm 11.6 behaviour: regenerating the lockfile **from scratch** (deleting `package-lock.json`)
  without `--legacy-peer-deps` drops the `packages/chart` workspace, because `@bloxwap/hig-react` declares an
  optional `@bloxwap/chart` peer with the same name. `npm ci`, `npm install` against the committed lock and
  adding dependencies are unaffected. If you must regenerate the lock, run
  `npm install --legacy-peer-deps` once, then `npm install` (which reports "up to date") and confirm
  `npm ls @bloxwap/chart` shows `-> ./packages/chart`.
- `@bloxwap/hig-tokens` no longer ships native TTFs (hig#64). Satori reads TTF/OTF/WOFF, not the variable
  WOFF2 in `@bloxwap/font`, so the social cards take their two static faces from `@bloxwap/hig-native-fonts`
  as the HIG native migration guide recommends. That tarball is not imported by any page and nothing from it
  reaches the static export except the rendered PNG cards.

## Upgrade or roll back

Rebuild the tarballs from a reviewed HIG commit, replace them here, update `provenance.json` and the four
`file:` specs, run `npm install`, then `npm run lint`, `npm run typecheck`, the docs build and
`npm run docs:test`. Rolling back is an atomic revert of the commit that changed this folder, the lockfile and
the docs imports together.
