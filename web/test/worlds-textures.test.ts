/**
 * The two array textures (spec §1.5, §1.6, §1.12).
 *
 * All of this is allocation, not rendering, so it is measured rather than pinned: a
 * `DataArrayTexture` is a typed array and a settings bag until a renderer uploads it. The one call
 * that genuinely needs GL — `uploadArtLayer` — is exercised against a stub renderer, which is
 * enough to catch the argument-order trap it exists to document and is honest about being nothing
 * more than that.
 *
 * The budget rows below are **recomputed from the allocations**, not restated from §1.12's table. A
 * table and a test that quote the same literal agree by construction; these two agree only if the
 * code allocates what the spec says it does.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  Vector3,
  type WebGLRenderer,
} from 'three'

import {
  createArtPoolTexture,
  createEquirectArray,
  uploadArtLayer,
  writeEquirectLayer,
} from '../src/scene/worlds/worldTextures'
import { ART_LAYER_HEIGHT, ART_LAYER_WIDTH } from '../src/scene/worlds/artStream'
import { EQUIRECT_HEIGHT, EQUIRECT_WIDTH } from '../src/scene/worlds/lod'
import { artPoolSize } from '../src/scene/worlds/artPool'

const MiB = 1024 * 1024

function worldsWithCards(role: string): number {
  const datasets = JSON.parse(
    readFileSync(resolve(__dirname, '../datasets.json'), 'utf8'),
  ) as Record<string, string>
  const file = JSON.parse(
    readFileSync(resolve(__dirname, '../public/data', datasets[role]!, 'planes.json'), 'utf8'),
  ) as { planes: { rowCells?: number[] }[] }
  return file.planes.filter((p) => Array.isArray(p.rowCells)).length
}

describe('§1.12 the allocations, and the budget rows that depend on them', () => {
  it('allocates the art pool at 128x96x4 per layer, no mips', () => {
    // §1.12's largest row: 1,024 x 128 x 96 x 4 = 48.00 MiB. Recomputed from the allocation, so a
    // change to the letterbox size moves this test rather than leaving the table quietly wrong.
    const pool = createArtPoolTexture(1024)!
    expect(pool.image.width).toBe(ART_LAYER_WIDTH)
    expect(pool.image.height).toBe(ART_LAYER_HEIGHT)
    expect(pool.image.depth).toBe(1024)
    expect(pool.image.data.byteLength).toBe(50331648)
    expect(pool.image.data.byteLength / MiB).toBeCloseTo(48.0, 6)
  })

  it('allocates the equirect array from the DATASET, not from a constant', () => {
    // §1.5/§3.1's normative claim, and the reason it is normative: a constant is right on exactly
    // one of the two datasets this renderer is guaranteed to meet.
    const v3 = worldsWithCards('worlds')
    expect(v3).toBe(45)
    const array = createEquirectArray(v3)!
    expect(array.image.depth).toBe(45)
    expect(array.image.width).toBe(EQUIRECT_WIDTH)
    expect(array.image.height).toBe(EQUIRECT_HEIGHT)
    expect(array.image.data.byteLength).toBe(5898240)
    expect(array.image.data.byteLength / MiB).toBeCloseTo(5.62, 2)

    // The 87-plane roster's row, for the same allocation — 29 layers / 3.62 MiB.
    expect(createEquirectArray(29)!.image.data.byteLength / MiB).toBeCloseTo(3.62, 2)
  })

  it('reproduces the §1.12 total from the parts it allocates', () => {
    // Everything except the two rows this module does not own (printing ring, focused card).
    const pool = createArtPoolTexture(1024)!.image.data.byteLength
    const equirect = createEquirectArray(45)!.image.data.byteLength
    const cells = 24399 * 40
    const ring = 72 * 146 * 204 * 4
    const card = 672 * 936 * 4
    const total = pool + equirect + cells + ring + card
    expect(total).toBe(68299608)
    expect(total / MiB).toBeCloseTo(65.14, 2)
    expect(96 - total / MiB).toBeGreaterThan(30)
  })
})

describe('§1.12 the defaults three would otherwise pick', () => {
  it('turns mipmaps off AND moves minFilter off the mipmap default, together', () => {
    // Half of this is the trap. `generateMipmaps = false` with three's default
    // LinearMipmapLinearFilter leaves the texture incomplete, and an incomplete texture samples
    // opaque black: every cell that resolves to art goes black, every cell still on its swatch
    // looks right, and it reads as an art-stream bug.
    for (const texture of [createArtPoolTexture(4)!, createEquirectArray(4)!]) {
      expect(texture.generateMipmaps).toBe(false)
      expect(texture.minFilter).toBe(LinearFilter)
      expect(texture.minFilter).not.toBe(LinearMipmapLinearFilter)
      expect(texture.magFilter).toBe(LinearFilter)
      expect(texture.wrapS).toBe(ClampToEdgeWrapping)
      expect(texture.wrapT).toBe(ClampToEdgeWrapping)
    }
  })

  it('leaves flipY off, because the fragment shader is what flips V', () => {
    // §1.4's sampler does the flip. Setting this instead would not work — a DataArrayTexture
    // ignores UNPACK_FLIP_Y_WEBGL — and would leave the shader's flip as a double negative.
    expect(createArtPoolTexture(4)!.flipY).toBe(false)
    expect(createEquirectArray(4)!.flipY).toBe(false)
  })

  it('tags the art sRGB and the bake linear, because only one of them is encoded', () => {
    // `art_crop` is sRGB JPEG; `bakeEquirectLayer` writes iSwatch's LINEAR rgb through a plain
    // x255. Tagging the bake sRGB has the hardware decode values that were never encoded, and the
    // error appears only inside §1.5's crossover band, as a brightness step mid-fade.
    expect(createArtPoolTexture(4)!.colorSpace).toBe(SRGBColorSpace)
    expect(createEquirectArray(4)!.colorSpace).toBe(NoColorSpace)
  })
})

describe('§1.6 a pool of no layers is legal', () => {
  it('allocates nothing rather than a placeholder layer', () => {
    // `artPoolSize` returns 0 on a lost context, on a non-WebGL2 one, and for ?layers=0. §1.4's
    // shading path already degrades to swatch-only, so there is nothing for a placeholder to fix.
    expect(createArtPoolTexture(0)).toBeNull()
    expect(createArtPoolTexture(artPoolSize(512, 0))).toBeNull()
    expect(createEquirectArray(0)).toBeNull()
  })

  it('still allocates a pool wherever the clamp leaves one', () => {
    // The expected-GREEN control for the row above: a test that only ever saw null would pass
    // against a function that always returned it.
    expect(createArtPoolTexture(artPoolSize(512, 256))!.image.depth).toBe(224)
    expect(createArtPoolTexture(artPoolSize(1024, 2048))!.image.depth).toBe(1024)
  })
})

describe('§1.5 writing a baked layer', () => {
  it('lands layer N at offset N, leaving its neighbours alone', () => {
    const stride = EQUIRECT_WIDTH * EQUIRECT_HEIGHT * 4
    const array = createEquirectArray(3)!
    writeEquirectLayer(array, 1, new Uint8Array(stride).fill(7))
    const data = array.image.data as Uint8Array
    expect(data[0]).toBe(0)
    expect(data[stride]).toBe(7)
    expect(data[stride * 2 - 1]).toBe(7)
    expect(data[stride * 2]).toBe(0)
  })

  it('refuses a layer that is the wrong size or outside the allocation', () => {
    // Both would otherwise corrupt a neighbouring world's bake rather than fail — `set` throws only
    // when it runs off the end of the whole array, not off the end of one layer's slice.
    const array = createEquirectArray(2)!
    expect(() => writeEquirectLayer(array, 0, new Uint8Array(16))).toThrow(/bytes/)
    expect(() =>
      writeEquirectLayer(array, 2, new Uint8Array(EQUIRECT_WIDTH * EQUIRECT_HEIGHT * 4)),
    ).toThrow(/outside/)
  })
})

describe('§1.6 streaming one layer', () => {
  it('copies to (0, 0, layer) in the order three r165 expects', () => {
    // The trap this documents: three changed the signature to (src, dst, srcRegion, dstPosition)
    // and warns once rather than throwing, so a call left in the old order silently copies nothing.
    const copy = vi.fn()
    const renderer = { copyTextureToTexture: copy } as unknown as WebGLRenderer
    const pool = createArtPoolTexture(8)!
    const source = new Texture()
    uploadArtLayer(renderer, pool, 5, source)

    expect(copy).toHaveBeenCalledOnce()
    const call = copy.mock.calls[0] as unknown[]
    expect(call[0]).toBe(source)
    expect(call[1]).toBe(pool)
    expect(call[2]).toBeNull()
    expect(call[3]).toEqual(new Vector3(0, 0, 5))
  })

  it('refuses a layer outside the pool instead of copying past its end', () => {
    const copy = vi.fn()
    const renderer = { copyTextureToTexture: copy } as unknown as WebGLRenderer
    const pool = createArtPoolTexture(8)!
    expect(() => uploadArtLayer(renderer, pool, 8, new Texture())).toThrow(/outside/)
    expect(copy).not.toHaveBeenCalled()
  })
})
