# ui

React components (location picker, system config form, mode toggle, chart
tabs). Depends only on `simulation`'s output types — never reaches into
`solar-physics` or `data-sources` internals directly. See
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

## App shell (issue #11)

`AppShell.tsx` is the top-level layout (left sidebar + main chart area,
layout "A" from the M1 design doc). It composes:

- `Sidebar.tsx` — location/system-config placeholder slots, `ModeToggle`,
  `UpdateButton`. Collapses to a top accordion below 768px.
- `MainArea.tsx` — `TabNav` + a content panel that shows `EmptyState`,
  `LoadingSkeleton`, or the active tab's content, in that priority order.

Sibling issues (location picker, system config form, Daily/Monthly/
Heatmap/Forecast chart tabs) plug into `AppShell`'s slot props —
`locationSlot`, `systemConfigSlot`, `tabContent` — without needing to
modify these files. See each component's prop JSDoc for the exact
interface, or the app-shell PR description.

## Styling

Components use CSS Modules (`Component.module.css` colocated with
`Component.tsx`) per `docs/decisions/0060-ui-styling-approach.md`. Shared
color tokens live as CSS custom properties (`--shell-*`) on `AppShell`'s
root class — reuse them via `var(--shell-*)` rather than hardcoding
colors.
