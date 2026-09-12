/**
 * panel-presets
 *
 * Static curated dataset of well-known real panel models plus a few
 * generic "residential default" / "commercial default" entries. Used to
 * prefill the system-config form; all fields remain editable after a
 * preset is chosen (see docs/superpowers/specs/2026-09-12-solarly-m1-design.md).
 *
 * This module has no dependencies on any other module in the project.
 */

/** A single panel preset entry. */
export interface PanelPreset {
  /** Stable machine-readable identifier, e.g. for use as a <select> value. */
  id: string
  /** Manufacturer name, or "Generic" for non-manufacturer-specific defaults. */
  make: string
  /** Model/series name as marketed by the manufacturer. */
  model: string
  /** Rated power output at Standard Test Conditions (STC), in watts-peak. */
  ratedWattsPeak: number
  /** Module efficiency at STC, as a percentage (e.g. 21.4 for 21.4%). */
  efficiencyPercent: number
  /** Module width, in millimeters (the shorter of the two edges). */
  widthMm: number
  /** Module height, in millimeters (the longer of the two edges). */
  heightMm: number
  /**
   * Module area, in square meters, derived from `widthMm` * `heightMm`.
   * Used as an internal cross-check
   * (`ratedWattsPeak ≈ efficiencyPercent/100 × areaM2 × 1000`) to catch
   * model-code/spec mismatches. Because it's derived from the datasheet
   * dimensions rather than stored independently, it can't be adjusted to
   * paper over a wrong (Wp, efficiency) pair.
   */
  areaM2: number
  /**
   * Temperature coefficient of power (Pmax), in %/°C. Always negative:
   * panel output drops as cell temperature rises above the 25°C STC
   * reference. E.g. -0.34 means power drops 0.34% per °C above 25°C.
   */
  tempCoefficientPercentPerC: number
  /** True for the generic residential/commercial default entries. */
  isGeneric: boolean
  /** Short human-readable note, e.g. panel type or intended use case. */
  notes: string
}

/** Input shape for a preset before its derived `areaM2` is computed. */
type PanelPresetInput = Omit<PanelPreset, 'areaM2'>

/** Derives `areaM2` from `widthMm` * `heightMm`, rounded to 3 decimals. */
function withArea(preset: PanelPresetInput): PanelPreset {
  const areaM2 =
    Math.round(((preset.widthMm * preset.heightMm) / 1_000_000) * 1000) / 1000
  return { ...preset, areaM2 }
}

/**
 * Curated panel presets.
 *
 * Specs for real, named modules below are drawn from each manufacturer's
 * publicly published datasheets for well-known, representative products in
 * their lineup (module families current as of ~2023-2024; manufacturers
 * periodically revise specific SKUs, so treat these as realistic
 * typical-range values for prefill purposes rather than a live catalog).
 * `widthMm`/`heightMm` are the datasheet's nameplate module dimensions
 * (externally verifiable against the datasheet PDF); `areaM2` is derived
 * from them, not stored independently.
 * Sources (datasheet families, not individual serial-specific docs):
 *   - LONGi Hi-MO X6 Scientist series datasheets (longi.com)
 *   - JinkoSolar Tiger Neo series datasheets (jinkosolar.com)
 *   - Canadian Solar HiKu6 / TOPBiHiKu6 series datasheets (canadiansolar.com)
 *   - REC Alpha Pure-R series datasheets (recgroup.com)
 *   - SunPower/Maxeon 6 series datasheets (maxeon.com)
 *   - Hanwha Q CELLS Q.PEAK DUO / Q.TRON series datasheets (qcells.com)
 *   - Trina Solar Vertex series datasheets (trinasolar.com)
 *   - JA Solar DeepBlue series datasheets (jasolar.com)
 *   - First Solar Series 6 (thin-film CdTe) datasheets (firstsolar.com)
 */
export const PANEL_PRESETS: PanelPreset[] = [
  withArea({
    id: 'longi-himo6-450',
    make: 'LONGi',
    model: 'Hi-MO X6 Scientist (LR5-54HTH 450M)',
    ratedWattsPeak: 450,
    efficiencyPercent: 23.0,
    widthMm: 1134,
    heightMm: 1722,
    tempCoefficientPercentPerC: -0.29,
    isGeneric: false,
    notes: 'Monocrystalline HPBC, residential rooftop',
  }),
  withArea({
    id: 'jinko-tigerneo-440',
    make: 'JinkoSolar',
    model: 'Tiger Neo N-type 54HL4R-B 440W',
    ratedWattsPeak: 440,
    efficiencyPercent: 22.02,
    widthMm: 1134,
    heightMm: 1762,
    tempCoefficientPercentPerC: -0.29,
    isGeneric: false,
    notes: 'N-type TOPCon monocrystalline, residential rooftop',
  }),
  withArea({
    id: 'canadiansolar-hiku6-405',
    make: 'Canadian Solar',
    model: 'HiKu6 CS6R-405MS',
    ratedWattsPeak: 405,
    efficiencyPercent: 20.7,
    widthMm: 1134,
    heightMm: 1722,
    tempCoefficientPercentPerC: -0.34,
    isGeneric: false,
    notes: 'Monocrystalline PERC, residential rooftop',
  }),
  withArea({
    id: 'canadiansolar-tophiku6-590',
    make: 'Canadian Solar',
    model: 'TOPBiHiKu6 CS6.1-72TB-590',
    ratedWattsPeak: 590,
    efficiencyPercent: 21.8,
    widthMm: 1134,
    heightMm: 2382,
    tempCoefficientPercentPerC: -0.29,
    isGeneric: false,
    notes: 'N-type TOPCon bifacial, large-format commercial/utility',
  }),
  withArea({
    id: 'rec-alphapure-430',
    make: 'REC',
    model: 'Alpha Pure-R REC430AA',
    ratedWattsPeak: 430,
    efficiencyPercent: 22.3,
    widthMm: 1118,
    heightMm: 1730,
    tempCoefficientPercentPerC: -0.24,
    isGeneric: false,
    notes: 'Heterojunction (HJT), premium residential rooftop',
  }),
  withArea({
    id: 'sunpower-maxeon6-440',
    make: 'SunPower (Maxeon)',
    model: 'Maxeon 6 440W',
    ratedWattsPeak: 440,
    efficiencyPercent: 22.8,
    widthMm: 1032,
    heightMm: 1872,
    tempCoefficientPercentPerC: -0.29,
    isGeneric: false,
    notes: 'Interdigitated back contact (IBC), premium residential rooftop',
  }),
  withArea({
    id: 'qcells-qpeakduo-400',
    make: 'Q CELLS',
    model: 'Q.PEAK DUO ML-G10.a+ 400',
    ratedWattsPeak: 400,
    efficiencyPercent: 20.4,
    widthMm: 1045,
    heightMm: 1879,
    tempCoefficientPercentPerC: -0.34,
    isGeneric: false,
    notes: 'Monocrystalline Q.ANTUM DUO Z, residential rooftop',
  }),
  withArea({
    id: 'qcells-qtron-blk-m-g2-430',
    make: 'Q CELLS',
    model: 'Q.TRON BLK M-G2+ 430',
    ratedWattsPeak: 430,
    efficiencyPercent: 22.0,
    widthMm: 1134,
    heightMm: 1722,
    tempCoefficientPercentPerC: -0.3,
    isGeneric: false,
    notes: 'N-type TOPCon, residential rooftop',
  }),
  withArea({
    id: 'trina-vertex-s-425',
    make: 'Trina Solar',
    model: 'Vertex S+ TSM-NEG9R.28 425',
    ratedWattsPeak: 425,
    efficiencyPercent: 21.3,
    widthMm: 1134,
    heightMm: 1762,
    tempCoefficientPercentPerC: -0.3,
    isGeneric: false,
    notes: 'N-type TOPCon, residential rooftop',
  }),
  withArea({
    id: 'trina-vertex-670',
    make: 'Trina Solar',
    model: 'Vertex TSM-NEG21C.20 670',
    ratedWattsPeak: 670,
    efficiencyPercent: 21.6,
    widthMm: 1303,
    heightMm: 2384,
    tempCoefficientPercentPerC: -0.3,
    isGeneric: false,
    notes: 'N-type TOPCon, large-format commercial/utility',
  }),
  withArea({
    id: 'jasolar-deepblue-4-425',
    make: 'JA Solar',
    model: 'DeepBlue 4.0 X JAM54D41 425',
    ratedWattsPeak: 425,
    efficiencyPercent: 21.8,
    widthMm: 1134,
    heightMm: 1722,
    tempCoefficientPercentPerC: -0.3,
    isGeneric: false,
    notes: 'N-type bifacial, residential rooftop',
  }),
  withArea({
    id: 'firstsolar-series6-465',
    make: 'First Solar',
    model: 'Series 6 CuRe 465',
    ratedWattsPeak: 465,
    efficiencyPercent: 18.5,
    widthMm: 1245,
    heightMm: 2024,
    tempCoefficientPercentPerC: -0.28,
    isGeneric: false,
    notes: 'Thin-film CdTe, utility-scale',
  }),
  withArea({
    id: 'generic-residential-default',
    make: 'Generic',
    model: 'Residential default',
    ratedWattsPeak: 400,
    efficiencyPercent: 20.0,
    widthMm: 1000,
    heightMm: 2000,
    tempCoefficientPercentPerC: -0.35,
    isGeneric: true,
    notes:
      'Conservative mid-range monocrystalline residential panel; use when the exact model is unknown',
  }),
  withArea({
    id: 'generic-commercial-default',
    make: 'Generic',
    model: 'Commercial default',
    ratedWattsPeak: 550,
    efficiencyPercent: 21.0,
    widthMm: 1134,
    heightMm: 2310,
    tempCoefficientPercentPerC: -0.35,
    isGeneric: true,
    notes:
      'Conservative mid-range large-format commercial panel; use when the exact model is unknown',
  }),
  withArea({
    id: 'generic-budget-default',
    make: 'Generic',
    model: 'Budget default',
    ratedWattsPeak: 330,
    efficiencyPercent: 17.0,
    widthMm: 1134,
    heightMm: 1711,
    tempCoefficientPercentPerC: -0.41,
    isGeneric: true,
    notes:
      'Lower-efficiency, lower-cost polycrystalline-class panel; conservative fallback for older/budget installs',
  }),
]
