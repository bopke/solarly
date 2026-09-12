# 0001. Project scaffolding: build, test, lint, and deploy tooling

Status: accepted

## Context

Issue #1 (M1 milestone) needed a base project set up before any feature
work — the module boundaries, chart UI, and generation engine described in
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md` all sit on top of
this scaffold. The spec already fixes the high-level architecture (Vite +
React + TypeScript, static build, Cloudflare Pages, no backend), so the
open questions here were the specific tools within that architecture:
build tool, test runner, lint/format setup, and how to wire up the
Cloudflare Pages deploy.

## Decision

- **Build tool: Vite** (via `npm create vite@latest -- --template
react-ts`). The spec already calls for Vite; it was not re-litigated here.
  Vite gives fast local dev (HMR) and a standard static `dist/` output
  that Cloudflare Pages serves directly, with no server-side rendering or
  custom bundler config needed.
- **Testing: Vitest**, using its Vite-native config integration (`test`
  block merged into `vite.config.ts`) rather than a separate test runner
  like Jest. Rationale: it reuses the exact same transform pipeline as the
  dev/build, avoiding a second, possibly-inconsistent toolchain. Testing
  Library (`@testing-library/react`) is included for component tests, and
  `jsdom` provides the DOM environment. Note: at scaffolding time, the
  latest `vite` (8.x) required `vitest` 5.x for a compatible internal
  `vite` peer version — using vitest 3.x against vite 8 caused a type
  mismatch in the merged config. Pin `vitest` to a version whose peer
  range includes the installed `vite` major when upgrading either in the
  future.
- **Lint/format: ESLint (flat config) + Prettier**, rather than the newer
  `oxlint` that `create-vite` scaffolds by default. Rationale: the issue
  explicitly asked for "ESLint + Prettier (or equivalent)"; ESLint +
  Prettier is the more broadly documented and stable combination for a
  TypeScript + React project, with mature `typescript-eslint` and
  `eslint-plugin-react-hooks` support. `eslint-config-prettier` disables
  ESLint's own formatting rules so the two tools never fight over the same
  concern.
- **Cloudflare Pages deploy: config only, not a verified live deploy.**
  Added `wrangler.toml` (declares the Pages project name and
  `dist` as the build output directory) plus a `.github/workflows/deploy.yml`
  GitHub Actions workflow that builds and deploys via
  `cloudflare/pages-action` on push to `main`. **This has not been used to
  trigger an actual deploy** — no Cloudflare account/API token is
  available in this environment. The deploy step is guarded to skip (with
  a warning) rather than hard-fail when the `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID` secrets aren't configured, so CI stays green
  until someone with Cloudflare access adds those secrets and/or connects
  the Pages project. A separate `.github/workflows/ci.yml` runs
  lint/format-check/test/build on every PR and push to `main`,
  independent of deploy credentials.

## Consequences

- Anyone building on this scaffold can run `npm run dev`, `npm run
build`, `npm test`, `npm run lint`, and `npm run format` immediately;
  CI enforces the same on every PR.
- The app is **not yet live** on a Cloudflare Pages URL. Someone with
  Cloudflare account access needs to either connect this repo to a
  Cloudflare Pages project (dashboard, or `wrangler pages project create
solarly`) and add the two GitHub Actions secrets, or run `wrangler
pages deploy dist` manually after a local build. Until then, the
  acceptance criterion "app is live at a Cloudflare Pages URL" is
  unverified — this is a known gap, tracked back to the person with
  Cloudflare credentials, not a silent claim of a working deploy.
- Because Vitest's config is merged into `vite.config.ts`, the two tools'
  major versions are coupled going forward; bumping `vite` may require
  bumping `vitest` in the same change (see note above).
