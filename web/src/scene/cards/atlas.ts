/**
 * PRD 8.5.8's thumbnail atlas: 4096², 128 × 178 cells, base level only, with an LRU over the cells.
 *
 * **Why a render target and not a `DataTexture`.** The atlas is 64 MB of texels. A `DataTexture`
 * would hold all 64 MB a second time as a CPU-side `Uint8Array` for the life of the scene, and
 * every cell upload would either re-upload the whole thing or need `copyTextureToTexture`, which
 * three's texture manager treats a render-target texture and an ordinary one differently for. A
 * render target is one GPU allocation with no CPU twin, and a cell upload is a scissored blit into
 * its own 128 × 178 rectangle — no clear, so the other 735 cells are untouched.
 *
 * **No mipmaps** is PRD 8.5.8 verbatim: "base level only — no mipmap chain, since a full chain
 * would add a third to the atlas's 64 MB and put the 7.2 target out of reach". Thumbnails are drawn
 * at roughly their stored size at the moment they exist at all (PRD 5.5.1 puts the cross-fade at
 * 24 px and the cells are 128 px wide), so the chain would buy very little for its 21 MB.
 *
 * **Colour.** The cells hold Scryfall's bytes as they arrive — sRGB-encoded — and the thumbnail
 * shader decodes them. Storing linear instead would be a quiet quality loss: eight bits of linear
 * banding across the dark half of a card's art, for nothing. Getting there needs the blit source
 * marked `NoColorSpace` so three does not decode it on the way in, because three writes
 * `LinearSRGBColorSpace` into every non-XR render target whatever the target texture says.
 */

import {
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  Texture,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

import { ATLAS_CELL_HEIGHT, ATLAS_CELL_WIDTH, ATLAS_SIZE, THUMBNAIL_GRACE_S } from '../tuning'

/** A cell's occupant. `key` is the star index the cell holds a thumbnail for. */
interface Cell {
  key: number
  /** Scene time, in seconds, when this cell was last wanted on screen (PRD 5.5.4's grace period). */
  lastSeen: number
  /** False between `claim` and `upload`: the cell is spoken for but has nothing in it yet. */
  loaded: boolean
}

export const ATLAS_COLUMNS = Math.floor(ATLAS_SIZE / ATLAS_CELL_WIDTH)
export const ATLAS_ROWS = Math.floor(ATLAS_SIZE / ATLAS_CELL_HEIGHT)
/** Cells the atlas physically has. The *usable* count is the quality tier's capacity. */
export const ATLAS_CELLS = ATLAS_COLUMNS * ATLAS_ROWS

/** PRD 7.2's GPU memory line. One RGBA byte quadruple per texel, no mipmap chain. */
export const ATLAS_BYTES = ATLAS_SIZE * ATLAS_SIZE * 4

export interface AtlasCellUv {
  /** Bottom-left of the cell in atlas UV, and the cell's UV extent. */
  u: number
  v: number
  du: number
  dv: number
}

/**
 * The blit quad: a unit plane whose `v` runs **top-down**.
 *
 * `UNPACK_FLIP_Y_WEBGL` does not apply to an `ImageBitmap` source — the WebGL spec fixes a bitmap's
 * orientation at creation, so `Texture.flipY` is inert here whatever it is set to. Row 0 of the
 * upload is therefore the image's *top* row, and `t = 0` samples it.
 *
 * A render target's texels run bottom-up, and the ortho camera below puts the quad's `+y` at the
 * top of the viewport. So the quad's top vertex has to carry `t = 0` for the image's top row to
 * land at the top of the cell — which is the opposite of `PlaneGeometry`'s default.
 *
 * Left as the default, every thumbnail in the sheet drew upside down. It was invisible until the
 * viewport bug in {@link ThumbnailAtlas.upload} was fixed, because until then the blit rectangle
 * was 1.5× its cell and no thumbnail sampled the pixels it had written anyway.
 */
function blitGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(1, 1)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i += 1) uv.setY(i, 1 - uv.getY(i))
  uv.needsUpdate = true
  return geometry
}

/**
 * The atlas and its LRU. Knows nothing about fetching — {@link ThumbnailLoader} owns that — so the
 * eviction rule and the fetch policy can be read, and tested, apart.
 */
export class ThumbnailAtlas {
  readonly target: WebGLRenderTarget
  /** Cells indexed by slot. `key` is -1 for a free cell. */
  private readonly cells: Cell[] = []
  /** star index → slot. */
  private readonly slots = new Map<number, number>()
  private capacityValue: number

  private readonly blitScene = new Scene()
  private readonly blitCamera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1)
  // Named for the same reason as the scene's other materials: `SHADER_NAME` is `material.name`, so
  // an unnamed built-in is as anonymous in the program list as an unnamed raw `ShaderMaterial`.
  private readonly blitMaterial = new MeshBasicMaterial({
    name: 'AtlasBlit',
    depthTest: false,
    depthWrite: false,
  })
  private readonly blitMesh: Mesh
  /** Scratch for the caller's viewport and scissor, saved across a blit. See {@link upload}. */
  private readonly savedViewport = new Vector4()
  private readonly savedScissor = new Vector4()

  constructor(capacity: number) {
    this.capacityValue = Math.min(capacity, ATLAS_CELLS)
    this.target = new WebGLRenderTarget(ATLAS_SIZE, ATLAS_SIZE, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      // PRD 8.5.8: base level only.
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: LinearSRGBColorSpace,
    })
    this.target.texture.name = 'eternities:thumbnail-atlas'

    for (let i = 0; i < ATLAS_CELLS; i += 1) {
      this.cells.push({ key: -1, lastSeen: 0, loaded: false })
    }

    this.blitMesh = new Mesh(blitGeometry(), this.blitMaterial)
    this.blitMesh.frustumCulled = false
    this.blitScene.add(this.blitMesh)
  }

  get texture(): Texture {
    return this.target.texture
  }

  get capacity(): number {
    return this.capacityValue
  }

  /** Cells currently holding, or reserved for, a thumbnail. */
  get used(): number {
    return this.slots.size
  }

  /** The slot holding `key`, or -1. */
  slotOf(key: number): number {
    return this.slots.get(key) ?? -1
  }

  hasLoaded(key: number): boolean {
    const slot = this.slots.get(key)
    return slot !== undefined && this.cells[slot]!.loaded
  }

  /** PRD 5.5.4: this thumbnail is wanted on screen now, so it is not a candidate for eviction. */
  touch(key: number, now: number): void {
    const slot = this.slots.get(key)
    if (slot !== undefined) this.cells[slot]!.lastSeen = now
  }

  /**
   * Reserve a cell for `key`, evicting the least recently *visible* occupant if the atlas is full.
   *
   * Returns the slot, or -1 when every cell is either loaded-and-recent or reserved — in which case
   * the caller must not fetch, because there would be nowhere to put the result. "Recent" is PRD
   * 5.5.4's grace period: a cell seen within the last {@link THUMBNAIL_GRACE_S} seconds is not
   * taken, so a camera that swings past a shelf and back does not re-fetch what it just had.
   *
   * The key of anything evicted to make room is pushed onto `evicted`. The caller **must** act on
   * it: an evicted star still carries the `aThumb` byte that tells the star shader to fade out, and
   * leaving it set is a star that fades into a cell somebody else now owns.
   */
  claim(key: number, now: number, evicted: number[] = []): number {
    const existing = this.slots.get(key)
    if (existing !== undefined) {
      this.cells[existing]!.lastSeen = now
      return existing
    }

    if (this.slots.size < this.capacityValue) {
      for (let slot = 0; slot < this.capacityValue; slot += 1) {
        const cell = this.cells[slot]!
        if (cell.key !== -1) continue
        cell.key = key
        cell.lastSeen = now
        cell.loaded = false
        this.slots.set(key, slot)
        return slot
      }
    }

    const victim = this.leastRecentlyVisible(now)
    if (victim < 0) return -1
    const cell = this.cells[victim]!
    if (cell.key !== -1) evicted.push(cell.key)
    this.slots.delete(cell.key)
    cell.key = key
    cell.lastSeen = now
    cell.loaded = false
    this.slots.set(key, victim)
    return victim
  }

  /**
   * The evictable cell that has gone unseen longest, or -1 if none is evictable.
   *
   * A cell that is reserved but not yet loaded is never evicted whatever its age: it has a fetch in
   * flight against it, and taking it would land that fetch's bitmap in a cell now owned by someone
   * else. The loader cancels rather than evicting when it wants one of those back.
   */
  private leastRecentlyVisible(now: number): number {
    let victim = -1
    let oldest = Infinity
    for (let slot = 0; slot < this.capacityValue; slot += 1) {
      const cell = this.cells[slot]!
      if (cell.key === -1) return slot
      if (!cell.loaded) continue
      if (now - cell.lastSeen < THUMBNAIL_GRACE_S) continue
      if (cell.lastSeen < oldest) {
        oldest = cell.lastSeen
        victim = slot
      }
    }
    return victim
  }

  /** Give a reserved cell back without ever having filled it — the fetch failed or was dropped. */
  release(key: number): void {
    const slot = this.slots.get(key)
    if (slot === undefined) return
    const cell = this.cells[slot]!
    cell.key = -1
    cell.loaded = false
    this.slots.delete(key)
  }

  /**
   * Blit a decoded bitmap into the cell reserved for `key`.
   *
   * Closes the bitmap: nothing outside this call should hold a decoded image, and the caller has no
   * further use for one. Returns false if the reservation went away while the fetch was in flight.
   */
  upload(renderer: WebGLRenderer, key: number, bitmap: ImageBitmap): boolean {
    const slot = this.slots.get(key)
    if (slot === undefined) {
      bitmap.close()
      return false
    }

    const texture = new Texture(bitmap as unknown as HTMLImageElement)
    // Not a mistake: Scryfall's bytes are sRGB and the atlas stores them that way, so three must
    // not decode on the way in. See the file header.
    texture.colorSpace = NoColorSpace
    // Explicitly off, and it would be off in effect either way: `UNPACK_FLIP_Y_WEBGL` does not
    // apply to an `ImageBitmap`, whose orientation the WebGL spec fixes at creation. Saying `true`
    // here reads as a flip that is not happening — which is how the sheet came to draw upside down.
    // The orientation is handled once, in `blitGeometry`, where it is visible.
    texture.flipY = false
    texture.generateMipmaps = false
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.needsUpdate = true
    this.blitMaterial.map = texture
    this.blitMaterial.needsUpdate = true

    const x = (slot % ATLAS_COLUMNS) * ATLAS_CELL_WIDTH
    const y = Math.floor(slot / ATLAS_COLUMNS) * ATLAS_CELL_HEIGHT

    const previousTarget = renderer.getRenderTarget()
    const previousScissorTest = renderer.getScissorTest()
    // `setViewport`/`setScissor` take **CSS** pixels and multiply by the pixel ratio on the way to
    // GL; `getViewport`/`getScissor` hand back the same CSS-pixel rectangle. So the caller's frame
    // is saved and restored in those units, and the cell rectangle — which is in atlas texels, and
    // an atlas has no pixel ratio — is divided by the ratio going in so that three's multiply
    // lands it back on the exact texels {@link cellUv} maps.
    //
    // Getting either half of that wrong is not a small error. Passing drawing-buffer pixels to the
    // restore leaves a viewport 1.5× the buffer for the rest of the session, and every subsequent
    // frame of the *whole scene* draws scaled about the bottom-left corner; passing them to the
    // blit scales the cell rectangle into its neighbours, so cells overlap and thumbnails sample
    // each other. Both shipped, and `verify-browser`'s viewport assertion is there to keep them
    // from coming back.
    const ratio = renderer.getPixelRatio()
    renderer.getViewport(this.savedViewport)
    renderer.getScissor(this.savedScissor)
    renderer.setRenderTarget(this.target)
    // Viewport *and* scissor: the viewport places the quad, the scissor guarantees that a driver
    // rounding the quad's edges outwards cannot touch a neighbouring cell.
    renderer.setViewport(x / ratio, y / ratio, ATLAS_CELL_WIDTH / ratio, ATLAS_CELL_HEIGHT / ratio)
    renderer.setScissor(x / ratio, y / ratio, ATLAS_CELL_WIDTH / ratio, ATLAS_CELL_HEIGHT / ratio)
    renderer.setScissorTest(true)
    renderer.render(this.blitScene, this.blitCamera)
    // Restored before the render target is put back, not after: `setRenderTarget` sets the GL
    // viewport itself from whichever frame applies to the target it is binding, so it has to be the
    // last word.
    //
    // The other order is wrong in both directions, and the damaging one is the non-default target.
    // Binding a non-null target applies that target's own viewport to GL verbatim; a trailing
    // `setViewport(saved)` then overwrites it with the *caller's screen* rectangle and leaves it
    // there, so the next thing drawn into that target is scissored to a rectangle belonging to the
    // canvas. Binding the default framebuffer instead recomputes GL from the saved viewport — which
    // at that moment is still this cell — so the cell rectangle is on screen only until the
    // trailing `setViewport` corrects it, one statement later. Transient rather than harmless, and
    // no reason to rely on it.
    renderer.setScissorTest(previousScissorTest)
    renderer.setViewport(this.savedViewport)
    renderer.setScissor(this.savedScissor)
    renderer.setRenderTarget(previousTarget)

    this.blitMaterial.map = null
    texture.dispose()
    bitmap.close()

    this.cells[slot]!.loaded = true
    return true
  }

  /**
   * PRD 8.5.11's third degradation step: the thumbnail capacity.
   *
   * Shrinking evicts every cell above the new capacity, loaded or not, and returns their keys so
   * the loader can cancel any fetch that was aimed at them. Growing takes effect on the next claim.
   */
  setCapacity(capacity: number, evicted: number[] = []): number[] {
    const next = Math.max(1, Math.min(capacity, ATLAS_CELLS))
    if (next >= this.capacityValue) {
      this.capacityValue = next
      return evicted
    }
    for (let slot = next; slot < this.capacityValue; slot += 1) {
      const cell = this.cells[slot]!
      if (cell.key === -1) continue
      evicted.push(cell.key)
      this.slots.delete(cell.key)
      cell.key = -1
      cell.loaded = false
    }
    this.capacityValue = next
    return evicted
  }

  /** The cell's rectangle in atlas UV, for the instance attribute. */
  cellUv(slot: number, out: AtlasCellUv): AtlasCellUv {
    const x = (slot % ATLAS_COLUMNS) * ATLAS_CELL_WIDTH
    const y = Math.floor(slot / ATLAS_COLUMNS) * ATLAS_CELL_HEIGHT
    out.u = x / ATLAS_SIZE
    out.v = y / ATLAS_SIZE
    out.du = ATLAS_CELL_WIDTH / ATLAS_SIZE
    out.dv = ATLAS_CELL_HEIGHT / ATLAS_SIZE
    return out
  }

  /** Bytes this atlas occupies on the GPU. PRD 7.2's budget is checked against the sum of these. */
  get gpuBytes(): number {
    return ATLAS_BYTES
  }

  dispose(): void {
    this.target.dispose()
    this.blitMesh.geometry.dispose()
    this.blitMaterial.dispose()
  }
}
