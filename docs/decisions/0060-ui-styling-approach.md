# 0060. UI styling approach: CSS Modules

Status: accepted

## Context

No styling approach had been chosen yet for the project (issue #1's
scaffold left this open). Issue #11 (app shell) is the first `ui/`
component work and needs a convention in place before it, and the several
sibling UI issues that build on top of it (location picker, system config
form, chart tabs), start writing component styles independently and
inconsistently.

Options considered:

- **CSS Modules** — built into Vite with zero extra dependency
  (`Component.module.css` files, class names scoped and hashed at build
  time).
- **A CSS-in-JS library** (e.g. styled-components, Emotion) — familiar
  API, but adds a runtime dependency and a bit of bundle/runtime cost for
  a static, no-backend app where that cost buys little.
- **Tailwind CSS** — fast to write once set up, but needs its own build
  step/config and a shift in authoring style; not clearly a better fit
  than plain CSS for a small, deliberately-not-over-polished component
  set.
- **One global stylesheet** — simplest to start, but does not scale past
  a handful of components: class names collide across `ui/` components
  written by different issues/people over time, and there is no clear
  file-per-component boundary.

## Decision

Use **CSS Modules**, colocated as `Component.module.css` next to each
`Component.tsx` in `src/ui/`. Vite supports this out of the box (any
`*.module.css` import is automatically scoped) so it adds no new
dependency and no extra build configuration.

Conventions for `ui/` components going forward:

- **Flat files**: `Component.module.css` colocated directly next to
  `Component.tsx` in `src/ui/` — not a subdirectory per component. This
  was ambiguous in the original text of this ADR ("colocated... in
  `src/ui/`" reads either way) and had already diverged in practice
  (`issue-13-config-form`'s `SystemConfigForm` used a
  `src/ui/SystemConfigForm/{...}` subdirectory). Flat is simpler and is
  what the rest of `src/ui/` already does (`AppShell.tsx` +
  `AppShell.module.css`, `Sidebar.tsx` + `Sidebar.module.css`, etc.) — a
  component with enough helper modules to want its own directory is the
  exception, not the default, and can opt out explicitly when it
  actually needs to.
- Shared design tokens (colors, spacing) are exposed as CSS custom
  properties on **`:root`, in `src/ui/tokens.css`** (a plain global
  stylesheet, imported once from `src/main.tsx` — not a CSS Module) —
  `--shell-bg`, `--shell-text`, `--shell-accent`, etc., redefined under
  `@media (prefers-color-scheme: dark)`. Component `*.module.css` files
  read them via `var(--shell-*)` rather than hardcoding colors. These
  were originally defined on `AppShell.module.css`'s `.shell` class, but
  a CSS Module class is scoped to its own DOM subtree — custom properties
  defined there aren't visible to anything portaled outside it (map
  popups, dropdowns, modals), so they live on `:root` instead. Sibling
  issues building new top-level slots (location picker, system config
  form) should reuse these tokens rather than inventing new ones, to keep
  the app visually coherent.
- **The narrow/desktop breakpoint is 768px** (`max-width: 768px` in CSS;
  `SIDEBAR_BREAKPOINT_PX` / `SIDEBAR_BREAKPOINT_QUERY` in
  `src/ui/types.ts` for JS that needs to check it, e.g. via
  `matchMedia`). This was previously only implicit in `AppShell.module.css`
  and `Sidebar.module.css`'s media queries; siblings introducing their
  own responsive behavior should reuse this value rather than picking
  their own.
- Keep visual design "clean but not over-invested" per the M1 spec's
  functional-shell framing — this is not a design system, just enough
  structure that independently-built components don't clash.

## Consequences

- No new npm dependency; nothing to keep updated beyond Vite itself.
- Class names are automatically scoped per component, so sibling issues
  (location picker, system config form, Daily/Monthly/Heatmap/Forecast
  chart tabs) cannot accidentally collide with each other's class names
  even using generic names like `.container` or `.title`.
- Global/shared values (colors, breakpoints) still need explicit
  coordination — CSS Modules alone doesn't give you a design-token system.
  The `--shell-*` custom properties on `:root` in `src/ui/tokens.css` are
  the interim mechanism; if the token set grows unwieldy, a follow-up ADR
  can introduce a more structured tokens setup.
- If a future need arises for dynamic/runtime-computed styles beyond what
  CSS custom properties handle, that would be a reason to revisit this
  decision — not expected in the near term for M1's scope.
