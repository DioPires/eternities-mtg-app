/**
 * Phase 3's Node-side tests: the parts of the card tier that are arithmetic or policy rather than
 * pixels.
 *
 * What is deliberately not here, for the same reason `starfield.test.ts` says it: whether the
 * thumbnail quad lands on the star it replaced. That is a GPU claim, and it is made in the browser
 * by `scripts/verify-browser.mjs`. What *is* here is everything a wrong answer would be invisible
 * in: the atlas's cell geometry, the LRU's eviction rule, the six-request cap, the ring layout, the
 * GPU budget arithmetic and the tilt spring.
 */

import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { BufferGeometry, Mesh, Points, Texture, Vector4, WebGLRenderer } from 'three'

import { ATLAS_BYTES, ATLAS_CELLS, ATLAS_COLUMNS, ThumbnailAtlas } from '../src/scene/cards/atlas'
import {
  FocusedCard,
  stepSpring,
  worstCaseCardBytes,
  PLANET_ID_BASE,
  PRINTING_IMAGE_HEIGHT,
  PRINTING_IMAGE_WIDTH,
} from '../src/scene/cards/focusedCard'
import {
  PLANET_FRAGMENT_SHADER,
  PLANET_VERTEX_SHADER,
} from '../src/scene/cards/cardShaders'
import { glslFloat } from '../src/scene/starfield/shaders'
import type { CardRecord, PrintingTuple } from '../src/data/types'
import {
  GPU_CEILING_BYTES,
  GPU_TARGET_BYTES,
  WORST_CASE,
  gpuMemoryReport,
  textureBytes,
  worstCaseReport,
} from '../src/scene/cards/gpuMemory'
import { ImageQueue } from '../src/scene/cards/imageQueue'
import { planetLayout, planetPosition } from '../src/scene/cards/planets'
import {
  pickedStarIndex,
  resolvePick,
  samePick,
  type PickResult,
} from '../src/scene/picking/scenePicker'
import { PICK_BUSY, PICK_LAYER, PICK_MISS } from '../src/scene/picking/idPicker'
import { cardEdgeGeometry, cardFaceGeometry } from '../src/scene/cards/roundedRect'
import {
  ATLAS_CELL_HEIGHT,
  ATLAS_CELL_WIDTH,
  ATLAS_SIZE,
  CARD_HEIGHT,
  CARD_TILT_MAX_RAD,
  CARD_WIDTH,
  IMAGE_CONCURRENCY,
  PLANETS_PER_RING,
  PLANET_CAP,
  PLANET_PERIOD_S,
  PLANET_QUAD_HEIGHT,
  PLANET_QUAD_WIDTH,
  PLANET_RING_RADII,
  PLANET_SMALL_HEIGHT,
  PLANET_SMALL_WIDTH,
  PLANET_TICK_RADIUS,
  THUMBNAIL_FADE_FULL_PX,
  THUMBNAIL_GRACE_S,
} from '../src/scene/tuning'

describe('PRD 8.5.8 atlas geometry', () => {
  it('is 4096² of 128 × 178 cells, base level only', () => {
    expect(ATLAS_SIZE).toBe(4096)
    expect(ATLAS_CELL_WIDTH).toBe(128)
    expect(ATLAS_CELL_HEIGHT).toBe(178)
    expect(ATLAS_COLUMNS).toBe(32)
    // 4096 / 178 is 23 whole rows; the remainder is unusable, not silently overlapped.
    expect(ATLAS_CELLS).toBe(32 * 23)
    // PRD 8.5.8 calls it "the atlas's 64 MB". One RGBA byte quadruple per texel, no chain.
    expect(ATLAS_BYTES).toBe(64 * 1024 * 1024)
  })

  it('holds the default capacity of 512 with room to spare', () => {
    expect(ATLAS_CELLS).toBeGreaterThanOrEqual(512)
  })
})

/**
 * The LRU, with no GPU in sight. `ThumbnailAtlas` allocates a `WebGLRenderTarget` in its
 * constructor, which is a plain object until a renderer touches it, so the eviction rule can be
 * exercised directly — and it is the rule, not the blit, that decides what the user sees.
 */
describe('PRD 5.5.4 thumbnail LRU', () => {
  const atlas = (capacity: number): ThumbnailAtlas => new ThumbnailAtlas(capacity)

  it('hands out a distinct cell per star until it is full', () => {
    const a = atlas(4)
    const slots = [10, 11, 12, 13].map((star) => a.claim(star, 0))
    expect(new Set(slots).size).toBe(4)
    expect(slots.every((slot) => slot >= 0)).toBe(true)
    expect(a.used).toBe(4)
  })

  it('refuses rather than evicting a cell whose fetch is still in flight', () => {
    const a = atlas(2)
    a.claim(1, 0)
    a.claim(2, 0)
    // Neither has been uploaded, so neither is evictable at any age: the bitmap coming back would
    // land in a cell somebody else now owns.
    expect(a.claim(3, THUMBNAIL_GRACE_S * 10)).toBe(-1)
  })

  it('keeps a cell that was visible within the grace period', () => {
    const a = atlas(1)
    const slot = a.claim(1, 0)
    a.upload = (() => true)
    markLoaded(a, slot)
    expect(a.claim(2, THUMBNAIL_GRACE_S - 0.1)).toBe(-1)
  })

  it('evicts the least recently visible loaded cell past the grace period, and says which', () => {
    const a = atlas(2)
    markLoaded(a, a.claim(1, 0))
    markLoaded(a, a.claim(2, 1))
    a.touch(2, 5)

    const evicted: number[] = []
    const slot = a.claim(3, 5 + THUMBNAIL_GRACE_S)
    a.claim(3, 5 + THUMBNAIL_GRACE_S, evicted)
    expect(slot).toBeGreaterThanOrEqual(0)
    // Star 1 was last seen at 0; star 2 at 5. The older one goes.
    expect(a.slotOf(1)).toBe(-1)
    expect(a.slotOf(2)).toBeGreaterThanOrEqual(0)
  })

  it('reports the evicted key so the star can stop pretending it has a thumbnail', () => {
    const a = atlas(1)
    markLoaded(a, a.claim(7, 0))
    const evicted: number[] = []
    a.claim(8, THUMBNAIL_GRACE_S + 1, evicted)
    expect(evicted).toEqual([7])
  })

  it('PRD 8.5.11: shrinking the capacity evicts everything above it', () => {
    const a = atlas(4)
    for (const star of [1, 2, 3, 4]) markLoaded(a, a.claim(star, 0))
    const evicted: number[] = []
    a.setCapacity(2, evicted)
    expect(a.capacity).toBe(2)
    expect(evicted.length).toBe(2)
    expect(a.used).toBe(2)
    // Growing again is not retroactive; it just makes room.
    a.setCapacity(4)
    expect(a.capacity).toBe(4)
  })

  it('maps a cell to a rectangle inside the atlas that does not overlap its neighbour', () => {
    const a = atlas(ATLAS_CELLS)
    const first = { u: 0, v: 0, du: 0, dv: 0 }
    const second = { u: 0, v: 0, du: 0, dv: 0 }
    a.cellUv(0, first)
    a.cellUv(1, second)
    expect(first.u).toBe(0)
    expect(first.v).toBe(0)
    expect(first.du).toBeCloseTo(ATLAS_CELL_WIDTH / ATLAS_SIZE, 12)
    expect(second.u).toBeCloseTo(first.u + first.du, 12)
    expect(second.v).toBe(first.v)

    // The last cell still fits.
    const last = { u: 0, v: 0, du: 0, dv: 0 }
    a.cellUv(ATLAS_CELLS - 1, last)
    expect(last.u + last.du).toBeLessThanOrEqual(1)
    expect(last.v + last.dv).toBeLessThanOrEqual(1)
  })
})

/**
 * The atlas blit's frame handling, which shipped inverted.
 *
 * `WebGLRenderer.setViewport`/`setScissor` take **CSS** pixels and multiply by the pixel ratio on
 * the way to GL; `getViewport`/`getScissor` hand the same CSS-pixel rectangle back. The blit passed
 * drawing-buffer pixels to both, so at a pixel ratio of 1.5 it wrote a 192 × 267 rectangle into a
 * 128 × 178 cell — overlapping its neighbours — and then left a 4320 × 2430 viewport on a
 * 2880 × 1620 buffer for the rest of the session, which drew the *whole scene* scaled about the
 * bottom-left corner from the first thumbnail on.
 *
 * The fake renderer below is three's own arithmetic, and the assertions are in GL pixels: what the
 * driver is actually handed.
 */
describe('PRD 8.5.8 atlas blit frame', () => {
  /** Just enough `WebGLRenderer` for `upload`, applying three's CSS-pixel → GL-pixel rule. */
  function fakeRenderer(pixelRatio: number, cssWidth: number, cssHeight: number) {
    const viewport = { x: 0, y: 0, width: cssWidth, height: cssHeight }
    const scissor = { ...viewport }
    let target: unknown = null
    let scissorTest = false
    const glRects: Array<{ target: unknown; x: number; y: number; width: number; height: number }> =
      []
    const toGl = (r: typeof viewport) => ({
      x: Math.round(r.x * pixelRatio),
      y: Math.round(r.y * pixelRatio),
      width: Math.round(r.width * pixelRatio),
      height: Math.round(r.height * pixelRatio),
    })
    const renderer = {
      getPixelRatio: () => pixelRatio,
      // In drawing-buffer pixels, as the real canvas is. Present so that reaching for it — which is
      // what the bug did — produces a wrong *measurement* here rather than a missing property.
      domElement: { width: cssWidth * pixelRatio, height: cssHeight * pixelRatio },
      getRenderTarget: () => target,
      setRenderTarget: (next: unknown) => {
        target = next
      },
      getScissorTest: () => scissorTest,
      setScissorTest: (next: boolean) => {
        scissorTest = next
      },
      getViewport: (out: { set: (x: number, y: number, z: number, w: number) => void }) => {
        out.set(viewport.x, viewport.y, viewport.width, viewport.height)
        return out
      },
      getScissor: (out: { set: (x: number, y: number, z: number, w: number) => void }) => {
        out.set(scissor.x, scissor.y, scissor.width, scissor.height)
        return out
      },
      setViewport: (x: number | Vector4, y?: number, w?: number, h?: number) => {
        if (typeof x === 'number') {
          viewport.x = x
          viewport.y = y!
          viewport.width = w!
          viewport.height = h!
        } else {
          viewport.x = x.x
          viewport.y = x.y
          viewport.width = x.z
          viewport.height = x.w
        }
      },
      setScissor: (x: number | Vector4, y?: number, w?: number, h?: number) => {
        if (typeof x === 'number') {
          scissor.x = x
          scissor.y = y!
          scissor.width = w!
          scissor.height = h!
        } else {
          scissor.x = x.x
          scissor.y = x.y
          scissor.width = x.z
          scissor.height = x.w
        }
      },
      render: () => {
        glRects.push({ target, ...toGl(viewport) })
      },
    }
    return {
      renderer: renderer as unknown as WebGLRenderer,
      glRects,
      glViewport: () => toGl(viewport),
      glScissor: () => toGl(scissor),
      renderTarget: () => target,
      scissorTest: () => scissorTest,
    }
  }

  const bitmap = (): ImageBitmap =>
    ({ width: 128, height: 178, close: () => {} })

  it('blits into the cell rectangle `cellUv` maps, at a fractional pixel ratio', () => {
    const atlas = new ThumbnailAtlas(ATLAS_CELLS)
    // 1.5 is the default quality tier's `pixelRatioCap`, which is where this was found.
    const fake = fakeRenderer(1.5, 1920, 1080)

    // Slot 0 and its right-hand neighbour, which the 1.5× rect used to run into.
    atlas.claim(0, 0)
    atlas.claim(1, 0)
    expect(atlas.upload(fake.renderer, 0, bitmap())).toBe(true)
    expect(atlas.upload(fake.renderer, 1, bitmap())).toBe(true)

    expect(fake.glRects).toHaveLength(2)
    expect(fake.glRects[0]).toMatchObject({
      x: 0,
      y: 0,
      width: ATLAS_CELL_WIDTH,
      height: ATLAS_CELL_HEIGHT,
    })
    expect(fake.glRects[1]).toMatchObject({
      x: ATLAS_CELL_WIDTH,
      y: 0,
      width: ATLAS_CELL_WIDTH,
      height: ATLAS_CELL_HEIGHT,
    })
    // The cells abut and do not overlap, in GL pixels.
    expect(fake.glRects[0]!.x + fake.glRects[0]!.width).toBe(fake.glRects[1]!.x)
    // Both were drawn into the atlas, not into the default framebuffer.
    expect(fake.glRects[0]!.target).toBe(atlas.target)
    atlas.dispose()
  })

  it('writes the image the right way up: the top row goes to the top of the cell', () => {
    // `UNPACK_FLIP_Y_WEBGL` is inert for an `ImageBitmap`, so texel row 0 is the image's *top* row
    // and `t = 0` samples it. A render target's texels run bottom-up and the ortho blit camera puts
    // the quad's `+y` at the top of the viewport, so the quad's top vertex must carry `t = 0`.
    // `PlaneGeometry`'s default is the opposite, and with it every thumbnail drew upside down.
    const atlas = new ThumbnailAtlas(4)
    const mesh = (atlas as unknown as { blitMesh: { geometry: BufferGeometry } }).blitMesh
    const position = mesh.geometry.getAttribute('position')
    const uv = mesh.geometry.getAttribute('uv')
    let checked = 0
    for (let i = 0; i < position.count; i += 1) {
      // Quad top → image top → t = 0. Quad bottom → image bottom → t = 1.
      expect(uv.getY(i)).toBeCloseTo(position.getY(i) > 0 ? 0 : 1, 9)
      // `u` is untouched: a horizontal flip would mirror every thumbnail.
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) > 0 ? 1 : 0, 9)
      checked += 1
    }
    expect(checked).toBe(4)
    atlas.dispose()
  })

  it('gives the caller back the exact frame it had, and its render target', () => {
    const atlas = new ThumbnailAtlas(ATLAS_CELLS)
    const fake = fakeRenderer(1.5, 1920, 1080)
    atlas.claim(7, 0)
    atlas.upload(fake.renderer, 7, bitmap())

    // 1920 × 1080 CSS at 1.5 is a 2880 × 1620 drawing buffer. The viewport left behind has to be
    // that, and not the 4320 × 2430 that passing drawing-buffer pixels to the restore produced.
    expect(fake.glViewport()).toEqual({ x: 0, y: 0, width: 2880, height: 1620 })
    expect(fake.glScissor()).toEqual({ x: 0, y: 0, width: 2880, height: 1620 })
    expect(fake.renderTarget()).toBeNull()
    expect(fake.scissorTest()).toBe(false)
    atlas.dispose()
  })

  it('leaves a caller who was already rendering somewhere else exactly as it found them', () => {
    const atlas = new ThumbnailAtlas(ATLAS_CELLS)
    const fake = fakeRenderer(2, 800, 600)
    // Something mid-pass: a half-frame viewport, a scissor, the test on, another target bound.
    const otherTarget = {}
    fake.renderer.setViewport(10, 20, 400, 300)
    fake.renderer.setScissor(11, 21, 401, 301)
    fake.renderer.setScissorTest(true)
    fake.renderer.setRenderTarget(otherTarget as never)

    atlas.claim(40, 0)
    atlas.upload(fake.renderer, 40, bitmap())

    expect(fake.glViewport()).toEqual({ x: 20, y: 40, width: 800, height: 600 })
    expect(fake.glScissor()).toEqual({ x: 22, y: 42, width: 802, height: 602 })
    expect(fake.scissorTest()).toBe(true)
    expect(fake.renderTarget()).toBe(otherTarget)
    atlas.dispose()
  })

  /**
   * DEC-697. A `Texture` per upload is a `glCreateTexture` + `texStorage2D` + `glDeleteTexture`
   * per thumbnail — a 91 KB allocate/free cycle each. A 110 s card-level session measured ~721 of
   * them: the fill, bounded by the tier's `thumbnailCapacity` of 512 rather than by `ATLAS_CELLS`,
   * plus every cell arriving after it. Fetch-bound and finite, not a steady rate: the burst landed
   * in the first seconds after `focusCard` and was at 0/s by second 35. One staging
   * texture makes every upload after the first a bare `texSubImage2D`, because three keys its GL
   * texture on the parameters and not on the image.
   */
  const stagingOf = (atlas: ThumbnailAtlas): Texture | null =>
    (atlas as unknown as { blitTexture: Texture | null }).blitTexture

  it('stages every upload through one texture rather than allocating one per thumbnail', () => {
    const atlas = new ThumbnailAtlas(ATLAS_CELLS)
    const fake = fakeRenderer(1, 1920, 1080)
    const closed: boolean[] = []
    const tracked = (): ImageBitmap => {
      const index = closed.push(false) - 1
      return {
        width: ATLAS_CELL_WIDTH,
        height: ATLAS_CELL_HEIGHT,
        close: () => {
          closed[index] = true
        },
      }
    }

    atlas.claim(0, 0)
    atlas.upload(fake.renderer, 0, tracked())
    const staging = stagingOf(atlas)
    expect(staging).not.toBeNull()

    const versionAfterFirst = staging!.source.version
    for (let key = 1; key < 5; key += 1) {
      atlas.claim(key, 0)
      expect(atlas.upload(fake.renderer, key, tracked())).toBe(true)
      // Same `Texture`, so three's cache key never moves and its GL storage is never reallocated.
      expect(stagingOf(atlas)).toBe(staging)
    }
    // Each upload still bumps the source version, or three would skip the re-upload entirely and
    // every cell after the first would hold the first thumbnail.
    expect(staging!.source.version).toBe(versionAfterFirst + 4)
    // The material keeps pointing at it: nulling `map` between uploads flipped `USE_MAP` on and
    // off and re-ran the program cache lookup every time.
    expect(
      (atlas as unknown as { blitMaterial: { map: Texture | null } }).blitMaterial.map,
    ).toBe(staging)
    // Still nothing outside the atlas holding a decoded image.
    expect(closed).toEqual([true, true, true, true, true])

    atlas.dispose()
  })

  it('reallocates the staging texture when a bitmap is not the cell size', () => {
    // `texSubImage2D` writes the image's own dimensions at offset 0 into storage sized by the
    // *first* bitmap. A smaller one would leave the previous thumbnail's pixels showing around it
    // and a larger one is a GL error, so a mismatch has to reallocate rather than reuse.
    const atlas = new ThumbnailAtlas(ATLAS_CELLS)
    const fake = fakeRenderer(1, 1920, 1080)
    const sized = (width: number, height: number): ImageBitmap => ({
      width,
      height,
      close: () => {},
    })

    atlas.claim(0, 0)
    atlas.upload(fake.renderer, 0, sized(ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT))
    const first = stagingOf(atlas)

    atlas.claim(1, 0)
    atlas.upload(fake.renderer, 1, sized(ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT - 1))
    expect(stagingOf(atlas)).not.toBe(first)

    // And back to the cell size: the new one is kept and reused from there.
    const second = stagingOf(atlas)
    atlas.claim(2, 0)
    atlas.upload(fake.renderer, 2, sized(ATLAS_CELL_WIDTH, ATLAS_CELL_HEIGHT - 1))
    expect(stagingOf(atlas)).toBe(second)

    atlas.dispose()
  })

  it('disposes the staging texture with the atlas', () => {
    const atlas = new ThumbnailAtlas(ATLAS_CELLS)
    const fake = fakeRenderer(1, 1920, 1080)
    atlas.claim(0, 0)
    atlas.upload(fake.renderer, 0, bitmap())
    const staging = stagingOf(atlas)!
    let disposed = false
    staging.addEventListener('dispose', () => {
      disposed = true
    })
    atlas.dispose()
    expect(disposed).toBe(true)
    expect(stagingOf(atlas)).toBeNull()
  })
})

/** `upload` needs a renderer; the flag it sets is what the LRU reads, so set it directly. */
function markLoaded(atlas: ThumbnailAtlas, slot: number): void {
  const cells = (atlas as unknown as { cells: Array<{ loaded: boolean }> }).cells
  const cell = cells[slot]
  if (cell) cell.loaded = true
}

describe('PRD 7.2 image concurrency', () => {
  function queue(options: {
    concurrency?: number
    onFetch?: (url: string) => void
    fail?: (url: string) => boolean
  }): { queue: ImageQueue; release: (url: string) => void; inFlight: () => number } {
    const pending = new Map<string, (value: Response) => void>()
    const q = new ImageQueue({
      ...(options.concurrency !== undefined && { concurrency: options.concurrency }),
      // Faithful in the one way that matters here: an aborted fetch rejects, which is what lets
      // `dispose` and `cancel` settle a request that is already in flight.
      fetchImpl: ((url: string, init?: { signal?: AbortSignal }) => {
        options.onFetch?.(url)
        return new Promise<Response>((resolve, reject) => {
          pending.set(url, resolve)
          init?.signal?.addEventListener('abort', () => {
            pending.delete(url)
            reject(new Error('aborted'))
          })
        })
      }) as unknown as typeof fetch,
      decode: () => Promise.resolve({ close: () => {} } as unknown as ImageBitmap),
    })
    return {
      queue: q,
      release: (url: string) => {
        const settle = pending.get(url)
        pending.delete(url)
        settle?.({
          ok: !options.fail?.(url),
          status: options.fail?.(url) ? 404 : 200,
          blob: () => Promise.resolve({} as Blob),
        } as unknown as Response)
      },
      inFlight: () => pending.size,
    }
  }

  it('never has more than six requests open (PRD 7.2: target 6, ceiling 8)', async () => {
    expect(IMAGE_CONCURRENCY).toBe(6)
    const started: string[] = []
    const harness = queue({ onFetch: (url) => started.push(url) })
    const promises = Array.from({ length: 20 }, (_, i) =>
      harness.queue.request({ key: `k${i}`, url: `u${i}`, priority: () => i }),
    )
    await Promise.resolve()
    expect(harness.inFlight()).toBe(6)
    expect(harness.queue.stats.inFlight).toBe(6)

    // Draining one lets exactly one more start.
    harness.release(started[0]!)
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.queue.stats.peakInFlight).toBe(6)

    for (const url of [...started]) harness.release(url)
    for (let i = 0; i < 40; i += 1) await Promise.resolve()
    harness.queue.dispose()
    await Promise.allSettled(promises)
  })

  it('takes the nearest waiting request next, re-reading the priority at dequeue (PRD 5.5.3)', async () => {
    const started: string[] = []
    let distance = 100
    const harness = queue({ concurrency: 1, onFetch: (url) => started.push(url) })

    void harness.queue.request({ key: 'a', url: 'a', priority: () => 0 })
    void harness.queue.request({ key: 'far', url: 'far', priority: () => distance })
    void harness.queue.request({ key: 'near', url: 'near', priority: () => 50 })
    await Promise.resolve()
    expect(started).toEqual(['a'])

    // The camera moved while they waited: 'far' is now the nearer of the two.
    distance = 1
    harness.release('a')
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(started[1]).toBe('far')
    harness.queue.dispose()
  })

  it('drops a request whose priority went null rather than spending a slot on it', async () => {
    const started: string[] = []
    const harness = queue({ concurrency: 1, onFetch: (url) => started.push(url) })
    void harness.queue.request({ key: 'a', url: 'a', priority: () => 0 })
    const dropped = harness.queue.request({ key: 'gone', url: 'gone', priority: () => null })
    await Promise.resolve()
    harness.release('a')
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    // 'dropped', not 'failed': the caller stopped wanting it, and asking again later is correct.
    // The thumbnail tier blacklists failures and not drops, so this distinction is load-bearing —
    // conflating them leaves a permanent hole wherever the camera once flew past.
    expect(await dropped).toEqual({ ok: false, reason: 'dropped' })
    expect(started).not.toContain('gone')
    expect(harness.queue.stats.failed).toBe(0)
    harness.queue.dispose()
  })

  // The two below are the same defect from either side, and neither is exotic: `priority()` returns
  // null whenever a cell was evicted or a card drifted out of the cross-fade band, so a dropped
  // entry sitting in front of a live one is the ordinary case on a moving camera. The test above
  // has only the dropped entry waiting, which is why it never caught either.
  it('drops an entry in front of the nearest one without dequeuing its neighbour (PRD 5.5.3)', async () => {
    const started: string[] = []
    const harness = queue({ concurrency: 1, onFetch: (url) => started.push(url) })

    void harness.queue.request({ key: 'a', url: 'a', priority: () => 0 })
    // Ordered so that the drop is at a lower index than the winner. A scan that records the
    // winner's *index* has that index shifted down by the splice, onto 'far'.
    void harness.queue.request({ key: 'dropme', url: 'dropme', priority: () => null })
    void harness.queue.request({ key: 'near', url: 'near', priority: () => 1 })
    void harness.queue.request({ key: 'far', url: 'far', priority: () => 5 })
    await Promise.resolve()
    expect(started).toEqual(['a'])

    harness.release('a')
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(started[1]).toBe('near')
    harness.queue.dispose()
  })

  it('does not stall the pump when the nearest entry is the last one (PRD 5.5.3)', async () => {
    const started: string[] = []
    const harness = queue({ concurrency: 1, onFetch: (url) => started.push(url) })

    void harness.queue.request({ key: 'a', url: 'a', priority: () => 0 })
    void harness.queue.request({ key: 'dropme', url: 'dropme', priority: () => null })
    // Last in the queue, so a shifted index runs off the end: `splice` returns nothing, the pump
    // reads it as "nothing waiting" and stops — with 'keep' still waiting and a slot free.
    void harness.queue.request({ key: 'keep', url: 'keep', priority: () => 1 })
    await Promise.resolve()
    expect(started).toEqual(['a'])

    harness.release('a')
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(started).toContain('keep')
    expect(harness.queue.stats.waiting).toBe(0)
    harness.queue.dispose()
  })

  it('reports a failure as a failure and never retries (PRD 7.4.2)', async () => {
    const started: string[] = []
    const harness = queue({ onFetch: (url) => started.push(url), fail: () => true })
    const result = harness.queue.request({ key: 'a', url: 'a', priority: () => 0 })
    await Promise.resolve()
    harness.release('a')
    // `bytes: 0` because this harness fails the response before a body exists. The failed variant
    // carries a byte count so the worlds art stream's per-session budget (spec §1.6) can charge a
    // body that arrived and then failed to decode; that case spends a full transfer and returns
    // nothing, and a budget that only charged successes would under-count exactly the traffic it
    // exists to bound.
    expect(await result).toEqual({ ok: false, reason: 'failed', bytes: 0 })
    expect(started).toEqual(['a'])
    expect(harness.queue.stats.failed).toBe(1)
    harness.queue.dispose()
  })

  it('reports an aborted request as cancelled, not as a failure', async () => {
    const harness = queue({ concurrency: 1 })
    const running = harness.queue.request({ key: 'a', url: 'a', priority: () => 0 })
    await Promise.resolve()
    harness.queue.cancel('a')
    expect(await running).toEqual({ ok: false, reason: 'cancelled' })
    expect(harness.queue.stats.failed).toBe(0)
    harness.queue.dispose()
  })

  it('joins a second request for the same key onto the first', async () => {
    const started: string[] = []
    const harness = queue({ onFetch: (url) => started.push(url) })
    const first = harness.queue.request({ key: 'same', url: 'a', priority: () => 0 })
    const second = harness.queue.request({ key: 'same', url: 'a', priority: () => 0 })
    expect(first).toBe(second)
    await Promise.resolve()
    expect(started).toEqual(['a'])
    harness.queue.dispose()
    await Promise.allSettled([first, second])
  })

  it('cancels a waiting request without disturbing the ones in flight', async () => {
    const harness = queue({ concurrency: 1 })
    void harness.queue.request({ key: 'a', url: 'a', priority: () => 0 })
    const waiting = harness.queue.request({ key: 'b', url: 'b', priority: () => 1 })
    await Promise.resolve()
    harness.queue.cancel('b')
    expect(await waiting).toEqual({ ok: false, reason: 'cancelled' })
    expect(harness.queue.stats.inFlight).toBe(1)
    harness.queue.dispose()
  })
})

describe('PRD 5.6.7-8 planet rings', () => {
  it('shows no planets for a single printing', () => {
    expect(planetLayout(1).slots).toHaveLength(0)
    expect(planetLayout(0).slots).toHaveLength(0)
  })

  it('adds rings as needed: one to 24, two to 48, three to 72', () => {
    expect(planetLayout(2).rings).toBe(1)
    expect(planetLayout(24).rings).toBe(1)
    expect(planetLayout(25).rings).toBe(2)
    expect(planetLayout(48).rings).toBe(2)
    expect(planetLayout(49).rings).toBe(3)
    expect(planetLayout(72).rings).toBe(3)
    expect(PLANETS_PER_RING).toBe(24)
    expect(PLANET_CAP).toBe(72)
  })

  it('caps the outermost ring past 72 and reports the remainder for the panel', () => {
    // Swamp has 570 printings in the production dataset; this is that case.
    const layout = planetLayout(570)
    expect(layout.slots).toHaveLength(72)
    expect(layout.overflow).toBe(570 - 72)
    expect(layout.rings).toBe(3)
  })

  it('spaces a ring evenly and starts it at 12 oclock', () => {
    const layout = planetLayout(24)
    expect(layout.slots[0]!.phase).toBe(0)
    for (let i = 1; i < 24; i += 1) {
      expect(layout.slots[i]!.phase - layout.slots[i - 1]!.phase).toBeCloseTo((2 * Math.PI) / 24, 12)
    }
    // Distinct radii per ring, so a two-ring card does not draw both rings on top of each other.
    const two = planetLayout(30)
    expect(two.slots[0]!.radius).toBeLessThan(two.slots[24]!.radius)
  })

  it('puts the first planet at 12 oclock and the next one clockwise of it (PRD 5.6.7)', () => {
    const layout = planetLayout(4)
    const at = { x: 0, y: 0, z: 0 }
    planetPosition(layout.slots[0]!, 0, 1, at)
    expect(at.x).toBeCloseTo(0, 12)
    expect(at.y).toBeCloseTo(layout.slots[0]!.radius, 12)

    planetPosition(layout.slots[1]!, 0, 1, at)
    // A quarter turn clockwise on screen is +x.
    expect(at.x).toBeCloseTo(layout.slots[1]!.radius, 12)
    expect(at.y).toBeCloseTo(0, 12)
  })

  it('orbits once per 60 s and stops dead under reduced motion (PRD 5.6.7, 5.9)', () => {
    const slot = planetLayout(4).slots[0]!
    const start = { x: 0, y: 0, z: 0 }
    const half = { x: 0, y: 0, z: 0 }
    const full = { x: 0, y: 0, z: 0 }
    planetPosition(slot, 0, 1, start)
    planetPosition(slot, 30, 1, half)
    planetPosition(slot, 60, 1, full)
    expect(half.y).toBeCloseTo(-start.y, 10)
    expect(full.x).toBeCloseTo(start.x, 10)
    expect(full.y).toBeCloseTo(start.y, 10)

    const frozen = { x: 0, y: 0, z: 0 }
    planetPosition(slot, 30, 0, frozen)
    expect(frozen.x).toBeCloseTo(start.x, 12)
    expect(frozen.y).toBeCloseTo(start.y, 12)
  })
})

describe('PRD 7.2 GPU memory', () => {
  it('counts an RGBA texture with no mipmap chain', () => {
    expect(textureBytes(4096, 4096)).toBe(64 * 1024 * 1024)
    expect(textureBytes(256, 187)).toBe(256 * 187 * 4)
  })

  it('the worst case — a 72-printing card — is inside the 96 MB target', () => {
    const report = worstCaseReport()
    expect(WORST_CASE.planets).toBe(72)
    expect(report.totalBytes).toBe(ATLAS_BYTES + worstCaseCardBytes())
    expect(report.withinTarget).toBe(true)
    expect(report.withinCeiling).toBe(true)
    // Stated rather than merely asserted, so a regression reads as a number and not as a boolean.
    expect(report.totalBytes).toBeLessThan(GPU_TARGET_BYTES)
    expect(report.totalBytes / (1024 * 1024)).toBeLessThan(90)
  })

  it('names the ceiling as over-target-but-not-over-ceiling rather than as pass or fail', () => {
    const overTarget = gpuMemoryReport(GPU_TARGET_BYTES, 1)
    expect(overTarget.withinTarget).toBe(false)
    expect(overTarget.withinCeiling).toBe(true)
    const overCeiling = gpuMemoryReport(GPU_CEILING_BYTES, 1)
    expect(overCeiling.withinCeiling).toBe(false)
  })
})

describe('PRD 5.5.1 cross-fade threshold', () => {
  it('completes the fade at exactly the 24 px the PRD names', () => {
    expect(THUMBNAIL_FADE_FULL_PX).toBe(24)
  })
})

describe('PRD 5.6.3 tilt spring', () => {
  it('settles at the target without overshooting the ±12° limit', () => {
    const state = { value: 0, rate: 0 }
    let peak = 0
    for (let i = 0; i < 240; i += 1) {
      stepSpring(state, CARD_TILT_MAX_RAD, 1 / 60)
      peak = Math.max(peak, state.value)
    }
    expect(state.value).toBeCloseTo(CARD_TILT_MAX_RAD, 4)
    // PRD 9.3: "no overshoot, no lag". A hair of tolerance for the integrator, not a visible bounce.
    expect(peak).toBeLessThanOrEqual(CARD_TILT_MAX_RAD * 1.02)
  })

  it('settles back to rest when the pointer leaves (PRD 5.6.3)', () => {
    const state = { value: CARD_TILT_MAX_RAD, rate: 0 }
    for (let i = 0; i < 240; i += 1) stepSpring(state, 0, 1 / 60)
    expect(Math.abs(state.value)).toBeLessThan(1e-4)
  })

  it('does not blow up on a long frame', () => {
    const state = { value: 0, rate: 0 }
    // One 500 ms frame — a shard decoding, or a tab coming back. The step is capped, so the spring
    // cannot integrate its way past the limit and back.
    stepSpring(state, CARD_TILT_MAX_RAD, 0.5)
    expect(Math.abs(state.value)).toBeLessThanOrEqual(CARD_TILT_MAX_RAD)
  })
})

describe('PRD 8.5.6 picking with the card tier in the buffer', () => {
  const planeRow = (): number => 3
  const noPlane = (): number => -1

  it('reads a thumbnail as the star it stands for (PRD 5.6.1)', () => {
    // A thumbnail writes its own star's id, so it arrives here indistinguishable from the star.
    expect(resolvePick(42, 100, planeRow, noPlane)).toEqual({
      kind: 'star',
      index: 42,
      planeIndex: 3,
    })
  })

  it('reads a planet id as a planet (PRD 5.6.9)', () => {
    expect(resolvePick(PLANET_ID_BASE + 5, 100, planeRow, noPlane)).toEqual({
      kind: 'planet',
      index: 5,
    })
  })

  it('keeps the planet range clear of any dataset star count', () => {
    // The production dataset has 28,587 stars. A dataset would have to grow 290× to collide.
    expect(PLANET_ID_BASE).toBeGreaterThan(1_000_000)
  })

  it('still falls through to the plane raycast on a miss, and refuses to guess when busy', () => {
    expect(resolvePick(PICK_MISS, 100, planeRow, () => 7)).toEqual({ kind: 'plane', index: 7 })
    expect(resolvePick(PICK_BUSY, 100, planeRow, () => 7)).toBeUndefined()
  })
})

/**
 * PRD 5.6.9's four promises about the hover label, as the change detection that has to hold for any
 * of them to fire. `StarScene` reports a hover only when the pick changed, and it used to decide
 * that on the star index alone — under which a planet, a plane and empty space are all `-1`.
 */
describe('PRD 5.6.9 hover change detection', () => {
  /** Exactly `StarScene`'s loop: what a run of picks reports to `onHover`. */
  function reported(picks: PickResult[]): PickResult[] {
    let previous: PickResult = null
    const out: PickResult[] = []
    for (const pick of picks) {
      if (samePick(pick, previous)) continue
      previous = pick
      out.push(pick)
    }
    return out
  }

  const planet = (index: number): PickResult => ({ kind: 'planet', index })
  const star = (index: number): PickResult => ({ kind: 'star', index, planeIndex: 0 })

  it('reports a planet arrived at from empty space', () => {
    expect(reported([null, planet(0)])).toEqual([planet(0)])
  })

  it('reports the move from one planet to the next', () => {
    expect(reported([planet(0), planet(1)])).toEqual([planet(0), planet(1)])
  })

  it('reports leaving a planet, so the label can clear', () => {
    expect(reported([planet(0), null])).toEqual([planet(0), null])
  })

  it('does not report the same planet twice while the pointer rests on it', () => {
    expect(reported([planet(3), planet(3), planet(3)])).toEqual([planet(3)])
  })

  it('never conflates a planet with the star or plane of the same index', () => {
    expect(samePick(planet(4), star(4))).toBe(false)
    expect(samePick(planet(4), { kind: 'plane', index: 4 })).toBe(false)
    expect(samePick(planet(4), planet(4))).toBe(true)
    // Empty space is its own state, and only equal to itself.
    expect(samePick(null, null)).toBe(true)
    expect(samePick(null, planet(0))).toBe(false)
  })

  it('gives the star field a star index only for a star', () => {
    expect(pickedStarIndex(star(9))).toBe(9)
    expect(pickedStarIndex(planet(9))).toBe(-1)
    expect(pickedStarIndex({ kind: 'plane', index: 9 })).toBe(-1)
    expect(pickedStarIndex(null)).toBe(-1)
  })
})

/**
 * One of Phase 3's five integration fixes, which shipped without a guard.
 *
 * `three` uploads a texture lazily, on the first frame that draws it, so an `ImageBitmap` closed as
 * soon as the `Texture` wrapping it exists is a texture with nothing in it — a flat grey card,
 * which is what the first browser run showed. The card therefore holds the bitmap until it has been
 * handed a renderer to force the upload with. The ordering is the whole fix, so the ordering is
 * what this asserts.
 */
describe('PRD 5.6.2 decoded image lifetime', () => {
  const printing: PrintingTuple = ['0aeebaf5-8c7d-4636-9e82-8c27447861f7', 1, '1', 1700000000, '1']
  const record: CardRecord = {
    u: 'o-1',
    n: 'Test Card',
    m: '{1}',
    t: 'Instant',
    o: '',
    b: null,
    ci: 'U',
    r: 0,
    l: 'normal',
    p: [printing],
  }

  it('closes a bitmap only after the renderer has been asked to upload its texture', async () => {
    const events: string[] = []
    const queue = new ImageQueue({
      fetchImpl: (() =>
        Promise.resolve({
          ok: true,
          status: 200,
          blob: () => Promise.resolve({} as Blob),
        })) as unknown as typeof fetch,
      decode: () =>
        Promise.resolve({
          width: 1,
          height: 1,
          close: () => events.push('close'),
        } as unknown as ImageBitmap),
    })
    const card = new FocusedCard(queue)
    card.show(record, 0, 0)
    for (let i = 0; i < 60; i += 1) await Promise.resolve()

    // Both faces have decoded. Nothing is closed yet: no renderer has seen them.
    expect(events).toEqual([])

    card.flushUploads({ initTexture: () => events.push('init') })
    // Two faces, and every close is preceded by its own upload.
    expect(events).toEqual(['init', 'close', 'init', 'close'])

    // And a second flush has nothing left to hold.
    card.flushUploads({ initTexture: () => events.push('init') })
    expect(events).toHaveLength(4)

    card.dispose()
    queue.dispose()
  })

  it('closes a held bitmap on dispose rather than leaking it', async () => {
    const events: string[] = []
    const queue = new ImageQueue({
      fetchImpl: (() =>
        Promise.resolve({
          ok: true,
          status: 200,
          blob: () => Promise.resolve({} as Blob),
        })) as unknown as typeof fetch,
      decode: () =>
        Promise.resolve({ width: 1, height: 1, close: () => events.push('close') } as unknown as ImageBitmap),
    })
    const card = new FocusedCard(queue)
    card.show(record, 0, 0)
    for (let i = 0; i < 60; i += 1) await Promise.resolve()
    expect(events).toEqual([])
    card.dispose()
    expect(events).toEqual(['close', 'close'])
    queue.dispose()
  })
})

describe('PRD 5.6.2 card geometry', () => {
  it('maps the image across the face exactly once, edge to edge', () => {
    const geometry = cardFaceGeometry(CARD_WIDTH, CARD_HEIGHT, 0.03, 0.01, true)
    const uv = geometry.getAttribute('uv')
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (let i = 0; i < uv.count; i += 1) {
      minU = Math.min(minU, uv.getX(i))
      maxU = Math.max(maxU, uv.getX(i))
      minV = Math.min(minV, uv.getY(i))
      maxV = Math.max(maxV, uv.getY(i))
    }
    expect(minU).toBeCloseTo(0, 6)
    expect(maxU).toBeCloseTo(1, 6)
    expect(minV).toBeCloseTo(0, 6)
    expect(maxV).toBeCloseTo(1, 6)
  })

  it('mirrors the back face so a flipped card is not mirror-written', () => {
    const front = cardFaceGeometry(CARD_WIDTH, CARD_HEIGHT, 0.03, 0.01, true)
    const back = cardFaceGeometry(CARD_WIDTH, CARD_HEIGHT, 0.03, -0.01, false)
    const fu = front.getAttribute('uv')
    const bu = back.getAttribute('uv')
    // Vertex 1 is the first point of the outline on both, at the same xy.
    expect(front.getAttribute('position').getX(1)).toBeCloseTo(
      back.getAttribute('position').getX(1),
      12,
    )
    expect(bu.getX(1)).toBeCloseTo(1 - fu.getX(1), 6)
  })

  it('keeps every vertex inside the card outline', () => {
    const geometry = cardFaceGeometry(CARD_WIDTH, CARD_HEIGHT, 0.03, 0, true)
    const position = geometry.getAttribute('position')
    for (let i = 0; i < position.count; i += 1) {
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(CARD_WIDTH / 2 + 1e-9)
      expect(Math.abs(position.getY(i))).toBeLessThanOrEqual(CARD_HEIGHT / 2 + 1e-9)
    }
  })

  it('builds an edge that spans the thickness and points outwards', () => {
    const geometry = cardEdgeGeometry(CARD_WIDTH, CARD_HEIGHT, 0.03, 0.02)
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < position.count; i += 1) {
      minZ = Math.min(minZ, position.getZ(i))
      maxZ = Math.max(maxZ, position.getZ(i))
      // Radially outwards, so it is a unit vector in the xy plane.
      expect(Math.hypot(normal.getX(i), normal.getY(i))).toBeCloseTo(1, 6)
      expect(normal.getZ(i)).toBe(0)
    }
    // Float32 attribute storage, so six places is the whole of the available precision here.
    expect(maxZ - minZ).toBeCloseTo(0.02, 6)
  })
})

/**
 * §1.10's overflow ticks, pinned as positions (worlds spec §1.10, DEC-751).
 *
 * The section asks for this by name — "pin it with a unit test on the tick positions, not with a
 * capture" — and gives the reason: on the production roster this draws on **five cards**, so a
 * defect here is invisible in every screenshot anyone would think to take.
 *
 * What is being pinned is a *mapping*, not a picture: each dropped printing gets one tick, at its
 * own fraction of the release order, on a ring outside the quads. The digits below are all derived
 * from that sentence rather than transcribed from a run.
 */
describe('§1.10 the ring marks the printings it dropped', () => {
  it('draws no ticks at all until the cap actually binds', () => {
    // The cap binds on five cards. Everything else must be untouched by this change, and the
    // boundary is the interesting row: 72 is not overflow, 73 is one.
    expect(planetLayout(1).ticks).toHaveLength(0)
    expect(planetLayout(24).ticks).toHaveLength(0)
    expect(planetLayout(PLANET_CAP).ticks).toHaveLength(0)
    expect(planetLayout(PLANET_CAP).overflow).toBe(0)
    expect(planetLayout(PLANET_CAP + 1).ticks).toHaveLength(1)
  })

  it('draws exactly one tick per dropped printing, and names which', () => {
    // Swamp, the worst case on the roster: 570 printings, 72 quads, 498 ticks.
    const layout = planetLayout(570)
    expect(layout.slots).toHaveLength(PLANET_CAP)
    expect(layout.overflow).toBe(498)
    expect(layout.ticks).toHaveLength(498)
    // Every dropped printing, once, and no printing that the ring already shows. A tick set that
    // merely had the right *count* would pass a `toHaveLength` and still mark the wrong printings.
    expect(layout.ticks.map((tick) => tick.printing)).toEqual(
      Array.from({ length: 498 }, (_, i) => PLANET_CAP + i),
    )
    const shown = new Set(layout.slots.map((slot) => slot.printing))
    expect(layout.ticks.some((tick) => shown.has(tick.printing))).toBe(false)
  })

  it('places a tick at its own fraction of the release order, not of the tail', () => {
    // The distinguishing assertion (§1.10). Spacing the ticks evenly over the *tail* would put the
    // first one at angle 0 and spread 498 marks around the whole circle, saying nothing about
    // where in the card's history they fall. Placed against the whole sequence, printing 72 of 570
    // sits about an eighth of the way round — just past the quads it follows.
    const layout = planetLayout(570)
    const first = layout.ticks[0]!
    expect(first.printing).toBe(72)
    expect(first.phase).toBeCloseTo((2 * Math.PI * 72) / 570, 12)
    expect(first.phase).toBeGreaterThan(0)
    // The last printing is nearly all the way round, and strictly short of a full turn — a tick at
    // exactly 2*PI would sit on top of printing 0.
    const last = layout.ticks[layout.ticks.length - 1]!
    expect(last.printing).toBe(569)
    expect(last.phase).toBeCloseTo((2 * Math.PI * 569) / 570, 12)
    expect(last.phase).toBeLessThan(2 * Math.PI)
    // Monotonic in release order, which is what makes the ring readable as a clock.
    for (let i = 1; i < layout.ticks.length; i += 1) {
      expect(layout.ticks[i]!.phase).toBeGreaterThan(layout.ticks[i - 1]!.phase)
    }
  })

  it('puts the ticks outside every quad ring, so the tail reads as a tail', () => {
    const layout = planetLayout(570)
    for (const tick of layout.ticks) {
      expect(tick.radius).toBe(PLANET_TICK_RADIUS)
      for (const slot of layout.slots) expect(tick.radius).toBeGreaterThan(slot.radius)
    }
  })

  it('orbits a tick on the same clock as the quads (PRD 5.6.7)', () => {
    // One angular law for both, or the tail drifts against the ring it belongs to. Asserted as an
    // *equality of angular advance* rather than as coordinates, because that is the claim.
    const layout = planetLayout(570)
    const tick = layout.ticks[0]!
    const slot = layout.slots[0]!
    const at = (thing: { phase: number; radius: number }, t: number) => {
      const out = { x: 0, y: 0, z: 0 }
      planetPosition(thing, t, 1, out)
      return Math.atan2(out.x, out.y)
    }
    const quarter = PLANET_PERIOD_S / 4
    const advance = (thing: { phase: number; radius: number }) => {
      const before = at(thing, 0)
      const after = at(thing, quarter)
      return (after - before + 2 * Math.PI) % (2 * Math.PI)
    }
    expect(advance(tick)).toBeCloseTo(Math.PI / 2, 10)
    expect(advance(tick)).toBeCloseTo(advance(slot), 10)
    // And it is on the tick ring while it does it — the radius survives the orbit.
    const out = { x: 0, y: 0, z: 0 }
    planetPosition(tick, 12.3, 1, out)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(PLANET_TICK_RADIUS, 10)
  })

  it('stops moving under reduced motion, as the quads do (PRD 5.9)', () => {
    const tick = planetLayout(570).ticks[0]!
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 0 }
    planetPosition(tick, 0, 0, a)
    planetPosition(tick, 30, 0, b)
    expect(b).toEqual(a)
  })
})

/**
 * §1.10's ticks reaching the scene graph (DEC-751).
 *
 * The layout rows above are arithmetic and would all stay green with nothing drawn at all — which
 * is the exact shape of DEC-768's F3, where two worlds wiring lines could be deleted with the
 * whole suite still passing. So this drives the real {@link FocusedCard} and asks the scene graph
 * what is in it.
 */
describe('§1.10 the tick tail is in the scene, not only in the layout', () => {
  function cardWith(printings: number): CardRecord {
    const p: PrintingTuple[] = Array.from({ length: printings }, (_, i) => [
      `0aeebaf5-8c7d-4636-9e82-${String(i).padStart(12, '0')}`,
      1,
      '1',
      1700000000,
      `${i}`,
    ])
    return { u: 'o-1', n: 'Basic', m: '{0}', t: 'Land', o: '', b: null, ci: 'C', r: 0, l: 'normal', p }
  }

  function tickPointsOf(card: FocusedCard): Points | null {
    let found: Points | null = null
    card.root.traverse((node) => {
      if ((node as Points).isPoints) found = node as Points
    })
    return found
  }

  function queueStub(): ImageQueue {
    return new ImageQueue({
      fetchImpl: () => new Promise<Response>(() => {}),
      decode: () => new Promise<ImageBitmap>(() => {}),
    })
  }

  it('adds one point per dropped printing, and nothing when the cap does not bind', () => {
    const queue = queueStub()
    const card = new FocusedCard(queue)

    // A card the cap does not touch draws no tail at all — the common path on the roster, and the
    // control that stops the next assertion passing on a permanently-present object.
    card.show(cardWith(24), 0, 0)
    expect(tickPointsOf(card)).toBeNull()

    // Swamp's shape: 570 printings, 72 quads, 498 marks.
    card.show(cardWith(570), 0, 0)
    const points = tickPointsOf(card)
    expect(points).not.toBeNull()
    expect(points!.geometry.getAttribute('position').count).toBe(498)

    // And it goes away again when a card that does not overflow takes focus.
    card.show(cardWith(24), 0, 0)
    expect(tickPointsOf(card)).toBeNull()

    card.dispose()
    queue.dispose()
  })

  it('turns the tail on the orbit, and holds it still under reduced motion (PRD 5.9)', () => {
    const queue = queueStub()
    const card = new FocusedCard(queue)
    card.show(cardWith(570), 0, 0)
    const origin = { x: 0, y: 0, z: 0 }

    const points = tickPointsOf(card)!
    expect(points.rotation.z).toBe(0)

    // A quarter of the orbit period turns the tail a quarter turn, in the same direction the
    // quads go: `planetPosition` advances a phase, and the object's rotation is that advance.
    card.update(PLANET_PERIOD_S / 4, origin, { x: 0, y: 0, z: 10 }, 1, false)
    expect(points.rotation.z).toBeCloseTo(-Math.PI / 2, 10)

    // Reduced motion freezes it where it stands rather than resetting it — `planeTable.advance`'s
    // rule, and the reason the orbit clock is scaled as it accumulates rather than at the point of
    // use. Scaling at the point of use sends the ring back to its t=0 phase when motion goes off
    // and teleports it forward when it comes back: it jumps twice. The quads had that defect and
    // this row covers them too, which is why the planet's position is asserted beside the tail's
    // rotation — one clock, so one assertion could not have told them apart.
    const held = points.rotation.z
    const before = new Vector3()
    card.root.updateMatrixWorld(true)
    expect(card.planetWorldPosition(0, before)).toBe(true)

    card.update(PLANET_PERIOD_S / 4, origin, { x: 0, y: 0, z: 10 }, 0, true)
    expect(points.rotation.z).toBe(held)
    const after = new Vector3()
    card.root.updateMatrixWorld(true)
    card.planetWorldPosition(0, after)
    expect(after.distanceTo(before)).toBeLessThan(1e-9)

    // And it picks up from where it stopped, rather than from the beginning.
    card.update(PLANET_PERIOD_S / 4, origin, { x: 0, y: 0, z: 10 }, 1, false)
    expect(points.rotation.z).toBeCloseTo(-Math.PI, 10)

    card.dispose()
    queue.dispose()
  })
})

/**
 * §1.10's first paragraph: a printing is a **flat `small` quad**, not a textured sphere.
 *
 * Its claims are "flat", "at their own aspect ratio", "undistorted", "unshaded" and "the active
 * printing marked by a brighter rim" — and every one of them is invisible when wrong. A card
 * squashed by a few percent still reads as a card; a uniformly dimmed ring reads as a styling
 * choice; an active marker whose term evaluates to zero reads as nothing at all. So they are
 * pinned here rather than left to a capture.
 */
describe('§1.10 the printings are flat quads', () => {
  /**
   * A GLSL source with its comments stripped, so a source-text assertion reads the **program**.
   *
   * Every shader row below would otherwise be satisfiable by prose, and in both directions. That is
   * not hypothetical — it is what the first run of these rows did. The "no view-dependent term" row
   * forbids `pow(1 - dot(n, toEye), 3)`, and the comment beside the rim quotes that expression
   * verbatim in order to explain why it is gone; the "unshaded" row went red on the word `lambert`
   * appearing in a comment that says the lambert was removed. A guard that cannot tell code from a
   * note about code fails on an honest explanation and passes on a claim nobody implemented.
   */
  function glslCode(source: string): string {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    // A parser this small is only worth trusting if it fails loudly rather than degrading. If a
    // rewrite ever leaves a comment marker standing, that is one failure here instead of six
    // quietly weakened assertions downstream.
    if (stripped.includes('/*') || stripped.includes('//')) {
      throw new Error('glslCode left a comment marker behind')
    }
    return stripped
  }

  it('reads the program and not the prose around it', () => {
    // The positive control for `glslCode`, and it is load-bearing rather than decorative: with the
    // stripping inert, every row below still passes except the two that would be *wrong*.
    expect(PLANET_FRAGMENT_SHADER).toContain('lambert')
    expect(glslCode(PLANET_FRAGMENT_SHADER)).not.toContain('lambert')
    expect(glslCode(PLANET_FRAGMENT_SHADER).length).toBeLessThan(PLANET_FRAGMENT_SHADER.length)
    // And it does not eat the program on the way past.
    expect(glslCode(PLANET_FRAGMENT_SHADER)).toContain('gl_FragColor')
  })

  function cardWith(printings: number): CardRecord {
    const p: PrintingTuple[] = Array.from({ length: printings }, (_, i) => [
      `0aeebaf5-8c7d-4636-9e82-${String(i).padStart(12, '0')}`,
      1,
      '1',
      1700000000,
      `${i}`,
    ])
    return { u: 'o-1', n: 'Basic', m: '{0}', t: 'Land', o: '', b: null, ci: 'C', r: 0, l: 'normal', p }
  }

  function queueStub(): ImageQueue {
    return new ImageQueue({
      fetchImpl: () => new Promise<Response>(() => {}),
      decode: () => new Promise<ImageBitmap>(() => {}),
    })
  }

  it('gives the quad the aspect of the image it shows, so a printing cannot be distorted', () => {
    // Not "close to 0.7157" — **equal**, because the width is derived from the image's dimensions
    // rather than written down. A literal within a percent of the aspect would pass a
    // `toBeCloseTo` and squash all 72 printings on screen with nothing to report it.
    expect(PLANET_QUAD_WIDTH / PLANET_QUAD_HEIGHT).toBe(
      PRINTING_IMAGE_WIDTH / PRINTING_IMAGE_HEIGHT,
    )
    // And that is the *card's* aspect, which is what lets §1.10 retire the sphere: the ring and the
    // focused card's own face now agree about the shape of a card.
    expect(PLANET_QUAD_WIDTH / PLANET_QUAD_HEIGHT).toBeCloseTo(CARD_WIDTH / CARD_HEIGHT, 2)
  })

  it('puts a four-vertex plane in the scene, for the draw pass and the pick pass alike', () => {
    const queue = queueStub()
    const card = new FocusedCard(queue)
    card.show(cardWith(4), 0, 0)

    const meshes: Mesh[] = []
    card.root.traverse((node) => {
      if ((node as Mesh).isMesh) meshes.push(node as Mesh)
    })
    // Three for the card itself (front, back, edge) and two per printing — draw and pick.
    const printingMeshes = meshes.filter((mesh) => mesh.geometry.getAttribute('position').count === 4)
    expect(printingMeshes).toHaveLength(8)

    for (const mesh of printingMeshes) {
      const position = mesh.geometry.getAttribute('position')
      // A quad, not a 24 x 16 sphere's 425 vertices. `position.count` rather than `geometry.type`:
      // the type is a string three sets, and it would survive a swap that kept the label.
      expect(position.count).toBe(4)
      // Flat, and flat in the plane that faces the camera. The ring hangs off a root that does
      // `lookAt(camera)`, so a quad in local XY needs no billboarding — and a quad that had drifted
      // out of XY would be edge-on at some camera angles and invisible, intermittently.
      for (let i = 0; i < position.count; i += 1) expect(position.getZ(i)).toBe(0)
    }

    // Four drawn and four in the pick pass, and the *same* geometry object behind all eight — so
    // the hit target cannot drift off the picture. A second `PlaneGeometry` of equal size would
    // satisfy every dimension assertion above and still be free to diverge later.
    const drawn = printingMeshes.filter((mesh) => mesh.layers.mask === 1)
    const picked = printingMeshes.filter((mesh) => mesh.layers.mask === 1 << PICK_LAYER)
    expect(drawn).toHaveLength(4)
    expect(picked).toHaveLength(4)
    expect(new Set(printingMeshes.map((mesh) => mesh.geometry)).size).toBe(1)

    card.dispose()
    queue.dispose()
  })

  /**
   * Sweep a whole revolution and report the closest any two quads come (DEC-776 F1).
   *
   * The quads are axis-aligned in the card's frame and the ring turns underneath them, so a single
   * phase is a *sample*, not an answer — the arrangement that shipped is clear at `t = 0` and
   * overlapping a quarter-revolution later. Everything here goes through the shipped
   * `planetLayout` / `planetPosition`, so it measures the ring the product draws.
   *
   * Separation is reported as a ratio, not a boolean: axis-aligned rects of equal size overlap
   * exactly when both centre offsets are inside the box, so `max(|dx|/width, |dy|/height) >= 1` is
   * the clearance condition and the shortfall of the minimum below 1 says how badly. Width and
   * height are arguments so the pre-fix size can be driven through the *same* instrument — which
   * makes this a measurement taking its geometry as a parameter, so the shipped row below passes
   * the shipped constants and nothing else, and the control is exactly the call-site mutation.
   */
  function closestQuadApproach(
    printings: number,
    width: number,
    height: number,
    steps = 720,
  ): { separation: number; overlappingPairs: number; overlappingRings: number[] } {
    const { slots } = planetLayout(printings)
    const at = slots.map(() => ({ x: 0, y: 0, z: 0 }))
    const overlappingRings = new Set<number>()
    let separation = Infinity
    let overlappingPairs = 0

    for (let step = 0; step < steps; step += 1) {
      const t = (PLANET_PERIOD_S * step) / steps
      for (let i = 0; i < slots.length; i += 1) planetPosition(slots[i]!, t, 1, at[i]!)

      let pairsThisStep = 0
      for (let i = 0; i < slots.length; i += 1) {
        for (let j = i + 1; j < slots.length; j += 1) {
          const gap = Math.max(
            Math.abs(at[i]!.x - at[j]!.x) / width,
            Math.abs(at[i]!.y - at[j]!.y) / height,
          )
          if (gap < separation) separation = gap
          // 1e-9 is a float allowance, not a clearance: the shipped height solves the diagonal
          // condition at *equality*, so the tightest pair touches at exactly 1 and lands either
          // side of it in doubles. The defect this row exists for sits at 0.79.
          if (gap < 1 - 1e-9) {
            pairsThisStep += 1
            overlappingRings.add(slots[i]!.ring)
            overlappingRings.add(slots[j]!.ring)
          }
        }
      }
      overlappingPairs = Math.max(overlappingPairs, pairsThisStep)
    }

    return {
      separation,
      overlappingPairs,
      overlappingRings: [...overlappingRings].sort((a, b) => a - b),
    }
  }

  it('takes its height from the tightest ring chord, through the diagonal condition', () => {
    // The clearance sweep below proves the quad fits; this proves *why* it is the size it is.
    // Without it a height that happened to fit — transcribed, or left over from another ring's
    // arithmetic — would be indistinguishable from one derived from the ring the code ships.
    const chords = PLANET_RING_RADII.map(
      (radius) => 2 * radius * Math.sin(Math.PI / PLANETS_PER_RING),
    )
    const diagonal = Math.hypot(PLANET_QUAD_WIDTH, PLANET_QUAD_HEIGHT)
    expect(diagonal).toBeCloseTo(Math.min(...chords), 12)
    // And the tightest ring is the innermost one, so a reordered `PLANET_RING_RADII` would be
    // caught here rather than showing up as an overlap on a ring nobody thought to sweep.
    expect(Math.min(...chords)).toBe(chords[0])
  })

  it('keeps the quads off each other at every phase of the turn, not just at the top', () => {
    // 72 fills all three rings; 18 is where overlap began on the production roster before the fix;
    // 570 is Swamp, the worst card on it. All three go through the shipped layout functions.
    for (const printings of [2, 18, 24, 25, 48, 72, 570]) {
      const { separation, overlappingPairs } = closestQuadApproach(
        printings,
        PLANET_QUAD_WIDTH,
        PLANET_QUAD_HEIGHT,
      )
      expect({ printings, overlappingPairs }).toEqual({ printings, overlappingPairs: 0 })
      expect(separation).toBeGreaterThanOrEqual(1 - 1e-9)
    }
  })

  it('sizes the quad so that clearance *binds* — the ring holds nothing larger', () => {
    // Without this the row above is satisfied by any small enough quad, including one shrunk to
    // nothing. The tightest ring's closest approach has to sit on the boundary, so a quad even a
    // percent taller would overlap: that is what makes the derived height the largest one §1.10's
    // ring can hold rather than a number that merely happens to fit.
    // Asserted as "a fractionally larger quad overlaps" rather than as an upper bound on the
    // sampled minimum, because the sampled minimum is *not* a property of the ring: the true
    // closest approach is exactly 1 at an irrational phase, and any finite sweep reads slightly
    // above it and converges down as the step count rises. The overlap count does not drift —
    // widen the quad and the dip goes below 1 over a whole neighbourhood of phases, which 720
    // steps cannot miss.
    for (const scale of [1.002, 1.01, 1.1]) {
      const larger = closestQuadApproach(
        24,
        PLANET_QUAD_WIDTH * scale,
        PLANET_QUAD_HEIGHT * scale,
      )
      expect({ scale, overlaps: larger.overlappingPairs > 0 }).toEqual({ scale, overlaps: true })
    }
    // Non-binding control: shrinking instead leaves the ring clear, so the row above is testing the
    // boundary and not merely that this instrument reports overlap for any input.
    const smaller = closestQuadApproach(
      24,
      PLANET_QUAD_WIDTH * 0.998,
      PLANET_QUAD_HEIGHT * 0.998,
    )
    expect(smaller.overlappingPairs).toBe(0)
  })

  it('positive control: the instrument sees the height that shipped overlapping', () => {
    // DEC-776 F1's own measurement, re-run here. Without this row a sweep that could not see the
    // defect would read exactly like a sweep that proves it is gone. The pre-fix quad was
    // 0.24 tall at the same derived aspect, and the review found 16 simultaneous pairs.
    const preFixHeight = 0.24
    const preFixWidth = (preFixHeight * PLANET_SMALL_WIDTH) / PLANET_SMALL_HEIGHT
    const preFix = closestQuadApproach(72, preFixWidth, preFixHeight)
    expect(preFix.overlappingPairs).toBe(16)
    expect(preFix.separation).toBeLessThan(1)

    // Rings 0 and 1 collide and 1.42 always cleared — which is the *attribution*, and it is what
    // makes this a control for the diagonal rule rather than a control for "this instrument reports
    // overlap". An outer ring that also went red would mean the instrument was measuring something
    // else: 1.42's chord is 0.371 against the pre-fix quad's 0.295 diagonal, so it cannot overlap.
    expect(preFix.overlappingRings).toEqual([0, 1])

    // Onset is a *count*, and it is where the review put the blast radius: 17 printings sit one
    // ring apart at a chord of 0.302, wider than the pre-fix diagonal; 18 at 0.285 is not. So the
    // control separates cards that reached the defect from cards that never could.
    expect(closestQuadApproach(17, preFixWidth, preFixHeight).overlappingPairs).toBe(0)
    expect(closestQuadApproach(18, preFixWidth, preFixHeight).overlappingPairs).toBeGreaterThan(0)
  })

  it('makes no printing harder to click than the sphere it replaces', () => {
    // The pick mesh shares the quad, so the hit area *is* the quad. Both dimensions have to clear
    // the sphere's 0.116 diameter, or the conversion would have bought a better picture with
    // pickability — and nothing on screen would say so. Still true after DEC-776 F1's shrink:
    // 0.125 x 0.174 against 0.116.
    const sphereDiameter = 0.058 * 2
    expect(PLANET_QUAD_WIDTH).toBeGreaterThan(sphereDiameter)
    expect(PLANET_QUAD_HEIGHT).toBeGreaterThan(sphereDiameter)
  })

  it('asks for the whole card at `small`, not a crop of its art', () => {
    const requested: string[] = []
    const queue = new ImageQueue({
      fetchImpl: (input: RequestInfo | URL) => {
        // `ImageQueue` passes the request's url, which is a plain string. Narrowed rather than
        // stringified: `String(new Request(...))` is "[object Object]", and a url assertion
        // against that would pass or fail for reasons that have nothing to do with the image size.
        expect(typeof input).toBe('string')
        requested.push(input as string)
        return new Promise<Response>(() => {})
      },
      decode: () => new Promise<ImageBitmap>(() => {}),
    })
    const card = new FocusedCard(queue)
    card.show(cardWith(4), 0, 0)

    const ring = requested.filter((url) => !url.includes('/large/'))
    expect(ring).toHaveLength(4)
    for (const url of ring) {
      expect(url).toContain('/small/')
      // The sphere's source. §1.10 drops it for the reason review §10 Q3 records: an `art_crop`
      // carries no title, frame or artist line, so showing one obliges an artist credit beside
      // every planet, while a whole card carries its attribution on its own face.
      expect(url).not.toContain('/art_crop/')
    }

    card.dispose()
    queue.dispose()
  })

  it('marks the active printing with a term that is not identically zero on a flat quad', () => {
    /*
     * The trap this row exists for, and it is the one thing in this conversion that fails
     * **silently**. The sphere's rim was `pow(1 - dot(n, toEye), 3)`. The quad faces the camera by
     * construction, so `dot(n, toEye)` is 1 across the whole surface and that expression is
     * identically zero. Ported across unchanged it leaves `uActive` and `uHover` bound, still
     * written by `setActivePrinting`/`setHoveredPlanet`, and multiplied into nothing: PRD 5.6.9's
     * mark stops existing, with no error raised and no uniform left unwritten to notice.
     *
     * So no view-dependent term reaches the fragment stage at all, and the rim is distance to the
     * quad's own edge instead.
     */
    expect(glslCode(PLANET_FRAGMENT_SHADER)).not.toContain('vNormalView')
    expect(glslCode(PLANET_FRAGMENT_SHADER)).not.toContain('vViewPosition')
    expect(glslCode(PLANET_FRAGMENT_SHADER)).not.toContain('dot(')
    expect(glslCode(PLANET_VERTEX_SHADER)).not.toContain('normalMatrix')
    expect(glslCode(PLANET_FRAGMENT_SHADER)).toContain('vec2 toEdge = min(vUv, 1.0 - vUv)')
    expect(glslCode(PLANET_FRAGMENT_SHADER)).toContain('uActive * (ACTIVE_GAIN - 1.0)')
  })

  it('measures the rim in the quads units, not in UV, so the border is even on four sides', () => {
    // The quad is 146:204, so a rim inset by a fraction of UV would be 1.4x thicker on the left and
    // right edges than on the top and bottom. Scaling by both dimensions is what evens it, so both
    // have to reach the shader — and reach it carrying the quad's real size, not a second literal.
    const code = glslCode(PLANET_FRAGMENT_SHADER)
    expect(code).toContain('* vec2(QUAD_WIDTH, QUAD_HEIGHT)')
    expect(code).toContain(`#define QUAD_WIDTH ${glslFloat(PLANET_QUAD_WIDTH)}`)
    expect(code).toContain(`#define QUAD_HEIGHT ${glslFloat(PLANET_QUAD_HEIGHT)}`)
  })

  it('is unshaded — no lighting term survived the conversion', () => {
    // "Unshaded" is not a style note here. The wrapped lambert it replaces collapses to a single
    // constant on a flat quad, so carried over it would dim every printing by that constant
    // forever and read as a deliberate choice.
    expect(glslCode(PLANET_FRAGMENT_SHADER)).not.toContain('lambert')
    expect(glslCode(PLANET_FRAGMENT_SHADER)).not.toMatch(/base\s*\*=/)
  })
})
