/**
 * The one `BufferGeometry` behind PRD 8.5.1's single `Points` object, and the growing draw range
 * that PRD 8.7.3 streams into.
 *
 * **Two GPU buffers, sixteen aligned bytes a star (DEC-739, review §3.5).** Both are preallocated to
 * the manifest's star count at construction, so a chunk arriving never reallocates:
 *
 *  - **positions**, four half floats per star — `xyz` and one pad — so the stride is 8 bytes rather
 *    than an unaligned 6. The float32 fallback of PRD risk 6 lives here too: same code path,
 *    different destination array, and at 12 bytes a star it is already aligned and needs no pad.
 *  - **the byte attributes**, two `u8x4` vectors per star: `aClass` = (planeIndex, colourByte,
 *    sizeClass, **filter**) at offset 0 and `aStyle` = (brightness, twinklePhase, typeMask,
 *    **thumbnail present**) at offset 4.
 *
 * The layout and the reasoning are in `../../data/types` beside the on-disk record they repack; the
 * short version is that D3D11 wants every offset and stride to be a multiple of four, the shipped
 * layout broke that in four places, and ANGLE's answer to a misaligned buffer is to repack it on the
 * CPU — once per plane, as `stars.bin` streams, on exactly the Windows laptops nobody has measured.
 *
 * **What this is not.** The on-disk contract does not change: `stars.bin` is still 12-byte records
 * and `decodeStars` still reads them. What used to be uploaded *was* the on-disk record, byte for
 * byte, with `aClass` and `aStyle` as views into it at offsets 6 and 9 — so "nothing is repacked"
 * was true of the app and false of the driver. {@link StarGeometry.append} now does the repack
 * itself, in the loop that was already walking every record to lift its position out.
 *
 * A partially arrived plane is not a problem: its stars sit inside the draw range with a plane fade
 * of 0, so they are invisible until every one of them has landed (PRD 6.8.1).
 */

import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from 'three'

import type { PositionMode } from '../platform/positionMode'

import {
  colourByteOfPacked,
  colourIdentityFromColourByte,
  hueClassFromColourByte,
} from '../../data/colourByte'
import { float16ToNumber } from '../../data/decode'
import {
  FILTER_MASK_PASS,
  PACKED_ATTRIBUTE_BYTES,
  PACKED_CLASS_OFFSET,
  PACKED_FILTER_LANE,
  PACKED_POSITION_HALVES,
  PACKED_STYLE_OFFSET,
  PACKED_THUMB_LANE,
  STAR_RECORD_BYTES,
} from '../../data/types'


export class StarGeometry {
  readonly geometry: BufferGeometry
  readonly capacity: number
  readonly positionMode: PositionMode

  /** Records uploaded so far. The draw range never exceeds it. */
  private uploaded = 0
  /**
   * The repacked byte attributes, `PACKED_ATTRIBUTE_BYTES` per star. `aClass` and `aStyle` are
   * `u8x4` views into this at offsets 0 and 4, and the filter and thumbnail masks are their `w`
   * lanes — so the CPU-side readers below index it directly rather than keeping a copy of the
   * on-disk record, which no longer exists on this side of the load.
   */
  private readonly attributes: Uint8Array
  private readonly attributeBuffer: InterleavedBuffer
  private readonly positions: Uint16Array | Float32Array
  /** Stride of {@link positions} in array elements: 4 halves when padded, 3 floats when not. */
  private readonly positionStride: number
  private readonly positionBuffer: InterleavedBuffer | null
  private readonly positionAttribute: BufferAttribute | InterleavedBufferAttribute

  constructor(capacity: number, positionMode: PositionMode = 'float16') {
    this.capacity = capacity
    this.positionMode = positionMode

    this.attributes = new Uint8Array(capacity * PACKED_ATTRIBUTE_BYTES)
    // PRD 8.5.1's uint8 filter mask: everything passes until a filter says otherwise.
    // `FILTER_MASK_PASS` is the same constant `filters/evaluate.ts` writes, which is what keeps
    // `setFilterMask` a copy rather than a translation.
    for (let i = 0; i < capacity; i += 1) {
      this.attributes[i * PACKED_ATTRIBUTE_BYTES + PACKED_FILTER_LANE] = FILTER_MASK_PASS
    }
    this.attributeBuffer = new InterleavedBuffer(this.attributes, PACKED_ATTRIBUTE_BYTES)
    this.attributeBuffer.setUsage(DynamicDrawUsage)

    if (positionMode === 'float32') {
      // Three floats at a stride of 12 bytes: already a multiple of four, so the fallback needs no
      // pad and pays no repack. A plain `BufferAttribute` is the tightest spelling of that.
      this.positionStride = 3
      this.positionBuffer = null
      const attribute = new BufferAttribute(new Float32Array(capacity * 3), 3)
      attribute.setUsage(DynamicDrawUsage)
      this.positionAttribute = attribute
      this.positions = attribute.array as Float32Array
    } else {
      /*
       * Four halves at a stride of 8 bytes: `xyz` and a pad lane that exists solely to make the
       * stride a power of two. What goes in is raw IEEE binary16 bit patterns lifted out of the
       * record and never converted, so the GPU sees exactly the bytes the pipeline wrote.
       *
       * `isFloat16BufferAttribute` is set on the `InterleavedBuffer` by hand, and it is the one
       * piece of this file that reaches into three's internals. three picks a vertex attribute's GL
       * type from the array backing its buffer — `WebGLAttributes.createBuffer` maps `Uint16Array`
       * to `UNSIGNED_SHORT` *unless* that flag is set, in which case `HALF_FLOAT` — and it resolves
       * an `InterleavedBufferAttribute` to its `.data` before asking. There is no
       * `Float16InterleavedBuffer` to use instead; the flag is the only way to get a padded
       * half-float stride out of three. `test/starfield.test.ts` asserts the flag is set, so an
       * upgrade that renames it fails a test rather than silently uploading every position as an
       * unsigned short.
       *
       * Re-verified at **0.186.0** by DEC-741 (audit item N4): `createBuffer` still maps
       * `Uint16Array` to `UNSIGNED_SHORT` unless this flag selects `HALF_FLOAT`, and the
       * interleaved resolution to `.data` is unchanged. r186 added a branch for a native
       * `Float16Array` *above* this one, which does not touch the `Uint16Array` path taken here.
       * The build line numbers this comment used to cite are dropped: they moved between r170 and
       * r186 while the behaviour did not, so they dated the comment without protecting anything.
       */
      this.positionStride = PACKED_POSITION_HALVES
      const buffer = new InterleavedBuffer(
        new Uint16Array(capacity * PACKED_POSITION_HALVES),
        PACKED_POSITION_HALVES,
      )
      ;(buffer as InterleavedBuffer & { isFloat16BufferAttribute: boolean }).isFloat16BufferAttribute =
        true
      buffer.setUsage(DynamicDrawUsage)
      this.positionBuffer = buffer
      this.positionAttribute = new InterleavedBufferAttribute(buffer, 3, 0)
      this.positions = buffer.array as Uint16Array
    }

    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', this.positionAttribute)
    // Four components each, both four-byte aligned. The fourth lane of `aClass` is PRD 5.8's filter
    // mask and the fourth of `aStyle` is PRD 5.5.1's "the thumbnail is in the atlas" byte; both were
    // stride-1 attributes of their own before DEC-739, which is the worst alignment in the old
    // layout, and both vectors had a spare lane. The shader normalises them itself — see
    // `./shaders.ts` — rather than three doing it, because the other three lanes of each vector are
    // raw byte values and a buffer is normalised or it is not.
    this.geometry.setAttribute(
      'aClass',
      new InterleavedBufferAttribute(this.attributeBuffer, 4, PACKED_CLASS_OFFSET),
    )
    this.geometry.setAttribute(
      'aStyle',
      new InterleavedBufferAttribute(this.attributeBuffer, 4, PACKED_STYLE_OFFSET),
    )
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

    const float32 = this.positions instanceof Float32Array
    const stride = this.positionStride

    // One walk of the new tail, writing both buffers. This loop already existed to lift the
    // positions out of the record; DEC-739 gave it the six byte attributes as well, which is why
    // the repack costs no second pass over 28,587 records.
    for (let i = from; i < to; i += 1) {
      const source = i * STAR_RECORD_BYTES
      const target = i * stride
      for (let axis = 0; axis < 3; axis += 1) {
        const offset = source + axis * 2
        // Little-endian, matching the encoder; assembled by hand rather than through a
        // `Uint16Array` view because `body` may sit at an odd byte offset in its backing buffer.
        const bits = body[offset]! | (body[offset + 1]! << 8)
        this.positions[target + axis] = float32 ? float16ToNumber(bits) : bits
      }
      // The pad lane is left at zero. Nothing reads it — `position` is a three-component attribute
      // over a four-element stride — and writing it would only make the loop longer.

      const attribute = i * PACKED_ATTRIBUTE_BYTES
      // Record bytes 6,7,8 are (planeIndex, colourByte, sizeClass) and 9,10,11 are (brightness,
      // twinklePhase, typeMask). They land in the first three lanes of each vector; the fourth
      // lanes are the filter and thumbnail masks, which are not in the record and are owned by
      // `setFilterMask` and `setThumbnailPresent`.
      this.attributes[attribute + PACKED_CLASS_OFFSET] = body[source + 6]!
      this.attributes[attribute + PACKED_CLASS_OFFSET + 1] = body[source + 7]!
      this.attributes[attribute + PACKED_CLASS_OFFSET + 2] = body[source + 8]!
      this.attributes[attribute + PACKED_STYLE_OFFSET] = body[source + 9]!
      this.attributes[attribute + PACKED_STYLE_OFFSET + 1] = body[source + 10]!
      this.attributes[attribute + PACKED_STYLE_OFFSET + 2] = body[source + 11]!
    }

    this.attributeBuffer.addUpdateRange(
      from * PACKED_ATTRIBUTE_BYTES,
      (to - from) * PACKED_ATTRIBUTE_BYTES,
    )
    this.attributeBuffer.needsUpdate = true

    // On the *buffer* for the padded half path and on the attribute for the plain float32 one:
    // three reads `needsUpdate` and the update ranges off whichever object owns the array, and an
    // `InterleavedBufferAttribute` owns none of its own.
    const positionTarget = this.positionBuffer ?? (this.positionAttribute as BufferAttribute)
    positionTarget.addUpdateRange(from * stride, (to - from) * stride)
    positionTarget.needsUpdate = true

    this.uploaded = to
    this.geometry.setDrawRange(0, to)
  }

  /**
   * PRD 5.8: the active filter, one byte per star. {@link FILTER_MASK_PASS} passes, 0 dims.
   *
   * The rules are `filters/evaluate.ts`'s and the subscription that brings the result here is
   * `app/filterMask.ts`. The mask is copied, so the caller may keep reusing its buffer.
   */
  setFilterMask(mask: Uint8Array, from = 0, count = mask.length): void {
    if (from + count > this.capacity) {
      throw new RangeError(`filter mask [${from}, ${from + count}) exceeds ${this.capacity} stars`)
    }
    // A strided scatter rather than the `set` this used to be, because the mask now lives in the
    // `w` lane of `aClass` (DEC-739). 28,587 byte writes on a filter change, which happens when a
    // chip is clicked and not per frame; the alignment it buys is paid for on every `bufferSubData`
    // of the stream. See `../../data/types`' `PACKED_*` block.
    for (let i = 0; i < count; i += 1) {
      this.attributes[(from + i) * PACKED_ATTRIBUTE_BYTES + PACKED_FILTER_LANE] = mask[i]!
    }
    this.markAttributeRange(from, count)
  }

  /** Everything passes again. Cheaper than handing in a full-length mask of pass bytes. */
  clearFilter(): void {
    for (let i = 0; i < this.capacity; i += 1) {
      this.attributes[i * PACKED_ATTRIBUTE_BYTES + PACKED_FILTER_LANE] = FILTER_MASK_PASS
    }
    this.markAttributeRange(0, this.capacity)
  }

  /** Whether a star currently passes the filter — the CPU side of PRD 5.8.3. */
  passesFilter(index: number): boolean {
    return (
      index >= 0 &&
      index < this.capacity &&
      this.attributes[index * PACKED_ATTRIBUTE_BYTES + PACKED_FILTER_LANE] !== 0
    )
  }

  /**
   * Flag `count` stars' worth of the attribute buffer dirty, in the buffer's own element units.
   *
   * A whole-stride range rather than the single lane that changed: an update range is a byte span
   * for `bufferSubData`, and a lane at stride 8 is not a span. Marking the strides that contain the
   * changed lanes is both correct and what the driver would have to upload anyway.
   */
  private markAttributeRange(from: number, count: number): void {
    if (count <= 0) return
    this.attributeBuffer.addUpdateRange(
      from * PACKED_ATTRIBUTE_BYTES,
      count * PACKED_ATTRIBUTE_BYTES,
    )
    this.attributeBuffer.needsUpdate = true
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
    const lane = index * PACKED_ATTRIBUTE_BYTES + PACKED_THUMB_LANE
    if (this.attributes[lane] === value) return
    this.attributes[lane] = value
    this.markAttributeRange(index, 1)
  }

  hasThumbnail(index: number): boolean {
    return (
      index >= 0 &&
      index < this.capacity &&
      this.attributes[index * PACKED_ATTRIBUTE_BYTES + PACKED_THUMB_LANE] !== 0
    )
  }

  /** The plane row a star belongs to — `aClass.x`, the first lane of the repacked class vector. */
  planeRowOf(index: number): number {
    return this.attributes[index * PACKED_ATTRIBUTE_BYTES + PACKED_CLASS_OFFSET]!
  }

  /**
   * PRD 5.4.8's hue class, for the thumbnail rim glow of PRD 5.5.2.
   *
   * Through `colourByte`, not this file's own arithmetic: byte 7 packs the colour identity into
   * bits 3-7 (contract §5, amendment A3), and this class reads the record bytes directly rather
   * than through `decodeStars`. That is precisely how PR #10 shipped an unmasked read here —
   * unmasked, a mono-green star answers 132, which `HUE_COLOURS` in `focusedCard` silently falls
   * back to colourless for and which the thumbnail's `aHue` attribute would carry to the GPU.
   */
  hueClassOf(index: number): number {
    return hueClassFromColourByte(colourByteOfPacked(this.attributes, index))
  }

  /** The card's five-bit WUBRG colour identity (PRD 6.6.2, amendment A3), from the same byte. */
  colourIdentityOf(index: number): number {
    return colourIdentityFromColourByte(colourByteOfPacked(this.attributes, index))
  }

  /** PRD 5.4.9's size class. The cross-fade threshold is a *drawn* size, so rarity is part of it. */
  sizeClassOf(index: number): number {
    return this.attributes[index * PACKED_ATTRIBUTE_BYTES + PACKED_CLASS_OFFSET + 2]!
  }

  /** A star's plane-local position, for the CPU motion mirror of PRD 8.5.7. */
  localPosition(index: number, out: { x: number; y: number; z: number }): void {
    // The stride is the padded 4 on the half path and a tight 3 on the float32 one, so it comes
    // from the field rather than from a literal — a `* 3` here was correct before DEC-739 and
    // would now read every star's position from somewhere between two others.
    const base = index * this.positionStride
    if (this.positions instanceof Float32Array) {
      out.x = this.positions[base]!
      out.y = this.positions[base + 1]!
      out.z = this.positions[base + 2]!
    } else {
      out.x = float16ToNumber(this.positions[base]!)
      out.y = float16ToNumber(this.positions[base + 1]!)
      out.z = float16ToNumber(this.positions[base + 2]!)
    }
  }

  dispose(): void {
    this.geometry.dispose()
  }
}
