/**
 * The gate's PNG point-sampler.
 *
 * `worlds-gate.mjs` reads every colour criterion out of the captured frame rather than off the
 * probe (spec §3.1), so a wrong pixel here is a wrong verdict on W2 and W3 with nothing else in the
 * pipeline able to notice. The five scanline filters are the whole risk surface: `None` and `Up`
 * are hard to get wrong, and `Sub`, `Average` and `Paeth` are all easy to get wrong in a way that
 * still decodes to a plausible picture.
 *
 * So the test encodes known pixels with each filter in turn and requires the decoder to hand them
 * back byte for byte. The encoder here is test-only — the gate never writes a PNG — and it exists
 * precisely so the decoder is checked against something other than itself.
 */

import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { decodePng, samplePixel } from '../scripts/lib/png-sample.mjs'

// ------------------------------------------------------------------------------------------------
// A minimal PNG encoder, test-only
// ------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, body, crc])
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Encode `pixels` with one filter type applied to every scanline.
 *
 * Real encoders pick a filter per row; forcing one throughout is what makes each filter's
 * reconstruction path individually testable.
 */
function encodePng(
  width: number,
  height: number,
  channels: 3 | 4,
  pixels: Buffer,
  filter: 0 | 1 | 2 | 3 | 4,
): Buffer {
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter
    for (let i = 0; i < stride; i += 1) {
      const x = pixels[y * stride + i] as number
      const a = i >= channels ? (pixels[y * stride + i - channels] as number) : 0
      const b = y === 0 ? 0 : (pixels[(y - 1) * stride + i] as number)
      const c = y === 0 || i < channels ? 0 : (pixels[(y - 1) * stride + i - channels] as number)
      let out: number
      switch (filter) {
        case 0:
          out = x
          break
        case 1:
          out = x - a
          break
        case 2:
          out = x - b
          break
        case 3:
          out = x - ((a + b) >> 1)
          break
        case 4:
          out = x - paeth(a, b, c)
          break
      }
      raw[y * (stride + 1) + 1 + i] = out & 0xff
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 4 ? 6 : 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A pattern with hard edges and a gradient.
 *
 * Both matter: a flat field decodes correctly under a broken `Sub` or `Average`, and a pure
 * gradient decodes correctly under a broken `Up`.
 */
function pattern(width: number, height: number, channels: 3 | 4): Buffer {
  const px = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * channels
      const edge = (x >> 2) % 2 === (y >> 2) % 2
      px[at] = edge ? 250 : 12
      px[at + 1] = (x * 7 + y * 3) & 0xff
      px[at + 2] = edge ? 40 : 210
      if (channels === 4) px[at + 3] = 255
    }
  }
  return px
}

// ------------------------------------------------------------------------------------------------

const WIDTH = 29
const HEIGHT = 17

describe('decodePng', () => {
  for (const filter of [0, 1, 2, 3, 4] as const) {
    const name = ['None', 'Sub', 'Up', 'Average', 'Paeth'][filter]

    it(`round-trips RGBA under the ${name} filter`, () => {
      const px = pattern(WIDTH, HEIGHT, 4)
      const image = decodePng(encodePng(WIDTH, HEIGHT, 4, px, filter))
      expect(image.width).toBe(WIDTH)
      expect(image.height).toBe(HEIGHT)
      expect(Buffer.compare(image.data, px)).toBe(0)
    })

    it(`round-trips RGB under the ${name} filter, filling alpha`, () => {
      const px = pattern(WIDTH, HEIGHT, 3)
      const image = decodePng(encodePng(WIDTH, HEIGHT, 3, px, filter))
      for (let p = 0; p < WIDTH * HEIGHT; p += 1) {
        expect([image.data[p * 4], image.data[p * 4 + 1], image.data[p * 4 + 2]]).toEqual([
          px[p * 3],
          px[p * 3 + 1],
          px[p * 3 + 2],
        ])
        expect(image.data[p * 4 + 3]).toBe(255)
      }
    })
  }

  /**
   * The Paeth predictor's tie-break, which the pattern above cannot reach.
   *
   * `paeth` returns `a` when `pa <= pb && pa <= pc`, and the `<=` is load-bearing: relaxing either
   * to `<` sends a tie to a different neighbour. The block pattern never catches that, because its
   * ties all occur inside flat runs where `a`, `b` and `c` hold the *same value* and every branch
   * returns the same number — a mutation of the tie-break survives it undetected.
   *
   * So these bytes are chosen to tie with *distinct* neighbours. Writing `d1 = a − c` and
   * `d2 = b − c`, the three distances are `pa = |d2|`, `pb = |d1|`, `pc = |d1 + d2|`, and each
   * tie-break needs its own arithmetic — one case cannot reach both:
   *
   * - **`pa <= pc`** (returns `a`): `c` = 100, `a` = 96, `b` = 102 → `pa` 2, `pb` 4, `pc` 2. The
   *   spec returns `a` = 96; `pa < pc` falls through to `c` = 100.
   * - **`pb <= pc`** (returns `b`): needs `d2 = −2·d1`, so `c` = 100, `a` = 103, `b` = 94 →
   *   `pa` 6, `pb` 3, `pc` 3. The spec returns `b` = 94; `pb < pc` falls through to `c` = 100.
   *
   * A wrong predictor does not merely corrupt this pixel: `Sub`-like error propagates along the
   * row and `Up`-like error down the column, so the whole frame below and right of it moves.
   */
  it.each([
    { branch: 'pa <= pc, returns a', c: 100, b: 102, a: 96 },
    { branch: 'pb <= pc, returns b', c: 100, b: 94, a: 103 },
  ])('breaks a Paeth tie the way the spec does ($branch)', ({ c, b, a }) => {
    const px = Buffer.alloc(2 * 2 * 4, 255)
    const put = (x: number, y: number, v: number) => {
      const at = (y * 2 + x) * 4
      px[at] = v
      px[at + 1] = v
      px[at + 2] = v
    }
    put(0, 0, c) //  above-left
    put(1, 0, b) //  above
    put(0, 1, a) //  left
    put(1, 1, 40) // the byte whose predictor is under test

    const image = decodePng(encodePng(2, 2, 4, px, 4))
    expect(samplePixel(image, 1, 1)).toEqual([40, 40, 40])
  })

  it('rejects what it cannot honestly decode rather than guessing', () => {
    expect(() => decodePng(Buffer.alloc(64))).toThrow(/signature/)

    const png = encodePng(WIDTH, HEIGHT, 4, pattern(WIDTH, HEIGHT, 4), 0)

    // Byte 24 of a PNG is IHDR's interlace flag; 25 back from IHDR's start is the bit depth.
    const interlaced = Buffer.from(png)
    interlaced[8 + 8 + 12] = 1
    expect(() => decodePng(interlaced)).toThrow(/interlaced/)

    const deep = Buffer.from(png)
    deep[8 + 8 + 8] = 16
    expect(() => decodePng(deep)).toThrow(/bit depth 16/)

    const paletted = Buffer.from(png)
    paletted[8 + 8 + 9] = 3
    expect(() => decodePng(paletted)).toThrow(/colour type 3/)
  })
})

describe('samplePixel', () => {
  const px = pattern(WIDTH, HEIGHT, 4)
  const image = decodePng(encodePng(WIDTH, HEIGHT, 4, px, 4))

  it('reads the pixel the coordinates name', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [WIDTH - 1, HEIGHT - 1],
      [13, 9],
    ] as const) {
      const at = (y * WIDTH + x) * 4
      expect(samplePixel(image, x, y)).toEqual([px[at], px[at + 1], px[at + 2]])
    }
  })

  it('floors a fractional cell centre onto the pixel it lands in', () => {
    expect(samplePixel(image, 5.9, 3.1)).toEqual(samplePixel(image, 5, 3))
  })

  it('throws rather than clamping a sample outside the capture', () => {
    // A cell centre off the frame means the probe and the screenshot disagree about the viewport.
    // Clamping would fold that disagreement into a colour statistic and call it a measurement.
    expect(() => samplePixel(image, WIDTH, 0)).toThrow(/outside/)
    expect(() => samplePixel(image, -1, 0)).toThrow(/outside/)
    expect(() => samplePixel(image, 0, HEIGHT)).toThrow(/outside/)
  })

  it('applies an explicit scale for a capture taken above dpr 1', () => {
    // The gate runs at dpr 1 (§3.1, DEC-683), so this is the escape hatch and not the normal path:
    // the conversion is at the call site rather than silently inside the sampler.
    const at = (6 * WIDTH + 4) * 4
    expect(samplePixel(image, 2, 3, 2)).toEqual([px[at], px[at + 1], px[at + 2]])
  })
})
