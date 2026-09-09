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
import type { BufferGeometry, Texture, Vector4, WebGLRenderer } from 'three'

import { ATLAS_BYTES, ATLAS_CELLS, ATLAS_COLUMNS, ThumbnailAtlas } from '../src/scene/cards/atlas'
import {
  FocusedCard,
  stepSpring,
  worstCaseCardBytes,
  PLANET_ID_BASE,
} from '../src/scene/cards/focusedCard'
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
import { PICK_BUSY, PICK_MISS } from '../src/scene/picking/idPicker'
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
      } as unknown as ImageBitmap
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
    const sized = (width: number, height: number): ImageBitmap =>
      ({ width, height, close: () => {} }) as unknown as ImageBitmap

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
    expect(await result).toEqual({ ok: false, reason: 'failed' })
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
