/**
 * The one `BufferGeometry` behind PRD 8.5.1's single `Points` object, and the growing draw range
 * that PRD 8.7.3 streams into.
 *
 * Two GPU buffers, both preallocated to the manifest's star count at construction so a chunk
 * arriving never reallocates:
 *
 *  - the raw `stars.bin` records, uploaded byte for byte as one interleaved buffer. `aClass` and
 *    `aStyle` are views into it at offsets 6 and 9, so nothing about the record is repacked.
 *  - the positions, which *are* repacked, because a vertex attribute has to be one GL type and the
 *    record interleaves 16-bit floats with bytes. This is where the float32 fallback of PRD risk 6
 *    lives: same code path, different destination array.
 *
 * A partially arrived plane is not a problem: its stars sit inside the draw range with a plane fade
 * of 0, so they are invisible until every one of them has landed (PRD 6.8.1).
 */

import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Float16BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from 'three'

import { float16ToNumber } from '../../data/decode'
import { STAR_RECORD_BYTES } from '../../data/types'

/**
 * PRD risk 6's named mitigation. `float16` is the default and halves the position buffer;
 * `float32` is the escape hatch for a GPU or driver that mishandles half-float attributes.
 */
export type PositionMode = 'float16' | 'float32'

const POSITION_BYTES_IN_RECORD = 6

/**
 * Where the mode comes from, in precedence order: an explicit `?positions=float32` in the URL,
 * then a stored setting, then the default. PRD 7.1.2's cross-browser pass (Phase 6) exercises the
 * fallback through the query parameter, and PRD 6.10's settings surface (Phase 4) can persist it.
 */
export const POSITION_MODE_STORAGE_KEY = 'eternities:positions'

export function resolvePositionMode(
  search: string | undefined = typeof location === 'undefined' ? undefined : location.search,
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): PositionMode {
  const requested = search === undefined ? null : new URLSearchParams(search).get('positions')
  const stored = (() => {
    try {
      return storage?.getItem(POSITION_MODE_STORAGE_KEY) ?? null
    } catch {
      // Safari in private mode throws on localStorage access; a setting is not worth a crash.
      return null
    }
  })()
  const value = requested ?? stored
  return value === 'float32' || value === 'float16' ? value : 'float16'
}

export class StarGeometry {
  readonly geometry: BufferGeometry
  readonly capacity: number
  readonly positionMode: PositionMode

  /** Records uploaded so far. The draw range never exceeds it. */
  private uploaded = 0
  private readonly records: Uint8Array
  private readonly recordBuffer: InterleavedBuffer
  private readonly positions: Uint16Array | Float32Array
  private readonly positionAttribute: BufferAttribute
  private readonly filter: Uint8Array
  private readonly filterAttribute: BufferAttribute
  private readonly thumb: Uint8Array
  private readonly thumbAttribute: BufferAttribute

  constructor(capacity: number, positionMode: PositionMode = 'float16') {
    this.capacity = capacity
    this.positionMode = positionMode

    this.records = new Uint8Array(capacity * STAR_RECORD_BYTES)
    this.recordBuffer = new InterleavedBuffer(this.records, STAR_RECORD_BYTES)
    this.recordBuffer.setUsage(DynamicDrawUsage)

    // `Float16BufferAttribute` copies the array it is handed and flags it HALF_FLOAT, so take the
    // copy back as the destination. What goes into it is raw IEEE binary16 bit patterns lifted
    // out of the record and never converted: the GPU sees exactly the bytes the pipeline wrote.
    this.positionAttribute =
      positionMode === 'float32'
        ? new BufferAttribute(new Float32Array(capacity * 3), 3)
        : new Float16BufferAttribute(new Uint16Array(capacity * 3), 3)
    this.positions = this.positionAttribute.array as Uint16Array | Float32Array
    this.positionAttribute.setUsage(DynamicDrawUsage)

    // PRD 8.5.1's uint8 filter mask. Everything passes until Phase 4 says otherwise; normalised, so
    // the shader reads 1.0 for a pass and 0.0 for a fail.
    this.filterAttribute = new BufferAttribute(new Uint8Array(capacity).fill(255), 1, true)
    this.filter = this.filterAttribute.array as Uint8Array
    this.filterAttribute.setUsage(DynamicDrawUsage)

    // PRD 5.5.1 and 5.5.3, as one byte per star: 255 once this star's thumbnail is in the atlas and
    // may be cross-faded to, 0 while it is not. The *timing* of the cross-fade is camera distance
    // and nothing else (PRD 7.3.4); this only says whether there is anything to fade to, which is
    // PRD 5.5.3's "fall back to the star glow until loaded". Phase 3's thumbnail layer owns it.
    this.thumbAttribute = new BufferAttribute(new Uint8Array(capacity), 1, true)
    this.thumb = this.thumbAttribute.array as Uint8Array
    this.thumbAttribute.setUsage(DynamicDrawUsage)

    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', this.positionAttribute)
    this.geometry.setAttribute('aClass', new InterleavedBufferAttribute(this.recordBuffer, 3, 6))
    this.geometry.setAttribute('aStyle', new InterleavedBufferAttribute(this.recordBuffer, 3, 9))
    this.geometry.setAttribute('aFilter', this.filterAttribute)
    this.geometry.setAttribute('aThumb', this.thumbAttribute)
    this.geometry.setDrawRange(0, 0)
    // Positions are plane-local here and become world positions in the vertex shader, so three's
    // bounding sphere would describe a volume nothing is actually drawn in.
    this.geometry.boundingSphere = null
  }

  get drawCount(): number {
    return this.uploaded
  }

  /**
   * Take everything that has arrived. `body` is the record bytes of `stars.bin` with the header
   * stripped; `available` is how many whole records it holds. Uploads only the new tail, as a
   * `bufferSubData` on each of the two buffers.
   */
  append(body: Uint8Array, available: number): void {
    const to = Math.min(available, this.capacity)
    if (to <= this.uploaded) return
    const from = this.uploaded

    const byteFrom = from * STAR_RECORD_BYTES
    const byteTo = to * STAR_RECORD_BYTES
    this.records.set(body.subarray(byteFrom, byteTo), byteFrom)
    this.recordBuffer.addUpdateRange(byteFrom, byteTo - byteFrom)
    this.recordBuffer.needsUpdate = true

    if (this.positions instanceof Float32Array) {
      for (let i = from; i < to; i += 1) {
        const source = i * STAR_RECORD_BYTES
        const target = i * 3
        for (let axis = 0; axis < 3; axis += 1) {
          const offset = source + axis * 2
          this.positions[target + axis] = float16ToNumber(
            body[offset]! | (body[offset + 1]! << 8),
          )
        }
      }
    } else {
      for (let i = from; i < to; i += 1) {
        const source = i * STAR_RECORD_BYTES
        const target = i * 3
        for (let axis = 0; axis < 3; axis += 1) {
          const offset = source + axis * 2
          // Little-endian, matching the encoder; assembled by hand rather than through a
          // Uint16Array view because `body` may sit at an odd byte offset in its backing buffer.
          this.positions[target + axis] = body[offset]! | (body[offset + 1]! << 8)
        }
      }
    }
    this.positionAttribute.addUpdateRange(from * 3, (to - from) * 3)
    this.positionAttribute.needsUpdate = true

    this.uploaded = to
    this.geometry.setDrawRange(0, to)
  }

  /** PRD 5.8: the active filter, one byte per star. 255 passes, 0 dims. Phase 4 owns the rules. */
  setFilterMask(mask: Uint8Array, from = 0, count = mask.length): void {
    if (from + count > this.capacity) {
      throw new RangeError(`filter mask [${from}, ${from + count}) exceeds ${this.capacity} stars`)
    }
    this.filter.set(mask.subarray(0, count), from)
    this.filterAttribute.addUpdateRange(from, count)
    this.filterAttribute.needsUpdate = true
  }

  /** Everything passes again. Cheaper than handing in a full-length mask of 255s. */
  clearFilter(): void {
    this.filter.fill(255)
    this.filterAttribute.addUpdateRange(0, this.capacity)
    this.filterAttribute.needsUpdate = true
  }

  /** Whether a star currently passes the filter — the CPU side of PRD 5.8.3. */
  passesFilter(index: number): boolean {
    return index >= 0 && index < this.capacity && this.filter[index] !== 0
  }

  /**
   * PRD 5.5.1: this star now has a thumbnail in the atlas, or no longer does.
   *
   * One byte per call rather than a mask, because the caller is an LRU that gains and loses cells
   * a few at a time — the whole point of PRD 8.5.8's fixed capacity.
   */
  setThumbnailPresent(index: number, present: boolean): void {
    if (index < 0 || index >= this.capacity) return
    const value = present ? 255 : 0
    if (this.thumb[index] === value) return
    this.thumb[index] = value
    this.thumbAttribute.addUpdateRange(index, 1)
    this.thumbAttribute.needsUpdate = true
  }

  hasThumbnail(index: number): boolean {
    return index >= 0 && index < this.capacity && this.thumb[index] !== 0
  }

  /** The plane row a star belongs to, read straight out of the uploaded record. */
  planeRowOf(index: number): number {
    return this.records[index * STAR_RECORD_BYTES + POSITION_BYTES_IN_RECORD]!
  }

  /** PRD 5.4.8's hue class, for the thumbnail rim glow of PRD 5.5.2. */
  hueClassOf(index: number): number {
    return this.records[index * STAR_RECORD_BYTES + POSITION_BYTES_IN_RECORD + 1]!
  }

  /** PRD 5.4.9's size class. The cross-fade threshold is a *drawn* size, so rarity is part of it. */
  sizeClassOf(index: number): number {
    return this.records[index * STAR_RECORD_BYTES + POSITION_BYTES_IN_RECORD + 2]!
  }

  /** A star's plane-local position, for the CPU motion mirror of PRD 8.5.7. */
  localPosition(index: number, out: { x: number; y: number; z: number }): void {
    if (this.positions instanceof Float32Array) {
      out.x = this.positions[index * 3]!
      out.y = this.positions[index * 3 + 1]!
      out.z = this.positions[index * 3 + 2]!
    } else {
      out.x = float16ToNumber(this.positions[index * 3]!)
      out.y = float16ToNumber(this.positions[index * 3 + 1]!)
      out.z = float16ToNumber(this.positions[index * 3 + 2]!)
    }
  }

  dispose(): void {
    this.geometry.dispose()
  }
}
