/**
 * A copy of `@mapbox/mapbox-gl-draw`'s bundled default layer styles
 * (`@mapbox/mapbox-gl-draw/src/lib/theme.js`, not published as an import
 * from the package — see below), with one fix: `gl-draw-lines`'s
 * `line-dasharray` paint property used a bare numeric array (`[2, 0]` /
 * `[0.2, 2]`) where the current style spec requires either a plain
 * (non-expression) constant value or an explicit `['literal', [...]]`
 * expression. MapLibre's stricter style-spec validation (see
 * `SceneTracing.tsx`'s `handleMapError` doc comment for the full story)
 * rejects the bare array as an invalid expression — `map.addLayer`
 * returns early without adding the layer — so `gl-draw-lines` (polygon
 * edge outlines, and the rubber-band line while drawing) silently never
 * renders at all, even though `gl-draw-polygon-fill` and the vertex/point
 * layers (which don't use `line-dasharray`) render fine. Wrapping both
 * arrays in `['literal', ...]` passes validation and is visually
 * identical.
 *
 * This is a full copy, not a partial override, because
 * `@mapbox/mapbox-gl-draw`'s `MapboxDrawOptions.styles` *replaces* the
 * default theme rather than merging into it (see its `src/options.js`) —
 * passing just a fixed `gl-draw-lines` entry would silently drop the
 * fill/point/vertex/midpoint layers.
 *
 * `@mapbox/mapbox-gl-draw` doesn't publish `lib/theme.js` in its package
 * `exports` map, so it can't be imported directly; this is kept in sync
 * by hand against the installed version (currently 1.5.1) instead.
 */
export const DRAW_STYLES: object[] = [
  // Polygons
  //   Solid fill
  //   Active state defines color
  {
    id: 'gl-draw-polygon-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: {
      'fill-color': [
        'case',
        ['==', ['get', 'active'], 'true'],
        '#fbb03b',
        '#3bb2d0',
      ],
      'fill-opacity': 0.1,
    },
  },
  // Lines
  // Polygon
  //   Matches Lines AND Polygons
  //   Active state defines color
  {
    id: 'gl-draw-lines',
    type: 'line',
    filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'active'], 'true'],
        '#fbb03b',
        '#3bb2d0',
      ],
      // Fixed: wrapped in `['literal', ...]` — see module doc comment.
      'line-dasharray': [
        'case',
        ['==', ['get', 'active'], 'true'],
        ['literal', [0.2, 2]],
        ['literal', [2, 0]],
      ],
      'line-width': 2,
    },
  },
  // Points
  //   Circle with an outline
  //   Active state defines size and color
  {
    id: 'gl-draw-point-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
      'circle-color': '#fff',
    },
  },
  {
    id: 'gl-draw-point-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 5, 3],
      'circle-color': [
        'case',
        ['==', ['get', 'active'], 'true'],
        '#fbb03b',
        '#3bb2d0',
      ],
    },
  },
  // Vertex
  //   Visible when editing polygons and lines
  //   Similar behaviour to Points
  //   Active state defines size
  {
    id: 'gl-draw-vertex-outer',
    type: 'circle',
    filter: [
      'all',
      ['==', '$type', 'Point'],
      ['==', 'meta', 'vertex'],
      ['!=', 'mode', 'simple_select'],
    ],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
      'circle-color': '#fff',
    },
  },
  {
    id: 'gl-draw-vertex-inner',
    type: 'circle',
    filter: [
      'all',
      ['==', '$type', 'Point'],
      ['==', 'meta', 'vertex'],
      ['!=', 'mode', 'simple_select'],
    ],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 5, 3],
      'circle-color': '#fbb03b',
    },
  },
  // Midpoint
  //   Visible when editing polygons and lines
  //   Tapping or dragging them adds a new vertex to the feature
  {
    id: 'gl-draw-midpoint',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'midpoint']],
    paint: {
      'circle-radius': 3,
      'circle-color': '#fbb03b',
    },
  },
]
