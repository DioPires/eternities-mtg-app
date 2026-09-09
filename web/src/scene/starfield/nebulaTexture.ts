/**
 * The low-frequency noise PRD 5.3.19 asks for, baked once into a small tiling texture.
 *
 * Evaluating fbm analytically in the fragment shader would put three or four octaves of noise
 * under every nebula quad, and at plane level a single nebula can cover the whole viewport. A
 * 128² lookup with two taps costs two texture reads instead, which is the difference between the
 * nebula being free and the nebula being the frame budget.
 *
 * Seeded and deterministic, like every other placement decision in the project (PRD 5.3.1): the
 * same build shows every user the same clouds.
 */

import { DataTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three'

import { valueNoise2Periodic } from './noise'

const SIZE = 128
/** Octaves and the lattice period of the first one. Both divide SIZE, so the texture tiles. */
const OCTAVES = 4
const BASE_PERIOD = 4

export function createNebulaTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let value = 0
      let amplitude = 1
      let total = 0
      let period = BASE_PERIOD
      for (let octave = 0; octave < OCTAVES; octave += 1) {
        value += valueNoise2Periodic((x / SIZE) * period, (y / SIZE) * period, period) * amplitude
        total += amplitude
        amplitude *= 0.5
        period *= 2
      }
      data[y * SIZE + x] = Math.round((value / total) * 255)
    }
  }

  const texture = new DataTexture(data, SIZE, SIZE, RedFormat, UnsignedByteType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
