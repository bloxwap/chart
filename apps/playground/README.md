# Chart playground

The complete interactive demo for `@bloxwap/chart`. Both the documentation landing
page and playground guide embed this same HTML.

From the repository root:

```sh
npm ci
npm run demo
```

Requires Node.js 24+ and Bun. The command builds the library before starting the
server at http://localhost:8641/demo/. Set `PORT` to use a different port.

Edit `index.html` for demo controls and `packages/chart/src` for library behavior.
Run `npm run build` after library changes, then refresh the browser. The server
maps `/dist/`, `/assets/`, and `/bench/` to the library workspace so the same
relative imports work in the standalone app and exported documentation.

The real-canvas benchmark is at http://localhost:8641/bench/browser.html.

For the docs, `apps/docs/scripts/prepare-demo.mjs` copies the playground HTML,
compiled library, and fonts into the docs public directory before dev or build.
Restart `npm run docs:dev` after changing playground or library files to refresh
that copy.
