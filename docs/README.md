# @bloxwap/chart documentation

Fumadocs + Next.js, statically exported for GitHub Pages. The playground embeds
the repository's actual demo and compiled chart package. The docs dependencies
are isolated from the published library.

From the repository root (Node.js 24+):

```sh
npm ci
npm --prefix docs ci
npm run docs:dev
```

Local development: http://localhost:3000

```sh
npm run docs:check
NEXT_PUBLIC_BASE_PATH=/chart npm run docs:build
npm run docs:preview
```

Static preview: http://localhost:3001/chart/ for a `/chart` build, or
http://localhost:3001/ for a build without a base path. The preview reads the
path from the built artifact. It does not run Next.js or a search backend.

Edit MDX in `content/docs/` and sidebar order in each `meta.json`. The build
checks local HTML links and assets, and emits a browser-searchable index at
`search.json`. Fonts are local repository assets, so builds do not fetch Google Fonts.

The design follows `bloxwap/src/monorepo/workers/docs`: dark surfaces, green
accents, Nunito body copy, Space Grotesk headings, and Maple Mono code. The theme
is intentionally dark, matching the main Bloxwap docs.

- `styles/tokens.generated.css` is a vendored copy of the monorepo's
  `packages/ui/src/styles/tokens.generated.css`. Update it from that source;
  do not hand-edit generated tokens.
- `app/global.css` maps those tokens to Fumadocs and the playground wrapper,
  using the same typography and navigation rules as the monorepo docs. The
  embedded demo keeps the library's own appearance and controls.
- `public/logos/bloxwap-wordmark-white.svg` and `public/icon.svg` are the supplied
  monorepo documentation artwork. Preserve the marks instead of typesetting them.
- `fonts/README.md` records font sources and licenses.

These copies keep this repository's GitHub Pages build independent of a sibling
monorepo checkout.

The `predev` and `prebuild` scripts compile the library and run
`scripts/prepare-demo.mjs`. It copies `demo/index.html`, `dist/`, and the demo's
fonts to the ignored `public/chart-demo/` directory. Both the homepage and the
playground guide embed this same demo; edit the original instead of making a
separate docs implementation. Restart `docs:dev` after changing the demo or
library to refresh the copied assets. The export checker validates the iframe
URL and required demo assets. Changes to `demo/` also trigger the Pages workflow.

`.github/workflows/docs.yml` validates pull requests and deploys main to
https://bloxwap.github.io/chart/. Configure **Settings → Pages → Source → GitHub Actions**
once in the GitHub repository. No deployment credentials are stored in the repo;
the deployment job uses GitHub's Pages permissions and OIDC.

The chart package has not been published to npm yet. The quick-start guide
documents building and installing its local tarball; update that note and the
homepage's release badge after the first public release.
