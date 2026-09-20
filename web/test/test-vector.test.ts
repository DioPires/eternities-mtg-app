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
  READABLE_CONTRACT_VERSIONS,
  HUE_CLASS_MASK,
  HueClass,
  SHARD_SIZE,
  StarStreamReader,
  cardBackImageUri,
  colourIdentityBits,
  decodeSets,
  decodeStars,
  decodeSwatches,
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
import { PerspectiveCamera, Vector2, Vector3 } from 'three'

import type { PlaneRecord } from '../src/data/types'

import { Framing, HOME_POLAR } from '../src/camera/framing'
import { DRIFT_VERTICAL_RATIO } from '../src/scene/tuning'
import { PLANE_PICK_FLOOR_PX, PlanePicker } from '../src/scene/picking/scenePicker'
import { FOV } from '../src/scene/renderer/sceneRenderer'
import {
  FRAMING_REFERENCE_FOV_RADIANS,
  FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX,
} from '../src/scene/worlds/surfaceLaw'
import { driftOffset } from '../src/scene/starfield/motion'
import { PlaneTable } from '../src/scene/starfield/planeTable'

const VECTOR_DIR = resolve(__dirname, '../../contract/test-vectors/v3')

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

interface VectorFloat16 {
  bits: number
  value: number
}

interface Vector {
  contractVersion: number
  dataHash: string
  starCount: number
  stars: VectorStar[]
  /** v3 §2.2: four RGB565 samples per star, in star order. */
  swatches: number[][]
  /** v3 §2.4: plane slug -> the shipped per-row cell counts. Only planes that have a grid. */
  rowCells: Record<string, number[]>
  /** v3 §2.3: the artist of every printing of every card, in shard order. */
  artists: string[][]
  /** The float16 edge cases v2 pinned through star positions (§5); see `vector_summary`. */
  float16Checks: VectorFloat16[]
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
  /**
   * The `home`-law camera constants `pipeline/src/eternities/fixtures/layout.py` mirrors by hand
   * (DEC-884). Published by the Python half, checked against the renderer by the block at the
   * bottom of this file — which is what makes the mirror two-way.
   */
  cameraLaw: {
    homeElevationRad: number
    homeDistanceFactor: number
    fovDegrees: number
    referenceViewportHeightPx: number
    referenceFocalPx: number
    pickProxyMargin: number
    /** A **diameter**, in `scenePicker.ts`' units; `layout` keeps it as a radius. */
    pickFloorDiameterPx: number
    driftVerticalRatio: number
  }
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

  it('decodes swatches.bin to the exact samples the encoder recorded (§2.2)', () => {
    const swatches = decodeSwatches(bytes('swatches.bin'))
    expect(swatches.count).toBe(vector.starCount)
    expect(vector.swatches).toHaveLength(vector.starCount)
    vector.swatches.forEach((expected, i) => {
      expect([...swatches.samples(i)]).toEqual(expected)
    })
  })

  it('indexes swatches by star index alone, with no table (§2.2)', () => {
    // The whole encoding is that `swatches.bin` is parallel to `stars.bin`: the lookup is
    // `starIndex * 8 + 16`. Asserted against the raw bytes rather than through the decoder, so a
    // decoder that quietly introduced an offset table would fail here.
    const raw = new DataView(bytes('swatches.bin'))
    vector.swatches.forEach((expected, i) => {
      for (let corner = 0; corner < 4; corner += 1) {
        expect(raw.getUint16(16 + i * 8 + corner * 2, true)).toBe(expected[corner])
      }
    })
  })

  it('converts a swatch sample to linear light with the 6-bit green field intact (§1.4)', () => {
    const swatches = decodeSwatches(bytes('swatches.bin'))
    // Star 5's four samples are all 0xFFFF, star 6's all 0x0000: the two ends, exactly.
    expect(swatches.linear(5, 0)).toEqual([1, 1, 1])
    expect(swatches.linear(6, 0)).toEqual([0, 0, 0])
    // Star 0 corner 2 is 0xF800 — pure red — and corner 3 is 0x001F, pure blue. Green is the
    // six-bit field an RGB555 packing would get wrong, so 0x07E0 has to come out pure green.
    expect(swatches.linear(0, 2)).toEqual([1, 0, 0])
    expect(swatches.linear(0, 3)).toEqual([0, 0, 1])
    expect(swatches.linear(1, 0)).toEqual([0, 1, 0])
  })

  it('rejects a star index outside the swatch file', () => {
    const swatches = decodeSwatches(bytes('swatches.bin'))
    expect(() => swatches.samples(-1)).toThrow(ContractError)
    expect(() => swatches.samples(vector.starCount)).toThrow(ContractError)
  })

  it('ships rowCells on every world and omits it everywhere else (§2.4)', () => {
    const planes = json<PlanesFile>('planes.json')
    for (const plane of planes.planes) {
      const hasGrid = plane.slug !== 'blind-eternities' && plane.cardCount > 0
      expect(plane.rowCells === undefined).toBe(!hasGrid)
      if (!hasGrid) continue
      const rowCells = plane.rowCells!
      expect(vector.rowCells[plane.slug]).toEqual([...rowCells])
      // `rowCells.length` is the row count and the counts sum to the card count — the two claims
      // a client derives everything else from.
      expect(rowCells.reduce((a, b) => a + b, 0)).toBe(plane.cardCount)
      expect(rowCells.length).toBeGreaterThan(0)
    }
  })

  it('places every world cell on the unit sphere (§2.1)', () => {
    // v3 bytes 0-5 are a unit-sphere cell centre, not a plane-local position. Read back through
    // the float16 round trip, which is the only length a client ever sees.
    const stars = decodeStars(bytes('stars.bin'))
    const planes = json<PlanesFile>('planes.json')
    for (const plane of planes.planes) {
      if (plane.rowCells === undefined) continue
      for (let i = plane.starOffset; i < plane.starOffset + plane.starCount; i += 1) {
        const length = Math.hypot(stars.x(i), stars.y(i), stars.z(i))
        expect(length).toBeGreaterThan(1 - 2e-3)
        expect(length).toBeLessThan(1 + 2e-3)
      }
    }
  })

  it('carries the artist as the sixth printing-tuple element, empty string and all (§2.3)', () => {
    const shards = ['blind-eternities', 'dominaria', 'ravnica'].map((slug) =>
      json<PlaneShardFile>(`planes/${slug}.0.json`),
    )
    const artists = shards.flatMap((shard) => shard.cards.map((c) => c.p.map((t) => t[5])))
    expect(artists).toEqual(vector.artists)
    // One printing has `""`. The element must be *present* and empty, not absent: an encoder that
    // dropped it would shorten exactly one tuple and nothing else would notice.
    expect(artists.flat()).toContain('')
    for (const shard of shards) {
      for (const card of shard.cards) {
        for (const tuple of card.p) expect(tuple).toHaveLength(6)
      }
    }
  })

  it('decodes every pinned float16 bit pattern the same way (§5)', () => {
    for (const check of vector.float16Checks) {
      expect(float16ToNumber(check.bits)).toBe(check.value)
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

  // The §11 argument for bumping the version is that an older file read by a newer build fails
  // *silently* without the bump. The code that makes it loud was itself unpinned: `it('is the
  // version this build speaks')` compares two constants and passes even with the gate at
  // `decode.ts` deleted outright. These assert the gate, not the constant. (DEC-646 N1.)
  //
  // **v3 changed what the mutant has to be.** `CONTRACT_VERSION - 1` is 2, and v2 is now a version
  // this build deliberately *reads* — worlds spec §2's dual-scene period needs it to. So the
  // rejected version is one no build has ever written, and the readable pair gets an assertion of
  // its own below: a gate that accepted everything and a gate that accepted only v3 would both
  // pass a test that only ever mutates to v2.
  const UNREADABLE_VERSION = 1
  /** Binary header (§6): `ETRN`, kind, then the contract version. */
  const VERSION_BYTE = 5

  it.each([
    ['stars.bin', decodeStars],
    ['sets.bin', decodeSets],
    ['swatches.bin', decodeSwatches],
  ] as const)('rejects an unreadable-contract header in %s', (name, decode) => {
    const buffer = new Uint8Array(bytes(name))
    expect(buffer[VERSION_BYTE]).toBe(CONTRACT_VERSION)
    buffer[VERSION_BYTE] = UNREADABLE_VERSION

    expect(() => decode(buffer.buffer)).toThrow(ContractError)
    expect(() => decode(buffer.buffer)).toThrow(/contract version 1/)
    // The unmutated bytes decode, so the throw is that one byte and not the mutation itself.
    expect(() => decode(bytes(name))).not.toThrow()
  })

  it.each([
    ['stars.bin', decodeStars],
    ['sets.bin', decodeSets],
  ] as const)('rejects a v2 header in %s, now that the galaxy has retired', (name, decode) => {
    // Was "still reads a v2 header, for the dual-scene period": `datasets.json` kept `active` on the
    // last v2 dataset while v3 was published beside it. That period closed at the cutover (worlds
    // spec §3.2, DEC-752), in the commit that moved `active`, and the refusal is now the guard —
    // v3 dropped the spiral fields and their readers go through `?? 0`, so a v2 file this build
    // accepted would render with the shear flattened rather than fail.
    const buffer = new Uint8Array(bytes(name))
    buffer[VERSION_BYTE] = 2
    expect(READABLE_CONTRACT_VERSIONS.has(2)).toBe(false)
    expect(() => decode(buffer.buffer)).toThrow(ContractError)
    expect(() => decode(bytes(name)), 'the v3 bytes still decode').not.toThrow()
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
  ] as const)('rejects an unreadable-contract %s', async (name, load) => {
    await expect(load(servingVersion(UNREADABLE_VERSION))).rejects.toThrow(
      `${name} is contract v${UNREADABLE_VERSION}, this build reads`,
    )
    // The same artefact at the readable version loads, so the gate is the version and nothing
    // else. v2 is refused since the cutover (DEC-752) — see the header rows above.
    await expect(load(servingVersion(CONTRACT_VERSION))).resolves.toBeDefined()
    await expect(load(servingVersion(2))).rejects.toThrow(`${name} is contract v2, this build reads`)
  })
})


/**
 * The `home`-law camera mirror, from the renderer's side (DEC-884).
 *
 * `pipeline/src/eternities/fixtures/layout.py` restates six constants that live in TypeScript, and
 * bakes the result into `planes.json` as every plane's `home`. The mirror used to be one-way and
 * unguarded: DEC-865 doubled `DRIFT_VERTICAL_RATIO` in `tuning.ts` and the entire web suite stayed
 * green, because the Python law never read this side and this side never read the Python law.
 *
 * `vector.json` is the bridge, and it is the bridge that already exists — the `data contract` CI
 * job runs `test_test_vector.py` and this file against the same committed bytes, so the six
 * constants ride the freeze point the rest of the contract rides. Move one half alone and one of
 * the two suites goes red; regenerate the vector to silence the Python half and this one reds
 * instead.
 *
 * **Not a source-text parse, and deliberately not.** A guard that grepped `framing.ts` for `1.9`
 * would be only as good as its parser: `1.9`, `19 / 10`, `1.90`, a value moved behind a helper or
 * a `const` re-export all mean the same thing to the renderer and different things to a regex.
 * Two of the six are not exported at all — `framing.ts`' `r * 1.9` is a literal inside an object
 * argument, and `scenePicker.ts`' `PLANE_PICK_MARGIN` is a module-private `const` — and rather
 * than export them (which would put a non-comment change into `web/src/scene`, and the Renderer
 * Draw Rule with it) this block reads both *behaviourally*, through `Framing.multiverse()` and
 * through `PlanePicker.pick` itself. A behavioural read cannot be fooled by a respelling, and it
 * fails if the constant is right but no longer reaches the code path, which is the failure a
 * parse cannot see at all.
 */
describe('the home-law camera constants are mirrored in both directions', () => {
  const law = vector.cameraLaw

  /** A `planes.json` with nothing in it but the field `Framing` reads. */
  function discOfRadius(multiverseRadius: number): PlanesFile {
    return { contractVersion: CONTRACT_VERSION, shardSize: SHARD_SIZE, multiverseRadius, planes: [] }
  }

  /** One plane, carrying only the fields the picker and the drift read. */
  function planeRecord(overrides: Partial<PlaneRecord>): PlaneRecord {
    return {
      index: 0,
      slug: 'dominaria',
      displayName: 'dominaria',
      notes: '',
      kind: 'spiral',
      cardCount: 10,
      starOffset: 0,
      starCount: 0,
      shardCount: 1,
      home: [0, 0, 0],
      radius: 1,
      tilt: [0, 0, 0, 1],
      spinPeriodS: 100,
      spinDirection: 1,
      driftAmplitude: 0,
      driftPeriodS: 1,
      driftPhase: 0,
      palette: [1, 0, 0, 0, 0, 0, 0],
      nebulaTint: [1, 1, 1],
      firstYear: null,
      lastYear: null,
      sets: [],
      ...overrides,
    }
  }

  const DRIFT_PERIOD_S = 100

  it('agrees about the home view elevation', () => {
    // `framing.ts` stores the polar angle from +Y and `layout.py` stores the elevation above the
    // disc. The subtraction is done here, in the open, rather than published twice.
    expect(HOME_POLAR).toBeCloseTo(Math.PI / 2 - law.homeElevationRad, 15)
    expect(new Framing(discOfRadius(130)).multiverse().framePolar).toBeCloseTo(HOME_POLAR, 15)
  })

  it('agrees about how far the home view sits from the origin', () => {
    // `r * 1.9` is a literal inside `Framing.multiverse`'s argument, so this reads the factor back
    // out of the tether. Two radii, because one would pass a `frameDistance` that had quietly
    // become a constant — the same hole DEC-865 found on the Python side of this very number.
    for (const radius of [130, 325]) {
      const tether = new Framing(discOfRadius(radius)).multiverse()
      expect(tether.frameDistance / radius).toBeCloseTo(law.homeDistanceFactor, 12)
    }
  })

  it('agrees about the reference viewport the pixel law is written for', () => {
    // Three spellings of one fov: the renderer's degrees, the surface law's radians, and the
    // focal length `layout.py` pre-multiplies. All three have to move together.
    expect(FOV).toBe(law.fovDegrees)
    expect(FRAMING_REFERENCE_FOV_RADIANS).toBeCloseTo((law.fovDegrees * Math.PI) / 180, 15)
    expect(FRAMING_REFERENCE_VIEWPORT_HEIGHT_PX).toBe(law.referenceViewportHeightPx)

    const focalPx =
      law.referenceViewportHeightPx / (2 * Math.tan(((law.fovDegrees * Math.PI) / 180) / 2))
    // Both engines land on the same double here, but the mirrored quantities are the fov and the
    // height; the focal length is their product and is checked as one.
    expect(Math.abs(focalPx / law.referenceFocalPx - 1)).toBeLessThan(1e-12)
  })

  it('agrees about the screen-space pick floor', () => {
    expect(PLANE_PICK_FLOOR_PX).toBe(law.pickFloorDiameterPx)
  })

  it('agrees about the pick proxy margin, measured through the picker', () => {
    // `PLANE_PICK_MARGIN` is module-private, so the margin is recovered from the shipped raycast:
    // find the pointer offset at which a plane stops being picked, and the ray that grazes the
    // proxy there is at one proxy radius from its centre.
    const WIDTH = 1920
    const HEIGHT = 1080
    // A viewport tall enough that §1.11's floor converts to ~1e-5 world units. The floor and the
    // margin are a `max`, and this is what makes the margin the branch under test.
    const TALL = 1e7
    const DEPTH = 400
    const RADIUS = 10

    const camera = new PerspectiveCamera(law.fovDegrees, WIDTH / HEIGHT, 0.1, 8000)
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()

    const table = new PlaneTable([planeRecord({ home: [0, 0, -DEPTH], radius: RADIUS })], 200)
    table.revealPlane(0)
    table.advance(10, 0)
    const picker = new PlanePicker()
    const picks = (ndcX: number) =>
      picker.pick(new Vector2(ndcX, 0), camera, table, 0, TALL) === 0

    expect(picks(0)).toBe(true)
    // The proxy is ~11.5 units at 400 of depth, well inside the frustum, so the bracket holds.
    let inside = 0
    let outside = 1
    expect(picks(outside)).toBe(false)
    for (let step = 0; step < 60; step += 1) {
      const middle = (inside + outside) / 2
      if (picks(middle)) inside = middle
      else outside = middle
    }

    // The grazing ray, and its perpendicular distance to the plane's centre: that distance is the
    // proxy radius the picker used, and the margin is what it is in units of the drawn radius.
    const direction = new Vector3(inside, 0, 0.5).unproject(camera).normalize()
    const centre = new Vector3(0, 0, -DEPTH)
    const along = centre.dot(direction)
    const perpendicular = Math.sqrt(centre.lengthSq() - along * along)
    expect(perpendicular / RADIUS).toBeCloseTo(law.pickProxyMargin, 6)
  })

  it('agrees about the vertical half of the drift orbit, measured through the drift', () => {
    // The constant is exported, so this checks it directly — and then checks that it is the number
    // the drift actually applies, which is the half a constant comparison cannot see.
    expect(DRIFT_VERTICAL_RATIO).toBe(law.driftVerticalRatio)

    const AMPLITUDE = 7
    const table = new PlaneTable(
      [planeRecord({ driftAmplitude: AMPLITUDE, driftPeriodS: DRIFT_PERIOD_S })],
      200,
    )
    table.revealPlane(0)
    const out = { x: 0, y: 0, z: 0 }
    let tallest = 0
    let widest = 0
    // `y` peaks at `sin(2a) = 1`; sweeping rather than solving keeps this a measurement of the
    // shipped orbit instead of a second copy of its formula.
    for (let step = 0; step <= 2000; step += 1) {
      driftOffset(table.raw, 0, (step / 2000) * DRIFT_PERIOD_S, out)
      tallest = Math.max(tallest, Math.abs(out.y))
      widest = Math.max(widest, Math.hypot(out.x, out.z))
    }
    expect(widest).toBeCloseTo(AMPLITUDE, 4)
    expect(tallest / widest).toBeCloseTo(law.driftVerticalRatio, 4)
  })
})
