#!/usr/bin/env python3
"""
Independent Python re-transcription of the isotropic sky-diffuse POA
transposition model and the NOCT-based power-output model, written
from scratch against the published equations (not a copy of the TS
source) to cross-check src/solar-physics/poaIrradiance.ts and
panelPowerOutput.ts.
"""
import math


def poa_irradiance(direct_h, diffuse_h, sun_alt, sun_az, tilt, panel_az, albedo=0.2):
    tilt_r = math.radians(tilt)
    cos_tilt = math.cos(tilt_r)

    diffuse_poa = diffuse_h * (1 + cos_tilt) / 2
    ground_poa = (direct_h + diffuse_h) * albedo * (1 - cos_tilt) / 2

    if sun_alt <= 0:
        return max(diffuse_poa + ground_poa, 0)

    zenith = 90 - sun_alt
    cos_zenith = math.sin(math.radians(sun_alt))
    zenith_r = math.radians(zenith)
    az_diff_r = math.radians(sun_az - panel_az)

    cos_aoi = math.cos(zenith_r) * cos_tilt + math.sin(zenith_r) * math.sin(tilt_r) * math.cos(az_diff_r)
    direct_poa = direct_h * (max(cos_aoi, 0) / cos_zenith) if cos_zenith > 0 else 0

    return max(direct_poa + diffuse_poa + ground_poa, 0)


def panel_power_output(poa, rated_wp, temp_coeff_pct_per_c, ambient_c, losses_pct, noct=45):
    if poa <= 0:
        return 0
    base = rated_wp * (poa / 1000)
    cell_temp = ambient_c + (noct - 20) / 800 * poa
    derate = 1 + (temp_coeff_pct_per_c / 100) * (cell_temp - 25)
    loss_factor = 1 - losses_pct / 100
    return max(base * derate * loss_factor, 0)


if __name__ == "__main__":
    # --- poaIrradiance cases ---
    print("poaIrradiance:")
    cases = [
        # (direct_h, diffuse_h, sun_alt, sun_az, tilt, panel_az, albedo)
        (800, 100, 60, 180, 0, 180, 0.2),       # flat panel, high sun
        (800, 100, 60, 180, 30, 180, 0.2),      # tilted, facing sun exactly
        (800, 100, 30, 90, 40, 180, 0.2),       # sun in east, panel south -> low AOI cos
        (600, 150, 45, 200, 35, 180, 0.2),      # oblique
        (0, 50, 10, 90, 30, 180, 0.2),          # no direct component
        (500, 100, 20, 0, 30, 180, 0.2),        # sun directly behind panel (north vs south-facing)
        (700, 120, 50, 180, 90, 180, 0.2),      # vertical panel, sun due south
        (0, 0, -5, 180, 30, 180, 0.2),          # sun below horizon
    ]
    for c in cases:
        print(c, "->", round(poa_irradiance(*c), 4))

    print()
    print("panelPowerOutput:")
    pcases = [
        (1000, 400, -0.35, 25, 14, 45),   # STC-ish, 25C ambient
        (1000, 400, -0.35, 40, 14, 45),   # hot ambient, same irradiance
        (500, 400, -0.35, 25, 14, 45),    # half irradiance
        (1000, 400, -0.35, 0, 14, 45),    # cold ambient
        (800, 300, -0.40, 30, 10, 45),
        (0, 400, -0.35, 25, 14, 45),      # zero irradiance
    ]
    for c in pcases:
        print(c, "->", round(panel_power_output(*c), 4))
