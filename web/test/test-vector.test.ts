/**
 * The TypeScript half of the shared contract check.
 *
 * These read exactly the bytes `pipeline/tests/test_test_vector.py` re-encodes and asserts on.
 * If the two sides ever disagree about a byte offset, an enum value, a section id or a derived
 * URI, one of these two suites fails. That is the whole point of the vector.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CONTRACT_VERSION,
  ContractError,
  SHARD_SIZE,
  StarStreamReader,
  decodeSets,
  decodeStars,
  float16ToNumber,
  imageUri,
  pageUri,
  shardIndexFor,
  shardPathFor,
  CARD_BACK_URI,
  type Manifest,
  type PlaneShardFile,
  type PlanesFile,
  type SearchFile,
} from '../src/data'

const VECTOR_DIR = resolve(__dirname, '../../contract/test-vectors/v1')

interface VectorStar {
  index: number
  x: number
  y: number
  z: number
  planeIndex: number
  hueClass: number
  sizeClass: number
  brightness: number
  twinklePhase: number
  typeMask: number
}

interface Vector {
  contractVersion: number
  dataHash: string
  starCount: number
  stars: VectorStar[]
  oracleIds: string[]
  setIdsPerStar: number[][]
  planeShards: Record<string, number>
  files: string[]
  cardBackUri: string
  uris: Array<Record<string, string>>
  hueClassChecks: Array<{ colourIdentity: string; hueClass: number }>
  typeMaskChecks: Array<{ typeLine: string; typeMask: number }>
  shardIndexChecks: Array<{ localIndex: number; shard: number }>
}

function bytes(relative: string): ArrayBuffer {
  const buffer = readFileSync(join(VECTOR_DIR, relative))
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

function json<T>(relative: string): T {
  return JSON.parse(readFileSync(join(VECTOR_DIR, relative), 'utf8')) as T
}

const vector = json<Vector>('vector.json')

describe('shared contract test vector', () => {
  it('is the version this build speaks', () => {
    expect(vector.contractVersion).toBe(CONTRACT_VERSION)
  })

  it('decodes stars.bin to the exact values the encoder recorded', () => {
    const stars = decodeStars(bytes('stars.bin'))
    expect(stars.count).toBe(vector.starCount)
    expect(stars.float32Positions).toBe(false)
    for (const expected of vector.stars) {
      const i = expected.index
      expect(stars.x(i)).toBe(expected.x)
      expect(stars.y(i)).toBe(expected.y)
      expect(stars.z(i)).toBe(expected.z)
      expect(stars.planeIndex(i)).toBe(expected.planeIndex)
      expect(stars.hueClass(i)).toBe(expected.hueClass)
      expect(stars.sizeClass(i)).toBe(expected.sizeClass)
      expect(stars.brightness(i)).toBe(expected.brightness)
      expect(stars.twinklePhase(i)).toBe(expected.twinklePhase)
      expect(stars.typeMask(i)).toBe(expected.typeMask)
    }
  })

  it('exposes stars.bin as one interleaved buffer with no repacking', () => {
    const stars = decodeStars(bytes('stars.bin'))
    expect(stars.interleaved.byteLength).toBe(stars.count * 12)
    // The GPU binds HALF_FLOAT x3 at 0, UNSIGNED_BYTE x4 at 6 and UNSIGNED_BYTE x2 at 10.
    expect(stars.interleaved[6]).toBe(vector.stars[0]!.planeIndex)
    expect(stars.interleaved[11]).toBe(vector.stars[0]!.typeMask)
  })

  it('produces the same float32 positions through the fallback path', () => {
    const stars = decodeStars(bytes('stars.bin'))
    const flat = stars.toFloat32Positions()
    expect(flat.length).toBe(stars.count * 3)
    for (const expected of vector.stars) {
      expect(flat[expected.index * 3]).toBe(expected.x)
      expect(flat[expected.index * 3 + 1]).toBe(expected.y)
      expect(flat[expected.index * 3 + 2]).toBe(expected.z)
    }
  })

  it('decodes sets.bin oracle ids in both directions', () => {
    const sets = decodeSets(bytes('sets.bin'))
    expect(sets.starCount).toBe(vector.starCount)
    vector.oracleIds.forEach((oracleId, index) => {
      expect(sets.oracleId(index)).toBe(oracleId)
      expect(sets.starIndexOf(oracleId)).toBe(index)
    })
    expect(sets.starIndexOf('ffffffff-ffff-4fff-8fff-ffffffffffff')).toBe(-1)
  })

  it('decodes sets.bin set-id lists and answers the facet test', () => {
    const sets = decodeSets(bytes('sets.bin'))
    vector.setIdsPerStar.forEach((ids, index) => {
      expect(Array.from(sets.setIdsOf(index))).toEqual(ids)
      for (const id of ids) expect(sets.hasSet(index, id)).toBe(true)
      expect(sets.hasSet(index, 60000)).toBe(false)
    })
  })

  it('reads manifest.json, planes.json and search.json', () => {
    const manifest = json<Manifest>('manifest.json')
    expect(manifest.dataHash).toBe(vector.dataHash)
    expect(manifest.shardSize).toBe(SHARD_SIZE)
    expect(manifest.planeShards).toEqual(vector.planeShards)
    expect(manifest.files.map((f) => f.path)).toEqual(vector.files)

    const planes = json<PlanesFile>('planes.json')
    expect(planes.planes.map((p) => p.index)).toEqual(planes.planes.map((_, i) => i))
    const blind = planes.planes[0]!
    expect(blind.slug).toBe('blind-eternities')
    expect(blind.tilt).toEqual([0, 0, 0, 1])
    expect(blind.spinPeriodS).toBe(0)

    // A plane owns a contiguous star range, which is how a star's plane is recovered (contract §2).
    let cursor = 0
    for (const plane of planes.planes) {
      expect(plane.starOffset).toBe(cursor)
      cursor += plane.starCount
    }
    expect(cursor).toBe(vector.starCount)

    const search = json<SearchFile>('search.json')
    expect(search.cardNames).toHaveLength(vector.starCount)
    expect(search.sets.some((s) => s.planeSlug === null)).toBe(true)
    expect(search.backNames.length).toBeGreaterThan(0)
  })

  it('derives Scryfall URIs exactly as the pipeline does', () => {
    expect(CARD_BACK_URI).toBe(vector.cardBackUri)
    for (const expected of vector.uris) {
      const id = expected.printingId!
      const ts = Number(expected.imageTs)
      expect(imageUri(id, ts, 'small')).toBe(expected.small)
      expect(imageUri(id, ts, 'large')).toBe(expected.large)
      expect(imageUri(id, ts, 'art_crop')).toBe(expected.artCrop)
      expect(imageUri(id, ts, 'large', 'back')).toBe(expected.backLarge)
    }
  })

  it('derives the Scryfall page URI from a shard printing tuple', () => {
    const shard = json<PlaneShardFile>('planes/dominaria.0.json')
    const search = json<SearchFile>('search.json')
    const printing = shard.cards[0]!.p[0]!
    const setCode = search.sets.find((s) => s.id === printing[1])!.code
    expect(pageUri(setCode, printing[4])).toContain('https://scryfall.com/card/')
  })

  it('agrees on shard arithmetic and paths (amendment A1)', () => {
    for (const check of vector.shardIndexChecks) {
      expect(shardIndexFor(check.localIndex)).toBe(check.shard)
    }
    expect(shardPathFor('dominaria', 0)).toBe('planes/dominaria.0.json')
    // A zero-card plane still gets one file, so the loader has no special case.
    expect(vector.planeShards['segovia']).toBe(1)
    expect(json<PlaneShardFile>('planes/segovia.0.json').cards).toEqual([])
  })
})

describe('streaming reader (PRD 8.3, 6.8.1)', () => {
  it('exposes only whole records as a safe draw range', () => {
    const buffer = new Uint8Array(bytes('stars.bin'))
    const reader = new StarStreamReader()

    reader.push(buffer.subarray(0, 8))
    expect(reader.completeRecords).toBe(0) // header not complete yet

    reader.push(buffer.subarray(8, 16 + 12 + 5)) // one whole record and part of the next
    expect(reader.expectedRecords).toBe(vector.starCount)
    expect(reader.completeRecords).toBe(1)
    expect(reader.done).toBe(false)
    expect(reader.snapshot().count).toBe(1)

    reader.push(buffer.subarray(16 + 12 + 5))
    expect(reader.completeRecords).toBe(vector.starCount)
    expect(reader.done).toBe(true)
    expect(reader.snapshot().x(2)).toBe(vector.stars[2]!.x)
  })
})

describe('float16 decoding', () => {
  it('handles the cases the vector pins', () => {
    expect(float16ToNumber(0x0000)).toBe(0)
    expect(float16ToNumber(0x3c00)).toBe(1)
    expect(float16ToNumber(0xbc00)).toBe(-1)
    expect(float16ToNumber(0x3800)).toBe(0.5)
    expect(float16ToNumber(0x1400)).toBe(0.0009765625) // 2^-10, from the vector
    expect(float16ToNumber(0x7c00)).toBe(Infinity)
    expect(Number.isNaN(float16ToNumber(0x7e00))).toBe(true)
    expect(float16ToNumber(0x0001)).toBe(2 ** -24) // smallest subnormal
  })
})

describe('loud failures', () => {
  it('rejects a bad magic', () => {
    const buffer = new Uint8Array(bytes('stars.bin'))
    buffer[0] = 0x58
    expect(() => decodeStars(buffer.buffer)).toThrow(ContractError)
  })

  it('rejects a stars file handed to the sets decoder', () => {
    expect(() => decodeSets(bytes('stars.bin'))).toThrow(/expected a sets file/)
  })

  it('rejects a truncated stars file', () => {
    const buffer = new Uint8Array(bytes('stars.bin'))
    expect(() => decodeStars(buffer.slice(0, buffer.byteLength - 1).buffer)).toThrow(
      ContractError,
    )
  })
})
