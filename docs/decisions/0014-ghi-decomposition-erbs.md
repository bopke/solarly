# 0014. GHI decomposition model: Erbs correlation

Status: accepted

## Context

Issue #32 needed `decomposeGhi(ghiWm2, sunPosition) -> { directWm2, diffuseWm2 }`
in `solar-physics/`. Neither of M1's two real-world climate data sources
gives a direct/diffuse split directly:

- NASA POWER's climatology endpoint (issue #6) gives `dailyInsolationKWhM2`
  — a single daily GHI total.
- Open-Meteo's forecast (issue #7) gives `shortwave_radiation` — a single
  hourly-mean GHI value.

But `poaIrradiance()` (issue #4) needs separate horizontal direct + diffuse
components to transpose onto a tilted panel plane. Both #9 (TMY
orchestration) and #10 (Live orchestration) need this split, so it belongs
here in `solar-physics/` once, not duplicated in both orchestration paths
— the same duplication problem already avoided once for clear-sky logic
during #7's review.

A few things needed pinning down:

- **Model choice: Erbs vs alternatives.** The Erbs correlation (Erbs,
  Klein & Duffie, 1982, "Estimation of the diffuse radiation fraction for
  hourly, daily and monthly-average global radiation", Solar Energy
  28:293-302) is one of the most widely published and cited
  clearness-index-based GHI decomposition models — implemented as a
  reference/baseline model in pvlib-python (`irradiance.erbs`) and taught
  alongside Liu-Jordan/Reindl/Orgill-Hollands as one of the standard
  correlations in this space. Reindl and Orgill-Hollands are broadly
  similar piecewise clearness-index models with slightly different fitted
  coefficients/regimes; DISC/DIRINT are more complex (aimed at estimating
  DNI directly, with additional empirical corrections) and are more suited
  to sub-hourly/higher-fidelity pipelines than M1's daily/hourly-mean
  inputs need. Erbs was chosen as the simplest well-published option that
  directly matches the issue's own framing ("the Erbs correlation... or an
  equivalent well-established model") and composes cleanly with the
  `kt`/clearness-index inputs `solar-physics/` already computes elsewhere.
- **Clearness index and extraterrestrial irradiance.** `kt = GHI /
extraterrestrialHorizontal`, where `extraterrestrialHorizontal = I0 *
cos(zenith)` and `I0` is the solar constant. `SOLAR_CONSTANT_W_M2 = 1361`
  is reused verbatim (as a local duplicate constant, since
  `clearSkyIrradiance.ts` doesn't export its own) for consistency across
  the module — the same fixed value already used by `clearSkyIrradiance`
  for its own GHI estimate, so two functions computing "what GHI _should_
  be given sun position" don't disagree about the reference used to
  normalize it.
- **Eccentricity correction: omitted, matching `clearSkyIrradiance`'s
  documented gap.** A more accurate `I0` scales the solar constant by the
  ~±3.3% annual Earth-Sun distance eccentricity variation (typically via a
  day-of-year-based correction factor, e.g. Spencer's Fourier series or
  the simpler `1 + 0.033*cos(2*pi*dayOfYear/365)` approximation commonly
  paired with Erbs in textbooks). `decomposeGhi` takes no date/timestamp
  input — only `ghiWm2` and `sunPosition` (altitude/azimuth) — so, exactly
  like `clearSkyIrradiance` (ADR 0011), there is no day-of-year to derive
  that correction from. This is a deliberate, explicitly-named
  simplification consistent with the existing gap in this module, not an
  oversight: adding it later would require either adding a date parameter
  to this function's signature or accepting `extraterrestrialHorizontal`
  as an optional pre-computed override, either of which is a
  straightforward additive change.
- **Zenith / refraction convention.** `cos(zenith) = sin(sunAltitude in
radians)`, computed the same way `clearSkyIrradiance` computes it, from
  `sunPosition().altitude`'s apparent (refraction-corrected) convention.
  This matches the refraction-coupling contract already documented in
  `clearSkyIrradiance.ts`'s module doc, which this function's own doc
  comment cross-references rather than re-deriving.
- **Direct component convention: horizontal beam, not DNI.** `poaIrradiance()`'s
  `horizontalIrradiance.direct` parameter is documented (and used) as
  _horizontal_ direct irradiance — "direct horizontal irradiance already
  equals DNI * cos(zenith)", per its own doc comment and the AOI
  projection logic in `poaIrradiance.ts`. `clearSkyIrradiance()`'s
  `direct` output uses the same convention. So `decomposeGhi` returns
  `directWm2 = ghiWm2 - diffuseWm2` (horizontal beam), _not_ DNI (which
  would additionally require dividing by `cos(zenith)`), for a drop-in
  match with `poaIrradiance()`'s expected input and consistency with
  `clearSkyIrradiance`'s output shape. This was checked carefully against
  both `poaIrradiance.ts`'s source and its tests before settling the
  convention, since a DNI/horizontal-beam mismatch here would silently
  propagate into wrong POA irradiance with no type error to catch it.
- **Edge cases and out-of-range clearness index.** Sun at or below the
  horizon, non-finite altitude, non-finite GHI, or non-positive GHI all
  return `{ directWm2: 0, diffuseWm2: 0 }` directly — matching the
  input-validation convention already established in `clearSkyIrradiance`
  and `poaIrradiance` (explicit guards rather than relying on comparisons
  that silently pass `NaN` through, and avoiding a division by a
  zero/negative `cos(zenith)` when computing `kt`). Real-world GHI
  measurements can occasionally push `kt` slightly outside the model's
  ideal `[0, ~1]` range (e.g. brief cloud-edge irradiance enhancement
  exceeding the clear-sky/extraterrestrial estimate) — Erbs's `kt > 0.8`
  branch already returns a flat constant regardless of how large `kt`
  gets, so the formula itself doesn't blow up, but the diffuse fraction is
  still explicitly clamped to `[0, 1]` and the resulting `directWm2`/
  `diffuseWm2` clamped to non-negative (and `diffuseWm2` capped at
  `ghiWm2`) as an explicit safety net rather than relying on the
  piecewise formula's own well-behavedness.

## Decision

- Implemented the Erbs (1982) piecewise diffuse-fraction correlation in
  `src/solar-physics/decomposeGhi.ts`:
  `kt <= 0.22`: `kd = 1 - 0.09*kt`;
  `0.22 < kt <= 0.80`: `kd = 0.9511 - 0.1604*kt + 4.388*kt^2 - 16.638*kt^3 + 12.336*kt^4`;
  `kt > 0.80`: `kd = 0.165`. No external PV-modeling dependency —
  transcribed directly from the published coefficients / cross-checked
  against pvlib-python's `irradiance.erbs` reference implementation.
- `kt = ghiWm2 / (1361 * cos(zenith))`, no Earth-Sun distance eccentricity
  correction (see above) — a known, documented simplification matching
  `clearSkyIrradiance`'s existing gap (ADR 0011), not an independent one.
- `directWm2 = ghiWm2 - diffuseWm2` — the horizontal beam convention,
  matching `poaIrradiance()`'s `horizontalIrradiance.direct` and
  `clearSkyIrradiance()`'s `direct` output exactly, so this function's
  output composes directly with both with no conversion needed.
- Sun below/at the horizon, non-finite altitude, non-finite GHI, or
  non-positive GHI all return `{ directWm2: 0, diffuseWm2: 0 }`.
- Diffuse fraction clamped to `[0, 1]`; `diffuseWm2` further clamped to
  `[0, ghiWm2]`; `directWm2` clamped to `>= 0` — so out-of-ideal-range
  `kt` values from real measurement noise can't produce a negative or
  GHI-exceeding component.
- Reference test values in `decomposeGhi.test.ts` were generated by an
  independent Python transcription of the same equations (not by calling
  the TypeScript function under test), committed at
  `src/solar-physics/__verification__/decomposeGhi_reference.py` with an
  optional `--pvlib` cross-check mode — matching the cross-check rigor
  used for `clearSkyIrradiance` (0011) and `sunPosition` (0010).

## Consequences

- `solar-physics/`'s pipeline now has a fifth pure function:
  `sunPosition()` -> `decomposeGhi()` (an alternative "given GHI" entry
  point alongside `clearSkyIrradiance()`'s "estimate GHI from scratch"
  path) -> `poaIrradiance()` -> `panelPowerOutput()`. #9 (TMY) and #10
  (Live) can both call `decomposeGhi(ghi, sunPosition(...))` and feed the
  result straight into `poaIrradiance()` without writing their own
  decomposition logic or reasoning about the DNI-vs-horizontal-beam
  convention themselves.
- The no-eccentricity-correction gap is now duplicated (by design, for
  consistency) across two functions instead of one. If/when a
  day-of-year-based eccentricity correction is added to fix
  `clearSkyIrradiance`'s ADR-0011-documented gap, `decomposeGhi` should be
  revisited in the same pass so the two functions' `kt`/`extraterrestrial`
  math stays in agreement — leaving one corrected and one not would make
  their outputs subtly inconsistent with each other.
- Like `clearSkyIrradiance`, the fixed solar constant means `decomposeGhi`'s
  `kt` (and therefore its diffuse-fraction estimate) is systematically off
  by up to ~±3.3% depending on time of year — smaller than the inherent
  scatter/uncertainty of the Erbs correlation itself (published RMS errors
  for hourly diffuse fraction are commonly cited in the 10-20% range even
  against ground-truth pyranometer data), so this is not expected to be
  the dominant source of error for #9/#10's downstream estimates, but is
  named explicitly per the same "no eccentricity correction" ranking
  logic used in ADR 0011's Consequences section.
- `decomposeGhi`'s `SunPositionInput` type is structurally identical to
  `poaIrradiance`'s (and `clearSkyIrradiance`/`sunPosition`'s
  altitude/azimuth shape), so `sunPosition()`'s return value can be passed
  to any of these functions interchangeably without an adapter.
