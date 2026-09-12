# 0002. Deploy via Cloudflare Workers Builds, not Pages + GitHub Actions

Status: accepted (supersedes the deploy-config portion of
[0001](0001-project-scaffolding.md))

## Context

ADR 0001 set up a Cloudflare **Pages** deploy config (`pages_build_output_dir`
in `wrangler.toml`) plus a `.github/workflows/deploy.yml` GitHub Actions
workflow using `cloudflare/wrangler-action` and two repo secrets
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), at a point when no
Cloudflare account access was available to verify it end-to-end.

Once the repo owner actually connected the project in the Cloudflare
dashboard, it turned out they'd created a **Workers** project with Git
integration ("Workers Builds"), not a Pages project — a different,
newer Cloudflare product that reads a different `wrangler.toml` shape and
handles building/deploying itself, without needing any GitHub Actions
workflow or secrets at all. The mismatch was visible as a permanently
failing "Workers Builds: solarly" check on every PR.

## Decision

- Switch `wrangler.toml` from the Pages-style `pages_build_output_dir`
  field to the Workers static-assets shape: an `[assets]` block with
  `directory = "dist"`. No `main` entrypoint script is declared — Workers
  supports assets-only deployments for a project with no server-side code,
  which is all Solarly needs for M1.
- Remove `.github/workflows/deploy.yml` entirely. Cloudflare's Workers
  Builds Git integration runs its own build (configured in the dashboard,
  not in this repo) and deploys via `wrangler deploy` directly — the
  GitHub Actions workflow was not just unnecessary but would have
  actively conflicted with it (deploying via the old `wrangler pages
deploy` command against what is now a Workers-shaped config).
- `.github/workflows/ci.yml` (lint/format/test/build, independent of any
  deploy credentials) is unaffected and still runs on every PR.

Verified locally with `npx wrangler deploy --dry-run`, which read the new
config and correctly found the built `dist/` assets. Confirmed working in
practice by the previously-failing `Workers Builds: solarly` check turning
green on the PR that made this change.

## Consequences

- No GitHub Actions secrets are needed for deployment — simpler than ADR
  0001's original plan. The follow-up issue tracking Cloudflare credential
  setup (#26) is resolved without ever needing those secrets.
- The deploy pipeline itself (build command, branch rules, preview
  deploys) now lives in Cloudflare dashboard settings rather than in this
  repo, so it isn't version-controlled or visible in a diff. Anyone
  changing the build command needs dashboard access, not just a PR.
- Cloudflare's Workers Builds provides PR preview deploys natively
  (per-branch preview URLs), so removing the GitHub Actions workflow does
  not give up that capability.
- `wrangler.toml`'s `[assets]` block defaults `not_found_handling` to
  `"none"` — fine for the current no-router static site, but will need
  revisiting (e.g. `single-page-application` handling) if/when
  client-side routing is added.
