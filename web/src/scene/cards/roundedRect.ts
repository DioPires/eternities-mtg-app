/**
 * PRD 5.6.2's "thin rounded-rectangle solid", as two geometries.
 *
 * A face is a flat rounded rectangle with the card's image mapped straight onto it; the body is the
 * same outline extruded to the card's thickness, in the dark neutral of PRD 5.6.2, and the faces sit
 * a hair proud of it on either side.
 *
 * Built by hand rather than from `RoundedBoxGeometry` or `ExtrudeGeometry` because the UVs are the
 * point: a card's image has to land on the face exactly once, edge to edge, and both of those
 * generate cap UVs in *shape* coordinates that then need unpicking. A triangle fan from the centre
 * gives the mapping directly, and it is 4 KB of geometry either way.
 */

import { BufferAttribute, BufferGeometry } from 'three'

/** Vertices per corner arc. Eight is smooth at the fixed on-screen size of PRD 5.6.1. */
const CORNER_SEGMENTS = 8

/** The outline, counter-clockwise, starting at the +x edge. Shared by the face and the body. */
function outline(width: number, height: number, radius: number): Float32Array {
  const hw = width / 2
  const hh = height / 2
  const r = Math.min(radius, hw, hh)
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [hw - r, hh - r, 0], // top right, sweeping from 0 to 90°
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, (3 * Math.PI) / 2],
  ]
  const points = new Float32Array(corners.length * (CORNER_SEGMENTS + 1) * 2)
  let at = 0
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= CORNER_SEGMENTS; i += 1) {
      const angle = start + (i / CORNER_SEGMENTS) * (Math.PI / 2)
      points[at++] = cx + r * Math.cos(angle)
      points[at++] = cy + r * Math.sin(angle)
    }
  }
  return points
}

/**
 * One face of the card, in the xy plane at `z`, facing `+z` when `front` and `-z` otherwise.
 *
 * `uv` runs 0-1 across the rectangle's *bounding box*, so the image is not distorted by the corner
 * radius.
 *
 * **`v` runs down the card, and that is measured rather than derived.** The image arrives as an
 * `ImageBitmap`, and an `ImageBitmap` is the one texture source whose `flipY` is not reliably
 * applied on upload — so the row the sampler calls `v = 0` is the image's *top*, not its bottom.
 * Mapping `v` upwards, as `PlaneGeometry` does for an ordinary image, put the card's title along
 * its bottom edge on Chrome/Metal. The atlas path in `./atlas` does not have this problem because
 * it blits through a render target, where three's own quad and the flip agree with each other.
 *
 * `scripts/verify-browser.mjs --shots` writes the front and the back of a focused card, which is
 * PRD 9.3's checkpoint 4 and also what would catch this moving again.
 *
 * The back face is additionally mirrored in `u`, so that PRD 5.6.5's 180° turn about the vertical
 * axis lands the back image the right way round rather than mirror-written.
 */
export function cardFaceGeometry(
  width: number,
  height: number,
  radius: number,
  z: number,
  front: boolean,
): BufferGeometry {
  const points = outline(width, height, radius)
  const perimeter = points.length / 2
  const vertexCount = perimeter + 1

  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const normalZ = front ? 1 : -1

  // Vertex 0 is the fan's centre.
  positions[2] = z
  normals[2] = normalZ
  uvs[0] = 0.5
  uvs[1] = 0.5

  for (let i = 0; i < perimeter; i += 1) {
    const x = points[i * 2]!
    const y = points[i * 2 + 1]!
    const at = (i + 1) * 3
    positions[at] = x
    positions[at + 1] = y
    positions[at + 2] = z
    normals[at + 2] = normalZ
    const u = x / width + 0.5
    // `v` runs *down* the card: see the doc comment.
    uvs[(i + 1) * 2] = front ? u : 1 - u
    uvs[(i + 1) * 2 + 1] = 0.5 - y / height
  }

  const indices: number[] = []
  for (let i = 0; i < perimeter; i += 1) {
    const a = i + 1
    const b = ((i + 1) % perimeter) + 1
    // Wind so the triangle's front is the side its normal points at.
    if (front) indices.push(0, a, b)
    else indices.push(0, b, a)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/** The card's edge: the outline swept through `thickness`, normals pointing outwards. */
export function cardEdgeGeometry(
  width: number,
  height: number,
  radius: number,
  thickness: number,
): BufferGeometry {
  const points = outline(width, height, radius)
  const perimeter = points.length / 2
  const half = thickness / 2

  const positions = new Float32Array(perimeter * 2 * 3)
  const normals = new Float32Array(perimeter * 2 * 3)
  const uvs = new Float32Array(perimeter * 2 * 2)

  for (let i = 0; i < perimeter; i += 1) {
    const x = points[i * 2]!
    const y = points[i * 2 + 1]!
    const length = Math.hypot(x, y) || 1
    for (let side = 0; side < 2; side += 1) {
      const at = (i * 2 + side) * 3
      positions[at] = x
      positions[at + 1] = y
      positions[at + 2] = side === 0 ? half : -half
      // Radially outwards. The outline is convex, so the direction from the centre is the normal.
      normals[at] = x / length
      normals[at + 1] = y / length
      uvs[(i * 2 + side) * 2] = i / perimeter
      uvs[(i * 2 + side) * 2 + 1] = side
    }
  }

  const indices: number[] = []
  for (let i = 0; i < perimeter; i += 1) {
    const next = (i + 1) % perimeter
    const a = i * 2
    const b = i * 2 + 1
    const c = next * 2
    const d = next * 2 + 1
    indices.push(a, b, c, b, d, c)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}
