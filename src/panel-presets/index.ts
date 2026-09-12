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

/**
 * Curated panel presets.
 *
 * Specs for real, named modules below are drawn from each manufacturer's
 * publicly published datasheets for well-known, representative products in
 * their lineup (module families current as of ~2023-2024; manufacturers
 * periodically revise specific SKUs, so treat these as realistic
 * typical-range values for prefill purposes rather than a live catalog).
 * Sources (datasheet families, not individual serial-specific docs):
 *   - LONGi Hi-MO 6 / Hi-MO 5 series datasheets (longi.com)
 *   - JinkoSolar Tiger Neo series datasheets (jinkosolar.com)
 *   - Canadian Solar HiKu6 / TopHiKu6 series datasheets (canadiansolar.com)
 *   - REC Alpha Pure series datasheets (recgroup.com)
 *   - SunPower/Maxeon 6 / Performance series datasheets (maxeon.com)
 *   - Q CELLS Q.PEAK DUO series datasheets (qcells.com)
 *   - Trina Solar Vertex series datasheets (trinasolar.com)
 *   - JA Solar DeepBlue series datasheets (jasolar.com)
 *   - Hanwha Q CELLS Q.TRON series datasheets (qcells.com)
 *   - First Solar Series 6 (thin-film CdTe) datasheets (firstsolar.com)
 */
export const PANEL_PRESETS: PanelPreset[] = [
  {
    id: 'longi-himo6-450',
    make: 'LONGi',
    model: 'Hi-MO 6 (LR5-54HTH 450M)',
    ratedWattsPeak: 450,
    efficiencyPercent: 22.8,
    tempCoefficientPercentPerC: -0.29,
    isGeneric: false,
    notes: 'Monocrystalline PERC/HPBC, residential rooftop',
  },
  {
    id: 'jinko-tigerneo-440',
    make: 'JinkoSolar',
    model: 'Tiger Neo N-type 54HL4R-B 440W',
    ratedWattsPeak: 440,
    efficiencyPercent: 22.3,
    tempCoefficientPercentPerC: -0.29,
    isGeneric: false,
    notes: 'N-type TOPCon monocrystalline, residential rooftop',
  },
  {
    id: 'canadiansolar-hiku6-445',
    make: 'Canadian Solar',
    model: 'HiKu6 CS6R-445MS',
    ratedWattsPeak: 445,
    efficiencyPercent: 21.5,
    tempCoefficientPercentPerC: -0.34,
    isGeneric: false,
    notes: 'Monocrystalline PERC, residential rooftop',
  },
  {
    id: 'canadiansolar-tophiku6-590',
    make: 'Canadian Solar',
    model: 'TopHiKu6 CS7N-590MS',
    ratedWattsPeak: 590,
    efficiencyPercent: 22.5,
    tempCoefficientPercentPerC: -0.29,
    isGeneric: false,
    notes: 'N-type TOPCon, large-format commercial/utility',
  },
  {
    id: 'rec-alphapure-430',
    make: 'REC',
    model: 'Alpha Pure-R REC430AA',
    ratedWattsPeak: 430,
    efficiencyPercent: 22.3,
    tempCoefficientPercentPerC: -0.26,
    isGeneric: false,
    notes: 'Heterojunction (HJT), premium residential rooftop',
  },
  {
    id: 'sunpower-maxeon6-440',
    make: 'SunPower (Maxeon)',
    model: 'Maxeon 6 440W',
    ratedWattsPeak: 440,
    efficiencyPercent: 22.6,
    tempCoefficientPercentPerC: -0.27,
    isGeneric: false,
    notes: 'Interdigitated back contact (IBC), premium residential rooftop',
  },
  {
    id: 'qcells-qpeakduo-400',
    make: 'Q CELLS',
    model: 'Q.PEAK DUO ML-G10+ 400',
    ratedWattsPeak: 400,
    efficiencyPercent: 20.6,
    tempCoefficientPercentPerC: -0.34,
    isGeneric: false,
    notes: 'Monocrystalline Q.ANTUM DUO, residential rooftop',
  },
  {
    id: 'qcells-qtron-td-g2-490',
    make: 'Q CELLS',
    model: 'Q.TRON BLK M-G2+ 490',
    ratedWattsPeak: 490,
    efficiencyPercent: 22.5,
    tempCoefficientPercentPerC: -0.3,
    isGeneric: false,
    notes: 'N-type TOPCon, large-format residential/commercial',
  },
  {
    id: 'trina-vertex-s-425',
    make: 'Trina Solar',
    model: 'Vertex S+ TSM-NEG9R.28 425',
    ratedWattsPeak: 425,
    efficiencyPercent: 21.6,
    tempCoefficientPercentPerC: -0.3,
    isGeneric: false,
    notes: 'N-type TOPCon, residential rooftop',
  },
  {
    id: 'trina-vertex-670',
    make: 'Trina Solar',
    model: 'Vertex TSM-NEG21C.20 670',
    ratedWattsPeak: 670,
    efficiencyPercent: 21.4,
    tempCoefficientPercentPerC: -0.34,
    isGeneric: false,
    notes: 'N-type TOPCon, large-format commercial/utility',
  },
  {
    id: 'jasolar-deepblue-4-425',
    make: 'JA Solar',
    model: 'DeepBlue 4.0 X JAM54D41 425',
    ratedWattsPeak: 425,
    efficiencyPercent: 22.0,
    tempCoefficientPercentPerC: -0.3,
    isGeneric: false,
    notes: 'N-type bifacial, residential rooftop',
  },
  {
    id: 'firstsolar-series6-465',
    make: 'First Solar',
    model: 'Series 6 CuRe 465',
    ratedWattsPeak: 465,
    efficiencyPercent: 19.5,
    tempCoefficientPercentPerC: -0.28,
    isGeneric: false,
    notes: 'Thin-film CdTe, utility-scale; lower temp sensitivity than c-Si',
  },
  {
    id: 'generic-residential-default',
    make: 'Generic',
    model: 'Residential default',
    ratedWattsPeak: 400,
    efficiencyPercent: 20.0,
    tempCoefficientPercentPerC: -0.35,
    isGeneric: true,
    notes:
      'Conservative mid-range monocrystalline residential panel; use when the exact model is unknown',
  },
  {
    id: 'generic-commercial-default',
    make: 'Generic',
    model: 'Commercial default',
    ratedWattsPeak: 550,
    efficiencyPercent: 21.0,
    tempCoefficientPercentPerC: -0.35,
    isGeneric: true,
    notes:
      'Conservative mid-range large-format commercial panel; use when the exact model is unknown',
  },
  {
    id: 'generic-budget-default',
    make: 'Generic',
    model: 'Budget default',
    ratedWattsPeak: 330,
    efficiencyPercent: 17.0,
    tempCoefficientPercentPerC: -0.41,
    isGeneric: true,
    notes:
      'Lower-efficiency, lower-cost polycrystalline-class panel; conservative fallback for older/budget installs',
  },
]
