/**
 * The rest of the multiverse, at concept B's scale law (review §4.2).
 *
 * Two claims are on trial here and neither needs card data, so both are cheap:
 *
 *   - **`radius ∝ √N` makes the 22% share visible.** Every plane except the two detailed ones is
 *     one instance of an icosphere at `WORLD_RADIUS_K · √cardCount`, coloured by its own
 *     `palette` — which is already a WUBRG-multi-colourless weight vector in `planes.json`, so
 *     the colour at system distance is a real statistic of the plane's cards and not a stand-in.
 *   - **the 57 empty planes are dark moons, not 57 grey blobs.** `√0` is zero, so they take a
 *     floor radius and a near-black colour: present, unlit, unlabelled, and impossible to mistake
 *     for a plane with cards in it. The current renderer draws them as dim glows the app is then
 *     obliged to label (review §4.1); this draws them as objects you have to go and look for.
 *
 * The Blind Eternities becomes the belt of review §4.2 — 4,980 points around the whole system,
 * one arc per set, coloured by release year. It is the largest population after Dominaria and the
 * only honest thing to do with it is stop pretending it has a shape.
 */

import * as THREE from 'three'

import { multiversePalette, paletteColour } from './data'
import type { PlaneRecord } from '../../src/data/types'
import { WORLD_RADIUS_K } from './world'

/** `√0 = 0`, so an empty plane needs a floor. One card's worth of area, near enough. */
const MOON_RADIUS = 0.55

/** Emptiness is the point, so it is a colour and not a size: near-black, no tint from `palette`. */
const MOON_COLOUR = new THREE.Color(0.035, 0.038, 0.05)

/**
 * Undetailed worlds are dimmed hard. They carry no cells, so at full brightness a neighbour is a
 * blank white ball that outshines the world being judged — which is a framing accident and not a
 * property of the concept.
 */
const UNDETAILED_DIM = 0.3

export interface SystemView {
  readonly group: THREE.Group
  readonly worlds: number
  readonly moons: number
  readonly beltPoints: number
}

/** A year → colour ramp for the belt: cold at 1993, warm at 2026. */
function yearColour(year: number, first: number, last: number): THREE.Color {
  const t = last > first ? (year - first) / (last - first) : 0.5
  return new THREE.Color().setHSL(0.62 - 0.62 * t, 0.55, 0.42 + 0.1 * t)
}

function belt(plane: PlaneRecord, radius: number): THREE.Points {
  const total = Math.max(1, plane.cardCount)
  const positions = new Float32Array(total * 3)
  const colours = new Float32Array(total * 3)
  const first = plane.firstYear ?? 1993
  const last = plane.lastYear ?? 2026

  let written = 0
  let cumulative = 0
  for (const set of plane.sets) {
    const share = set.cardCount / total
    const colour = yearColour(set.year, first, last)
    // A gap between arcs, so "one arc per set" is legible rather than a continuous smear.
    const from = (cumulative + share * 0.06) * Math.PI * 2
    const to = (cumulative + share * 0.94) * Math.PI * 2
    for (let i = 0; i < set.cardCount && written < total; i += 1) {
      const t = set.cardCount > 1 ? i / (set.cardCount - 1) : 0.5
      const theta = from + (to - from) * t
      // Deterministic scatter: a mathematically clean ring reads as a UI element, not as debris.
      const jitter = Math.sin(written * 12.9898) * 43758.5453
      const rJitter = ((jitter % 1) + 1) % 1
      const yJitter = ((Math.sin(written * 78.233) * 12345.6789) % 1 + 1) % 1
      const r = radius * (0.94 + rJitter * 0.12)
      positions[written * 3] = Math.cos(theta) * r
      positions[written * 3 + 1] = (yJitter - 0.5) * radius * 0.07
      positions[written * 3 + 2] = Math.sin(theta) * r
      colours[written * 3] = colour.r
      colours[written * 3 + 1] = colour.g
      colours[written * 3 + 2] = colour.b
      written += 1
    }
    cumulative += share
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, written * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours.subarray(0, written * 3), 3))
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      // Constant size, not attenuated: the belt passes within a few units of the camera on a
      // close approach to an outer plane, and an attenuated point there becomes a 70 px square.
      // Constant 2 px is also what review §4.3 asks of stars — small and sharp, not bokeh.
      size: 2,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  points.frustumCulled = false
  return points
}

export function buildSystem(
  planes: readonly PlaneRecord[],
  detailed: ReadonlySet<string>,
  multiverseRadius: number,
): SystemView {
  const group = new THREE.Group()
  const reference = multiversePalette(planes)

  const others = planes.filter(
    (plane) => !detailed.has(plane.slug) && plane.kind !== 'dust',
  )
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 4),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    others.length,
  )
  const matrix = new THREE.Matrix4()
  const scale = new THREE.Vector3()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  let moons = 0

  others.forEach((plane, i) => {
    const empty = plane.cardCount === 0
    if (empty) moons += 1
    const radius = empty ? MOON_RADIUS : WORLD_RADIUS_K * Math.sqrt(plane.cardCount)
    position.set(...plane.home)
    scale.setScalar(radius)
    quaternion.set(...plane.tilt)
    mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale))
    mesh.setColorAt(
      i,
      empty ? MOON_COLOUR : new THREE.Color(...paletteColour(plane, reference)).multiplyScalar(UNDETAILED_DIM),
    )
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  group.add(mesh)

  const dust = planes.find((plane) => plane.kind === 'dust')
  let beltPoints = 0
  if (dust !== undefined) {
    const points = belt(dust, multiverseRadius * 1.12)
    beltPoints = points.geometry.getAttribute('position').count
    group.add(points)
  }

  return { group, worlds: others.length - moons, moons, beltPoints }
}
