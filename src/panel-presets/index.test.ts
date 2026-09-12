import { describe, expect, it } from 'vitest'
import { PANEL_PRESETS } from './index'

describe('PANEL_PRESETS', () => {
  it('has at least 10 real (non-generic) presets and 2-3 generic defaults', () => {
    const real = PANEL_PRESETS.filter((p) => !p.isGeneric)
    const generic = PANEL_PRESETS.filter((p) => p.isGeneric)

    expect(real.length).toBeGreaterThanOrEqual(10)
    expect(real.length).toBeLessThanOrEqual(15)
    expect(generic.length).toBeGreaterThanOrEqual(2)
    expect(generic.length).toBeLessThanOrEqual(3)
  })

  it('has unique ids', () => {
    const ids = PANEL_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(PANEL_PRESETS)(
    '$id has plausible efficiency, temp coefficient, and wattage',
    (preset) => {
      // Efficiency: commercially available panels span roughly 10% (older
      // polycrystalline/thin-film) to 25% (best-in-class monocrystalline).
      expect(preset.efficiencyPercent).toBeGreaterThanOrEqual(10)
      expect(preset.efficiencyPercent).toBeLessThanOrEqual(25)

      // Temperature coefficient of Pmax is always negative for silicon and
      // thin-film panels, and realistically falls between about -0.6%/°C
      // (older/lower-quality) and -0.2%/°C (best-in-class HJT/IBC).
      expect(preset.tempCoefficientPercentPerC).toBeLessThan(0)
      expect(preset.tempCoefficientPercentPerC).toBeGreaterThanOrEqual(-0.6)
      expect(preset.tempCoefficientPercentPerC).toBeLessThanOrEqual(-0.2)

      // Rated power: realistic range for single residential/commercial
      // modules currently on the market.
      expect(preset.ratedWattsPeak).toBeGreaterThanOrEqual(250)
      expect(preset.ratedWattsPeak).toBeLessThanOrEqual(750)

      expect(preset.id.length).toBeGreaterThan(0)
      expect(preset.make.length).toBeGreaterThan(0)
      expect(preset.model.length).toBeGreaterThan(0)
      expect(preset.notes.length).toBeGreaterThan(0)
    },
  )

  it.each(PANEL_PRESETS)(
    '$id rated wattage is consistent with efficiency x area (catches model/spec mismatches)',
    (preset) => {
      // ratedWattsPeak should equal roughly efficiencyPercent/100 * areaM2 *
      // 1000. This is the cross-check that catches a real model code paired
      // with a wattage/efficiency combination that doesn't match its actual
      // physical size (e.g. a wattage that belongs to a different SKU).
      // Real STC ratings carry measurement tolerance, so allow ~5%.
      const impliedWatts =
        (preset.efficiencyPercent / 100) * preset.areaM2 * 1000
      expect(preset.ratedWattsPeak).toBeGreaterThanOrEqual(impliedWatts * 0.95)
      expect(preset.ratedWattsPeak).toBeLessThanOrEqual(impliedWatts * 1.05)
    },
  )

  it('flags exactly the "Generic" make entries as isGeneric', () => {
    for (const preset of PANEL_PRESETS) {
      expect(preset.isGeneric).toBe(preset.make === 'Generic')
    }
  })
})
