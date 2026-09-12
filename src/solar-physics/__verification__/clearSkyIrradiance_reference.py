#!/usr/bin/env python3
"""
Independent cross-check for `src/solar-physics/clearSkyIrradiance.ts`.

This is NOT part of the build or test suite (nothing in package.json runs
it, and it is not imported by any TS code). It exists purely for
auditability: it is a from-scratch Python transcription of the published
sea-level-simplified Ineichen & Perez (2002) clear-sky equations, written
independently of the TypeScript implementation, plus a second check that
runs the real upstream `pvlib` reference implementation over the same
inputs. Both are compared against the fixture values committed in
`clearSkyIrradiance.test.ts`.

The point is that the TS implementation, the fixtures, this hand
transcription, and pvlib's own C-derived-from-Fortran-lineage reference
code are four independent sources; if they all agree, a transcription bug
shared between the TS source and its own test fixtures becomes very
unlikely.

References:
  - Ineichen, P. and Perez, R., "A new airmass independent formulation for
    the Linke turbidity coefficient", Solar Energy, vol 73, pp. 151-157,
    2002.
  - Kasten, F. and Young, A.T., "Revised optical air mass tables and
    approximation formula", Applied Optics 28(22), pp. 4735-4738, 1989.
  - pvlib-python, `pvlib.clearsky.ineichen` (github.com/pvlib/pvlib-python).

Usage:
  python3 clearSkyIrradiance_reference.py            # hand transcription only
  python3 clearSkyIrradiance_reference.py --pvlib     # also cross-check
                                                       # against installed
                                                       # pvlib, if available
                                                       # (pip install pvlib)
"""

from __future__ import annotations

import math
import sys

SOLAR_CONSTANT_W_M2 = 1361.0


def relative_air_mass(zenith_deg: float) -> float:
    """Kasten & Young (1989) relative optical air mass from zenith angle,
    in degrees."""
    z = zenith_deg
    return 1.0 / (
        math.cos(math.radians(z)) + 0.50572 * (96.07995 - z) ** -1.6364
    )


def clear_sky_irradiance(
    sun_altitude_deg: float, turbidity: float = 3.5
) -> tuple[float, float]:
    """Hand transcription of the sea-level-simplified Ineichen & Perez
    (2002) model (altitude = 0 m, so fh1 = fh2 = 1, cg1 = 0.868,
    cg2 = 0.0387), written independently of clearSkyIrradiance.ts.

    Returns (direct, diffuse) horizontal irradiance in W/m^2.
    """
    if sun_altitude_deg <= 0:
        return 0.0, 0.0

    zenith_deg = 90.0 - sun_altitude_deg
    cos_zenith = math.sin(math.radians(sun_altitude_deg))
    am = relative_air_mass(zenith_deg)

    fh1 = 1.0
    fh2 = 1.0
    cg1 = 0.868
    cg2 = 0.0387

    ghi_attenuation = math.exp(-cg2 * am * (fh1 + fh2 * (turbidity - 1)))
    ghi = cg1 * SOLAR_CONSTANT_W_M2 * cos_zenith * max(ghi_attenuation, 0.0)

    beam_coefficient = 0.664 + 0.163 / fh1
    beam_normal_clear_sky = SOLAR_CONSTANT_W_M2 * max(
        beam_coefficient * math.exp(-0.09 * am * (turbidity - 1)), 0.0
    )

    bnci_2 = min(
        max(
            (
                1
                - (0.1 - 0.2 * math.exp(-turbidity))
                / (0.1 + 0.882 / fh1)
            )
            / cos_zenith,
            0.0,
        ),
        1e20,
    )
    beam_normal_from_ghi = ghi * bnci_2

    dni = max(min(beam_normal_clear_sky, beam_normal_from_ghi), 0.0)

    direct = dni * cos_zenith
    diffuse = max(ghi - direct, 0.0)
    return direct, diffuse


# (sun_altitude_deg, turbidity, expected_direct, expected_diffuse) — must
# match the fixtures in clearSkyIrradiance.test.ts.
TEST_CASES = [
    (2, 3.5, 0.4957, 2.4693),
    (10, 3.5, 55.6144, 40.6462),
    (30, 3.5, 359.3013, 91.5499),
    (60, 3.5, 751.8487, 123.1848),
    (90, 3.5, 898.8258, 132.9126),
    (30, 2.0, 468.5925, 37.5944),
    (30, 6.0, 229.3950, 142.3430),
    (45, 3.5, 579.1821, 110.6870),
]


def run_hand_transcription() -> bool:
    print("Hand transcription vs. committed test fixtures:")
    ok = True
    for alt, tl, exp_direct, exp_diffuse in TEST_CASES:
        direct, diffuse = clear_sky_irradiance(alt, tl)
        d_ok = abs(direct - exp_direct) < 0.005
        f_ok = abs(diffuse - exp_diffuse) < 0.005
        ok = ok and d_ok and f_ok
        status = "OK" if d_ok and f_ok else "MISMATCH"
        print(
            f"  alt={alt:>4} TL={tl:>4} -> direct={direct:10.4f} "
            f"(expected {exp_direct:10.4f}) diffuse={diffuse:10.4f} "
            f"(expected {exp_diffuse:10.4f})  [{status}]"
        )
    return ok


def run_pvlib_cross_check() -> bool:
    try:
        import pandas as pd
        import pvlib
    except ImportError:
        print(
            "\npvlib not installed — skipping upstream cross-check "
            "(pip install pvlib pandas to run it)."
        )
        return True

    print("\npvlib.clearsky.ineichen vs. committed test fixtures:")
    ok = True
    for alt, tl, exp_direct, exp_diffuse in TEST_CASES:
        zenith = 90.0 - alt
        am = relative_air_mass(zenith)
        result = pvlib.clearsky.ineichen(
            apparent_zenith=pd.Series([zenith]),
            airmass_absolute=pd.Series([am]),
            linke_turbidity=tl,
            altitude=0,
            dni_extra=SOLAR_CONSTANT_W_M2,
            perez_enhancement=False,
        )
        cos_zenith = math.sin(math.radians(alt))
        ghi = float(result["ghi"].iloc[0])
        dni = float(result["dni"].iloc[0])
        direct = dni * cos_zenith
        diffuse = max(ghi - direct, 0.0)
        d_ok = abs(direct - exp_direct) < 0.005
        f_ok = abs(diffuse - exp_diffuse) < 0.005
        ok = ok and d_ok and f_ok
        status = "OK" if d_ok and f_ok else "MISMATCH"
        print(
            f"  alt={alt:>4} TL={tl:>4} -> direct={direct:10.4f} "
            f"(expected {exp_direct:10.4f}) diffuse={diffuse:10.4f} "
            f"(expected {exp_diffuse:10.4f})  [{status}]"
        )
    return ok


if __name__ == "__main__":
    hand_ok = run_hand_transcription()
    pvlib_ok = True
    if "--pvlib" in sys.argv:
        pvlib_ok = run_pvlib_cross_check()
    sys.exit(0 if hand_ok and pvlib_ok else 1)
