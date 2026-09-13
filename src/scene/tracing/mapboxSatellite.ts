import type { StyleSpecification } from 'maplibre-gl'

/** The plain vector style used when satellite imagery isn't available — same style `LocationPicker` uses. */
export const FALLBACK_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const MAPBOX_SATELLITE_SOURCE_ID = 'mapbox-satellite'
const MAPBOX_SATELLITE_LAYER_ID = 'mapbox-satellite-layer'

/**
 * Reads the Mapbox API key from Vite's env, per the project's established
 * "read an optional env var, provide a fallback" pattern (see
 * `VITE_NOMINATIM_CONTACT_EMAIL` in `src/data-sources/nominatim.ts`) —
 * except this key has NO sensible default, since it's a real credential:
 * an empty/missing value here means "no satellite imagery available",
 * handled by the caller falling back to `FALLBACK_STYLE_URL`. See
 * `.env.example` for where to get one.
 */
export function readMapboxApiKey(): string {
  const raw = import.meta.env.VITE_MAPBOX_API_KEY as string | undefined
  return (raw ?? '').trim()
}

/**
 * Builds the raw MapLibre GL style for the Mapbox Satellite raster layer.
 * Tile URL template per Mapbox's Raster Tiles API
 * (https://docs.mapbox.com/api/maps/raster-tiles/):
 * `https://api.mapbox.com/v4/{tileset_id}/{z}/{x}/{y}{@2x}.{format}?access_token=...`.
 * Uses `mapbox.satellite` as the tileset, `@2x` for retina-sharp imagery
 * (matching `tileSize: 512`), and `.jpg90` — Mapbox always serves
 * `mapbox.satellite` tiles as JPEG regardless of the requested format
 * suffix, so `.jpg90` is used rather than `.png90` to make that explicit
 * and get a reasonable quality/size tradeoff.
 */
export function buildMapboxSatelliteStyle(apiKey: string): StyleSpecification {
  const tileUrl = `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${apiKey}`
  return {
    version: 8,
    sources: {
      [MAPBOX_SATELLITE_SOURCE_ID]: {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 512,
        attribution: '© Mapbox © Maxar',
      },
    },
    layers: [
      {
        id: MAPBOX_SATELLITE_LAYER_ID,
        type: 'raster',
        source: MAPBOX_SATELLITE_SOURCE_ID,
      },
    ],
  }
}

export { MAPBOX_SATELLITE_SOURCE_ID }
