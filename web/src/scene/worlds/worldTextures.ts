/**
 * The two `TEXTURE_2D_ARRAY`s a world's surface samples (spec §1.5, §1.6, §1.12).
 *
 * The **art pool** is 128×96 layers of `art_crop`, streamed in one layer at a time; the **equirect
 * swatch array** is 256×128 layers baked client-side from `swatches.bin`, one per world with cards.
 * They are separate texture objects on purpose: `MAX_ARRAY_TEXTURE_LAYERS` is a *per-texture* limit,
 * not a global pool, so the bake takes nothing from the art pool's allowance (§1.6).
 *
 * Allocation is where this path's budget-invalidating defaults live, and none of them announce
 * themselves — three's own defaults would silently triple the pool's memory, sample it black, and
 * gamma-shift the bake. Each is set explicitly below with the failure it prevents.
 */

import {
  ClampToEdgeWrapping,
  type DataArrayTexture as DataArrayTextureType,
  DataArrayTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector3,
  type WebGLRenderer,
} from 'three'

import { ART_LAYER_HEIGHT, ART_LAYER_WIDTH } from './artStream'
import { EQUIRECT_HEIGHT, EQUIRECT_WIDTH } from './lod'

/**
 * Apply the settings both arrays share, and that three's defaults get wrong.
 *
 * > **Normative — `generateMipmaps = false` and a non-mipmap `minFilter`, together (§1.12).**
 * > three's default `minFilter` is `LinearMipmapLinearFilter`. Turning mipmaps off and leaving that
 * > default makes the texture **incomplete**, and an incomplete texture samples as opaque black —
 * > every cell that resolves to art goes black while every cell still on its swatch looks right,
 * > which reads as an art-stream bug rather than as an allocation one. Leaving mipmaps *on* instead
 * > is the other half: it costs a third again on top of every byte in §1.12's table, and the table's
 * > 48.00 MiB art-pool row — the largest in the budget — is written "no mips" for that reason.
 * > Neither half is visible on the machine that sets it.
 *
 * `ClampToEdgeWrapping` because a letterboxed art layer must not bleed its neighbour's pillarbox
 * across the seam, and because the equirect's `u` wrap is handled in the sampler's own
 * parameterisation rather than by the wrap mode.
 */
function configureArray(texture: DataArrayTextureType): DataArrayTextureType {
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  // A DataArrayTexture ignores UNPACK_FLIP_Y_WEBGL, which is why §1.4's fragment shader flips V in
  // the sampler. Stating the default here so that "fixing" the flip by setting this instead is a
  // visible edit rather than a quiet one — it would not work, and the shader would then be wrong.
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/**
 * The art pool: `layers` of 128×96 RGBA8, or `null` for a pool of none.
 *
 * > **Normative — a zero-layer pool is legal, and is not a black world (§1.6).** `artPoolSize`
 * > returns 0 on a lost context, on a non-WebGL2 one, and whenever `?layers=0` asks for it. §1.4's
 * > shading path already degrades to swatch-only when no cell holds a layer, so the answer is to
 * > allocate nothing and bind nothing — not to allocate a one-layer texture so the uniform has
 * > something to point at.
 *
 * @param layers the **clamped** count from `artPoolSize`, never a tier constant (§1.12)
 */
export function createArtPoolTexture(layers: number): DataArrayTextureType | null {
  if (layers <= 0) return null
  const texture = new DataArrayTexture(
    new Uint8Array(ART_LAYER_WIDTH * ART_LAYER_HEIGHT * 4 * layers),
    ART_LAYER_WIDTH,
    ART_LAYER_HEIGHT,
    layers,
  )
  texture.format = RGBAFormat
  texture.type = UnsignedByteType
  // `art_crop` is sRGB-encoded JPEG. three picks the SRGB8_ALPHA8 internal format from this, so the
  // decode is free and happens in hardware; leaving it linear would show every card's art washed
  // out, which reads as a tone-mapping problem three passes downstream.
  texture.colorSpace = SRGBColorSpace
  return configureArray(texture)
}

/**
 * The equirect swatch array: one 256×128 RGBA8 layer per world with cards.
 *
 * > **Normative — the layer count comes from the dataset, never from a constant (§1.5, §3.1).** It
 * > is 29 on the 87-plane roster and **45** on v3, and those are the two datasets this renderer is
 * > guaranteed to meet. A constant is right on exactly one of them: sized at 29 it drops 16 worlds'
 * > bakes on the floor, and sized at 45 it wastes 2.0 MiB on the old one. §1.12's budget calls this
 * > one of its two dataset-dependent rows for the same reason.
 *
 * > **Normative — the bake is linear, so this array is not sRGB.** `bakeEquirectLayer` writes
 * > `iSwatch`'s own **linear** RGB through a plain ×255, matching the sheet's per-instance swatch
 * > exactly — that is the whole point of the crossover cross-fading between the two. Tagging it
 * > sRGB, as the art pool correctly is, would have the hardware decode values that were never
 * > encoded and darken every distant world against its own near representation. The error appears
 * > *only* inside §1.5's crossover band, as a brightness step mid-fade.
 */
export function createEquirectArray(worldsWithCards: number): DataArrayTextureType | null {
  if (worldsWithCards <= 0) return null
  const texture = new DataArrayTexture(
    new Uint8Array(EQUIRECT_WIDTH * EQUIRECT_HEIGHT * 4 * worldsWithCards),
    EQUIRECT_WIDTH,
    EQUIRECT_HEIGHT,
    worldsWithCards,
  )
  texture.format = RGBAFormat
  texture.type = UnsignedByteType
  texture.colorSpace = NoColorSpace
  return configureArray(texture)
}

/**
 * Write one baked layer into the equirect array.
 *
 * Straight into the backing store rather than through `copyTextureToTexture`, because the bake runs
 * at load, off the GPU, and all 45 layers are written before the first frame — there is no partial
 * upload to optimise and no renderer to hand it to yet. The art pool is the opposite case, and gets
 * the opposite treatment.
 */
export function writeEquirectLayer(
  texture: DataArrayTextureType,
  layer: number,
  bake: Uint8Array,
): void {
  const stride = EQUIRECT_WIDTH * EQUIRECT_HEIGHT * 4
  if (bake.length !== stride) {
    throw new Error(`equirect layer must be ${stride} bytes, got ${bake.length}`)
  }
  if (layer < 0 || layer >= texture.image.depth) {
    throw new Error(`equirect layer ${layer} outside the ${texture.image.depth} allocated`)
  }
  ;(texture.image.data as Uint8Array).set(bake, layer * stride)
  texture.needsUpdate = true
}

/**
 * Stream one card's art into its pool layer — a `texSubImage3D` of **one layer** (§1.6).
 *
 * > **Normative — this is why the pool is an array texture and not an atlas canvas (§1.6).** The
 * > `dstPosition` of `(0, 0, layer)` is what keeps streaming a card in from re-uploading the pool.
 * > Re-uploading 48 MiB to land 48 KiB would not fail any test written here; it would show up only
 * > as a hitch on the machine with the slowest bus, which is not the machine anyone develops on.
 *
 * Note the argument order: three r165 changed `copyTextureToTexture` from
 * `(position, src, dst, level)` to `(src, dst, srcRegion, dstPosition, level)` and warns once at
 * runtime rather than throwing. A call left in the old order silently copies nothing.
 *
 * > **The destination is `letterbox`'s origin, not (0, 0) (DEC-749).** `art_crop` is 626x457 against
 * > a 128x96 layer, so a fitted bitmap is 128x93 and `letterbox` centres it with one texel of bar
 * > top and two bottom. Uploading at the layer's origin instead shifts every card's art up by a
 * > texel *and* leaves the bottom three rows holding whatever the layer's previous tenant put there
 * > — a thin band of a different card along one edge of every cell, which reads as a seam in the
 * > mosaic rather than as a texture bug. The default is the origin only so the pure-arithmetic
 * > callers that have no box need not invent one.
 */
export function uploadArtLayer(
  renderer: WebGLRenderer,
  pool: DataArrayTextureType,
  layer: number,
  source: Texture,
  origin: { readonly x: number; readonly y: number } = ORIGIN,
): void {
  if (layer < 0 || layer >= pool.image.depth) {
    throw new Error(`art layer ${layer} outside the ${pool.image.depth} allocated`)
  }
  renderer.copyTextureToTexture(source, pool, null, new Vector3(origin.x, origin.y, layer))
}

const ORIGIN = { x: 0, y: 0 } as const

/** The array-texture type these allocators return, for the callers that hold one. */
export type { DataArrayTextureType }
