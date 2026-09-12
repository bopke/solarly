# 0013. POA transposition and power output model

Status: accepted

## Context

Issue #4 completes the `solar-physics` pipeline: sun position (#2) ->
clear-sky irradiance (#3) -> plane-of-array (POA) transposition -> panel
power output. Two remaining pure functions were needed:

- `poaIrradiance()` — transposes horizontal direct + diffuse irradiance
  onto a tilted, oriented panel plane.
- `panelPowerOutput()` — converts POA irradiance into actual watts for a
  specific panel, given ambient temperature and system losses.

Several modeling choices were needed that the M1 design spec
(`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`) left at the
level of "a standard isotropic sky-diffuse model" and "a temperature
coefficient x ambient temperature" — this ADR records the specific
choices made and why.

## Decision

### Sky-diffuse model: isotropic (Liu-Jordan)

Used the isotropic sky-diffuse model (Liu & Jordan, 1963): diffuse sky
irradiance is treated as uniformly bright across the sky dome, and the
tilted plane sees a fraction `(1 + cos(tilt)) / 2` of it (the plane's
"sky-view factor"). This is the simplest and most widely taught
transposition model, and is what the M1 design spec explicitly calls
for ("a standard isotropic sky-diffuse model").

More accurate anisotropic models (Hay-Davies, Reindl, or Perez, which
weight circumsolar and horizon brightening separately from isotropic sky
diffuse) are out of scope for M1. They require additional inputs
(clearness index, brightness index) and add meaningful complexity for a
correction that matters most in edge cases (very low diffuse fraction,
low sun angles) — not worth it for M1's first cut. Revisit if user
testing shows POA estimates are systematically off at specific tilt/sun
combinations; Perez is the natural upgrade path (pvlib implements it as
`pvlib.irradiance.perez`).

### Direct (beam) component: angle-of-incidence projection

The direct component is projected via the angle of incidence (AOI)
between the sun ray and the panel's surface normal:

```
cos(AOI) = cos(zenith) * cos(tilt) + sin(zenith) * sin(tilt) * cos(sunAzimuth - panelAzimuth)
```

Since `clearSkyIrradiance()`'s `direct` output is already the horizontal
projection of DNI (`DNI * cos(zenith)`, not DNI itself — see that
module's doc comment), the direct POA component is computed as
`directHorizontal * cos(AOI) / cos(zenith)` rather than first dividing out
to DNI and re-multiplying; this is algebraically identical but avoids
an extra explicit DNI variable. `cos(AOI)` is clamped to `>= 0`: a
negative value means the sun is behind the panel plane (physically no
direct illumination), which a raw `cos(AOI)` would otherwise represent as
negative irradiance.

### Ground-reflected component: included, with a fixed default albedo of 0.2

Ground-reflected irradiance was included as a third component, using the
standard complementary ground-view-factor formula:

```
groundReflected = (directHorizontal + diffuseHorizontal) * albedo * (1 - cos(tilt)) / 2
```

This matters for panels at non-trivial tilt (the ground-view factor is 0
at tilt=0 and grows with tilt, reaching 0.5 at tilt=90), which is the
common case for M1 (manual tilt input, typically 10-40 degrees for
residential). Omitting it would systematically underestimate POA
irradiance for every tilted panel.

`albedo` defaults to 0.2 — a standard generic-ground-surface value (grass,
bare soil, mixed suburban terrain) used as the fallback default across PV
modeling tools (e.g. pvlib's `get_total_irradiance` defaults to
`albedo=0.25`; NREL's PVWatts uses 0.2) when the actual surface material
is unknown, which is the case here since M1 has no ground-material input.
The parameter is exposed (not hardcoded) so a caller can override it later
if/when a ground-material input is added, without changing the function's
signature.

### Power output: rated-power linear scaling, not area x efficiency

`panelPowerOutput()` scales `panelSpec.ratedWattsPeak` linearly with the
POA-to-STC irradiance ratio (`poaIrradianceWm2 / 1000`), rather than
computing `efficiencyPercent/100 * areaM2 * poaIrradianceWm2`. Both
approaches are physically motivated, but `ratedWattsPeak` is the
manufacturer's actual STC-measured output — it already captures real
module losses (cell mismatch, busbar shading, encapsulant transmission
loss, etc.) that a naive area x efficiency computation would miss, and
it's the number that's actually printed on every panel's datasheet and
what `panel-presets/` (issue #5) curates. `efficiencyPercent` and
`areaM2` are kept in the local `PanelSpec` type for shape-compatibility
with `panel-presets/`'s `PanelPreset` (and so callers/UI can display them)
but aren't used in the power calculation itself; `areaM2` is optional in
`PanelSpec` accordingly.

### Cell temperature: NOCT linear approximation, default NOCT = 45C

Cell temperature is estimated from ambient air temperature and POA
irradiance using the standard NOCT (Nominal Operating Cell Temperature)
linear approximation (Duffie & Beckman, _Solar Engineering of Thermal
Processes_):

```
cellTemp = ambientTemp + (NOCT - 20) / 800 * poaIrradiance
```

NOCT is a manufacturer-published rating measured under standardized
conditions (800 W/m² POA, 20°C ambient, 1 m/s wind, open-rack mounting).
Since M1's `panelSpec` (and `panel-presets/`'s `PanelPreset`) doesn't
carry a per-panel NOCT value, a fixed default of 45°C is used — a typical
value for crystalline-silicon modules (values across real datasheets
commonly range ~42-46°C). The default is exported as `DEFAULT_NOCT_C` and
the parameter is overridable, matching the pattern used for
`DEFAULT_LINKE_TURBIDITY` in `clearSkyIrradiance`.

Known limitation: this approximation ignores wind speed and mounting
configuration (roof-mounted panels run hotter than open-rack, for which
NOCT is defined), and modern datasheets increasingly quote NMOT
(Nominal Module Operating Temperature, tested with more realistic
mounting) instead of/alongside NOCT — not modeled here. A more accurate
mounting-aware cell-temperature model (e.g. Faiman or Sandia) is a
plausible future improvement but out of scope for M1.

### Temperature derating and system losses application order

Applied as: `basePower * tempDerateFactor * (1 - systemLossesPercent/100)`,
where `tempDerateFactor = 1 + (tempCoefficientPercentPerC/100) * (cellTemp - 25)`.
System losses are applied as a single aggregate multiplicative factor
last, per the M1 design spec's `systemConfig` shape (one
"manual shading factor" style losses % input, not a breakdown by loss
category) — matches how PVWatts and similar tools apply an aggregate
"system losses" percentage.

### Non-negative clamping

Both functions clamp their result to `>= 0` and treat non-finite/sun-below-
horizon inputs as zero, matching the input-validation convention already
established in `clearSkyIrradiance` (explicit `NaN`/non-positive guards
rather than relying on comparisons that silently pass `NaN` through).

## Consequences

- The `solar-physics` module's pipeline is now complete: `sunPosition()`
  -> `clearSkyIrradiance()` -> `poaIrradiance()` -> `panelPowerOutput()`,
  each independently pure and unit-tested, ready for `simulation/`
  (issues #9/#10) to wire together over a time series.
- `panelPowerOutput`'s `PanelSpec` type is a structural (not nominal)
  subset match for `panel-presets/`'s `PanelPreset` — any object with the
  four required fields (`ratedWattsPeak`, `efficiencyPercent`,
  `tempCoefficientPercentPerC`, optionally `areaM2`) satisfies it, so
  `simulation/` can pass a `PanelPreset` (or a user-edited copy of one)
  directly without an adapter, while `solar-physics/` stays free of a
  hard dependency on `panel-presets/`.
- If a future milestone adds per-location ground-material or per-panel
  NOCT data, `albedo` and `noctC` are already parameters (not hardcoded
  constants baked into the formulas), so no signature change is needed —
  only the caller's default needs updating.
- Switching to an anisotropic (Perez) sky-diffuse model later would only
  change `poaIrradiance`'s internals and require additional inputs
  (clearness/brightness indices, derivable from existing
  `clearSkyIrradiance` + `sunPosition` outputs); it wouldn't change the
  function's public signature in a breaking way if the extra inputs are
  added as optional parameters.
