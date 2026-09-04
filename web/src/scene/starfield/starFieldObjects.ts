/**
 * The three.js object graph of the star field: one `Points` for the picture, one `Points` for the
 * id buffer, one instanced quad for the nebulae and zero-card glows.
 *
 * Built imperatively rather than as JSX because every one of these objects shares mutable state
 * with the others — the plane table, the time uniform, the geometry — and a single owner that
 * hands out one `update` call per frame is far easier to keep allocation-free (PRD 7.3.2) than a
 * tree of components each with its own `useFrame`.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Points,
  ShaderMaterial,
  type Texture,
  type Uniform,
} from 'three'

import { PICK_LAYER } from '../picking/idPicker'
import {
  EMPTY_GLOW_CORE,
  EMPTY_GLOW_OPACITY,
  HUE_COLOURS,
  NEBULA_OPACITY,
  PICK_MIN_PX,
  RARITY_SIZE,
  STAR_MAX_PX,
  STAR_MIN_PX,
  STAR_WORLD_DIAMETER,
} from '../tuning'
import { PlaneKindCode } from './motion'
import type { PlaneTable } from './planeTable'
import {
  GLOW_FRAGMENT_SHADER,
  GLOW_VERTEX_SHADER,
  STAR_FRAGMENT_SHADER,
  STAR_VERTEX_SHADER,
} from './shaders'
import type { StarGeometry } from './starGeometry'

/** A uniform entry, shared by reference across the three materials that need the same value. */
function uniform<T>(value: T): Uniform<T> {
  return { value } as Uniform<T>
}

export interface StarField {
  /** The drawn star field (PRD 8.5.1), on the default layer. */
  readonly points: Points
  /** The same geometry and the same vertex program, writing ids (PRD 8.5.6). Pick layer only. */
  readonly pickPoints: Points
  /** PRD 5.3.19 nebulae and PRD 5.3.6 zero-card glows, one instanced draw call. */
  readonly glow: Mesh

  /**
   * Push the frame's shared state into the uniforms. One call per frame, no allocation.
   *
   * `drawingBufferHeight` and `fovRadians` turn world-unit star diameters into device pixels;
   * `pixelRatio` keeps the minimum and maximum sizes fixed in CSS pixels as the ratio adapts
   * (PRD 8.5.11).
   */
  update(
    motion: number,
    drawingBufferHeight: number,
    fovRadians: number,
    pixelRatio: number,
  ): void

  /** PRD 5.4.12: the star under the pointer brightens by 30%. `-1` for none. */
  setHovered(index: number): void

  /**
   * Override the pick pass's minimum sprite size, in CSS pixels, or `null` for `PICK_MIN_PX`.
   *
   * Only the GPU self-check uses this. The production floor exists so a one-pixel star is still
   * clickable, but an inflated sprite means a *neighbour's* sprite also covers the queried pixel
   * and can win the depth test — which is a property of the sprite, not of where the shader put
   * the star. The check narrows the sprite so that what it measures is position agreement.
   */
  setPickSpriteFloorPx(px: number | null): void

  dispose(): void
}

export function createStarField(
  table: PlaneTable,
  geometry: StarGeometry,
  noise: Texture,
): StarField {
  // Shared by reference: one write per frame reaches every material that reads them.
  const uPlaneTable = uniform(table.texture)
  const uTime = uniform(0)
  const uMultiverseAngle = uniform(0)
  const uMotion = uniform(1)

  const uSizeScale = uniform(1)
  const uMinPixels = uniform(STAR_MIN_PX)
  const uMaxPixels = uniform(STAR_MAX_PX)
  const uPickMinPixels = uniform(PICK_MIN_PX)
  const uHoverIndex = uniform(-1)
  /** `null` means "use `PICK_MIN_PX`". See `setPickSpriteFloorPx`. */
  let pickSpriteFloorPx: number | null = null

  const hues = HUE_COLOURS.map(([r, g, b]) => new Color(r, g, b))
  const starUniforms = {
    uPlaneTable,
    uTime,
    uMultiverseAngle,
    uMotion,
    uHues: uniform(hues),
    uRaritySize: uniform([...RARITY_SIZE]),
    uStarDiameter: uniform(STAR_WORLD_DIAMETER),
    uSizeScale,
    uMinPixels,
    uMaxPixels,
    uHoverIndex,
  }

  const material = new ShaderMaterial({
    uniforms: starUniforms,
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    // PRD 5.2: stars are additive glows. Nothing in the field writes depth, so there is nothing to
    // sort and no order-dependent artefact to chase.
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })

  const idMaterial = new ShaderMaterial({
    // Same objects for the shared entries, its own minimum pixel size: a one-pixel star has to be
    // clickable even though it is drawn one pixel wide.
    uniforms: { ...starUniforms, uMinPixels: uPickMinPixels },
    defines: { ID_PASS: '' },
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: false,
    // The id pass *does* sort: the nearest star under the pointer is the one that was clicked.
    depthWrite: true,
    depthTest: true,
  })

  const points = new Points(geometry.geometry, material)
  points.frustumCulled = false
  points.matrixAutoUpdate = false
  points.layers.set(0)

  const pickPoints = new Points(geometry.geometry, idMaterial)
  pickPoints.frustumCulled = false
  pickPoints.matrixAutoUpdate = false
  pickPoints.layers.set(PICK_LAYER)

  const glow = createGlowMesh(table, noise, {
    uPlaneTable,
    uTime,
    uMultiverseAngle,
    uMotion,
  })

  return {
    points,
    pickPoints,
    glow,
    update(motion, drawingBufferHeight, fovRadians, pixelRatio) {
      uTime.value = table.time
      uMultiverseAngle.value = table.multiverseAngle
      uMotion.value = motion
      // World units to device pixels at one unit of depth. The vertex shader divides by -z.
      uSizeScale.value = drawingBufferHeight / (2 * Math.tan(fovRadians / 2))
      uMinPixels.value = STAR_MIN_PX * pixelRatio
      uMaxPixels.value = STAR_MAX_PX * pixelRatio
      uPickMinPixels.value = (pickSpriteFloorPx ?? PICK_MIN_PX) * pixelRatio
    },
    setHovered(index) {
      uHoverIndex.value = index
    },
    setPickSpriteFloorPx(px) {
      pickSpriteFloorPx = px
    },
    dispose() {
      material.dispose()
      idMaterial.dispose()
      glow.geometry.dispose()
      ;(glow.material as ShaderMaterial).dispose()
    },
  }
}

interface SharedUniforms {
  uPlaneTable: Uniform<Texture>
  uTime: Uniform<number>
  uMultiverseAngle: Uniform<number>
  uMotion: Uniform<number>
}

/**
 * One camera-facing quad per plane that has a glow — every plane except the Blind Eternities,
 * whose "radius" is the whole multiverse and which is drawn as dust instead.
 */
function createGlowMesh(table: PlaneTable, noise: Texture, shared: SharedUniforms): Mesh {
  const rows = table.planes
    .filter((state) => state.kind !== PlaneKindCode.Dust)
    .map((state) => state.record.index)

  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      // prettier-ignore
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.setAttribute('aPlaneRow', new InstancedBufferAttribute(Float32Array.from(rows), 1))
  geometry.instanceCount = rows.length
  geometry.boundingSphere = null

  const material = new ShaderMaterial({
    uniforms: {
      ...shared,
      uNoise: uniform(noise),
      uNebulaOpacity: uniform(NEBULA_OPACITY),
      uEmptyOpacity: uniform(EMPTY_GLOW_OPACITY),
      uEmptyCore: uniform(EMPTY_GLOW_CORE),
    },
    vertexShader: GLOW_VERTEX_SHADER,
    fragmentShader: GLOW_FRAGMENT_SHADER,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  })

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  // Drawn before the stars purely for legibility in a frame capture; additive blending makes the
  // order immaterial.
  mesh.renderOrder = -1
  mesh.layers.set(0)
  return mesh
}
