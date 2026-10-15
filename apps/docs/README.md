# @bloxwap/chart documentation

Fumadocs + Next.js, statically exported for GitHub Pages. The playground embeds
the repository's actual demo and compiled chart package. The docs dependencies
are isolated from the published library.

From the repository root (Node.js 24+):

```sh
npm ci
npm run docs:dev
```

Local development: http://localhost:3902

```sh
npm run docs:check
NEXT_PUBLIC_BASE_PATH=/chart npm run docs:build
npm run docs:preview
```

Static preview: http://localhost:3902/chart/ for a `/chart` build, or
http://localhost:3902/ for a build without a base path. The preview reads the
path from the built artifact. It does not run Next.js or a search backend.

Edit MDX in `content/docs/` and sidebar order in each `meta.json`. The build
checks local HTML links and assets, and emits a browser-searchable index at
`search.json`. Fonts come from the installed `@bloxwap/font` package (and `@bloxwap/hig-native-fonts` for social cards), so builds do not fetch Google Fonts.

The presentation follows the Bloxwap HIG and consumes it as packages, not copies:

- `@bloxwap/hig-tokens`, `@bloxwap/hig-contracts` and `@bloxwap/hig-react` (plus the build-time
  `@bloxwap/hig-native-fonts`) are installed from the pinned, unpublished candidate tarballs in [`vendor/bloxwap-hig/`](../../vendor/bloxwap-hig/README.md).
  `app/global.css` imports `@bloxwap/hig-tokens/css` and `@bloxwap/hig-react/css` and maps HIG roles
  onto Fumadocs; it does not declare palette values.
- Radius, type, motion and density roles (`--hig-radius-*`, `--hig-type-*`, `--hig-motion-*`,
  `--hig-density-*`) and the font roles come from `@bloxwap/hig-tokens/css`; the docs declare none.
  `npm run lint` (`scripts/hig-tokens.mjs --check`) fails on tarball hash changes, local role declarations
  or retired role names, copied palettes, `.btn`-style primitive copies or font binaries in the docs source.
- Buttons, install tabs/copy, code-window copy, callouts, search error/empty states and the playground
  loading status use HIG components (`Button`, `IconButton`, `Tabs`, `Surface`, `Callout`, `Alert`,
  `EmptyState`, `Spinner`) and the `InstallCommand`/`CodeWindow` recipe entries. The embedded demo keeps the SDK's own controls, themed from HIG roles.
- `public/logos/bloxwap-wordmark-white.svg` and `public/icon.svg` are the supplied
  monorepo documentation artwork. Preserve the marks instead of typesetting them.


## Social cards

The homepage and every documentation page have a 1200×630 PNG for Open Graph
and Twitter/X large-image previews. They are laid out like GitHub's repository
cards, in the site's dark theme and matching the bloxwap/sfx cards: a Bloxwap
black (`#0a0a0a`) canvas, Bloxwap Sans Bold and Black text in the `--foreground` and
`--muted-foreground` grays, and the green Bloxwap mark. The home card shows a
stats row (built-in indicator and drawing-tool counts from the library, plus the
dependency count and version from `packages/chart/package.json`); page cards
show the section instead. A weighted brand-color bar runs along the bottom.
Fonts are local assets.

`lib/og-card.tsx` renders the cards with Next's `ImageResponse`. The static route
in `app/og/[...slug]/route.tsx` generates `/og/home.png` and
`/og/docs/<page>.png` at build time, including `/og/docs/index.png` for the docs
introduction. Titles and descriptions come from each page's MDX frontmatter.
New pages receive a card automatically. No image server is needed after export.

`lib/social.ts` sets page-specific Open Graph and Twitter metadata and canonical
URLs using `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_BASE_PATH`. The postbuild
checker validates all page image URLs, preview metadata, and PNG dimensions.
For a `/chart` build, preview the homepage image at
`http://localhost:3902/chart/og/home.png` after `npm run docs:preview`.

The `predev` and `prebuild` scripts compile the library and run
`scripts/prepare-demo.mjs`. It copies `apps/playground/index.html`,
`packages/chart/dist/`, and the Latin Bloxwap Sans/Mono faces from
`@bloxwap/font` into the ignored `public/chart-demo/` directory. Both the homepage and the
playground guide embed this same demo; edit the original instead of making a
separate docs implementation. Restart `docs:dev` after changing the demo or
library to refresh the copied assets. The export checker validates the iframe
URL and required demo assets. Changes to `apps/playground/` also trigger the
Pages workflow.

`.github/workflows/docs.yml` validates pull requests and deploys main to
https://bloxwap.github.io/chart/. Configure **Settings → Pages → Source → GitHub Actions**
once in the GitHub repository. No deployment credentials are stored in the repo;
the deployment job uses GitHub's Pages permissions and OIDC.

The chart package has not been published to npm yet. The quick-start guide
documents building and installing its local tarball; update that note and the
homepage's release badge after the first public release.

The exact `@bloxwap/font@0.1.2` dependency supplies self-hosted Sans/Mono Next.js
loaders. The embedded playground copies a stylesheet trimmed to the Latin Sans
and Mono faces, replaces the playground's Geist faces with them, points the SDK
chrome's `--cts-font`/`--cts-mono` at Bloxwap Sans/Mono, and sets the canvas
`theme.fontFamily` to Bloxwap Sans and `monoFamily`/`scaleFontFamily` (status
line, drawing labels and scales) to Bloxwap Mono. The standalone playground and
SDK presets retain their existing font defaults.
Social cards use the static Bloxwap Sans faces shipped in `@bloxwap/hig-native-fonts/fonts` (OFL), a
build-time devDependency; Satori cannot read the variable WOFF2 in `@bloxwap/font`.

HIG presentation, pinned candidate provenance, validation, exceptions and upgrade/rollback
instructions are recorded in [the adoption report](../../docs/hig-adoption/README.md).
