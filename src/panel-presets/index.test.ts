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

  it.each(PANEL_PRESETS)('$id has a kebab-case id', (preset) => {
    expect(preset.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
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
    '$id has plausible module dimensions and a correctly derived areaM2',
    (preset) => {
      // Plausible single-module footprint: small residential half-cut
      // modules start around ~1.5 m^2, large-format commercial/utility
      // modules top out around ~3.2 m^2.
      expect(preset.areaM2).toBeGreaterThanOrEqual(1.5)
      expect(preset.areaM2).toBeLessThanOrEqual(3.2)

      // areaM2 must actually be derived from widthMm x heightMm, not an
      // independently editable number - otherwise it can't anchor the
      // wattage/efficiency cross-check below to physical reality.
      const expectedAreaM2 = (preset.widthMm * preset.heightMm) / 1_000_000
      expect(preset.areaM2).toBeCloseTo(expectedAreaM2, 3)
    },
  )

  it.each(PANEL_PRESETS)(
    '$id rated wattage is consistent with efficiency x area (catches model/spec mismatches)',
    (preset) => {
      // ratedWattsPeak should equal roughly efficiencyPercent/100 * areaM2 *
      // 1000, where areaM2 is derived from the datasheet's own
      // widthMm/heightMm (see above) rather than stored independently. That
      // anchor is what makes this catch a real model code paired with a
      // wattage/efficiency combination that doesn't match its actual
      // physical size (e.g. a wattage that belongs to a different SKU) -
      // an independently-editable areaM2 could always be nudged to agree
      // with a wrong (Wp, efficiency) pair.
      //
      // Datasheet efficiency is computed FROM nameplate Wp and module
      // area, so the two agree by construction to within display rounding
      // (~0.2-0.3%); every genuinely-correct entry in this dataset lands
      // within ~0.4%. +-2% is tight enough to catch a real mismatch while
      // leaving headroom for rounding.
      const impliedWatts =
        (preset.efficiencyPercent / 100) * preset.areaM2 * 1000
      expect(preset.ratedWattsPeak).toBeGreaterThanOrEqual(impliedWatts * 0.98)
      expect(preset.ratedWattsPeak).toBeLessThanOrEqual(impliedWatts * 1.02)
    },
  )

  it('flags exactly the "Generic" make entries as isGeneric', () => {
    for (const preset of PANEL_PRESETS) {
      expect(preset.isGeneric).toBe(preset.make === 'Generic')
    }
  })
})
