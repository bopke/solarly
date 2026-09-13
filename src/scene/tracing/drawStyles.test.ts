import { describe, expect, it } from 'vitest'
// @maplibre/maplibre-gl-style-spec is a transitive dependency of
// maplibre-gl (not a direct one of this project), but it's the same
// validator MapLibre itself runs against every `addLayer` call — using it
// here is what makes this a genuine regression test rather than a
// same-file tautology. See DRAW_STYLES's doc comment for the bug this
// guards against.
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { DRAW_STYLES } from './drawStyles'

const validateStyle = validateStyleMin as (
  style: unknown,
) => { message: string; severity?: string }[]

describe('DRAW_STYLES', () => {
  it('passes MapLibre style-spec validation for every layer, cold and hot variants included', () => {
    // Mirrors @mapbox/mapbox-gl-draw's own cold/hot layer duplication
    // (its src/options.js `addSources`) so this checks exactly what
    // actually gets passed to `map.addLayer` at runtime.
    const style = {
      version: 8,
      sources: {
        'mapbox-gl-draw-cold': {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
        'mapbox-gl-draw-hot': {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
      },
      layers: DRAW_STYLES.flatMap((layer) => {
        const style = layer as { id: string; source?: string }
        const withSource = (bucket: 'cold' | 'hot') =>
          style.source
            ? layer
            : {
                ...layer,
                id: `${style.id}.${bucket}`,
                source:
                  bucket === 'hot'
                    ? 'mapbox-gl-draw-hot'
                    : 'mapbox-gl-draw-cold',
              }
        return [withSource('cold'), withSource('hot')]
      }),
    }

    const errors = validateStyle(style)
    expect(errors).toEqual([])
  })

  it('includes a gl-draw-lines layer (regression: this must actually reach map.addLayer)', () => {
    expect(
      DRAW_STYLES.some(
        (layer) => (layer as { id: string }).id === 'gl-draw-lines',
      ),
    ).toBe(true)
  })
})
