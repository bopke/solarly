# 0090. Scene tracing: shape-tagging UX

Status: accepted

## Context

Issue #56 (`src/scene/tracing/`) has the user trace one or more polygons
over satellite imagery, each tagged as either `'roof-face'` or
`'ground-array'`. The M2 design spec and the issue both left the exact UX
for this tagging to implementer judgment ("a small control shown when a
polygon is completed, or a toggle before drawing starts... your call on
the cleanest UX").

Two options were considered:

1. **Toggle before drawing**: a "next shape" kind selector shown above the
   map at all times; whatever polygon the user completes next gets tagged
   with whatever the toggle currently says.
2. **Prompt after completing a polygon**: as soon as a polygon is
   finished, show an inline chooser (e.g. a small popup) asking the user
   to pick its kind before it's accepted.

## Decision

Use the toggle (option 1), **plus** let any already-traced shape's kind be
changed after the fact via a dropdown in the shape list below the map.

The toggle alone covers the realistic common case well: someone tracing a
plot typically draws several roof faces in a row, then switches to ground
arrays (or vice versa) — one click covers a whole batch, not one click per
shape. A post-completion prompt would interrupt the drawing flow after
every single polygon even when the user is tracing five roof faces back to
back.

The toggle alone has an obvious failure mode, though: forgetting to flip
it before drawing the next shape, or changing your mind about an
already-traced shape. Rather than requiring a redraw to fix that, every
traced shape in the list keeps its own kind dropdown, editable at any
time — cheap to add since the kind lives in each polygon's own feature
properties already (see `SceneTracing.tsx`'s `featureKind`/
`handleChangeKind`).

## Consequences

- No extra click is needed for the common "trace several of the same
  kind in a row" case.
- Mis-tagged or reconsidered shapes are fixed via the list panel, not by
  deleting and redrawing.
- The toggle's current value is UI state, not attached to any specific
  shape — if this is ever surprising in practice (e.g. users not noticing
  it needs to be set before drawing the very first shape, which defaults
  to `'roof-face'`), the per-shape dropdown is the mitigation already in
  place, not a new feature to build.
