/**
 * PRD 5.3.18's three-layer parallax starfield over the near-black sky, and PRD 8.7.1's first
 * frame: this renders before any artefact has been fetched, which is what makes "time to first
 * rendered frame ≤ 1.0 s" (PRD 7.2) a property of the shell rather than of the network.
 *
 * Grown out of the Phase 0 hello-scene. The layers are unchanged; what is new is that the
 * multiverse rotation now comes from the same clock as the stars, so the background and the
 * foreground turn together instead of drifting apart over a long session.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Points,
  PointsMaterial,
} from 'three'

import { BLOOM_LAYER } from './post/bloomLayer'
import { BACKGROUND_LAYERS, SKY_COLOUR, type BackgroundLayerSpec } from './tuning'

export { SKY_COLOUR }

/**
 * Deterministic scatter, so the background is identical for every user of a build — the same
 * promise PRD 5.3.1 makes about plane placement. No `Math.random`.
 */
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function shellPositions(count: number, radius: number, seed: number): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    // Uniform on a sphere: acos keeps the poles from bunching.
    const u = seededUnit(seed + i * 3)
    const v = seededUnit(seed + i * 3 + 1)
    const jitter = 0.85 + 0.3 * seededUnit(seed + i * 3 + 2)
    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)
    const r = radius * jitter
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.cos(phi)
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  return positions
}

function createLayer(spec: BackgroundLayerSpec, seed: number): Points {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(shellPositions(spec.count, spec.radius, seed), 3),
  )
  const material = new PointsMaterial({
    size: spec.size,
    sizeAttenuation: false,
    color: new Color(spec.tint),
    transparent: true,
    opacity: spec.opacity,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const points = new Points(geometry, material)
  points.frustumCulled = false
  // Layer 0 *and* the bloom layer, from one object, the way the field's glow mesh is (DEC-703).
  //
  // These shells bloomed under the shipped chain, because that chain's selection was inert and it
  // thresholded the whole composited frame (review finding R4). Two of the three are comfortably
  // over the threshold once their opacity and tint are folded in — layer 0's is 0.72 and layer 1's
  // 0.45 against `BLOOM_THRESHOLD` 0.28 — so leaving the group off the layer would have taken a
  // halo off the two nearest shells and called it a no-op. Layer 2 lands at 0.19 and contributes
  // nothing either way; it opts in regardless, because the threshold is the prefilter's business
  // and not a thing to re-derive here every time a tint moves.
  points.layers.enable(BLOOM_LAYER)
  return points
}

/**
 * The layers as one group. `advanceBackground` turns each layer at its own fraction of the
 * multiverse rate, which is what gives the three shells their distinct depths.
 */
export function createBackground(): { group: Group; dispose: () => void } {
  const group = new Group()
  const layers = BACKGROUND_LAYERS.map((spec, i) => createLayer(spec, (i + 1) * 1013))
  for (const layer of layers) group.add(layer)
  return {
    group,
    dispose() {
      for (const layer of layers) {
        layer.geometry.dispose()
        ;(layer.material as PointsMaterial).dispose()
      }
    },
  }
}

/** Called once per frame with the multiverse angle the star field is using. No allocation. */
export function advanceBackground(group: Group, multiverseAngle: number): void {
  for (let i = 0; i < group.children.length; i += 1) {
    group.children[i]!.rotation.y = multiverseAngle * BACKGROUND_LAYERS[i]!.parallax
  }
}
