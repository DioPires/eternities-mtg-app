/**
 * PRD 5.5.3's "nearest to the camera first": which cards the thumbnail tier should be holding.
 *
 * **The whole thing happens in the plane's local frame, and that is the design.** PRD 8.5.7 allows
 * exactly one star position on the CPU — the focused one — because a per-frame world-space walk
 * over a plane's stars is precisely the per-star CPU work PRD 8.5.3 moved into the vertex shader.
 * So the camera is transformed *into* the plane's frame once per pass, and the ranking is then a
 * subtraction and a dot product per star, with no trigonometry, no plane transform and no motion
 * mirror anywhere in it. The positions it reads are the raw `stars.bin` locals the shader itself
 * consumes; it never computes where a star *is*.
 *
 * Two consequences worth stating rather than discovering:
 *
 *  - **The rotations drop out.** Spin, tilt and the multiverse rotation are isometries, and the
 *    radius is a uniform scale, so a local distance times the plane radius *is* the world distance.
 *    Nothing is approximated by working locally.
 *  - **The shear does not drop out**, because it turns each star by an angle that depends on its
 *    own radius, so it is not one rigid motion. It is bounded at 10° (PRD 5.4.13), which moves a
 *    star at most `0.17 · r` and can only reorder two cards that were already within that of each
 *    other. This ranks fetches and picks a visible set; where a thumbnail is *drawn* is the vertex
 *    shader's answer and carries no such error.
 *
 * The pass runs on a timer (PRD 5.5.3 wants nearest, not instantaneous), skips entirely when no
 * star on the plane could reach the cross-fade band, and keeps its result in preallocated buffers
 * (PRD 7.3.2).
 */

import type { PlaneRecord } from '../../data/types'
import type { SceneMotion } from '../../camera/motion'
import { dot, sub, vec, type MutVec3 } from '../../camera/vec'
import { FRAME_RADIUS } from '../../data/types'
import type { StarGeometry } from '../starfield/starGeometry'
import { RARITY_SIZE, STAR_WORLD_DIAMETER, THUMBNAIL_FADE_START_PX } from '../tuning'

/**
 * How much nearer than the focused card a thumbnail may be before it is culled.
 *
 * Not 1.0: a card sits *in* the sheet, and its immediate neighbours are a hair nearer than it
 * without being in front of it. Just under the card's own half-height as a fraction of the tether's
 * framing distance, so what goes is the wall and not the shelf.
 */
const NEAR_CULL_FRACTION = 0.8

export interface SelectorView {
  /** Camera position in world space. */
  readonly position: Readonly<MutVec3>
  /** Unit forward direction in world space. */
  readonly forward: Readonly<MutVec3>
  /**
   * World units to device pixels at one unit of depth — `drawingBufferHeight / (2 tan(fov/2))`,
   * the same `uSizeScale` the star shader is given, so one formula decides the cross-fade in both
   * places.
   */
  readonly sizeScale: number
  /** Device pixels per CSS pixel, because PRD 5.5.1's 24 px is a CSS pixel. */
  readonly pixelRatio: number
}

/**
 * A bounded max-heap of the nearest `k` stars.
 *
 * The alternative — collect every candidate and sort — is `O(n log n)` with an allocation for the
 * candidate list, over a plane that can hold several thousand cards. This is `O(n log k)` with
 * `k ≤ 512` into two arrays allocated once.
 */
class NearestHeap {
  private readonly indices: Int32Array
  private readonly keys: Float32Array
  private size = 0
  private limit: number

  constructor(capacity: number) {
    this.indices = new Int32Array(capacity)
    this.keys = new Float32Array(capacity)
    this.limit = capacity
  }

  get count(): number {
    return this.size
  }

  get entries(): Int32Array {
    return this.indices
  }

  /** Distance of the current worst entry, or `Infinity` while there is room. */
  get worst(): number {
    return this.size < this.limit ? Infinity : this.keys[0]!
  }

  reset(limit: number): void {
    this.size = 0
    this.limit = Math.max(1, Math.min(limit, this.indices.length))
  }

  offer(index: number, key: number): void {
    if (this.size < this.limit) {
      this.indices[this.size] = index
      this.keys[this.size] = key
      this.siftUp(this.size)
      this.size += 1
      return
    }
    if (key >= this.keys[0]!) return
    this.indices[0] = index
    this.keys[0] = key
    this.siftDown(0)
  }

  /** Sort the heap's contents nearest-first, in place. Called once per pass, over ≤ 512 entries. */
  sortAscending(): void {
    // Heap-sort by repeatedly moving the max to the end; the result is ascending by key.
    let end = this.size - 1
    const originalSize = this.size
    while (end > 0) {
      this.swap(0, end)
      this.size = end
      this.siftDown(0)
      end -= 1
    }
    this.size = originalSize
  }

  private swap(a: number, b: number): void {
    const i = this.indices[a]!
    const k = this.keys[a]!
    this.indices[a] = this.indices[b]!
    this.keys[a] = this.keys[b]!
    this.indices[b] = i
    this.keys[b] = k
  }

  private siftUp(start: number): void {
    let child = start
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (this.keys[parent]! >= this.keys[child]!) break
      this.swap(parent, child)
      child = parent
    }
  }

  private siftDown(start: number): void {
    let parent = start
    for (;;) {
      const left = parent * 2 + 1
      if (left >= this.size) break
      const right = left + 1
      let largest = left
      if (right < this.size && this.keys[right]! > this.keys[left]!) largest = right
      if (this.keys[parent]! >= this.keys[largest]!) break
      this.swap(parent, largest)
      parent = largest
    }
  }
}

export class ThumbnailSelector {
  /** Star indices wanted on screen, nearest first. Valid for `count` entries. */
  private readonly heap: NearestHeap
  private countValue = 0
  private elapsed = 0
  private lastPlaneIndex = -1

  /** The camera in the plane's local frame, cached between passes for `screenPxOf`. */
  private readonly localEye: MutVec3 = vec()
  private readonly localForward: MutVec3 = vec()
  private readonly scratch: MutVec3 = vec()
  private readonly rel: MutVec3 = vec()
  private planeRadius = 1
  private sizeScaleCss = 1

  constructor(maxCapacity: number) {
    this.heap = new NearestHeap(maxCapacity)
  }

  get count(): number {
    return this.countValue
  }

  get visible(): Int32Array {
    return this.heap.entries
  }

  /** The plane whose stars the current selection came from, or -1. */
  get planeIndex(): number {
    return this.lastPlaneIndex
  }

  /** Nothing is near enough to be a card any more. */
  clear(): void {
    this.countValue = 0
    this.lastPlaneIndex = -1
  }

  /**
   * Re-rank if the timer has come round. Returns true when the selection changed hands.
   *
   * `intervalS` of 0 forces a pass, which is what a test and a fresh focus both want.
   */
  update(
    dt: number,
    intervalS: number,
    geometry: StarGeometry,
    motion: SceneMotion,
    plane: PlaneRecord,
    view: SelectorView,
    capacity: number,
    focusedStar = -1,
  ): boolean {
    this.elapsed += dt
    if (this.elapsed < intervalS && plane.index === this.lastPlaneIndex) return false
    this.elapsed = 0
    this.select(geometry, motion, plane, view, capacity, focusedStar)
    return true
  }

  private select(
    geometry: StarGeometry,
    motion: SceneMotion,
    plane: PlaneRecord,
    view: SelectorView,
    capacity: number,
    focusedStar: number,
  ): void {
    this.lastPlaneIndex = plane.index
    this.planeRadius = plane.radius
    this.sizeScaleCss = view.sizeScale / Math.max(view.pixelRatio, 1e-6)

    motion.worldToPlaneLocal(this.localEye, plane, view.position)
    motion.worldDirToPlaneLocal(this.localForward, plane, view.forward)

    // The largest star the plane could hold, at the nearest point of its disc. If even that would
    // be under the band there is nothing to select and the walk is skipped entirely — which is the
    // multiverse-level case, i.e. almost all of the time.
    const nearest = Math.max(
      0,
      Math.hypot(this.localEye.x, this.localEye.y, this.localEye.z) - FRAME_RADIUS,
    )
    const biggest = this.screenPx(STAR_WORLD_DIAMETER * RARITY_SIZE[3], nearest)
    if (biggest < THUMBNAIL_FADE_START_PX) {
      this.countValue = 0
      return
    }

    // PRD 5.6.1 and 5.7.5: while a card is focused it is the subject, and nothing may stand between
    // it and the eye. A dense plane puts hundreds of cards inside the 2.2 units the card tether
    // frames from — Dominaria's 6,266 sit a fraction of a unit apart — so without this the sheet
    // becomes a wall in front of the card the user just clicked. Measured from the focused star, so
    // the cards *around* and *behind* it are exactly the ones that stay.
    let nearLimit = 0
    if (focusedStar >= 0) {
      geometry.localPosition(focusedStar, this.scratch)
      sub(this.rel, this.scratch, this.localEye)
      nearLimit = Math.hypot(this.rel.x, this.rel.y, this.rel.z) * NEAR_CULL_FRACTION
    }

    const from = plane.starOffset
    const to = Math.min(plane.starOffset + plane.starCount, geometry.drawCount)
    this.heap.reset(capacity)

    for (let index = from; index < to; index += 1) {
      // The focused star *is* the card now (PRD 5.6.1); a thumbnail of it as well would be the
      // same picture at two sizes in the same place.
      if (index === focusedStar) continue
      geometry.localPosition(index, this.scratch)
      sub(this.rel, this.scratch, this.localEye)
      // Behind the camera is not a candidate: PRD 5.5.4 unloads what leaves the frustum, and
      // fetching for it in the first place would spend the six-request budget on the back wall.
      if (dot(this.rel, this.localForward) <= 0) continue
      const local = Math.hypot(this.rel.x, this.rel.y, this.rel.z)
      if (local < nearLimit) continue
      if (local >= this.heap.worst) continue
      const size = STAR_WORLD_DIAMETER * RARITY_SIZE[geometry.sizeClassOf(index)]!
      if (this.screenPx(size, local) < THUMBNAIL_FADE_START_PX) continue
      this.heap.offer(index, local)
    }

    this.heap.sortAscending()
    this.countValue = this.heap.count
  }

  /**
   * A star's current drawn diameter in CSS pixels, from the cached local camera.
   *
   * The image queue re-reads this at dequeue time so a request that waited while the camera moved
   * is re-ranked rather than fetched at the priority it was queued with (PRD 5.5.3).
   */
  screenPxOf(geometry: StarGeometry, index: number): number {
    geometry.localPosition(index, this.scratch)
    sub(this.rel, this.scratch, this.localEye)
    const local = Math.hypot(this.rel.x, this.rel.y, this.rel.z)
    return this.screenPx(STAR_WORLD_DIAMETER * RARITY_SIZE[geometry.sizeClassOf(index)]!, local)
  }

  /** Distance from the camera to a star, in world units, from the cached local camera. */
  distanceOf(geometry: StarGeometry, index: number): number {
    geometry.localPosition(index, this.scratch)
    sub(this.rel, this.scratch, this.localEye)
    return Math.hypot(this.rel.x, this.rel.y, this.rel.z) * this.planeRadius
  }

  /** `size` is a world diameter, `local` a distance in the plane's local units. */
  private screenPx(size: number, local: number): number {
    const world = local * this.planeRadius
    return (size * this.sizeScaleCss) / Math.max(world, 1e-6)
  }
}
