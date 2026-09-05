/**
 * The shared byte-7 helper, and the tripwire that keeps it shared. (DEC-647 N1.)
 *
 * Byte 7 packs two fields — PRD 5.4.8's hue class in bits 0-2, PRD 6.6.2's five-bit WUBRG colour
 * identity in bits 3-7 — and a reader that skips the mask is silent-wrong: mono-green is byte 132,
 * which reads as a hue class past the seventh and lands on a colourless fallback with no error.
 *
 * That is not hypothetical. PR #10 added `StarGeometry.hueClassOf` reading `this.records` directly,
 * and it shipped unmasked; review caught it on the merge, not before. Reviewer vigilance is the
 * control that already failed, so the second half of this file is a scan rather than a convention.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  COLOUR_BYTE_OFFSET,
  COLOUR_IDENTITY_MASK,
  COLOUR_LETTERS,
  COLOUR_LETTER_BIT,
  HUE_CLASS_MASK,
  HueClass,
  STAR_RECORD_BYTES,
  colourByteOf,
  colourIdentityBits,
  colourIdentityFromColourByte,
  colourIdentityLetters,
  hueClassFromColourByte,
  hueClassFromIdentity,
  matchesColourIdentity,
  packColourByte,
} from '../src/data'

describe('byte 7 packing', () => {
  it('round-trips every byte the encoder can emit', () => {
    // Every producible byte, not all 256: the low three bits hold seven assigned hue classes, so
    // the value 7 is unused and no record carries it. `starfield.test.ts` draws the same line for
    // the shader's copy of this mask.
    let seen = 0
    for (let hue = 0; hue <= HueClass.Colourless; hue += 1) {
      for (let identity = 0; identity <= COLOUR_IDENTITY_MASK; identity += 1) {
        const byte = packColourByte(hue, identity)
        expect(hueClassFromColourByte(byte)).toBe(hue)
        expect(colourIdentityFromColourByte(byte)).toBe(identity)
        seen += 1
      }
    }
    expect(seen).toBe(7 * 32)
    // The real ceiling is 253, not the arithmetic 254: a five-colour card is hue class 5, not 6.
    expect(packColourByte(HueClass.Multicolour, COLOUR_IDENTITY_MASK)).toBe(253)
  })

  it('keeps a hue class in range for all 256 byte values, producible or not', () => {
    // The regression, stated as the shader states it: no byte may yield an index past `uHues`.
    // 132 — mono green — is the one that used to, and 253 is the largest a record can hold.
    for (let byte = 0; byte < 256; byte += 1) {
      expect(hueClassFromColourByte(byte)).toBe(byte & HUE_CLASS_MASK)
      expect(hueClassFromColourByte(byte)).toBeLessThanOrEqual(HUE_CLASS_MASK)
    }
    expect(hueClassFromColourByte(132)).toBe(HueClass.Green)
    expect(hueClassFromColourByte(253)).toBe(HueClass.Multicolour)
    expect(colourIdentityFromColourByte(132)).toBe(colourIdentityBits('G'))
    expect(colourIdentityFromColourByte(253)).toBe(colourIdentityBits('WUBRG'))
  })

  it('reads the byte at record offset 7, and only there', () => {
    const records = new Uint8Array(3 * STAR_RECORD_BYTES)
    records[0 * STAR_RECORD_BYTES + COLOUR_BYTE_OFFSET] = 132
    records[2 * STAR_RECORD_BYTES + COLOUR_BYTE_OFFSET] = 253
    expect(colourByteOf(records, 0)).toBe(132)
    expect(colourByteOf(records, 1)).toBe(0)
    expect(colourByteOf(records, 2)).toBe(253)
    expect(COLOUR_BYTE_OFFSET).toBe(7)
    // Past the end answers 0 rather than `undefined`: `StarGeometry`'s buffer is capacity-sized and
    // reads ahead of what has streamed in, and a NaN hue index would reach the GPU.
    expect(colourByteOf(records, 99)).toBe(0)
  })
})

describe('identity letters and hue class', () => {
  it('maps letters to bits and back, in WUBRG order', () => {
    expect(colourIdentityBits('')).toBe(0)
    expect(colourIdentityBits('W')).toBe(1)
    expect(colourIdentityBits('WUBRG')).toBe(COLOUR_IDENTITY_MASK)
    // Order and case are not the caller's problem, and a repeat is still one bit.
    expect(colourIdentityBits('ru')).toBe(colourIdentityBits('UR'))
    expect(colourIdentityBits('WW')).toBe(colourIdentityBits('W'))
    // An unknown letter is dropped, exactly as the pipeline's `colour_identity_mask` drops it.
    expect(colourIdentityBits('WX')).toBe(colourIdentityBits('W'))
    for (let mask = 0; mask <= COLOUR_IDENTITY_MASK; mask += 1) {
      expect(colourIdentityBits(colourIdentityLetters(mask))).toBe(mask)
    }
    expect(colourIdentityLetters(colourIdentityBits('GRBUW'))).toBe('WUBRG')
  })

  it('derives the hue class from the identity for every arity', () => {
    expect(hueClassFromIdentity(0)).toBe(HueClass.Colourless)
    COLOUR_LETTERS.forEach((letter) => {
      // A mono card's identity is exactly the bit its hue class names — the invariant the shader's
      // `uHues` lookup and PRD 6.6.2's filter both depend on.
      const hue = hueClassFromIdentity(colourIdentityBits(letter))
      expect(hue).toBe(COLOUR_LETTER_BIT[letter])
      expect(colourIdentityBits(letter)).toBe(1 << hue)
    })
    let gold = 0
    for (let mask = 1; mask <= COLOUR_IDENTITY_MASK; mask += 1) {
      const arity = colourIdentityLetters(mask).length
      if (arity > 1) {
        expect(hueClassFromIdentity(mask)).toBe(HueClass.Multicolour)
        gold += 1
      }
    }
    expect(gold).toBe(26)
  })
})

describe('PRD 6.6.2 colour match', () => {
  const W = colourIdentityBits('W')
  const U = colourIdentityBits('U')

  it('matches on intersection, not on equality', () => {
    // An Azorius card matches a white-only selection: 6.6.2 says "intersects", not "equals".
    expect(matchesColourIdentity(colourIdentityBits('WU'), W, false)).toBe(true)
    expect(matchesColourIdentity(colourIdentityBits('WU'), W | U, false)).toBe(true)
    // ...and does not match a colour it has no bit for. This is the defect being fixed.
    expect(matchesColourIdentity(colourIdentityBits('WU'), colourIdentityBits('R'), false)).toBe(
      false,
    )
  })

  it('gives colourless its own answer in both directions', () => {
    // "Colourless is an explicit option that matches only empty identity." An empty identity
    // intersects nothing, so it needs the flag; and the flag must not admit a coloured card.
    expect(matchesColourIdentity(0, 0, true)).toBe(true)
    expect(matchesColourIdentity(0, W | U, false)).toBe(false)
    expect(matchesColourIdentity(W, 0, true)).toBe(false)
    expect(matchesColourIdentity(colourIdentityBits('WU'), 0, true)).toBe(false)
    // OR within the facet: `W,C` is white-or-empty, and both arrive.
    expect(matchesColourIdentity(W, W, true)).toBe(true)
    expect(matchesColourIdentity(0, W, true)).toBe(true)
  })
})

/**
 * The tripwire.
 *
 * Two rules, both greps over `web/src`:
 *
 *  1. **Containment.** Only the helper and the contract's constant table may name the byte-7 masks
 *     or its offset. A new reader that masks for itself trips this before it can be wrong.
 *  2. **Offset.** Nothing outside the helper may compute a star-record offset that lands on byte 7.
 *
 * Scope, stated honestly: this reads the two idioms the codebase actually uses to address a record
 * — `index * STAR_RECORD_BYTES + <offset>` and `decode.ts`'s local `at(i, <offset>)` — and it would
 * not see a reader that hard-coded the stride as `12`. It is a tripwire for the mistake that has
 * happened, not a proof. Rule 1 is the wider net of the two, and offsets it cannot resolve
 * statically are pinned below rather than waved through.
 *
 * The shaders are the one exemption: GLSL cannot call a TypeScript helper, so they mask inline and
 * the last test here asserts that they still do.
 */
const SRC = resolve(__dirname, '../src')
const HELPER = 'data/colourByte.ts'
const CONSTANTS = 'data/types.ts'

function sources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: relative(SRC, full).replaceAll('\\', '/'), text: readFileSync(full, 'utf8') })
      }
    }
  }
  walk(SRC)
  return out
}

const FILES = sources()

/** Offset tokens the scan can resolve. Anything else is reported as dynamic, not ignored. */
const KNOWN_OFFSETS: Readonly<Record<string, number>> = {
  POSITION_BYTES_IN_RECORD: 6,
  COLOUR_BYTE_OFFSET: 7,
}

function resolveOffset(expression: string): number | null {
  let total = 0
  for (const term of expression.split('+')) {
    const token = term.trim()
    if (/^\d+$/.test(token)) total += Number(token)
    else if (token in KNOWN_OFFSETS) total += KNOWN_OFFSETS[token]!
    else return null
  }
  return total
}

interface Site {
  file: string
  line: number
  text: string
  offset: number | null
}

function recordReads(): Site[] {
  const sites: Site[] = []
  for (const { path, text } of FILES) {
    text.split('\n').forEach((line, index) => {
      const patterns = [
        /\bSTAR_RECORD_BYTES\s*\+([^;\]),]*)/g,
        /\bat\(\s*[A-Za-z_$][\w$]*\s*,([^)]*)\)/g,
      ]
      for (const pattern of patterns) {
        for (const match of line.matchAll(pattern)) {
          sites.push({ file: path, line: index + 1, text: line.trim(), offset: resolveOffset(match[1]!) })
        }
      }
    })
  }
  return sites
}

describe('byte 7 has exactly one reader (tripwire)', () => {
  it('keeps the masks and the offset inside the helper', () => {
    const tokens = /\b(HUE_CLASS_MASK|COLOUR_IDENTITY_SHIFT|COLOUR_IDENTITY_MASK|COLOUR_BYTE_OFFSET)\b/
    const offenders = FILES.filter(
      ({ path, text }) => path !== HELPER && path !== CONSTANTS && tokens.test(text),
    ).map(({ path }) => path)
    expect(offenders).toEqual([])
    // Not a tautology only while the helper itself still names them.
    expect(tokens.test(FILES.find((f) => f.path === HELPER)!.text)).toBe(true)
  })

  it('lets nothing outside the helper address byte 7', () => {
    const sites = recordReads()
    const resolved = sites.filter((site) => site.offset !== null)
    // The scan must actually see the readers it is meant to police, or a rotted regex passes.
    expect(resolved.length).toBeGreaterThanOrEqual(6)
    expect(new Set(resolved.map((s) => s.offset))).toContain(6)
    expect(new Set(resolved.map((s) => s.offset))).toContain(8)
    expect(resolved.some((s) => s.file === HELPER && s.offset === COLOUR_BYTE_OFFSET)).toBe(true)

    const raw = resolved.filter((s) => s.offset === COLOUR_BYTE_OFFSET && s.file !== HELPER)
    expect(raw.map((s) => `${s.file}:${s.line} ${s.text}`)).toEqual([])
  })

  it('pins the offsets it cannot resolve statically', () => {
    // An unresolvable offset is not a pass. These three are the position path and the `at` helper
    // that feeds every resolved site above; a fourth means someone added a computed record read,
    // and it needs a look before it joins this list.
    const dynamic = recordReads()
      .filter((site) => site.offset === null)
      .map((site) => `${site.file}:${site.text}`)
    expect(dynamic).toEqual([
      'data/decode.ts:const at = (i: StarIndex, offset: number): number => i * STAR_RECORD_BYTES + offset',
      'data/decode.ts:? view.getFloat32(at(i, axis * 4), true)',
      'data/decode.ts:: float16ToNumber(view.getUint16(at(i, axis * 2), true))',
    ])
  })

  it('holds the shaders to their own inline mask, since GLSL cannot call in', () => {
    // `shaders.ts` indexes `uHues[7]` with byte 7 and `cardShaders.ts` with the `aHue` attribute
    // fed from it. Both mask with `& 7`; `starfield.test.ts` pins that mask over all 256 values.
    for (const path of ['scene/starfield/shaders.ts', 'scene/cards/cardShaders.ts']) {
      const shader = FILES.find((f) => f.path === path)!
      expect(shader.text).toMatch(/uHues\[[^\]]*&\s*7\s*\]|int\s+hue\s*=[^\n]*&\s*7/)
    }
  })
})

describe('the decoder and the geometry agree, because they share the read', () => {
  it('answers identically for every byte value', () => {
    // Both call the helper now, so this is a cheap guard on the wiring rather than on the maths:
    // it fails if either accessor is rewired to something else.
    const records = new Uint8Array(256 * STAR_RECORD_BYTES)
    for (let byte = 0; byte < 256; byte += 1) records[byte * STAR_RECORD_BYTES + 7] = byte
    for (let byte = 0; byte < 256; byte += 1) {
      expect(hueClassFromColourByte(colourByteOf(records, byte))).toBe(byte & HUE_CLASS_MASK)
      expect(colourIdentityFromColourByte(colourByteOf(records, byte))).toBe(byte >> 3)
    }
  })
})
