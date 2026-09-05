/**
 * Star record byte 7, in one place (contract §5, amendment A3).
 *
 * The byte packs two fields: PRD 5.4.8's `hueClass` in bits 0-2, and PRD 6.6.2's five-bit WUBRG
 * colour identity in bits 3-7. Every reader must mask, and a reader that forgets is silent-wrong
 * rather than loud-wrong: mono-green is byte 132, which reads as a hue class far past the seventh
 * and lands on `HUE_COLOURS`'s colourless fallback with no error anywhere.
 *
 * That has already happened once, in PR #10 — `starGeometry.hueClassOf` was added reading
 * `this.records` directly and bypassed the decoder's mask entirely. Per-reader masking is what
 * failed there, so the offset arithmetic and the two masks now live here and nowhere else, and
 * `web/test/colour-byte.test.ts` fails if a new reader under `web/src` computes byte 7 itself.
 * (DEC-647 N1.)
 *
 * The one reader that cannot call in is the shader: `shaders.ts` masks in GLSL with `& 7` and
 * `starfield.test.ts` pins that mask exhaustively over all 256 byte values instead.
 *
 * The letters-side helpers are the TypeScript twins of the pipeline's `hue_class_for` and
 * `colour_identity_mask`, for the surfaces that are handed a shard's `ci` string rather than the
 * packed byte. Both are pinned against Python's own
 * answers by the shared test vector, so the two implementations cannot drift.
 *
 * The Python twin is `pipeline/src/eternities/contract/enums.py`.
 */

import {
  COLOUR_IDENTITY_MASK,
  COLOUR_IDENTITY_SHIFT,
  ColourBit,
  HUE_CLASS_MASK,
  HueClass,
  STAR_RECORD_BYTES,
  type StarIndex,
} from './types'

/** Byte offset of the packed colour byte within a star record. */
export const COLOUR_BYTE_OFFSET = 7

/**
 * The packed byte for one star, out of a record array with no header — `Stars.interleaved` or
 * `StarGeometry`'s upload buffer. The only place this offset is computed.
 */
export function colourByteOf(records: Uint8Array, index: StarIndex): number {
  return records[index * STAR_RECORD_BYTES + COLOUR_BYTE_OFFSET] ?? 0
}

/** PRD 5.4.8's hue class, bits 0-2. Always 0-6, whatever the identity bits above it hold. */
export function hueClassFromColourByte(byte: number): HueClass {
  return (byte & HUE_CLASS_MASK) as HueClass
}

/**
 * PRD 6.6.2's five-bit WUBRG identity, bits 3-7.
 *
 * `0` is an empty identity. A colourless card and a card with no colours are the same thing here;
 * pair with {@link hueClassFromColourByte} if a caller needs the class as well.
 */
export function colourIdentityFromColourByte(byte: number): number {
  return (byte >> COLOUR_IDENTITY_SHIFT) & COLOUR_IDENTITY_MASK
}

/** The encoder's side of the same byte, so the packing is stated once and asserted once. */
export function packColourByte(hueClass: number, colourIdentity: number): number {
  return (
    (hueClass & HUE_CLASS_MASK) | ((colourIdentity & COLOUR_IDENTITY_MASK) << COLOUR_IDENTITY_SHIFT)
  )
}

/** Identity bit per Scryfall colour letter. Same indices as `HueClass`'s five mono values. */
export const COLOUR_LETTER_BIT: Readonly<Record<string, ColourBit>> = {
  W: ColourBit.White,
  U: ColourBit.Blue,
  B: ColourBit.Black,
  R: ColourBit.Red,
  G: ColourBit.Green,
}

/** WUBRG order, which is the order Scryfall writes `color_identity` and the panels read it. */
export const COLOUR_LETTERS = ['W', 'U', 'B', 'R', 'G'] as const

/**
 * A shard's `ci` string to the same five-bit mask the star record carries.
 *
 * Twin of the pipeline's `colour_identity_mask`. Unknown letters are dropped rather than thrown on,
 * exactly as Python does — the mask is a closed set of five bits and there is no sixth to widen to.
 */
export function colourIdentityBits(colourIdentity: string): number {
  let bits = 0
  for (const letter of colourIdentity.toUpperCase()) {
    const bit = COLOUR_LETTER_BIT[letter]
    if (bit !== undefined) bits |= 1 << bit
  }
  return bits
}

/** The identity mask back to letters, in WUBRG order. */
export function colourIdentityLetters(colourIdentity: number): string {
  let out = ''
  for (const letter of COLOUR_LETTERS) {
    if ((colourIdentity & (1 << COLOUR_LETTER_BIT[letter]!)) !== 0) out += letter
  }
  return out
}

/**
 * PRD 5.4.8's class, derived from the identity rather than re-derived from the letters.
 *
 * Twin of the pipeline's `hue_class_for`, and the reason a panel and the filter can no longer
 * disagree: both start from the same five bits.
 */
export function hueClassFromIdentity(colourIdentity: number): HueClass {
  const bits = colourIdentity & COLOUR_IDENTITY_MASK
  if (bits === 0) return HueClass.Colourless
  // Exactly one bit set: `bits & (bits - 1)` clears the lowest, so zero means there was only one.
  if ((bits & (bits - 1)) !== 0) return HueClass.Multicolour
  return Math.log2(bits) as HueClass
}

/**
 * PRD 6.6.2's colour test: "colour identity matches when the card's identity intersects the
 * selected colours; 'colourless' is an explicit option that matches only empty identity".
 *
 * `selectedBits` is the union of the selected WUBRG letters (OR within a facet, 6.6.2), and
 * `colourlessSelected` is the `C` chip — a separate flag rather than a sixth bit, because empty
 * identity intersects nothing and no bitmask test can express "matches only zero".
 */
export function matchesColourIdentity(
  colourIdentity: number,
  selectedBits: number,
  colourlessSelected: boolean,
): boolean {
  if ((selectedBits & colourIdentity) !== 0) return true
  return colourlessSelected && colourIdentity === 0
}
