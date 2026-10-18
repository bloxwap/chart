# CI runners

Every GitHub Actions job in this repository targets the org Mac mini fleet:

```yaml
runs-on: [self-hosted, macOS, ARM64]
```

Jobs stay queued until a runner with all three labels is online. Workflows do not call `apt`, `sudo`, or `playwright install --with-deps` (that flag installs Linux packages). Shell used by CI is POSIX / BSD-portable and writes scratch files under `$RUNNER_TEMP` (`TMPDIR` and Playwright's browser path are exported from `$RUNNER_TEMP` in a setup step; GitHub Actions does not allow the `runner` context in job-level `env`).

## Jobs

| Workflow | Job | What it runs |
| --- | --- | --- |
| [`.github/workflows/tests.yml`](../.github/workflows/tests.yml) | `test` | Library coverage gate and package `exports` imports |
| [`.github/workflows/coverage.yml`](../.github/workflows/coverage.yml) | `coverage` | LCOV report and Codecov upload |
| [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) | `build` | Docs export, typecheck, lint, Playwright Chrome checks, Pages artifact |
| [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) | `deploy` | `configure-pages` + `deploy-pages` on `main` |
| [`.github/workflows/publish_npm.yml`](../.github/workflows/publish_npm.yml) | `publish` | Version/tag check and `npm publish` of `@bloxwap/chart` |

## Prerequisites on each Mac mini

Install these on the machine (or confirm they are already present). Do not rely on the workflows to `brew install` or elevate privileges.

| Tool | Why |
| --- | --- |
| GitHub Actions runner | Registered with the default labels `self-hosted`, `macOS`, and `ARM64` |
| Xcode Command Line Tools | Provides `git` and the compiler toolchain `actions/checkout` and native npm packages expect |
| `bash` and `/bin/sh` | Workflow `run:` steps (macOS ships both) |
| GNU tar as `gtar` | `actions/upload-pages-artifact` archives with `gtar` on macOS (`brew install gnu-tar`) |
| Outbound HTTPS | `github.com`, `npmjs.com` / the npm registry, Codecov, and GitHub Pages APIs |

Node.js 24 is **not** a machine prerequisite. `actions/setup-node` downloads the `darwin-arm64` distribution into the runner tool cache.

### Playwright (docs job)

`npm run docs:test` launches Chrome through `playwright-core` (`channel: 'chrome'`). The docs workflow installs Chrome for Testing with:

```sh
npx playwright-core install chrome
```

Browsers go to `$RUNNER_TEMP/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`). There is no `--with-deps` and no `apt`/`sudo`. A system Google Chrome is optional; if present, Playwright may use it instead of Chrome for Testing.

### Not required

- Docker or container actions
- `jq` (publish reads `package.json` with Node)
- GNU `sed` / GNU `grep`
- PulseAudio, `xvfb`, or other Linux desktop packages
- Preinstalled npm dependencies (each job runs `npm ci`)

## Operator notes

- Give the runner enough free disk for `npm ci`, the Next.js static export, and a Chrome for Testing download.
- Headless Chrome on macOS does not need the Accessibility TCC prompt that headed browsers do.
- Fork pull requests on a public repository should stay on GitHub-hosted runners or a dedicated untrusted pool if org policy forbids self-hosted runners on forks. This repo's workflows themselves do not special-case forks.
