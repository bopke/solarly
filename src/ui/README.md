# ui

React components (location picker, system config form, mode toggle, chart
tabs). Depends only on `simulation`'s output types — never reaches into
`solar-physics` or `data-sources` internals directly. See
`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`.

## App shell (issue #11)

`AppShell.tsx` is the top-level layout (left sidebar + main chart area,
layout "A" from the M1 design doc). It composes:

- `Sidebar.tsx` — location/system-config placeholder slots, `ModeToggle`,
  `UpdateButton`. Collapses to a top accordion below 768px
  (`SIDEBAR_BREAKPOINT_PX` in `types.ts`), and gates that collapsed state
  on actually being at a narrow viewport so widening the browser back
  past the breakpoint always leaves the sidebar reachable again.
- `MainArea.tsx` — `TabNav` + a content panel that shows `EmptyState`,
  `ErrorState`, `LoadingSkeleton`, or the active tab's content, in that
  priority order (empty → error → loading → content).

Sibling issues (location picker, system config form, Daily/Monthly/
Heatmap/Forecast chart tabs) plug into `AppShell`'s slot props —
`locationSlot`, `systemConfigSlot`, `tabContent`, `error` — without
needing to modify these files. `AppShell` is uncontrolled by default
(it owns `mode`/`activeTab` state, seeded from `defaultMode`), but a
parent can take over either via the optional `mode`/`onModeChange` and
`activeTab`/`onTabChange` prop pairs; `onUpdate` always receives the
current `{ mode, activeTab }` regardless. See each component's prop
JSDoc for the exact interface, or the app-shell PR description.

## Styling

Components use CSS Modules (`Component.module.css` colocated flat, next
to `Component.tsx`, not in a subdirectory) per
`docs/decisions/0060-ui-styling-approach.md`. Shared color tokens live as
CSS custom properties (`--shell-*`) on `:root`, in `src/ui/tokens.css`
(imported once from `src/main.tsx`) — reuse them via `var(--shell-*)`
rather than hardcoding colors. They're on `:root` rather than a
component's own class specifically so they're available to anything
rendered outside `AppShell`'s DOM subtree too (portaled map popups,
dropdowns, modals).
