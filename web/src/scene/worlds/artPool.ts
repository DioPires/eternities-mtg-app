/**
 * The art pool (spec §1.6): layers of a `TEXTURE_2D_ARRAY`, handed out to cells and taken back.
 *
 * `art_crop` is letterboxed into 128x96 layers and uploaded one layer at a time with
 * `copyTextureToTexture(source, target, null, new Vector3(0, 0, layer))` — a `texSubImage3D` of one
 * layer, so streaming a card in never re-uploads the pool. That argument is the whole reason the
 * pool is an array texture and not an atlas canvas, and it is why this module hands out *indices*
 * and never touches GL.
 *
 * Everything here is deliberately testable without a context, because the two bugs it exists to
 * prevent are both invisible on this Mac: one needs a driver that reports a small limit, the other
 * needs a fetch to be in flight at the moment a second cell asks for the same key.
 */

/** A layer nothing holds. */
export const LAYER_FREE = -1

/**
 * A layer claimed by an **in-flight fetch** (§1.6).
 *
 * > **Normative — the pool needs three states, not two.** Without this one a layer claimed by a
 * > fetch still reads free, two loads claim it, one silently overwrites the other, and the resident
 * > count climbs *past* the pool size. The prototype observed **1,031 resident in a 1,024-layer
 * > pool**; that impossible number is the only tell there ever was. {@link ArtPool.resident} is
 * > asserted `<= layers` in this module's unit test for exactly that reason.
 */
export const LAYER_RESERVED = -2

/**
 * Driver slack: sit one notch below whatever limit the implementation states (§1.6).
 *
 * **This is not accounting.** `MAX_ARRAY_TEXTURE_LAYERS` is a *per-array-texture* limit, not a
 * global pool, so the equirect swatch array (§1.5 — 45 layers on v3) is a separate texture object
 * and takes nothing from the art pool's allowance. The 32 is cheap insurance (1.5 MiB at tier 0)
 * against drivers that report a limit they will not actually allocate at 128x96x4; nothing is being
 * reserved for anything.
 */
const DRIVER_SLACK_LAYERS = 32

/** A layer wanted within this many frames is never evicted (§1.6). */
const EVICTION_GRACE_FRAMES = 30

/**
 * The pool size for a tier on this GPU: `max(0, min(tierLayers, maxLayers - 32))` (§1.6, §1.12).
 *
 * > **Normative — the outer `max` is load-bearing (DEC-749's N1).** W4.1's `capabilities.ts`
 * > reports `maxArrayTextureLayers` as **0**, not as a large number, on two reachable paths: a
 * > non-WebGL2 context (`webgl2 ? getParameter(...) : 0`) and a context that has been lost, where
 * > `numberParameter`'s `try`/`catch` returns its `0` fallback. `min(tierLayers, 0 - 32)` is
 * > **-32 layers at every tier**, so the formula without the floor turns the one case the clamp
 * > exists to protect into a negative allocation. **A pool of 0 is legal** — a swatch-only world,
 * > which is what §1.4's shading path already degrades to when no cell holds a layer — and is not a
 * > black one.
 *
 * > **Knock-on for the ladder (§1.12).** WebGL 2's *specification minimum* for
 * > `MAX_ARRAY_TEXTURE_LAYERS` is **256, not 1,024**. On a device at that minimum, tiers 0, 1, 2
 * > and 3 all clamp to **224** and only tier 4 is distinct — so `e2e/quality.spec.ts` must assert
 * > against the value the renderer *reports*, not against the tier constant. An assertion written
 * > against the constants passes on this Mac, where neither bound binds, and fails on the hardware
 * > W0.1 is about to measure. This function is the seam that makes the reported value available.
 *
 * Callers decide *whether* to build a pool at all from `webgl2` / `arrayLayersAffordable`; this
 * never subtracts from an unanswered limit and then acts on the difference.
 */
export function artPoolSize(tierLayers: number, maxArrayTextureLayers: number): number {
  return Math.max(0, Math.min(tierLayers, maxArrayTextureLayers - DRIVER_SLACK_LAYERS))
}

/** What the probe reports about the pool, and what §1.12's ladder assertion reads (§3.1). */
export interface ArtPoolReport {
  /** The **clamped** layer count — the seam §1.12 says to assert against. */
  readonly layers: number
  readonly resident: number
  readonly reserved: number
  /** Monotonic since construction. The gate differences it across frames; it never resets. */
  readonly evictions: number
}

/**
 * A three-state LRU over the pool's layers.
 *
 * The keys are opaque integers — the caller's card index. The pool does not know what a card is,
 * does not fetch, and does not upload; it answers "which layer is this key on" and "which layer may
 * I overwrite".
 *
 * > **`showingArt` is not this object's business (§1.6, DEC-752).** A cell shows art when its
 * > `iArt` cross-fade has reached 1, not when the pool handed it a layer and not when the fetch
 * > resolved. W4's numerator is what the frame shows, and a cell mid-fade is showing its swatch.
 * > Reading residency as "showing art" is precisely the bookkeeping-for-picture substitution the
 * > 1,031-resident-in-1,024 bug hid behind.
 */
export class ArtPool {
  readonly layers: number

  /** Per layer: a key `>= 0`, {@link LAYER_FREE}, or {@link LAYER_RESERVED}. */
  private readonly state: Int32Array
  /** Per layer: the frame it was last wanted on, which is what the LRU orders by. */
  private readonly touched: Int32Array
  private readonly byKey = new Map<number, number>()
  /**
   * Keys whose fetch failed. **Never retried in the same session** (§1.6) — a key that 404s once
   * would otherwise be re-requested every frame it is on screen, which is the churn the adaptive
   * threshold exists to remove, reintroduced through the error path.
   */
  private readonly failed = new Set<number>()
  private residentCount = 0
  private reservedCount = 0
  private evictionCount = 0

  constructor(layers: number) {
    this.layers = Math.max(0, Math.floor(layers))
    this.state = new Int32Array(this.layers).fill(LAYER_FREE)
    this.touched = new Int32Array(this.layers).fill(-1 - EVICTION_GRACE_FRAMES)
  }

  get resident(): number {
    return this.residentCount
  }

  get reserved(): number {
    return this.reservedCount
  }

  get evictions(): number {
    return this.evictionCount
  }

  report(): ArtPoolReport {
    return {
      layers: this.layers,
      resident: this.residentCount,
      reserved: this.reservedCount,
      evictions: this.evictionCount,
    }
  }

  /** The layer holding `key`, or `null` if it is absent or still in flight. */
  layerOf(key: number): number | null {
    const layer = this.byKey.get(key)
    if (layer === undefined || this.state[layer] !== key) return null
    return layer
  }

  /** Whether `key` has already failed once and must not be asked for again. */
  hasFailed(key: number): boolean {
    return this.failed.has(key)
  }

  /**
   * Mark `key` as wanted on `frame`, so the grace window protects it.
   *
   * Cheap and idempotent: the selection pass calls this for every cell above the threshold,
   * including ones whose fetch has not started.
   */
  want(key: number, frame: number): void {
    const layer = this.byKey.get(key)
    if (layer !== undefined) this.touched[layer] = frame
  }

  /**
   * Claim a layer for `key`'s in-flight fetch, or `null` if the pool has nothing to give.
   *
   * Returns the existing layer if `key` is already resident or already reserved, which is the case
   * the two-state pool got wrong. A `null` is not an error — under the adaptive threshold it should
   * be vanishingly rare, and under `?artThreshold=fixed24` it is the exhaustion W4's control is
   * there to produce.
   */
  reserve(key: number, frame: number): number | null {
    if (this.failed.has(key)) return null
    const held = this.byKey.get(key)
    if (held !== undefined) {
      this.touched[held] = frame
      return held
    }
    const layer = this.claimLayer(frame)
    if (layer === null) return null
    this.state[layer] = LAYER_RESERVED
    this.touched[layer] = frame
    this.byKey.set(key, layer)
    this.reservedCount += 1
    return layer
  }

  /** The fetch landed: the reservation becomes residency. */
  resolve(key: number): number | null {
    const layer = this.byKey.get(key)
    if (layer === undefined || this.state[layer] !== LAYER_RESERVED) return null
    this.state[layer] = key
    this.reservedCount -= 1
    this.residentCount += 1
    return layer
  }

  /** The fetch failed: the layer goes back, and the key is never asked for again this session. */
  fail(key: number): void {
    const layer = this.byKey.get(key)
    this.failed.add(key)
    if (layer === undefined || this.state[layer] !== LAYER_RESERVED) return
    this.state[layer] = LAYER_FREE
    this.byKey.delete(key)
    this.reservedCount -= 1
  }

  /**
   * A free layer, or the least-recently-wanted resident one outside the grace window.
   *
   * **A reserved layer is never a candidate.** That is the whole point of the third state: evicting
   * one would leave a fetch in flight whose completion writes over a layer another key now owns.
   */
  private claimLayer(frame: number): number | null {
    for (let layer = 0; layer < this.layers; layer += 1) {
      if (this.state[layer] === LAYER_FREE) return layer
    }
    let victim = -1
    let oldest = frame - EVICTION_GRACE_FRAMES
    for (let layer = 0; layer < this.layers; layer += 1) {
      if (this.state[layer]! < 0) continue
      if (this.touched[layer]! < oldest) {
        oldest = this.touched[layer]!
        victim = layer
      }
    }
    if (victim < 0) return null
    this.byKey.delete(this.state[victim]!)
    this.state[victim] = LAYER_FREE
    this.residentCount -= 1
    this.evictionCount += 1
    return victim
  }
}
