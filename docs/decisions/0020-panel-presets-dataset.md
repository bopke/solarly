# 0020. Panel presets dataset shape

Status: accepted

## Context

Issue #5 asks for a static, dependency-free dataset of curated panel
presets to prefill the system-config form (`src/panel-presets/`): ~10-15
real, named panel models plus 2-3 generic "residential/commercial
default" entries. The form later needs tilt, azimuth, capacity, panel
count, and losses too, but those are per-installation and out of scope
for this dataset — this module only covers the panel-model-level specs
called out in the design doc: make/model, rated Wp, efficiency %, and
temperature coefficient.

Two things needed a concrete decision:

1. What fields belong on a preset entry, and how to represent the
   generic defaults alongside real manufacturer models in the same
   array/type (rather than as a separate type or a special-cased "none"
   option).
2. How to source and label the real-world numbers, given panel
   datasheets change over time and specific SKUs get revised.

## Decision

- Single `PanelPreset` interface covering both real and generic entries,
  with an explicit `isGeneric: boolean` flag rather than a separate type
  or union. This keeps the exported array simple (one flat, typed list)
  and lets the UI render all entries in a single dropdown, optionally
  grouping/labeling generic entries differently using the flag.
- Fields: `id` (stable key for `<select>` values), `make`, `model`,
  `ratedWattsPeak`, `efficiencyPercent`, `tempCoefficientPercentPerC`,
  `isGeneric`, and a free-text `notes` field for context (panel
  technology, typical use case) that's useful for a human picking a
  preset but not load-bearing for the physics pipeline.
- Generic entries use `make: 'Generic'` and are also flagged via
  `isGeneric: true` (tested to stay consistent) — three generic entries
  (residential, commercial, and a lower-efficiency "budget" default) to
  give a reasonable spread of fallback values rather than one
  one-size-fits-all default.
- Real entries are drawn from well-known, representative products from
  major manufacturers (LONGi, JinkoSolar, Canadian Solar, REC,
  SunPower/Maxeon, Q CELLS, Trina Solar, JA Solar, First Solar), citing
  the manufacturer datasheet family (not a specific dated PDF) in a code
  comment. These are realistic typical-range values for prefill
  purposes, not a live, continuously-updated catalog — datasheet
  revisions over time are expected and acceptable, since the form always
  leaves every field editable after a preset is chosen (per the design
  doc).
- No dependency on any other module (`src/panel-presets/index.ts` only
  imports from `vitest` in its test file); the dataset can be consumed
  standalone by the `ui` system-config form.

## Consequences

- Adding, removing, or re-numbering presets later is a small, isolated
  diff to one file, and the test suite already enforces plausible value
  ranges so a bad copy-paste from a datasheet is caught early.
- Because this is a point-in-time snapshot of published specs rather
  than a live-synced catalog, someone will eventually need to refresh
  the real-model numbers (new module generations supersede these); this
  is expected and low-cost, not a defect.
- The `isGeneric` flag + `make === 'Generic'` convention is enforced by
  a test rather than by the type system; if a future contributor adds a
  differently-branded generic entry, the test will need updating
  alongside it.
