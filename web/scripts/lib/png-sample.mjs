/**
 * Point-sampling a captured PNG, with no dependency beyond `node:zlib`.
 *
 * `worlds-gate.mjs` measures colour *in the captured frame* rather than off the probe (spec §3.1):
 * geometry comes from the probe, but every colour criterion has to be read after tonemap and
 * vignette at presentation scale, because that is precisely what review T7 found criterion 2 was
 * never measuring. A probe-reported swatch would measure the buffer we uploaded, not the picture.
 *
 * So the gate needs to get pixels out of a `page.screenshot()` buffer. Puppeteer hands back a plain
 * 8-bit non-interlaced PNG, and the whole of what we need is one `inflate` plus the five scanline
 * filters — a decoder small enough to read is worth more here than a dependency, and
 * `visual-gate.mjs` already carries its own PNG chunk walker for the same reason.
 *
 * Deliberately narrow: bit depth 8, colour type 2 or 6, no interlace. Anything else throws by name
 * rather than decoding to plausible garbage. A gate that silently mis-reads its own capture is the
 * failure mode this whole leg is written against.
 */

import { inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Channels per pixel, by PNG colour type. Only the two puppeteer emits are listed. */
const CHANNELS = { 2: 3, 6: 4 }

/**
 * Walk the chunk stream, returning the IHDR fields and the concatenated IDAT payload.
 *
 * CRCs are not checked. The buffer came out of the same process moments ago; a corrupt one is not
 * the risk here, and a CRC pass would not make a mis-typed IHDR any safer.
 */
function readChunks(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG (bad signature)')

  let header = null
  const idat = []
  let offset = 8

  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colourType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }

    // length + type + data + CRC
    offset += length + 12
  }

  if (header === null) throw new Error('PNG has no IHDR')
  return { header, idat: Buffer.concat(idat) }
}

/** PNG's Paeth predictor, byte-for-byte from the spec's pseudocode. */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Decode to a flat RGBA byte array, alpha forced to 255 for colour type 2.
 *
 * Scanlines are undone in place against the previous row, which is the only ordering that works:
 * every filter but `None` is defined against *reconstructed* bytes, not filtered ones.
 */
export function decodePng(png) {
  const { header, idat } = readChunks(png)
  const { width, height, bitDepth, colourType, interlace } = header

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (this decoder does 8)`)
  if (interlace !== 0) throw new Error('unsupported interlaced PNG (this decoder does non-interlaced)')
  const channels = CHANNELS[colourType]
  if (channels === undefined) {
    throw new Error(`unsupported PNG colour type ${colourType} (this decoder does 2 and 6)`)
  }

  const raw = inflateSync(idat)
  const stride = width * channels
  const expected = (stride + 1) * height
  if (raw.length < expected) {
    throw new Error(`PNG data is short: ${raw.length} bytes, expected ${expected}`)
  }

  const lines = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = lines.subarray(y * stride, y * stride + stride)
    const prev = y === 0 ? null : lines.subarray((y - 1) * stride, (y - 1) * stride + stride)

    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev === null ? 0 : prev[i]
      const c = prev === null || i < channels ? 0 : prev[i - channels]
      let value
      switch (filter) {
        case 0:
          value = src[i]
          break
        case 1:
          value = src[i] + a
          break
        case 2:
          value = src[i] + b
          break
        case 3:
          value = src[i] + ((a + b) >> 1)
          break
        case 4:
          value = src[i] + paeth(a, b, c)
          break
        default:
          throw new Error(`unknown PNG filter type ${filter} on row ${y}`)
      }
      cur[i] = value & 0xff
    }
  }

  if (channels === 4) return { width, height, data: lines }

  const rgba = Buffer.alloc(width * height * 4, 0xff)
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = lines[p * 3]
    rgba[p * 4 + 1] = lines[p * 3 + 1]
    rgba[p * 4 + 2] = lines[p * 3 + 2]
  }
  return { width, height, data: rgba }
}

/**
 * The pixel at `(x, y)`, in CSS pixels, as `[r, g, b]`.
 *
 * Coordinates are floored, and out-of-frame throws rather than clamping: a cell centre outside the
 * capture means the probe and the screenshot disagree about the viewport, which is a bug in the
 * gate's setup and must not be averaged away into a colour statistic.
 *
 * The gate runs at dpr 1 (§3.1, and DEC-683 — never an upscaled crop), so CSS pixels and image
 * pixels are the same grid. `scale` exists so that a capture taken at some other device pixel ratio
 * is converted explicitly at the call site instead of being silently off by a factor.
 */
export function samplePixel(image, x, y, scale = 1) {
  const px = Math.floor(x * scale)
  const py = Math.floor(y * scale)
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) {
    throw new Error(
      `sample (${x}, ${y}) at scale ${scale} falls outside the ${image.width}x${image.height} capture`,
    )
  }
  const at = (py * image.width + px) * 4
  return [image.data[at], image.data[at + 1], image.data[at + 2]]
}
