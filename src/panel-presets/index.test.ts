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
      expect(preset.ratedWattsPeak).toBeGreaterThan(0)
      expect(preset.ratedWattsPeak).toBeGreaterThanOrEqual(250)
      expect(preset.ratedWattsPeak).toBeLessThanOrEqual(750)

      expect(preset.make.length).toBeGreaterThan(0)
      expect(preset.model.length).toBeGreaterThan(0)
      expect(preset.notes.length).toBeGreaterThan(0)
    },
  )

  it('flags exactly the "Generic" make entries as isGeneric', () => {
    for (const preset of PANEL_PRESETS) {
      expect(preset.isGeneric).toBe(preset.make === 'Generic')
    }
  })
})
