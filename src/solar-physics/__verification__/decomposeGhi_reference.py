#!/usr/bin/env python3
"""
Independent cross-check for `src/solar-physics/decomposeGhi.ts`.

This is NOT part of the build or test suite (nothing in package.json runs
it, and it is not imported by any TS code). It exists purely for
auditability: it is a from-scratch Python transcription of the published
Erbs (1982) GHI-decomposition correlation, written independently of the
TypeScript implementation, plus an optional second check against the
upstream `pvlib.irradiance.erbs` reference implementation over the same
inputs. The hand-transcription output is compared against the fixture
values committed in `decomposeGhi.test.ts`; the pvlib cross-check is NOT
expected to match exactly, since pvlib's `erbs()` always derives its own
`dni_extra` (a different solar constant plus an eccentricity correction
this model deliberately omits — see ADR 0014), which alone accounts for
roughly -3.6% to +3.0% of kt divergence. What it does verify is that the
Erbs polynomial coefficients and branch boundaries themselves agree with
upstream, independent of that expected dni_extra difference.

Reference:
  - Erbs, D.G., Klein, S.A., Duffie, J.A., "Estimation of the diffuse
    radiation fraction for hourly, daily and monthly-average global
    radiation", Solar Energy, vol 28, pp. 293-302, 1982.
  - pvlib-python, `pvlib.irradiance.erbs` (github.com/pvlib/pvlib-python).

Usage:
  python3 decomposeGhi_reference.py            # hand transcription only
  python3 decomposeGhi_reference.py --pvlib     # also cross-check against
                                                 # installed pvlib, if
                                                 # available (pip install pvlib)
                                                 # Last verified against
                                                 # pvlib==0.13.0.
"""

from __future__ import annotations

import math
import sys

SOLAR_CONSTANT_W_M2 = 1361


def erbs_diffuse_fraction(kt: float) -> float:
    if kt <= 0.22:
        return 1 - 0.09 * kt
    if kt <= 0.8:
        return (
            0.9511
            - 0.1604 * kt
            + 4.388 * kt**2
            - 16.638 * kt**3
            + 12.336 * kt**4
        )
    return 0.165


def decompose_ghi(ghi_wm2: float, sun_altitude_deg: float) -> tuple[float, float]:
    if ghi_wm2 <= 0 or sun_altitude_deg <= 0:
        return 0.0, 0.0

    cos_zenith = math.sin(math.radians(sun_altitude_deg))
    extraterrestrial_horizontal = SOLAR_CONSTANT_W_M2 * cos_zenith
    kt = ghi_wm2 / extraterrestrial_horizontal

    kd = erbs_diffuse_fraction(kt)
    kd = min(max(kd, 0.0), 1.0)

    diffuse = min(max(kd * ghi_wm2, 0.0), ghi_wm2)
    direct = max(ghi_wm2 - diffuse, 0.0)
    return direct, diffuse


CASES = [
    # (ghi_wm2, sun_altitude_deg)
    (50, 10),    # heavily overcast, low sun -> kt very small
    (100, 30),   # overcast midday
    (400, 30),   # partly cloudy
    (600, 45),   # partly cloudy, higher sun
    (900, 60),   # clear sky
    (950, 90),   # clear sky, zenith
    (300, 10),   # low sun, relatively high GHI for the altitude (high kt)
]


def main() -> None:
    print(f"{'ghi':>6} {'alt':>5} {'kt':>8} {'direct':>10} {'diffuse':>10}")
    for ghi, alt in CASES:
        direct, diffuse = decompose_ghi(ghi, alt)
        cos_z = math.sin(math.radians(alt))
        kt = ghi / (SOLAR_CONSTANT_W_M2 * cos_z)
        print(f"{ghi:6.1f} {alt:5.1f} {kt:8.4f} {direct:10.4f} {diffuse:10.4f}")

    if "--pvlib" in sys.argv:
        try:
            import pvlib
            from pvlib import irradiance
        except ImportError:
            print("pvlib not installed; skipping cross-check", file=sys.stderr)
            return

        # Last run against pvlib 0.13.0. Reproduce with:
        #   pip install pvlib==0.13.0
        #   python3 decomposeGhi_reference.py --pvlib
        print(f"\npvlib cross-check (irradiance.erbs, pvlib=={pvlib.__version__}):")
        print(
            f"{'ghi':>6} {'alt':>5} {'kt':>8} {'our_direct':>11} "
            f"{'pvlib_beam_h':>13} {'our_diffuse':>12} {'pvlib_dhi':>10}"
        )
        for ghi, alt in CASES:
            zenith = 90 - alt
            cos_z = math.sin(math.radians(alt))
            our_kt = ghi / (SOLAR_CONSTANT_W_M2 * cos_z)
            our_direct, our_diffuse = decompose_ghi(ghi, alt)

            # pvlib's erbs(ghi, zenith, datetime_or_doy, ...) accepts plain
            # scalars for a single-point call (no need for pd.Series/
            # DatetimeIndex, which must all share one length — a length-1
            # Series paired with a length-1 DatetimeIndex still throws the
            # "Length of values (2) does not match length of index (1)"
            # ValueError pvlib raises internally when building its output
            # DataFrame from scalar-wrapped-as-length-1 inputs).
            #
            # NOTE on dni_extra: pvlib's erbs() has no dni_extra parameter —
            # it always derives its own via get_extra_radiation(doy), which
            # (a) uses pvlib's own solar constant (1366.1 W/m2, vs. this
            # model's fixed 1361) and (b) applies an Earth-Sun distance
            # eccentricity correction this model deliberately omits (see
            # ADR 0014). So this is NOT a forced apples-to-apples
            # comparison: pvlib_kt is expected to differ from our_kt by
            # roughly -3.6% to +3.0% (see ADR 0014's Consequences section)
            # purely from that dni_extra difference, independent of whether
            # the Erbs polynomial itself agrees. doy is arbitrary (chosen
            # mid-year so the eccentricity correction is close to its
            # annual mean) since there is no real observation date here.
            doy = 172
            result = irradiance.erbs(
                ghi,
                zenith,
                doy,
                min_cos_zenith=0.065,
                max_zenith=87,
            )
            pvlib_kt = result["kt"]
            # pvlib's erbs returns dni (not horizontal beam), so multiply
            # by cos(zenith) before comparing against our directWm2, which
            # is horizontal beam (ghi - dhi) — see decomposeGhi.ts's module
            # doc for the horizontal-beam-vs-DNI convention note.
            pvlib_beam_horizontal = result["dni"] * cos_z
            pvlib_dhi = result["dhi"]
            print(
                f"{ghi:6.1f} {alt:5.1f} {our_kt:8.4f} {our_direct:11.4f} "
                f"{pvlib_beam_horizontal:13.4f} {our_diffuse:12.4f} {pvlib_dhi:10.4f}"
            )
            print(f"  (pvlib kt={pvlib_kt:.4f} vs ours={our_kt:.4f})")


if __name__ == "__main__":
    main()
