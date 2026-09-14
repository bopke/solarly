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

/**
 * Duplicates a layer once per cold/hot source bucket, mirroring
 * `@mapbox/mapbox-gl-draw`'s own layer duplication (its `src/options.js`
 * `addSources`) — this is exactly what actually gets passed to
 * `map.addLayer` at runtime. No `withSource` conditional here (a prior
 * version of this helper had one, for a `layer.source` that's never
 * actually present on any `DRAW_STYLES` entry — see `drawStyles.ts`'s
 * doc comment on why `source` is always missing from this hand-maintained
 * copy — so that branch could never fire).
 */
function withSource(
  layer: (typeof DRAW_STYLES)[number],
  bucket: 'cold' | 'hot',
) {
  return {
    ...layer,
    id: `${layer.id}.${bucket}`,
    source: bucket === 'hot' ? 'mapbox-gl-draw-hot' : 'mapbox-gl-draw-cold',
  }
}

/**
 * Recursively unwraps `['literal', value]` expressions back to their raw
 * `value`, anywhere in `data` — the inverse of the `line-dasharray` fix
 * `DRAW_STYLES`'s doc comment describes, so a patched copy of `DRAW_STYLES`
 * (a layer-object tree, not just a single expression) can be compared
 * directly against the *unpatched* upstream theme below.
 */
function stripLiteralWrapping(data: unknown): unknown {
  if (Array.isArray(data)) {
    if (data.length === 2 && data[0] === 'literal') {
      return data[1]
    }
    return data.map(stripLiteralWrapping)
  }
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        stripLiteralWrapping(value),
      ]),
    )
  }
  return data
}

/**
 * Reads `@mapbox/mapbox-gl-draw`'s actual installed theme
 * (`src/lib/theme.js`) directly off disk and imports it as an ES module.
 * The package doesn't publish this file in its `exports` map (see
 * `DRAW_STYLES`'s doc comment), so it can't be reached via a normal bare
 * import — this project's flat, npm-managed `node_modules` (see
 * `package-lock.json`) means the installed copy is reliably reachable by a
 * relative path instead, from this file's own location
 * (`src/scene/tracing/`) up to the project root's `node_modules/`.
 *
 * The path is built at runtime (not as a string literal directly in the
 * `import()` call) specifically so this stays a plain dynamic import Vite
 * doesn't try to statically analyze/bundle, and so this project's
 * browser-only `tsconfig.app.json` (no Node types/`allowJs`) never needs
 * to resolve or type-check a path into `node_modules`.
 */
async function loadUpstreamTheme(): Promise<unknown[]> {
  const themePath =
    '../../../node_modules/@mapbox/mapbox-gl-draw/src/lib/theme.js'
  const themeModule = (await import(/* @vite-ignore */ themePath)) as {
    default: unknown[]
  }
  return themeModule.default
}

describe('DRAW_STYLES', () => {
  it('passes MapLibre style-spec validation for every layer, cold and hot variants included', () => {
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
      layers: DRAW_STYLES.flatMap((layer) => [
        withSource(layer, 'cold'),
        withSource(layer, 'hot'),
      ]),
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

  it('matches the installed @mapbox/mapbox-gl-draw theme, modulo the known line-dasharray fix', async () => {
    const upstream = await loadUpstreamTheme()

    // Reverses this file's deliberate `line-dasharray` fix (wrapping the
    // two dash-pattern arrays in `['literal', ...]`) so the comparison is
    // against the *unpatched* shape upstream actually ships — anything
    // else diverging is real, unintentional drift this test exists to
    // catch (see issue #92).
    const patched = DRAW_STYLES.map((layer) =>
      stripLiteralWrapping(layer),
    ) as unknown[]

    expect(patched).toEqual(upstream)
  })
})
