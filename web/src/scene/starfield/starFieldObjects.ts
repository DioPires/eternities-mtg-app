/**
 * The three.js object graph of the star field: one `Points` for the picture, one for the id buffer,
 * one for the bloom source, and one instanced quad for the nebulae and zero-card glows.
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
  Uniform,
} from 'three'

import { PICK_LAYER } from '../picking/idPicker'
import type { ProgramWarmupSpec } from '../platform/programWarmup'
import { BLOOM_LAYER } from '../post/bloomLayer'
import type { GlowQuality } from '../quality/adaptiveQuality'
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
  THUMBNAIL_FADE_FULL_PX,
  THUMBNAIL_FADE_START_PX,
} from '../tuning'
import {
  SHADER_NAME_PLANE_GLOW,
  SHADER_NAME_PLANE_GLOW_CHEAP,
  SHADER_NAME_STAR_FIELD,
  SHADER_NAME_STAR_FIELD_PICK,
} from '../shaderNames'
import { PlaneKindCode } from './motion'
import type { PlaneTable } from './planeTable'
import {
  GLOW_CHEAP_FRAGMENT_SHADER,
  GLOW_FRAGMENT_SHADER,
  GLOW_VERTEX_SHADER,
  STAR_FRAGMENT_SHADER,
  STAR_VERTEX_SHADER,
} from './shaders'
import type { StarGeometry } from './starGeometry'

export interface StarField {
  /** The drawn star field (PRD 8.5.1), on the default layer. */
  readonly points: Points
  /** The same geometry and the same vertex program, writing ids (PRD 8.5.6). Pick layer only. */
  readonly pickPoints: Points
  /**
   * The same geometry and the same programs again, into PRD 5.3.20's bloom source (DEC-703). Bloom
   * layer only, so the post chain's source pass draws it and the main pass does not.
   *
   * A separate object rather than a second layer on {@link StarField.points} because the sprite
   * sizes are in device pixels and the source is a smaller target — see `uBloomSizeScale`.
   *
   * This is what "selective" costs now: one more draw of the field at half resolution, against the
   * old chain's extra full-resolution scene render plus a depth pass and a mask pass — for a
   * selection that review finding R4 showed was inert anyway.
   */
  readonly bloomPoints: Points
  /**
   * PRD 5.3.19 nebulae and PRD 5.3.6 zero-card glows, one instanced draw call — on layer 0 *and*
   * the bloom layer, so the post chain's source pass draws the same mesh again (DEC-703).
   */
  readonly glow: Mesh

  /**
   * Push the frame's shared state into the uniforms. One call per frame, no allocation.
   *
   * `drawingBufferHeight` and `fovRadians` turn world-unit star diameters into device pixels;
   * `pixelRatio` keeps the minimum and maximum sizes fixed in CSS pixels as the ratio adapts
   * (PRD 8.5.11). `bloomScale` is the live tier's, and sizes the same quantities for the bloom
   * source, which is a smaller target — see the uniform block in `createStarField`.
   *
   * `maxPointSizePx` is `ALIASED_POINT_SIZE_RANGE`'s upper bound, from
   * `../platform/capabilities` (DEC-739, review §3.7). Every size below is clamped to it rather
   * than merely asked for: `gl_PointSize` is silently clamped by the driver, and the three
   * platforms in scope report 1024 (ANGLE D3D11), 511 (ANGLE Metal) and **64** (Firefox on Apple's
   * native GL). At dpr 4 the app's own 22 CSS-pixel ceiling asks for 88, which that last platform
   * would quietly refuse — drawing every large mythic at the same size with nothing saying so.
   * Clamping here makes the app's number and the driver's number the same number.
   */
  update(
    motion: number,
    drawingBufferHeight: number,
    fovRadians: number,
    pixelRatio: number,
    bloomScale: number,
    maxPointSizePx: number,
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

  /**
   * The quality ladder's bottom rung (DEC-739): which of the two glow programs the mesh draws with.
   *
   * A material swap, not a define flip. Setting `defines` on a live material and raising
   * `needsUpdate` re-links the program *on the next draw*, which is precisely the synchronous
   * first-use stall DEC-645 measured at 322-362 ms and `../platform/programWarmup` exists to move
   * off the frame path — so a rung meant to *recover* frames would cost several hundred
   * milliseconds the moment it fired. Both programs are built here and linked at boot; this
   * assignment is a pointer write.
   */
  setGlowQuality(quality: GlowQuality): void

  /**
   * Every program this field owns, for the boot-time warm-up (`../platform/programWarmup`).
   *
   * Listed here rather than gathered by traversing the objects, because two of the five are not
   * reachable that way: the glow's cheap variant is attached to nothing until the ladder's bottom
   * rung fires, and that is the rung whose whole purpose is to *recover* frames — linking a program
   * at the moment the monitor decides the machine is struggling is the worst available time.
   */
  readonly warmupSpecs: readonly ProgramWarmupSpec[]

  dispose(): void
}

export function createStarField(
  table: PlaneTable,
  geometry: StarGeometry,
  noise: Texture,
): StarField {
  // Shared by reference: one write per frame reaches every material that reads them.
  const uPlaneTable = new Uniform(table.texture)
  const uTime = new Uniform(0)
  const uMultiverseAngle = new Uniform(0)
  const uMotion = new Uniform(1)

  const uSizeScale = new Uniform(1)
  const uMinPixels = new Uniform(STAR_MIN_PX)
  const uMaxPixels = new Uniform(STAR_MAX_PX)
  const uPickMinPixels = new Uniform(PICK_MIN_PX)
  const uHoverIndex = new Uniform(-1)
  const uThumbStartPx = new Uniform(THUMBNAIL_FADE_START_PX)
  const uThumbFullPx = new Uniform(THUMBNAIL_FADE_FULL_PX)
  /** `null` means "use `PICK_MIN_PX`". See `setPickSpriteFloorPx`. */
  let pickSpriteFloorPx: number | null = null

  /*
   * The bloom pass's own copies of every uniform measured in *device pixels* (DEC-703).
   *
   * The bloom source is a smaller target than the drawing buffer — half of it at the top of the
   * ladder, a quarter two rungs down — and `gl_PointSize` is in device pixels of whatever target is
   * bound. Sharing `uSizeScale` with the main pass would draw every star sprite at twice its
   * angular size in the source, so the bloom would be a halo around a star twice as wide as the one
   * on screen. The old chain never had this problem because it derived its source *from* the scene
   * buffer by downsampling; drawing the source directly is what makes the scale explicit.
   *
   * The rule is one line: everything in device pixels scales with the target. That includes PRD
   * 5.5.1's cross-fade band, because the band is compared against the same `pixels` value the
   * vertex shader computes from `uSizeScale` — leave it unscaled and a star would fade into its
   * thumbnail at a different distance in the bloom than in the picture.
   */
  const uBloomSizeScale = new Uniform(1)
  const uBloomMinPixels = new Uniform(STAR_MIN_PX)
  const uBloomMaxPixels = new Uniform(STAR_MAX_PX)
  const uBloomThumbStartPx = new Uniform(THUMBNAIL_FADE_START_PX)
  const uBloomThumbFullPx = new Uniform(THUMBNAIL_FADE_FULL_PX)

  const hues = HUE_COLOURS.map(([r, g, b]) => new Color(r, g, b))
  const starUniforms = {
    uPlaneTable,
    uTime,
    uMultiverseAngle,
    uMotion,
    uHues: new Uniform(hues),
    uRaritySize: new Uniform([...RARITY_SIZE]),
    uStarDiameter: new Uniform(STAR_WORLD_DIAMETER),
    uSizeScale,
    uMinPixels,
    uMaxPixels,
    uHoverIndex,
    uThumbStartPx,
    uThumbFullPx,
  }

  const material = new ShaderMaterial({
    // `shaderNames.ts` has the why: three writes this into the shader header, and a material
    // without one links a program no profile can attribute.
    name: SHADER_NAME_STAR_FIELD,
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
    name: SHADER_NAME_STAR_FIELD_PICK,
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

  /*
   * The bloom source's stars: the same programs, the same blending, the same picture — at the
   * bloom target's resolution.
   *
   * Deliberately *not* thresholded here. The post chain applies PRD 5.3.20's threshold to the
   * accumulated source in its first downsample, because that is what the old chain did (it
   * thresholded the composited scene buffer) and a cluster of faint stars has to be able to sum
   * over the threshold together. Thresholding each sprite on its own was measured against the old
   * chain and lost the bloom off every dense cluster core — see `POST_DOWNSAMPLE_FRAGMENT_SHADER`.
   *
   * So the only difference from `material` is the five uniforms measured in device pixels.
   */
  const bloomMaterial = new ShaderMaterial({
    // The same name as `material` on purpose: same source, same (absent) defines, so three.js
    // links one program for both and a second name would describe nothing. See `shaderNames.ts`.
    name: SHADER_NAME_STAR_FIELD,
    uniforms: {
      ...starUniforms,
      uSizeScale: uBloomSizeScale,
      uMinPixels: uBloomMinPixels,
      uMaxPixels: uBloomMaxPixels,
      uThumbStartPx: uBloomThumbStartPx,
      uThumbFullPx: uBloomThumbFullPx,
    },
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })

  const points = new Points(geometry.geometry, material)
  points.frustumCulled = false
  points.matrixAutoUpdate = false
  points.layers.set(0)

  const pickPoints = new Points(geometry.geometry, idMaterial)
  pickPoints.frustumCulled = false
  pickPoints.matrixAutoUpdate = false
  pickPoints.layers.set(PICK_LAYER)

  const bloomPoints = new Points(geometry.geometry, bloomMaterial)
  bloomPoints.frustumCulled = false
  bloomPoints.matrixAutoUpdate = false
  bloomPoints.layers.set(BLOOM_LAYER)

  const { mesh: glow, materials: glowMaterials } = createGlowMesh(table, noise, {
    uPlaneTable,
    uTime,
    uMultiverseAngle,
    uMotion,
  })

  return {
    points,
    pickPoints,
    bloomPoints,
    glow,
    // The star geometry for the three point programs, the glow's own instanced geometry for the
    // two quad ones. `bloomMaterial` shares a program with `material` (same source, same absent
    // defines — see `shaderNames.ts`), so warming it is a cache hit; it is listed anyway because
    // "the bloom copy happens to share a program" is a fact about three's cache key, not a promise
    // this file is making.
    warmupSpecs: [
      { geometry: geometry.geometry, material, points: true },
      { geometry: geometry.geometry, material: idMaterial, points: true },
      { geometry: geometry.geometry, material: bloomMaterial, points: true },
      { geometry: glow.geometry, material: glowMaterials.full },
      { geometry: glow.geometry, material: glowMaterials.cheap },
    ],
    update(motion, drawingBufferHeight, fovRadians, pixelRatio, bloomScale, maxPointSizePx) {
      uTime.value = table.time
      uMultiverseAngle.value = table.multiverseAngle
      uMotion.value = motion
      // World units to device pixels at one unit of depth. The vertex shader divides by -z.
      uSizeScale.value = drawingBufferHeight / (2 * Math.tan(fovRadians / 2))
      // Every sprite size is in device pixels and every one of them is clamped to what the driver
      // will actually rasterise. See the note on `maxPointSizePx` in the interface above; the floor
      // is clamped too, because a floor above the driver's ceiling is a floor the driver ignores.
      uMinPixels.value = Math.min(STAR_MIN_PX * pixelRatio, maxPointSizePx)
      uMaxPixels.value = Math.min(STAR_MAX_PX * pixelRatio, maxPointSizePx)
      uPickMinPixels.value = Math.min(
        (pickSpriteFloorPx ?? PICK_MIN_PX) * pixelRatio,
        maxPointSizePx,
      )
      // PRD 5.5.1's threshold is 24 CSS pixels; `pixels` in the shader is device pixels, so the
      // band scales with the ratio exactly as the star size floors above it do.
      uThumbStartPx.value = THUMBNAIL_FADE_START_PX * pixelRatio
      uThumbFullPx.value = THUMBNAIL_FADE_FULL_PX * pixelRatio

      // The bloom source, in its own device pixels. One multiply each, from the values just
      // written, so the two passes cannot disagree about anything but the resolution.
      uBloomSizeScale.value = uSizeScale.value * bloomScale
      uBloomMinPixels.value = uMinPixels.value * bloomScale
      uBloomMaxPixels.value = uMaxPixels.value * bloomScale
      uBloomThumbStartPx.value = uThumbStartPx.value * bloomScale
      uBloomThumbFullPx.value = uThumbFullPx.value * bloomScale
    },
    setHovered(index) {
      uHoverIndex.value = index
    },
    setPickSpriteFloorPx(px) {
      pickSpriteFloorPx = px
    },
    setGlowQuality(quality) {
      glow.material = quality === 'cheap' ? glowMaterials.cheap : glowMaterials.full
    },
    dispose() {
      material.dispose()
      idMaterial.dispose()
      bloomMaterial.dispose()
      glow.geometry.dispose()
      // Both, not `glow.material`: the mesh holds whichever rung was last in force, and disposing
      // only that one leaks the other's program and uniforms for the life of the context.
      glowMaterials.full.dispose()
      glowMaterials.cheap.dispose()
    },
  }
}

interface SharedUniforms {
  uPlaneTable: Uniform<Texture>
  uTime: Uniform<number>
  uMultiverseAngle: Uniform<number>
  uMotion: Uniform<number>
}

/** The mesh and both of its interchangeable fragment programs. See {@link StarField.setGlowQuality}. */
interface GlowMesh {
  readonly mesh: Mesh
  readonly materials: { readonly full: ShaderMaterial; readonly cheap: ShaderMaterial }
}

/**
 * One camera-facing quad per plane that has a glow — every plane except the Blind Eternities,
 * whose "radius" is the whole multiverse and which is drawn as dust instead.
 *
 * Drawn twice per frame since DEC-703 — once into the picture and once into the bloom source —
 * from one mesh on two layers. See the layer enable at the end of this function.
 *
 * **Two materials since DEC-739.** The ladder's bottom rung swaps the fragment program for a
 * one-tap, no-dither variant; both are built here so that both are linked at boot and the swap
 * costs nothing. They share every uniform *object*, so the rung changes which program runs and
 * nothing about what it is told.
 */
function createGlowMesh(table: PlaneTable, noise: Texture, shared: SharedUniforms): GlowMesh {
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

  const glowUniforms = {
    ...shared,
    uNoise: new Uniform(noise),
    uNebulaOpacity: new Uniform(NEBULA_OPACITY),
    uEmptyOpacity: new Uniform(EMPTY_GLOW_OPACITY),
    uEmptyCore: new Uniform(EMPTY_GLOW_CORE),
  }

  /*
   * Everything except the name and the fragment source is identical between the ladder's two glow
   * programs, so it is written once and spread into both: a rung that accidentally changed the
   * blending or the side would change the picture in a way nothing here is measuring.
   *
   * Spread into two inline literals rather than returned from a `glowMaterial(name, source)`
   * factory, and `test/shader-names.test.ts` is why. That test reads `material.name` **out of the
   * source text** — it has no GL context to ask — so a site whose name arrives through a parameter
   * is a site it cannot check, and its own failure message says to give the site an inline literal
   * rather than to relax the match. Two `name:` literals here is the price of the guard staying
   * able to see them.
   */
  const glowShared = {
    // The same uniform *objects*, by reference, so the per-frame writes in `update` reach whichever
    // program the ladder has selected without the caller knowing which that is.
    uniforms: glowUniforms,
    vertexShader: GLOW_VERTEX_SHADER,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
  } as const

  const material = new ShaderMaterial({
    name: SHADER_NAME_PLANE_GLOW,
    fragmentShader: GLOW_FRAGMENT_SHADER,
    ...glowShared,
  })

  const cheapMaterial = new ShaderMaterial({
    name: SHADER_NAME_PLANE_GLOW_CHEAP,
    fragmentShader: GLOW_CHEAP_FRAGMENT_SHADER,
    ...glowShared,
  })

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  // Drawn before the stars purely for legibility in a frame capture; additive blending makes the
  // order immaterial.
  mesh.renderOrder = -1
  mesh.layers.set(0)
  // ...and again into PRD 5.3.20's bloom source (DEC-703). *The same object*, not a copy: a glow
  // quad's size comes from the plane table in world units, so its projected size scales with the
  // target on its own and there is nothing to give the bloom pass a second value of. The star
  // field cannot do this — see `uBloomSizeScale` and the sprite sizes in `createStarField`.
  mesh.layers.enable(BLOOM_LAYER)

  return { mesh, materials: { full: material, cheap: cheapMaterial } }
}
