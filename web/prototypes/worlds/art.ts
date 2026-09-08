/**
 * The near-cell art stream: real `art_crop` images into a `TEXTURE_2D_ARRAY`, as review §4.2
 * describes it ("`art_crop` letterboxed into 128×96 layers").
 *
 * A fixed pool of layers with LRU eviction, fed by whatever cells were big enough on screen last
 * frame. One layer is uploaded with `texSubImage3D` through `renderer.copyTextureToTexture`, so
 * streaming a card in does not re-upload the pool — which is the whole reason the pool is an array
 * texture and not an atlas canvas.
 *
 * The art is **letterboxed, never stretched or cropped**, and the shader draws it unshaded.
 * Scryfall's terms forbid distorting, stretching, blurring or brightness-shifting card art, and
 * review §4.4 flags the current planet shader for doing the second of those; concept B should not
 * inherit the problem, so the compliance is built into the pipeline here rather than bolted on.
 */

import * as THREE from 'three'

export const LAYER_WIDTH = 128
export const LAYER_HEIGHT = 96

/** How many `art_crop`s are resident at once. 256 × 128 × 96 × 4 B = 12.6 MB. */
const DEFAULT_LAYERS = 256

/** Concurrent fetches. The image CDN is unmetered (`docs/scryfall-policy.md:80`); stay polite. */
const MAX_IN_FLIGHT = 8

/** A layer wanted this frame is never evicted; one wanted within this many frames is spared too. */
const EVICTION_GRACE_FRAMES = 30

/**
 * `key >= 0` is resident art. `FREE` is unused. `RESERVED` is claimed by a fetch that has not
 * landed — without that third state two concurrent loads pick the same layer, one silently
 * overwrites the other, and the resident count climbs past the pool size.
 */
const FREE = -1
const RESERVED = -2

interface LayerState {
  key: number
  lastWanted: number
}

interface Wish {
  key: number
  uri: string
  priority: number
}

export interface ArtStats {
  readonly resident: number
  readonly layers: number
  readonly inFlight: number
  readonly wanted: number
  readonly completed: number
  readonly failed: number
  readonly evicted: number
}

export class ArtPool {
  readonly texture: THREE.DataArrayTexture

  private readonly renderer: THREE.WebGLRenderer
  private readonly layers: number
  private readonly layerOf = new Map<number, number>()
  private readonly state: LayerState[]
  private readonly free: number[]
  private readonly loading = new Set<number>()
  private readonly failedKeys = new Set<number>()
  private wishes: Wish[] = []
  private readonly scratch = document.createElement('canvas')
  private readonly position = new THREE.Vector3()

  private frame = 0
  private completed = 0
  private failed = 0
  private evicted = 0

  constructor(renderer: THREE.WebGLRenderer, layers = DEFAULT_LAYERS) {
    this.renderer = renderer
    this.layers = layers
    this.scratch.width = LAYER_WIDTH
    this.scratch.height = LAYER_HEIGHT

    const data = new Uint8Array(LAYER_WIDTH * LAYER_HEIGHT * 4 * layers)
    this.texture = new THREE.DataArrayTexture(data, LAYER_WIDTH, LAYER_HEIGHT, layers)
    this.texture.format = THREE.RGBAFormat
    this.texture.type = THREE.UnsignedByteType
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.wrapS = THREE.ClampToEdgeWrapping
    this.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture.flipY = false
    this.texture.generateMipmaps = false
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.needsUpdate = true

    this.state = Array.from({ length: layers }, () => ({ key: FREE, lastWanted: -1 }))
    this.free = Array.from({ length: layers }, (_unused, i) => layers - 1 - i)
  }

  beginFrame(): void {
    this.frame += 1
    this.wishes = []
  }

  /**
   * "This cell is on screen at `priority` pixels." Returns the resident layer, or `-1` if the art
   * is not there yet — the caller draws the swatch until it is.
   */
  want(key: number, uri: string, priority: number): number {
    const layer = this.layerOf.get(key)
    if (layer !== undefined) {
      this.state[layer]!.lastWanted = this.frame
      return layer
    }
    if (this.failedKeys.has(key) || this.loading.has(key)) return -1
    this.wishes.push({ key, uri, priority })
    return -1
  }

  /** Start the best fetches this frame's wishes justify. Call once per frame, after all `want`s. */
  pump(): void {
    if (this.wishes.length === 0) return
    this.wishes.sort((a, b) => b.priority - a.priority)
    for (const wish of this.wishes) {
      if (this.loading.size >= MAX_IN_FLIGHT) return
      const layer = this.claimLayer()
      if (layer < 0) return
      this.loading.add(wish.key)
      void this.load(wish.key, wish.uri, layer)
    }
  }

  stats(): ArtStats {
    return {
      resident: this.layerOf.size,
      layers: this.layers,
      inFlight: this.loading.size,
      wanted: this.wishes.length,
      completed: this.completed,
      failed: this.failed,
      evicted: this.evicted,
    }
  }

  private claimLayer(): number {
    const spare = this.free.pop()
    if (spare !== undefined) {
      this.state[spare] = { key: RESERVED, lastWanted: this.frame }
      return spare
    }

    let victim = -1
    let oldest = Infinity
    for (let i = 0; i < this.state.length; i += 1) {
      const entry = this.state[i]!
      if (entry.key === RESERVED) continue
      if (entry.key === FREE) {
        this.state[i] = { key: RESERVED, lastWanted: this.frame }
        return i
      }
      if (entry.lastWanted > this.frame - EVICTION_GRACE_FRAMES) continue
      if (entry.lastWanted < oldest) {
        oldest = entry.lastWanted
        victim = i
      }
    }
    if (victim < 0) return -1
    this.layerOf.delete(this.state[victim]!.key)
    this.state[victim] = { key: RESERVED, lastWanted: this.frame }
    this.evicted += 1
    return victim
  }

  private async load(key: number, uri: string, layer: number): Promise<void> {
    try {
      // `mode: 'cors'` so the upload is never tainted; `cards.scryfall.io` sends `allow-origin: *`.
      const res = await fetch(uri, { mode: 'cors', credentials: 'omit' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bitmap = await createImageBitmap(await res.blob())
      this.blit(bitmap, layer)
      bitmap.close()

      this.layerOf.set(key, layer)
      this.state[layer] = { key, lastWanted: this.frame }
      this.completed += 1
    } catch {
      this.failedKeys.add(key)
      this.failed += 1
      this.state[layer] = { key: FREE, lastWanted: -1 }
      this.free.push(layer)
    } finally {
      this.loading.delete(key)
    }
  }

  /** Letterbox into the layer: aspect preserved, bars where it does not fill. Never stretched. */
  private blit(bitmap: ImageBitmap, layer: number): void {
    const ctx = this.scratch.getContext('2d')
    if (ctx === null) throw new Error('no 2d context for the art scratch canvas')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, LAYER_WIDTH, LAYER_HEIGHT)
    const scale = Math.min(LAYER_WIDTH / bitmap.width, LAYER_HEIGHT / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.drawImage(bitmap, (LAYER_WIDTH - w) / 2, (LAYER_HEIGHT - h) / 2, w, h)

    const source = new THREE.Texture(this.scratch)
    source.needsUpdate = false
    this.position.set(0, 0, layer)
    this.renderer.copyTextureToTexture(source, this.texture, null, this.position)
    source.dispose()
  }
}
