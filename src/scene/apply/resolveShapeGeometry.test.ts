import { describe, expect, it } from 'vitest'
import type { SceneDesignState } from '../flow/types'
import {
  deriveSceneGeometryFromScene,
  isShapeGeometryResolvable,
  resolveShapeGeometry,
} from './deriveSceneGeometry'
import { deriveSystemConfigFromScene } from './deriveSystemConfig'

/**
 * Cross-derivation agreement test (issue #88, item 4): `resolveShapeGeometry`
 * is the single shared choke point `deriveSceneGeometryFromScene` and
 * `deriveSystemConfigFromScene` (via `isShapeGeometryResolvable`) both flow
 * through when deciding whether a traced shape's geometry can be resolved.
 * Before this refactor, the two derivations independently duplicated an
 * equivalent check, "provably in agreement" only by construction/fuzz-testing
 * (PR #83's review) rather than by sharing code — leaving room for a future
 * change to one side's skip conditions to silently reopen the
 * shapeId-correlation gap issue #78 closed. This fuzzes a wide variety of
 * shape/config combinations (valid squares, degenerate/self-intersecting
 * polygons, NaN and out-of-range tilt/azimuth) and asserts the two
 * derivations always agree on exactly which shapes are resolvable.
 */

const PANEL_PRESET = {
  id: 'fuzz-preset',
  make: 'Test',
  model: 'Panel',
  ratedWattsPeak: 400,
  efficiencyPercent: 20,
  widthMm: 1000,
  heightMm: 2000,
  areaM2: 2,
  tempCoefficientPercentPerC: -0.35,
  isGeneric: true,
  notes: '',
}

function square(latOffset: number, lonOffset: number, sizeDeg: number) {
  return [
    { lat: latOffset, lon: lonOffset },
    { lat: latOffset + sizeDeg, lon: lonOffset },
    { lat: latOffset + sizeDeg, lon: lonOffset + sizeDeg },
    { lat: latOffset, lon: lonOffset + sizeDeg },
  ]
}

// A small, deterministic PRNG (mulberry32) rather than `Math.random()`, so a
// failure is reproducible from the printed seed/iteration alone.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface FuzzCase {
  polygon: { lat: number; lon: number }[]
  config: { tiltDeg: number; azimuthDeg: number } | undefined
}

function randomCase(rand: () => number): FuzzCase {
  const polygonKind = Math.floor(rand() * 4)
  const polygon =
    polygonKind === 0
      ? square(rand() * 0.01, rand() * 0.01, 0.0005 + rand() * 0.0005)
      : polygonKind === 1
        ? [] // no vertices at all
        : polygonKind === 2
          ? [{ lat: rand(), lon: rand() }] // single point
          : // Self-intersecting "bowtie" quadrilateral.
            [
              { lat: 0, lon: 0 },
              { lat: 0.001, lon: 0.001 },
              { lat: 0, lon: 0.001 },
              { lat: 0.001, lon: 0 },
            ]

  const configKind = Math.floor(rand() * 5)
  const config: FuzzCase['config'] =
    configKind === 0
      ? undefined // unconfigured
      : configKind === 1
        ? { tiltDeg: rand() * 45, azimuthDeg: rand() * 360 } // ordinary valid
        : configKind === 2
          ? { tiltDeg: NaN, azimuthDeg: rand() * 360 } // issue #89
          : configKind === 3
            ? { tiltDeg: rand() * 45, azimuthDeg: NaN } // issue #89
            : { tiltDeg: 90, azimuthDeg: rand() * 360 } // exactly the boundary

  return { polygon, config }
}

describe('resolveShapeGeometry / cross-derivation agreement', () => {
  it('isShapeGeometryResolvable agrees with resolveShapeGeometry returning a value', () => {
    const rand = mulberry32(12345)
    for (let i = 0; i < 200; i++) {
      const { polygon, config } = randomCase(rand)
      const shape = { id: `shape-${i}`, polygon }
      expect(isShapeGeometryResolvable(shape, config)).toBe(
        resolveShapeGeometry(shape, config) !== undefined,
      )
    }
  })

  it('deriveSystemConfigFromScene’s shapeId population agrees with deriveSceneGeometryFromScene’s shapes list, across randomized shape/config combinations', () => {
    const rand = mulberry32(67890)
    for (let i = 0; i < 200; i++) {
      const { polygon, config } = randomCase(rand)
      const shapeId = `shape-${i}`

      const state: SceneDesignState = {
        tracedShapes: [{ id: shapeId, kind: 'roof-face', polygon }],
        hasInvalidTracedShapes: false,
        shapeConfigs: config ? [{ shapeId, ...config }] : [],
        isShapeConfigValid: true,
        obstructions: [],
        panelLayouts: [{ shapeId, panelCount: 4, panels: [] }],
      }

      const systemConfig = deriveSystemConfigFromScene(state, {
        panelPreset: PANEL_PRESET,
      })
      const sceneGeometry = deriveSceneGeometryFromScene(state)

      const arrayHasShapeId = systemConfig.arrays[0]?.shapeId === shapeId
      const sceneGeometryHasShape = sceneGeometry.shapes.some(
        (s) => s.id === shapeId,
      )

      expect(arrayHasShapeId).toBe(sceneGeometryHasShape)
      // And both should agree with the shared resolvability check directly.
      expect(arrayHasShapeId).toBe(
        isShapeGeometryResolvable({ id: shapeId, polygon }, config),
      )
    }
  })
})
