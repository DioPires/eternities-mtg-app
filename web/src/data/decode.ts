/**
 * The TypeScript half of the data contract: decoders for `stars.bin` and `sets.bin`.
 * The Python twin is `pipeline/src/eternities/contract/binary.py`, and both sides assert against
 * `contract/test-vectors/v2`. See `docs/data-contract.md` §2, §5, §6.
 *
 * Design constraints, both from PRD 7.3.2 (no allocations in the per-frame path):
 *  - decoding creates typed-array *views* over the received buffer wherever it can, no copies;
 *  - `stars.bin` is uploaded to the GPU as one interleaved buffer, so nothing is repacked.
 */

import { colourByteOf, colourIdentityFromColourByte, hueClassFromColourByte } from './colourByte'
import {
  BINARY_HEADER_BYTES,
  BINARY_MAGIC,
  BinaryKind,
  CONTRACT_VERSION,
  SetsSection,
  SHARD_SIZE,
  STAR_RECORD_BYTES,
  type OracleId,
  type SetId,
  type StarIndex,
} from './types'

export class ContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractError'
  }
}

export interface BinaryHeader {
  readonly kind: BinaryKind
  readonly flags: number
  readonly recordCount: number
}

const FLAG_FLOAT32_POSITIONS = 1 << 0

export function decodeHeader(buffer: ArrayBuffer, byteOffset = 0): BinaryHeader {
  if (buffer.byteLength - byteOffset < BINARY_HEADER_BYTES) {
    throw new ContractError(`buffer shorter than the ${BINARY_HEADER_BYTES}-byte header`)
  }
  const bytes = new Uint8Array(buffer, byteOffset, BINARY_HEADER_BYTES)
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (magic !== BINARY_MAGIC) {
    throw new ContractError(`bad magic ${JSON.stringify(magic)}, expected ${BINARY_MAGIC}`)
  }
  const view = new DataView(buffer, byteOffset, BINARY_HEADER_BYTES)
  const kind = view.getUint8(4)
  const version = view.getUint8(5)
  if (version !== CONTRACT_VERSION) {
    throw new ContractError(`contract version ${version}, this build speaks ${CONTRACT_VERSION}`)
  }
  if (view.getUint32(12, true) !== 0) {
    throw new ContractError('reserved header word is not zero')
  }
  if (kind !== BinaryKind.Stars && kind !== BinaryKind.Sets) {
    throw new ContractError(`unknown binary kind ${kind}`)
  }
  return { kind, flags: view.getUint16(6, true), recordCount: view.getUint32(8, true) }
}

/**
 * A decoded `stars.bin`.
 *
 * `interleaved` is the record array with no header, ready to become a single WebGL buffer with
 * stride {@link STAR_RECORD_BYTES}. Positions are materialised only on demand, through
 * {@link Stars.toFloat32Positions}, for PRD risk 6's fallback path and PRD 8.5.7's CPU motion
 * mirror. (The field this used to name, `float32Positions`, went with review §6.1 group A.)
 */
export interface Stars {
  readonly count: number
  readonly flags: number
  readonly interleaved: Uint8Array
  readonly view: DataView
  x(index: StarIndex): number
  y(index: StarIndex): number
  z(index: StarIndex): number
  planeIndex(index: StarIndex): number
  /** PRD 5.4.8, bits 0-2 of byte 7. Always 0-6, whatever the identity bits above it hold. */
  hueClass(index: StarIndex): number
  /**
   * PRD 6.6.2, bits 3-7 of byte 7: the card's five-bit WUBRG colour identity (amendment A3).
   *
   * 0 is colourless. It is also what a card with no colours set reads as, which is the same
   * thing here — but pair it with {@link hueClass} if a caller needs to tell the two apart.
   */
  colourIdentity(index: StarIndex): number
  sizeClass(index: StarIndex): number
  brightness(index: StarIndex): number
  twinklePhase(index: StarIndex): number
  typeMask(index: StarIndex): number
  /** Decoded positions as a flat `[x, y, z, ...]` Float32Array. Allocates; call once at load. */
  toFloat32Positions(): Float32Array
}

export function decodeStars(buffer: ArrayBuffer): Stars {
  const header = decodeHeader(buffer)
  if (header.kind !== BinaryKind.Stars) {
    throw new ContractError(`expected a stars file, got kind ${header.kind}`)
  }
  const expected = BINARY_HEADER_BYTES + header.recordCount * STAR_RECORD_BYTES
  if (buffer.byteLength !== expected) {
    throw new ContractError(`stars.bin is ${buffer.byteLength} bytes, expected ${expected}`)
  }
  return makeStars(buffer, header.recordCount, header.flags)
}

function makeStars(buffer: ArrayBuffer, count: number, flags: number): Stars {
  const interleaved = new Uint8Array(buffer, BINARY_HEADER_BYTES, count * STAR_RECORD_BYTES)
  const view = new DataView(buffer, BINARY_HEADER_BYTES, count * STAR_RECORD_BYTES)
  // The record is a fixed 12 bytes (three float16 coordinates), so a float32 emitter would need a
  // wider record than this decoder — and than the length check above — knows how to read. Refuse
  // rather than mis-read: PRD risk 6's fallback is `starGeometry`'s, not a second record layout.
  if ((flags & FLAG_FLOAT32_POSITIONS) !== 0) {
    throw new ContractError('stars.bin declares float32 positions; the record is 12-byte float16')
  }
  const at = (i: StarIndex, offset: number): number => i * STAR_RECORD_BYTES + offset
  const coordinate = (i: StarIndex, axis: 0 | 1 | 2): number =>
    float16ToNumber(view.getUint16(at(i, axis * 2), true))

  return {
    count,
    flags,
    interleaved,
    view,
    x: (i) => coordinate(i, 0),
    y: (i) => coordinate(i, 1),
    z: (i) => coordinate(i, 2),
    planeIndex: (i) => view.getUint8(at(i, 6)),
    // Byte 7 goes through `colourByte`, never read here: it packs two fields and a reader that
    // masks for itself is exactly what failed in PR #10 (see that module's header).
    hueClass: (i) => hueClassFromColourByte(colourByteOf(interleaved, i)),
    colourIdentity: (i) => colourIdentityFromColourByte(colourByteOf(interleaved, i)),
    sizeClass: (i) => view.getUint8(at(i, 8)),
    brightness: (i) => view.getUint8(at(i, 9)),
    twinklePhase: (i) => view.getUint8(at(i, 10)),
    typeMask: (i) => view.getUint8(at(i, 11)),
    toFloat32Positions() {
      const out = new Float32Array(count * 3)
      for (let i = 0; i < count; i += 1) {
        out[i * 3] = coordinate(i, 0)
        out[i * 3 + 1] = coordinate(i, 1)
        out[i * 3 + 2] = coordinate(i, 2)
      }
      return out
    },
  }
}

/**
 * IEEE 754 binary16 to a JS number.
 *
 * Written out rather than using `Float16Array` on purpose: PRD 7.1.2 supports current Safari,
 * Chrome and Firefox, and this path must not depend on how recently a browser shipped that type.
 */
export function float16ToNumber(bits: number): number {
  const sign = (bits & 0x8000) !== 0 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const mantissa = bits & 0x3ff
  if (exponent === 0) return sign * mantissa * 2 ** -24
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : NaN
  return sign * (mantissa + 1024) * 2 ** (exponent - 25)
}

/**
 * The most `StarStreamReader` will allocate on a header's word alone, before the bytes to fill it
 * have arrived.
 *
 * 64 MB is ~5.6 million star records — two orders of magnitude past the real dataset and 180×
 * `fixture-scale`, so no honest file ever reaches it and the single-allocation fast path is
 * unaffected. It is not a contract limit and nothing is rejected for exceeding it: a file that
 * really is larger simply grows through `grow`.
 */
const MAX_EAGER_BODY_BYTES = 64 * 1024 * 1024

/**
 * Incremental reader for the streaming `stars.bin` fetch of PRD 8.3.
 *
 * Feed it chunks as they arrive; `complete` is the number of whole records available, which is
 * exactly the draw range the renderer may use. Because records are plane-ordered, whole planes
 * become drawable one after another (PRD 6.8.1).
 */
export class StarStreamReader {
  /** Chunks held only until the header arrives and the buffer below can be sized from it. */
  private chunks: Uint8Array[] = []
  /**
   * The destination, allocated once from the header's `recordCount`.
   *
   * The alternative — a chunk list merged on demand — is quadratic in bytes copied here, because
   * the consumer asks for `body()` after every chunk and each merge copies everything received so
   * far. Unnoticeable on a 360 KB fixture; tens of megabytes of copying and GC on the real file,
   * during the intro fly-to, which is the one moment the frame budget is not negotiable.
   */
  private buffer: Uint8Array | null = null
  private received = 0
  private header: BinaryHeader | null = null

  push(chunk: Uint8Array): void {
    if (this.buffer !== null) {
      if (this.received + chunk.byteLength > this.buffer.byteLength) this.grow(chunk.byteLength)
      this.buffer.set(chunk, this.received)
      this.received += chunk.byteLength
      return
    }

    this.chunks.push(chunk)
    this.received += chunk.byteLength
    if (this.header === null && this.received >= BINARY_HEADER_BYTES) {
      // Read through the view's own offset. A chunk may be a view into a larger backing buffer —
      // `fetch`'s reader hands out offset-0 chunks today, but a worker or a pooled buffer (Phase
      // 2a moves shard parsing off the main thread) does not, and `.buffer` alone would silently
      // decode whatever bytes happen to sit at the start of the backing store.
      const joined = this.join()
      // Into a local, and assigned to the reader only once the whole block has succeeded. A
      // reader used to be thrown away with the failed load, so recording the header before
      // validating its kind cost nothing; PRD 7.4.1's retry keeps the reader across attempts, and
      // a half-assigned header is one the next attempt finds already set and skips — taking the
      // kind check and the header-sized allocation with it, and handing a `sets.bin` served at
      // this path to the renderer as the multiverse.
      const header = decodeHeader(joined.buffer as ArrayBuffer, joined.byteOffset)
      if (header.kind !== BinaryKind.Stars) {
        throw new ContractError(`expected a stars file, got kind ${header.kind}`)
      }
      // The header knows the length, so from here every chunk is written straight into place —
      // but `recordCount` is an unvalidated uint32 off the wire, and the streaming path has no
      // equivalent of the length check `decodeStars` does against a whole buffer. Trusting it
      // outright turns a corrupt header that still passes magic, version and the reserved word
      // into a `RangeError` on the first chunk, where the old chunk-list code streamed whatever
      // actually arrived. So size to the header only as far as `MAX_EAGER_BODY_BYTES` and let
      // `grow` take it from there: a real file under the cap still allocates exactly once, which
      // is the whole point of allocating from the header, and a claim of four billion records
      // costs nothing until the bytes turn up.
      const declared = BINARY_HEADER_BYTES + header.recordCount * STAR_RECORD_BYTES
      const sized = new Uint8Array(
        Math.max(Math.min(declared, BINARY_HEADER_BYTES + MAX_EAGER_BODY_BYTES), this.received),
      )
      sized.set(joined, 0)
      // Header and buffer together, after the last thing that can throw: they are one state, and
      // no attempt may ever observe half of it. The chunk list is not part of that state — the
      // push above already banked the bytes and the count, and a throw here leaves them on the
      // reader. That is harmless, and load-bearing: the rejected bytes stay put, so an attempt
      // that re-delivers only part 1 of the same wrong file re-joins it and rejects it again
      // rather than finding an empty reader and starting over.
      this.header = header
      this.buffer = sized
      this.chunks = []
    }
  }

  /**
   * Make room for a chunk that does not fit: either the file is longer than its own header says,
   * or the header declared more than {@link MAX_EAGER_BODY_BYTES} and the bytes are now arriving
   * to back the claim.
   *
   * Doubling, not fitting exactly. Fitting reallocates and recopies on *every* chunk once this
   * path is live, which is the quadratic behaviour that sizing from the header exists to remove —
   * reintroducing it on the one path where the stream is already anomalous. Doubling makes the
   * total copied linear in what arrives, at the cost of at most one unused buffer's worth of
   * slack. `completeRecords` still clamps to `recordCount`, so an over-long file's excess is
   * ignored rather than decoded, exactly as before.
   */
  private grow(incoming: number): void {
    const needed = this.received + incoming
    const previous = this.buffer?.byteLength ?? 0
    const grown = new Uint8Array(Math.max(needed, previous * 2))
    if (this.buffer !== null) grown.set(this.buffer.subarray(0, this.received), 0)
    this.buffer = grown
  }

  /**
   * Bytes received so far, header included.
   *
   * This is the resume point of PRD 7.4.1's retry: a stream that dies part-way asks for
   * `bytes=<this>-` rather than starting the largest artefact in the contract over. Byte-exact on
   * purpose — it may land in the middle of a record, and the next chunk simply continues it.
   */
  get receivedBytes(): number {
    return this.received
  }

  /** Whole records received so far. Safe to use as a draw range. */
  get completeRecords(): number {
    if (this.header === null) return 0
    const body = this.received - BINARY_HEADER_BYTES
    return Math.min(Math.floor(body / STAR_RECORD_BYTES), this.header.recordCount)
  }

  get expectedRecords(): number {
    return this.header?.recordCount ?? 0
  }

  /**
   * Whether the 16-byte header has arrived and been accepted.
   *
   * Only for reporting: `expectedRecords` is 0 both for a file that declares no stars and for a
   * stream that died inside its own header, and the two want different words.
   */
  get hasHeader(): boolean {
    return this.header !== null
  }

  get done(): boolean {
    return this.header !== null && this.completeRecords === this.header.recordCount
  }

  /**
   * The whole records received so far, header stripped, as a **view** — no copy.
   *
   * Phase 2a's renderer uploads the new tail of this to the GPU on every chunk (PRD 8.7.3), and
   * copying the whole buffer each time to do so would be the largest allocation on the load path.
   * Genuinely no copy once the header has landed, because `push` writes into a buffer sized from
   * `recordCount` — before that fix this claim was false and every call merged the whole stream.
   *
   * The view is only valid until the next `push`, which is why this is a method, not a property:
   * an over-long file reallocates, and the old view would then be of a stale buffer.
   */
  body(): Uint8Array {
    const records = this.completeRecords
    if (records === 0) return new Uint8Array(0)
    return this.join().subarray(
      BINARY_HEADER_BYTES,
      BINARY_HEADER_BYTES + records * STAR_RECORD_BYTES,
    )
  }

  /** Materialise what has arrived. Allocates, so call it on chunk boundaries, not per frame. */
  snapshot(): Stars {
    if (this.header === null) throw new ContractError('no header received yet')
    const records = this.completeRecords
    const bytes = this.join().slice(0, BINARY_HEADER_BYTES + records * STAR_RECORD_BYTES)
    return makeStars(bytes.buffer, records, this.header.flags)
  }

  /**
   * Everything received so far, contiguous. Once the header has landed this is a view of the
   * sized buffer and costs nothing; before that it merges the handful of chunks that arrived
   * first, which happens at most once.
   */
  private join(): Uint8Array {
    if (this.buffer !== null) return this.buffer.subarray(0, this.received)
    if (this.chunks.length > 1) {
      const merged = new Uint8Array(this.received)
      let offset = 0
      for (const chunk of this.chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      this.chunks = [merged]
    }
    return this.chunks[0] ?? new Uint8Array(0)
  }
}

/** A decoded `sets.bin`: the binary sidecar that loads with `search.json` (PRD 8.7.5). */
export interface SetsSidecar {
  readonly starCount: number
  /** Star index to `oracle_id`. */
  oracleId(index: StarIndex): OracleId
  /** The deep-link direction of PRD 6.7.1. `-1` when the id is not in this dataset. */
  starIndexOf(oracleId: OracleId): StarIndex
  /** Distinct included-printing set ids for a star, ascending. Returns a view, do not mutate. */
  setIdsOf(index: StarIndex): Uint16Array
  /** PRD 6.6.3's set-facet test, as a sorted membership check with no allocation. */
  hasSet(index: StarIndex, setId: SetId): boolean
}

export function decodeSets(buffer: ArrayBuffer): SetsSidecar {
  const header = decodeHeader(buffer)
  if (header.kind !== BinaryKind.Sets) {
    throw new ContractError(`expected a sets file, got kind ${header.kind}`)
  }
  const starCount = header.recordCount
  const view = new DataView(buffer)
  const sectionCount = view.getUint32(BINARY_HEADER_BYTES, true)
  if (view.getUint32(BINARY_HEADER_BYTES + 4, true) !== 0) {
    throw new ContractError('reserved section-table word is not zero')
  }

  const sections = new Map<number, { offset: number; byteLength: number }>()
  for (let i = 0; i < sectionCount; i += 1) {
    const base = BINARY_HEADER_BYTES + 8 + i * 16
    const id = view.getUint32(base, true)
    const offset = view.getUint32(base + 4, true)
    const byteLength = view.getUint32(base + 8, true)
    if (view.getUint32(base + 12, true) !== 0) {
      throw new ContractError(`section ${id}: reserved word is not zero`)
    }
    if (offset + byteLength > buffer.byteLength) {
      throw new ContractError(`section ${id} runs past the end of the buffer`)
    }
    sections.set(id, { offset, byteLength })
  }

  const section = (id: SetsSection, name: string): { offset: number; byteLength: number } => {
    const found = sections.get(id)
    if (!found) throw new ContractError(`sets.bin is missing section ${name}`)
    return found
  }

  const oracle = section(SetsSection.OracleIds, 'ORACLE_IDS')
  if (oracle.byteLength !== starCount * 16) {
    throw new ContractError(`ORACLE_IDS is ${oracle.byteLength} bytes, expected ${starCount * 16}`)
  }
  const oracleBytes = new Uint8Array(buffer, oracle.offset, oracle.byteLength)

  const countsSection = section(SetsSection.SetCounts, 'SET_COUNTS')
  if (countsSection.byteLength !== starCount * 2) {
    throw new ContractError(
      `SET_COUNTS is ${countsSection.byteLength} bytes, expected ${starCount * 2}`,
    )
  }
  const counts = new Uint16Array(buffer, countsSection.offset, starCount)

  // Offsets are a prefix sum rather than a stored array: monotone uint32s do not compress,
  // small uint16 counts do (docs/data-contract.md §6).
  const offsets = new Uint32Array(starCount + 1)
  for (let i = 0; i < starCount; i += 1) offsets[i + 1] = offsets[i]! + counts[i]!
  const totalEntries = offsets[starCount]!

  const entriesSection = section(SetsSection.SetEntries, 'SET_ENTRIES')
  if (entriesSection.byteLength !== totalEntries * 2) {
    throw new ContractError(
      `SET_ENTRIES is ${entriesSection.byteLength} bytes, expected ${totalEntries * 2}`,
    )
  }
  const entries = new Uint16Array(buffer, entriesSection.offset, totalEntries)

  let index: Map<OracleId, StarIndex> | null = null

  return {
    starCount,
    oracleId(i) {
      if (i < 0 || i >= starCount) throw new ContractError(`star index ${i} out of range`)
      return formatUuid(oracleBytes, i * 16)
    },
    starIndexOf(oracleId) {
      if (index === null) {
        index = new Map()
        for (let i = 0; i < starCount; i += 1) index.set(formatUuid(oracleBytes, i * 16), i)
      }
      return index.get(oracleId.toLowerCase()) ?? -1
    },
    setIdsOf(i) {
      if (i < 0 || i >= starCount) throw new ContractError(`star index ${i} out of range`)
      return entries.subarray(offsets[i], offsets[i + 1])
    },
    hasSet(i, setId) {
      // Throws like `oracleId` and `setIdsOf` rather than returning a silent `false`: this sits in
      // the facet path, and a filter that is off by a plane offset must fail loudly, not match
      // nothing (PRD 7.7.2).
      if (i < 0 || i >= starCount) throw new ContractError(`star index ${i} out of range`)
      let low = offsets[i]!
      let high = offsets[i + 1]! - 1
      while (low <= high) {
        const mid = (low + high) >> 1
        const value = entries[mid]!
        if (value === setId) return true
        if (value < setId) low = mid + 1
        else high = mid - 1
      }
      return false
    },
  }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

function formatUuid(bytes: Uint8Array, offset: number): string {
  let out = ''
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-'
    out += HEX[bytes[offset + i]!]
  }
  return out
}

/** PRD 8.3: a card's shard is `floor(localIndex / shardSize)` and needs no lookup table. */
export function shardIndexFor(localIndex: number, shardSize: number = SHARD_SIZE): number {
  return Math.floor(localIndex / shardSize)
}

/** Amendment A1: every plane shards, so the loader has one code path. */
export function shardPathFor(slug: string, shard: number): string {
  return `planes/${slug}.${shard}.json`
}

/** PRD 6.6.2: a card matches a type facet when any selected bit is set. */
export function matchesTypeMask(typeMask: number, selectedBits: number): boolean {
  return selectedBits === 0 || (typeMask & selectedBits) !== 0
}
