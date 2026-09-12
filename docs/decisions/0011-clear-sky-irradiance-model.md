# 0011. Clear-sky irradiance model: sea-level-simplified Ineichen/Perez, fixed Linke turbidity

Status: accepted

## Context

Issue #3 needed `clearSkyIrradiance(sunAltitude, turbidity?) -> { direct, diffuse }`
in `solar-physics/`, estimating cloudless-sky direct and diffuse irradiance
(W/m²) on a horizontal surface from sun altitude alone, per the M1 design
spec's "simplified Ineichen/Haurwitz-style model with a fixed Linke
turbidity climatology constant." A few things needed pinning down:

- **Ineichen vs Haurwitz vs a blend.** Haurwitz (1945) is a very simple
  empirical fit (`GHI = 1098 * cos(z) * exp(-0.059/cos(z))`) that needs no
  turbidity input at all — but that's also its weakness here: the issue
  and function signature explicitly want a `turbidity` parameter, and
  Haurwitz has nowhere to put one, so it can't express "clean, dry site"
  vs "hazy, humid site" the way a real climatology-driven model should,
  even in simplified/fixed-constant form. It also only produces a single
  GHI number, not separate direct/diffuse components, so an extra ad hoc
  split would have to be bolted on. The Ineichen & Perez (2002) model
  ("A new airmass independent formulation for the Linke turbidity
  coefficient", Solar Energy 73:151-157) takes Linke turbidity as a
  first-class input and natively produces both DNI (beam) and GHI, from
  which DHI/direct-horizontal fall out directly — a better structural fit
  for this function's signature and for downstream POA transposition
  (issue #4), which needs the direct/diffuse split.
- **Full Ineichen (with altitude correction) vs a sea-level simplification.**
  The full model corrects for site altitude/atmospheric pressure via
  `fh1 = exp(-altitude/8000)`, `fh2 = exp(-altitude/1250)`, and
  altitude-dependent `cg1`/`cg2`. `clearSkyIrradiance` only takes sun
  altitude (an angle), not site elevation — the M1 location model doesn't
  currently track elevation at all — so there's no altitude input to feed
  that correction with. Sea level (`altitude = 0`) collapses `fh1 = fh2 = 1`
  and fixes `cg1 = 0.868`, `cg2 = 0.0387`, which is what's implemented.
- **The Perez "enhancement" term.** The 2002 paper's GHI formula has an
  optional `exp(0.01 * AM^1.8)` multiplier. pvlib-python's reference
  `clearsky.ineichen` implementation (cross-checked against
  github.com/pvlib/pvlib-python) defaults this to `off`, documenting that
  it "may produce spurious results when the Sun is near the horizon and
  the airmass is high." Since accurate sunrise/sunset-hour behavior
  matters for a generation estimator, the enhancement term is omitted here
  too.
- **Air mass formula.** Kasten & Young (1989), "Revised optical air mass
  tables and approximation formula", Applied Optics 28(22):4735-4738:
  `AM = 1 / (cos(Z) + 0.50572 * (96.07995 - Z)^-1.6364)`, `Z` = zenith
  angle in degrees. This is the airmass formula pvlib's Ineichen
  implementation is normally paired with, and it stays well-behaved
  (finite, ~38) right out to the horizon.
- **Fixed Linke turbidity value.** `clearSkyIrradiance` has no location or
  date input (only sun altitude), so turbidity can only be a constant
  default, overridable by the caller. The SoDa/ESRA Linke turbidity
  climatology (Remund, Wald, Lefèvre, Ranchin, Page, 2003) reports typical
  annual-average values roughly in the 2-3 range for clean, dry/high-
  altitude sites, up to 5-7 for humid or polluted sites, with values
  around 3-4 common for clean-to-moderate continental mid-latitude
  locations. `DEFAULT_LINKE_TURBIDITY = 3.5` was chosen as a reasonable
  single global default sitting in the middle of that "clean continental"
  band, rather than skewed toward either the very-clean or very-hazy end —
  it is a rough placeholder, not a per-location lookup.
- **Solar constant.** Fixed at 1361 W/m², a commonly cited modern
  satellite-era (Kopp & Lean) mean total solar irradiance value. The
  function has no date input, so the ~±3.3% annual eccentricity variation
  in Earth-Sun distance isn't modeled — consistent with the fixed-turbidity
  simplification below. Note this is a slightly different vintage than the
  ~1364-1367 W/m² solar constant the Ineichen regression coefficients
  (`cg1`, `cg2`, the beam coefficient, `bnci_2`) were originally fit
  against; pvlib's own reference implementation defaults `dni_extra` to
  1364 for the same model. The mismatch is under 0.5% and was a deliberate
  choice to use the more accurate modern TSI value here, but it is worth
  naming explicitly rather than only justifying 1361 on its own terms.

## Decision

- Implemented the sea-level-simplified Ineichen & Perez (2002) clear-sky
  model (no Perez enhancement term, no altitude/pressure correction) in
  `src/solar-physics/clearSkyIrradiance.ts`, using the Kasten & Young
  (1989) relative air mass formula. No external PV-modeling dependency —
  transcribed directly from the published equations / cross-checked
  against pvlib-python's `clearsky.ineichen` reference implementation.
- `turbidity` defaults to `DEFAULT_LINKE_TURBIDITY = 3.5` (exported for
  callers/tests), a fixed climatology constant rather than a per-location
  or per-season lookup.
- Sun altitude at or below 0° (sun below/at the horizon) returns
  `{ direct: 0, diffuse: 0 }` directly, without running the model's
  air-mass math through its near-singular low-altitude behavior.
- Reference test values in `clearSkyIrradiance.test.ts` were generated by
  an independent Python transcription of the same equations (not by
  calling the TypeScript function under test), matching the cross-check
  rigor used for `sunPosition` (see 0010).
- **Documented known limitation (fixed turbidity):** this model uses one
  fixed Linke turbidity constant for all locations, seasons, and weather
  conditions, rather than looking up real, time-varying turbidity data
  (e.g. from a climatology dataset keyed by lat/lon/month). Actual
  clear-sky irradiance varies with local aerosol load, humidity, and
  season in ways this constant cannot capture. Real-time/location-specific
  turbidity data is explicitly out of scope for M1 per the design spec
  (`docs/superpowers/specs/2026-09-12-solarly-m1-design.md`); the
  `turbidity` parameter exists so this can be improved later (e.g. a
  lat/lon/month climatology lookup in `data-sources/` or a static dataset)
  without changing `clearSkyIrradiance`'s signature.

## Consequences

Ranked roughly by expected error magnitude (largest/most predictable
first), since it's easy to over-index on whichever limitation is discussed
most, not the one that actually dominates:

1. **No eccentricity correction (dominant, systematic, most predictable).**
   `clearSkyIrradiance` has no date input, so it can't scale the solar
   constant by Earth-Sun distance, which varies with a ~±3.3% swing over
   the year (closest at perihelion in early January, farthest at aphelion
   in early July). Every irradiance value this function returns is off by
   up to that much in a fully predictable, calendar-driven way — this is
   larger than the fixed-turbidity error for many locations/seasons, and
   unlike the turbidity error, it's a pure function of date, not of
   location climatology, so it's arguably the more embarrassing gap to
   have unaddressed: it could be fixed with just a day-of-year input and a
   one-line formula, with no external data dependency, unlike turbidity.
   Left as a known limitation for now because `clearSkyIrradiance` was
   scoped in the M1 design spec to take sun altitude only; revisit if a
   date/day-of-year parameter is added.
2. **Fixed Linke turbidity.** Because turbidity is fixed, absolute
   irradiance magnitudes for any given real location will systematically
   differ from ground truth by however much that location's actual
   climatology differs from TL=3.5 (clearer sites will be modeled as
   hazier than reality and vice versa) — this imprecision propagates into
   the TMY/Live simulation pipeline (issue #9) and should be called out
   if/when M1's overall accuracy is evaluated against real generation
   data. Unlike the eccentricity gap above, this requires an external
   climatology dataset to fix properly, not just a formula change.
3. **No site-altitude correction.** High-elevation locations (e.g.
   mountain rooftop installs) will have their clear-sky irradiance
   modestly underestimated (thinner atmosphere at altitude means less
   attenuation than sea level assumes). Not expected to matter much for
   typical residential rooftop siting, but worth revisiting if the
   location model ever gains an elevation field.
4. **Solar-constant vintage mismatch (~0.5%, see above).** Smallest of the
   four; noted for completeness rather than because it's expected to
   matter in practice.

Upgrading turbidity from a fixed constant to a real climatology lookup
later only requires changing what value callers pass in for `turbidity` —
no change to this function's model/signature. `clearSkyIrradiance` stays a
pure, dependency-free function taking only `(sunAltitude, turbidity?)`,
consistent with `solar-physics`'s "no I/O" constraint, and composes
cleanly with `sunPosition().altitude` while remaining independently
testable/callable — see the refraction-coupling note in
`clearSkyIrradiance.ts`'s module doc for the one place that composition
has an implicit contract worth watching.
