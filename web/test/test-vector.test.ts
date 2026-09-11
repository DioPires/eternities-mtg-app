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
  CARD_LAYOUTS,
  COLOUR_IDENTITY_MASK,
  COLOUR_IDENTITY_SHIFT,
  CONTRACT_VERSION,
  ContractError,
  HUE_CLASS_MASK,
  HueClass,
  SHARD_SIZE,
  StarStreamReader,
  cardBackImageUri,
  colourIdentityBits,
  decodeSets,
  decodeStars,
  float16ToNumber,
  hasBackImage,
  hueClassFromIdentity,
  packColourByte,
  imageUri,
  loadManifest,
  loadPlaneShard,
  loadPlanes,
  loadSearch,
  pageUri,
  shardIndexFor,
  shardPathFor,
  CARD_BACK_URI,
  type CardLayout,
  type CardRecord,
  type Manifest,
  type PlaneShardFile,
  type PlanesFile,
  type RetryOptions,
  type SearchFile,
} from '../src/data'
import { StarGeometry } from '../src/scene/starfield/starGeometry'

const VECTOR_DIR = resolve(__dirname, '../../contract/test-vectors/v2')

interface VectorStar {
  index: number
  x: number
  y: number
  z: number
  planeIndex: number
  hueClass: number
  colourIdentity: number
  sizeClass: number
  brightness: number
  twinklePhase: number
  typeMask: number
}

interface VectorUri {
  printingId: string
  imageTs: string
  layout: CardLayout
  hasSecondFace: boolean
  hasBackImage: boolean
  small: string
  large: string
  artCrop: string
  /** `null` wherever the card has no back image — split, adventure, flip and single-faced. */
  backLarge: string | null
  page: string
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
  uris: VectorUri[]
  colourChecks: Array<{
    colourIdentity: string
    hueClass: number
    identityMask: number
    colourByte: number
  }>
  typeMaskChecks: Array<{ typeLine: string; typeMask: number }>
  backImageChecks: Array<{ layout: CardLayout; hasBackImage: boolean }>
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
    expect(stars.flags).toBe(0)
    for (const expected of vector.stars) {
      const i = expected.index
      expect(stars.x(i)).toBe(expected.x)
      expect(stars.y(i)).toBe(expected.y)
      expect(stars.z(i)).toBe(expected.z)
      expect(stars.planeIndex(i)).toBe(expected.planeIndex)
      expect(stars.hueClass(i)).toBe(expected.hueClass)
      expect(stars.colourIdentity(i)).toBe(expected.colourIdentity)
      expect(stars.sizeClass(i)).toBe(expected.sizeClass)
      expect(stars.brightness(i)).toBe(expected.brightness)
      expect(stars.twinklePhase(i)).toBe(expected.twinklePhase)
      expect(stars.typeMask(i)).toBe(expected.typeMask)
    }
  })

  it('unpacks byte 7 the way the encoder packed it', () => {
    // Amendment A3: hue class in bits 0-2, five-bit WUBRG identity in bits 3-7. Both sides pin
    // the byte itself, because that is the only place the packing is observable.
    for (const check of vector.colourChecks) {
      expect(check.colourByte).toBe(check.hueClass | (check.identityMask << 3))
      expect(check.colourByte & HUE_CLASS_MASK).toBe(check.hueClass)
      expect((check.colourByte >> COLOUR_IDENTITY_SHIFT) & COLOUR_IDENTITY_MASK).toBe(
        check.identityMask,
      )
      // The encoder's side of the same byte, so the packing is pinned in both directions.
      expect(packColourByte(check.hueClass, check.identityMask)).toBe(check.colourByte)
      // The other half of the row: the identity *letters*. Python pins its side by byte equality;
      // without these the TypeScript twins of `colour_identity_mask` and `hue_class_for` — which
      // are what `CardPanel` now labels a card with — are unasserted. (DEC-647 N2.)
      expect(colourIdentityBits(check.colourIdentity)).toBe(check.identityMask)
      expect(hueClassFromIdentity(check.identityMask)).toBe(check.hueClass)
    }
    // A mono-coloured card sets exactly the bit its hue class names, so the shader's uHues
    // lookup and the 6.6.2 identity mask can never disagree about which colour a star is.
    for (const check of vector.colourChecks.filter((c) => c.colourIdentity.length === 1)) {
      expect(check.identityMask).toBe(1 << check.hueClass)
    }
  })

  it('reads a v1-range hue class out of every packed byte', () => {
    // The regression this guards: an unmasked reader sees mono-green as hue 132 and indexes
    // uHues[7] past its end. Every star must decode to a hue in 0-6 whatever its identity is.
    const stars = decodeStars(bytes('stars.bin'))
    for (let i = 0; i < stars.count; i += 1) {
      expect(stars.hueClass(i)).toBeLessThanOrEqual(HueClass.Colourless)
      expect(stars.colourIdentity(i)).toBeLessThanOrEqual(COLOUR_IDENTITY_MASK)
    }
    // ...and the vector really does carry a byte that would break an unmasked reader.
    expect(Math.max(...vector.stars.map((s) => s.hueClass | (s.colourIdentity << 3)))).toBeGreaterThan(
      HueClass.Colourless,
    )
  })

  it('reads byte 7 the same way through StarGeometry as through decodeStars', () => {
    // `StarGeometry`'s two accessors read the record bytes directly, bypassing the decoder — the
    // exact pattern that made PR #10's `hueClassOf` render mono-green as colourless. Pin them
    // against the decoder on the vector, which carries every arity 0-5. `colourIdentityOf` has no
    // caller until the exact-colour-filter leg, so this is the only thing holding it. (DEC-646 N2.)
    const stars = decodeStars(bytes('stars.bin'))
    const geometry = new StarGeometry(stars.count)
    geometry.append(stars.interleaved, stars.count)

    for (let i = 0; i < stars.count; i += 1) {
      expect(geometry.hueClassOf(i)).toBe(stars.hueClass(i))
      expect(geometry.colourIdentityOf(i)).toBe(stars.colourIdentity(i))
    }
    // Not a tautology only while the vector still holds a byte an unmasked reader would fumble.
    const identities = Array.from({ length: stars.count }, (_, i) => geometry.colourIdentityOf(i))
    expect(identities.some((mask) => mask > 0)).toBe(true)
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

  it('fails loudly on an out-of-range star index in every direction', () => {
    const sets = decodeSets(bytes('sets.bin'))
    for (const bad of [-1, vector.starCount, 999]) {
      expect(() => sets.oracleId(bad)).toThrow(ContractError)
      expect(() => sets.setIdsOf(bad)).toThrow(ContractError)
      // `hasSet` used to return a silent `false` here, so a filter off by a plane offset matched
      // nothing instead of failing.
      expect(() => sets.hasSet(bad, 0)).toThrow(ContractError)
    }
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
      const id = expected.printingId
      const ts = Number(expected.imageTs)
      expect(imageUri(id, ts, 'small')).toBe(expected.small)
      expect(imageUri(id, ts, 'large')).toBe(expected.large)
      expect(imageUri(id, ts, 'art_crop')).toBe(expected.artCrop)
    }
  })

  it('agrees with the pipeline on which layouts have a back image (contract §9)', () => {
    // Every Scryfall layout, both sides. This is what stops one language quietly deciding that,
    // say, `adventure` has a back image while the other says it does not.
    //
    // Membership, not a count, is the load-bearing assertion. `vector.json` arrives through an
    // `as Vector` cast, so the union is erased by the time it reaches here: a layout Python knows
    // and TypeScript does not would satisfy every check below, because `hasBackImage` answers
    // `false` for an unknown string and Python answers `false` for a layout with no back image.
    // Comparing the two lists as sets closes that in both directions. The bound this replaces
    // (`length > 20`, against 26 members) closed neither.
    expect([...vector.backImageChecks].map((check) => check.layout).sort()).toEqual(
      [...CARD_LAYOUTS].sort(),
    )
    for (const check of vector.backImageChecks) {
      expect(hasBackImage(check.layout)).toBe(check.hasBackImage)
    }
    // The specific claims the co-review verified against live Scryfall.
    expect(hasBackImage('transform')).toBe(true)
    expect(hasBackImage('modal_dfc')).toBe(true)
    for (const layout of ['split', 'adventure', 'flip', 'meld', 'normal'] as const) {
      expect(hasBackImage(layout)).toBe(false)
    }
  })

  it('derives a back image only where one exists, never a URI that 404s', () => {
    // The regression this pins: a split, adventure or flip card has a second *face* and no second
    // *image*. Deriving `.../back/<id>.jpg` for one of those 404s on live Scryfall, and the old
    // vector asserted exactly that URI for every printing.
    const shards = ['blind-eternities', 'dominaria', 'ravnica'].map((slug) =>
      json<PlaneShardFile>(`planes/${slug}.0.json`),
    )
    const cards = shards.flatMap((s) => s.cards)
    const byPrintingId = new Map<string, CardRecord>()
    for (const card of cards) for (const p of card.p) byPrintingId.set(p[0], card)

    let checkedWithout = 0
    let checkedWith = 0
    for (const expected of vector.uris) {
      const card = byPrintingId.get(expected.printingId)!
      const printing = card.p.find((p) => p[0] === expected.printingId)!
      expect(cardBackImageUri(card, printing, 'large')).toBe(expected.backLarge)
      expect(card.b !== null).toBe(expected.hasSecondFace)
      expect(card.l).toBe(expected.layout)
      if (expected.hasSecondFace && !expected.hasBackImage) checkedWithout += 1
      if (expected.hasBackImage) checkedWith += 1
    }
    // The vector must actually carry both shapes, or this test proves nothing.
    expect(checkedWithout).toBeGreaterThan(0)
    expect(checkedWith).toBeGreaterThan(0)
  })

  it('reaches a meld back face through its own printing id (PRD line 125)', () => {
    const ravnica = json<PlaneShardFile>('planes/ravnica.0.json')
    const meld = ravnica.cards.find((c) => c.l === 'meld')!
    expect(meld.b).not.toBeNull()
    // The meld result is a separate Scryfall object, so its image is its own *front* — not a back
    // face of the component's printing, which is why `b` has to carry an id and a timestamp.
    expect(meld.b!.id).toBeDefined()
    expect(meld.b!.ts).toBeDefined()
    const uri = cardBackImageUri(meld, meld.p[0]!, 'large')
    expect(uri).toBe(imageUri(meld.b!.id!, meld.b!.ts!, 'large', 'front'))
    expect(uri).not.toContain('/back/')

    // The trap the card tier has to avoid: these two disagree on meld, and both are right.
    // `hasBackImage` asks "does this layout derive a back URI from the printing id" — no. But a
    // back image does exist, via `b.id`. So `cardBackImageUri(...) !== null` is the gate on
    // rendering a back face; gating on `hasBackImage` drops every meld back silently.
    expect(hasBackImage('meld')).toBe(false)
    expect(uri).not.toBeNull()
  })

  it('finds every second face in backNames, not only the double-faced ones (PRD 6.5.2)', () => {
    const search = json<SearchFile>('search.json')
    const named = new Set(search.backNames.map(([, name]) => name))
    // A split card's second half must be searchable even though it has no back image.
    expect(named).toContain('Frost')
    expect(named).toContain('Stomp')
    expect(named).toContain('Aberration of Vectors')
  })

  it('percent-encodes a collector number with a Scryfall star', () => {
    // Scryfall collector numbers carry `★` and `†`. A browser papers over it inside an `href`;
    // a `fetch` or a re-template does not.
    expect(pageUri('tv3', '★1')).toBe('https://scryfall.com/card/tv3/%E2%98%851')
    const starred = vector.uris.find((u) => u.page.includes('%E2%98%85'))
    expect(starred).toBeDefined()
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

  it('reads a chunk that is a view into a larger buffer (non-zero byteOffset)', () => {
    // Regression: `push` used to decode `join().buffer`, which discards the view's byteOffset and
    // byteLength, so it read whatever bytes sat at the start of the backing store — here, zeros,
    // giving `bad magic "\0\0\0\0"`. `fetch`'s reader hands out offset-0 chunks, so nothing caught
    // it; a worker or a pooled buffer (Phase 2a) does not.
    const source = new Uint8Array(bytes('stars.bin'))
    const padding = 8
    const backing = new Uint8Array(padding + source.byteLength + padding)
    backing.set(source, padding)
    const chunk = backing.subarray(padding, padding + source.byteLength)
    expect(chunk.byteOffset).toBe(padding)

    const reader = new StarStreamReader()
    reader.push(chunk)
    expect(reader.expectedRecords).toBe(vector.starCount)
    expect(reader.done).toBe(true)
    expect(reader.snapshot().x(2)).toBe(vector.stars[2]!.x)
    expect(reader.snapshot().typeMask(5)).toBe(vector.stars[5]!.typeMask)
  })

  it('reads offset chunks that only complete the header once joined', () => {
    // The multi-chunk path merges into a fresh buffer, so it must stay correct too.
    const source = new Uint8Array(bytes('stars.bin'))
    const backing = new Uint8Array(16 + source.byteLength)
    backing.set(source, 16)
    const reader = new StarStreamReader()
    reader.push(backing.subarray(16, 16 + 9)) // header incomplete
    expect(reader.completeRecords).toBe(0)
    reader.push(backing.subarray(16 + 9))
    expect(reader.expectedRecords).toBe(vector.starCount)
    expect(reader.snapshot().x(2)).toBe(vector.stars[2]!.x)
  })

  it('does not allocate a corrupt header’s record count', () => {
    // Sizing the destination from `recordCount` is what makes the streaming path linear rather
    // than quadratic, but `recordCount` is an unvalidated uint32 off the wire and the streaming
    // path has no equivalent of the length check `decodeStars` does. A header claiming four
    // billion records asks for 48 GB and threw `RangeError` on the first chunk, where the old
    // chunk-list code streamed whatever actually arrived.
    const source = new Uint8Array(bytes('stars.bin'))
    const corrupt = source.slice()
    new DataView(corrupt.buffer).setUint32(8, 0xffffffff, true)

    const reader = new StarStreamReader()
    expect(() => reader.push(corrupt)).not.toThrow()
    expect(reader.expectedRecords).toBe(0xffffffff)
    // Still streams what genuinely arrived, and still refuses to call it done.
    expect(reader.completeRecords).toBe(vector.starCount)
    expect(reader.done).toBe(false)
    expect(reader.snapshot().x(2)).toBe(vector.stars[2]!.x)
  })

  it('grows geometrically when a file runs past its declared length', () => {
    // `grow` used to size exactly to what had arrived, so once a file overran its header every
    // subsequent chunk reallocated and recopied the whole buffer — the quadratic behaviour that
    // sizing from the header exists to remove, back again on the one path already anomalous.
    const source = new Uint8Array(bytes('stars.bin'))
    const reader = new StarStreamReader()
    reader.push(source)
    expect(reader.done).toBe(true)

    // 40 chunks past the end. Under exact-fit growth this is 40 reallocations; under doubling it
    // is at most a handful, and the records the header declared decode unchanged either way.
    for (let i = 0; i < 40; i += 1) reader.push(new Uint8Array(64))
    expect(reader.completeRecords).toBe(vector.starCount)
    expect(reader.snapshot().x(2)).toBe(vector.stars[2]!.x)
    expect(reader.snapshot().typeMask(5)).toBe(vector.stars[5]!.typeMask)
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

  // The float32 flag (§6 header flags bit 0, a uint16 LE at byte 6) would mean a wider record than
  // the fixed 12-byte float16 one this decoder and its length check know how to read. Review §6.1
  // group A deleted the unreachable float32 branch; refusing is what replaced it, so a silent
  // mis-read is the thing this pins. The length check cannot catch it — the byte count is
  // untouched, only the declaration changes. (DEC-715 N5.)
  it('refuses a stars file that declares float32 positions', () => {
    const buffer = new Uint8Array(bytes('stars.bin'))
    expect(() => decodeStars(buffer.buffer)).not.toThrow()
    buffer[6]! |= 1
    expect(() => decodeStars(buffer.buffer)).toThrow(ContractError)
    expect(() => decodeStars(buffer.buffer)).toThrow(/float32 positions/)
  })

  // The §11 argument for bumping to v2 is that a v1 file read by a v2 build fails *silently*
  // without the bump. The code that makes it loud was itself unpinned: `it('is the version this
  // build speaks')` compares two constants and passes even with the gate at `decode.ts:54` deleted
  // outright. These four assert the gate, not the constant. (DEC-646 N1.)
  const PREVIOUS_VERSION = CONTRACT_VERSION - 1
  /** Binary header (§6): `ETRN`, kind, then the contract version. */
  const VERSION_BYTE = 5

  it.each([
    ['stars.bin', decodeStars],
    ['sets.bin', decodeSets],
  ] as const)('rejects a stale-contract header in %s', (name, decode) => {
    const buffer = new Uint8Array(bytes(name))
    expect(buffer[VERSION_BYTE]).toBe(CONTRACT_VERSION)
    buffer[VERSION_BYTE] = PREVIOUS_VERSION

    expect(() => decode(buffer.buffer)).toThrow(
      `contract version ${PREVIOUS_VERSION}, this build speaks ${CONTRACT_VERSION}`,
    )
    // The unmutated bytes decode, so the throw is that one byte and not the mutation itself.
    expect(() => decode(bytes(name))).not.toThrow()
  })

  // `load.assertContractVersion` gates all four JSON artefacts and had no test on any path.
  const VECTOR_ROOT = 'https://eternities.test/data/vector/'

  function servingVersion(version: number): RetryOptions {
    return {
      root: VECTOR_ROOT,
      fetchImpl: ((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const doc = json<Record<string, unknown>>(url.slice(VECTOR_ROOT.length))
        return Promise.resolve(Response.json({ ...doc, contractVersion: version }))
      }),
    }
  }

  it.each([
    ['manifest.json', (o: RetryOptions) => loadManifest(o)],
    ['planes.json', (o: RetryOptions) => loadPlanes(o)],
    ['search.json', (o: RetryOptions) => loadSearch(o)],
    ['planes/dominaria.0.json', (o: RetryOptions) => loadPlaneShard('dominaria', 0, o)],
  ] as const)('rejects a stale-contract %s', async (name, load) => {
    await expect(load(servingVersion(PREVIOUS_VERSION))).rejects.toThrow(
      `${name} is contract v${PREVIOUS_VERSION}, this build speaks v${CONTRACT_VERSION}`,
    )
    // The same artefact at the current version loads, so the gate is the version and nothing else.
    await expect(load(servingVersion(CONTRACT_VERSION))).resolves.toBeDefined()
  })
})
