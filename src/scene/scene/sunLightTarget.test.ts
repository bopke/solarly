import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { computeSunLightState } from './sunDirection'

/**
 * Regression test for PR #81 review finding 1: `Scene3DView`'s
 * `DirectionalLight` used a `target-position` JSX prop to aim at the
 * scene's centroid, but a `DirectionalLight`'s `target` is a plain
 * `Object3D` that Three.js never adds to the scene graph by itself — a
 * `target-position` prop only ever sets that orphaned object's *local*
 * position. With no parent, nothing ever calls `updateMatrixWorld()` on
 * it, so its `matrixWorld` stays pinned at the identity (world origin)
 * forever, and the light's real effective aim becomes
 * `normalize(lightPosition - origin)` instead of the intended
 * `normalize(lightPosition - sceneCenter)`.
 *
 * That bug was invisible in a single-shape/near-origin scene, where
 * `sceneCenter ≈ (0, 0, 0)` makes the buggy and intended targets
 * coincide — exactly the configuration the existing `Scene3DView.test.tsx`
 * suite uses (and has to, since it mocks `@react-three/fiber`'s `Canvas`
 * to bypass the real Three.js reconciler/WebGL entirely, so it can't
 * observe real `Object3D` world transforms at all). This test instead
 * exercises real `three` objects directly, wired the same two ways
 * `Scene3DView.tsx` was (before) and is (after) — attaching the target as
 * a genuine scene child vs. leaving it detached — with a scene center
 * meaningfully far from the world origin, and asserts on the light's real
 * *resolved* aim direction (from actual world matrices, not prop values).
 */
describe('DirectionalLight target attachment (PR #81 review finding 1)', () => {
  // A multi-shape scene whose bounds are spread well away from the world
  // origin — mirroring `Scene3DView`'s own `sceneCenter` (the merged
  // bounds' midpoint), computed here for two shapes sitting roughly
  // 60-100m from the origin, well outside the "single shape near origin"
  // configuration that masked the bug.
  const sceneCenter = { x: 62, y: 88, z: 4 }
  const span = 40
  const sunLightDistance = Math.max(span * 3, 20)

  // Real sun-direction computation (Berlin, summer midday) — the exact
  // function `Scene3DView` calls for the scrubber.
  const sunLight = computeSunLightState(
    52.5,
    13.4,
    new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
  )
  if (!sunLight.direction) {
    throw new Error('test setup: expected sun above horizon at this time')
  }
  const direction = sunLight.direction

  // Same formula as `Scene3DView`'s `sunLightPosition` memo: the scene
  // center offset out along the sun direction.
  const lightPosition = {
    x: sceneCenter.x + direction.x * sunLightDistance,
    y: sceneCenter.y + direction.y * sunLightDistance,
    z: sceneCenter.z + direction.z * sunLightDistance,
  }

  // The light aims from its position toward its target: since
  // lightPosition = sceneCenter + direction * distance, a light correctly
  // aimed at sceneCenter points along -direction.
  const expectedAim = new THREE.Vector3(
    -direction.x,
    -direction.y,
    -direction.z,
  ).normalize()

  // Reads world position straight from `matrixWorld` — exactly how
  // Three.js's own shadow-camera code resolves the light's target
  // (`_lookTarget.setFromMatrixPosition(light.target.matrixWorld)`, per
  // the reviewer's citation), rather than via `Object3D.getWorldPosition`,
  // which lazily recomputes the object's own world matrix as a
  // convenience and would therefore mask exactly the bug being tested —
  // a detached object's `matrixWorld` is never recomputed by the normal
  // render/scene-graph traversal that Three.js actually uses at render
  // time.
  function worldPositionFromMatrix(object: THREE.Object3D) {
    return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld)
  }

  function effectiveAim(target: THREE.Object3D, light: THREE.DirectionalLight) {
    const lightWorld = worldPositionFromMatrix(light)
    const targetWorld = worldPositionFromMatrix(target)
    return targetWorld.clone().sub(lightWorld).normalize()
  }

  it('aims at the real scene center (within a tight tolerance) once the target is a genuine scene-graph child — the fix', () => {
    const scene = new THREE.Scene()
    const light = new THREE.DirectionalLight()
    light.position.set(lightPosition.x, lightPosition.y, lightPosition.z)

    // The fixed pattern: the target is rendered as its own node (via
    // `<primitive>` in `Scene3DView.tsx`), i.e. a real child of the scene,
    // not just a value assigned to a detached object.
    const target = new THREE.Object3D()
    target.position.set(sceneCenter.x, sceneCenter.y, sceneCenter.z)
    scene.add(target)
    scene.add(light)
    light.target = target

    scene.updateMatrixWorld(true)

    const aim = effectiveAim(target, light)
    expect(aim.x).toBeCloseTo(expectedAim.x, 6)
    expect(aim.y).toBeCloseTo(expectedAim.y, 6)
    expect(aim.z).toBeCloseTo(expectedAim.z, 6)
  })

  it('would NOT aim at the scene center with the old detached-target pattern — the bug being regressed against', () => {
    const scene = new THREE.Scene()
    const light = new THREE.DirectionalLight()
    light.position.set(lightPosition.x, lightPosition.y, lightPosition.z)

    // The buggy pattern this PR replaces: `target-position` only sets the
    // local position of an `Object3D` that is never added to the scene
    // graph. Reproduced here by deliberately NOT calling `scene.add`
    // on the target, leaving its `matrixWorld` frozen at the identity
    // (world origin) regardless of the local position set on it.
    const detachedTarget = new THREE.Object3D()
    detachedTarget.position.set(sceneCenter.x, sceneCenter.y, sceneCenter.z)
    scene.add(light)
    light.target = detachedTarget

    scene.updateMatrixWorld(true)

    // The target's world position stays at the origin, not sceneCenter —
    // `scene.updateMatrixWorld` only recurses into actual scene children,
    // and this target was deliberately never added as one.
    const targetWorld = worldPositionFromMatrix(detachedTarget)
    expect(targetWorld.x).toBe(0)
    expect(targetWorld.y).toBe(0)
    expect(targetWorld.z).toBe(0)

    const buggyAim = effectiveAim(detachedTarget, light)
    // With sceneCenter meaningfully far from the origin, the buggy
    // origin-relative aim diverges noticeably from the intended
    // sceneCenter-relative aim — this is the ~9.5°-scale error the
    // reviewer identified, made observable here rather than asserted
    // away by a near-origin test scene.
    const angleErrorRad = buggyAim.angleTo(expectedAim)
    const angleErrorDeg = (angleErrorRad * 180) / Math.PI
    expect(angleErrorDeg).toBeGreaterThan(1)
  })
})
