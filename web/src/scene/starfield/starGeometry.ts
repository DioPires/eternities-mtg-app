/**
 * The star buffer: `stars.bin`'s records, repacked on the CPU, and the growing count PRD 8.7.3
 * streams into.
 *
 * **Nothing uploads this any more (DEC-868).** It was the one `BufferGeometry` behind PRD 8.5.1's
 * star field: two interleaved GPU buffers, a draw range, and two `w`-lane masks (the filter and
 * "thumbnail in the atlas") that only the star shader read. The field retired at the cutover
 * (DEC-752) and nothing attached the geometry to a mesh afterwards, so every one of those was
 * written and never drawn — the filter lane alone cost a ~28 KB strided scatter per chip click.
 * What survives is what the worlds build reads on the CPU: PRD 8.5.6's pick resolves against
 * {@link StarGeometry.drawCount} and {@link StarGeometry.planeRowOf}, §1.10's printing ring reads
 * {@link StarGeometry.localPosition} and {@link StarGeometry.hueClassOf} every tick, and PRD
 * 8.5.7's mirror reads the position too (`starData.ts` names them).
 *
 * The arrays keep DEC-739's repacked layout — padded half-float positions and two `u8x4` vectors a
 * star, `../../data/types`' `PACKED_*` block — because `colourByte.ts` reads the colour byte out of
 * it by those offsets and `positionMode` (PRD risk 6) is still published by `?probe=` and the
 * bench. The layout's alignment rationale is its history now, not a constraint anything enforces.
 */

import type { PositionMode } from '../platform/positionMode'

import {
  colourByteOfPacked,
  colourIdentityFromColourByte,
  hueClassFromColourByte,
} from '../../data/colourByte'
import { float16ToNumber } from '../../data/decode'
import {
  PACKED_ATTRIBUTE_BYTES,
  PACKED_CLASS_OFFSET,
  PACKED_POSITION_HALVES,
  PACKED_STYLE_OFFSET,
  STAR_RECORD_BYTES,
} from '../../data/types'

export class StarGeometry {
  readonly capacity: number
  readonly positionMode: PositionMode

  /** Records appended so far. Never exceeds {@link capacity}. */
  private uploaded = 0
  /**
   * The repacked byte fields, `PACKED_ATTRIBUTE_BYTES` per star: (planeIndex, colourByte,
   * sizeClass) at `PACKED_CLASS_OFFSET` and (brightness, twinklePhase, typeMask) at
   * `PACKED_STYLE_OFFSET`. The readers below index it directly; the on-disk record is not kept.
   */
  private readonly attributes: Uint8Array
  /**
   * Plane-local positions: raw IEEE binary16 bit patterns at a stride of `PACKED_POSITION_HALVES`,
   * or decoded floats at a stride of 3 on the float32 path.
   */
  private readonly positions: Uint16Array | Float32Array
  /** Stride of {@link positions} in array elements: 4 halves when padded, 3 floats when not. */
  private readonly positionStride: number

  constructor(capacity: number, positionMode: PositionMode = 'float16') {
    this.capacity = capacity
    this.positionMode = positionMode
    this.attributes = new Uint8Array(capacity * PACKED_ATTRIBUTE_BYTES)
    if (positionMode === 'float32') {
      this.positionStride = 3
      this.positions = new Float32Array(capacity * 3)
    } else {
      this.positionStride = PACKED_POSITION_HALVES
      this.positions = new Uint16Array(capacity * PACKED_POSITION_HALVES)
    }
  }

  get drawCount(): number {
    return this.uploaded
  }

  /**
   * Take everything that has arrived. `body` is the record bytes of `stars.bin` with the header
   * stripped; `available` is how many whole records it holds. Repacks only the new tail.
   */
  append(body: Uint8Array, available: number): void {
    const to = Math.min(available, this.capacity)
    if (to <= this.uploaded) return
    const from = this.uploaded

    const float32 = this.positions instanceof Float32Array
    const stride = this.positionStride

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

      // Record bytes 6,7,8 are (planeIndex, colourByte, sizeClass) and 9,10,11 are (brightness,
      // twinklePhase, typeMask). They land in the first three lanes of each vector.
      const attribute = i * PACKED_ATTRIBUTE_BYTES
      this.attributes[attribute + PACKED_CLASS_OFFSET] = body[source + 6]!
      this.attributes[attribute + PACKED_CLASS_OFFSET + 1] = body[source + 7]!
      this.attributes[attribute + PACKED_CLASS_OFFSET + 2] = body[source + 8]!
      this.attributes[attribute + PACKED_STYLE_OFFSET] = body[source + 9]!
      this.attributes[attribute + PACKED_STYLE_OFFSET + 1] = body[source + 10]!
      this.attributes[attribute + PACKED_STYLE_OFFSET + 2] = body[source + 11]!
    }

    this.uploaded = to
  }

  /** The plane row a star belongs to — `aClass.x`, the first lane of the repacked class vector. */
  planeRowOf(index: number): number {
    return this.attributes[index * PACKED_ATTRIBUTE_BYTES + PACKED_CLASS_OFFSET]!
  }

  /**
   * PRD 5.4.8's hue class, which the printing ring tints the focused card by.
   *
   * Through `colourByte`, not this file's own arithmetic: byte 7 packs the colour identity into
   * bits 3-7 (contract §5, amendment A3), and this class reads the record bytes directly rather
   * than through `decodeStars`. That is precisely how PR #10 shipped an unmasked read here —
   * unmasked, a mono-green star answers 132, which `HUE_COLOURS` in `focusedCard` silently falls
   * back to colourless for.
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
}
