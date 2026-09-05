/**
 * Fetching the artefacts in the order PRD 8.7 requires, against the data directory the build
 * injected into `index.html` (docs/data-contract.md §1, §11).
 *
 * Retry policy is PRD 7.4.1's: exponential backoff, three attempts, then one non-blocking error
 * for the shell's toast. Phase 2a wires the error events to the loader; Phase 4 wires the toast.
 */

import { ContractError, decodeSets, decodeStars, StarStreamReader, type SetsSidecar, type Stars } from './decode'
import type { Manifest, PlaneShardFile, PlanesFile, SearchFile } from './types'
import { CONTRACT_VERSION, SHARD_SIZE } from './types'

/** The build writes this into `index.html`; see `web/vite.config.ts`. */
const DATA_META_NAME = 'eternities:data'

export function dataRoot(): string {
  if (typeof document !== 'undefined') {
    const meta = document.querySelector(`meta[name="${DATA_META_NAME}"]`)
    const content = meta?.getAttribute('content')
    if (content) return content.endsWith('/') ? content : `${content}/`
  }
  throw new ContractError(
    `no <meta name="${DATA_META_NAME}"> in the document; the build step that injects the data ` +
      'directory hash did not run',
  )
}

export interface RetryOptions {
  readonly attempts?: number
  readonly baseDelayMs?: number
  readonly signal?: AbortSignal
  /** Called once per failed attempt, so Phase 2a can surface PRD 7.4.1's single toast. */
  readonly onRetry?: (attempt: number, error: unknown) => void
  /** Injected in tests. */
  readonly fetchImpl?: typeof fetch
  /** Injected in tests; overrides the `<meta>` lookup. */
  readonly root?: string
}

/**
 * PRD 7.4.1's policy, once: three attempts, exponential backoff between them, `onRetry` after each
 * failure so the caller can report how many were actually spent rather than how many were allowed.
 *
 * It takes the attempt as a callback because `streamStars` needs the *body* inside the attempt and
 * not just the response. Retrying only the response is what left a `stars.bin` that died mid-body
 * with zero retries: the rejection came out of `read()`, long after this loop had returned.
 */
async function withRetries<T>(
  options: RetryOptions,
  attempt: () => Promise<T>,
  exhausted: () => Error,
): Promise<T> {
  const attempts = options.attempts ?? 3
  const base = options.baseDelayMs ?? 250

  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await attempt()
    } catch (error) {
      if (options.signal?.aborted) throw error
      lastError = error
      options.onRetry?.(i + 1, error)
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, base * 2 ** i))
      }
    }
  }
  throw lastError instanceof Error ? lastError : exhausted()
}

/** One request. `headers` is only ever the resume `Range` of {@link streamStars}. */
async function fetchOnce(
  url: string,
  options: RetryOptions,
  headers?: Record<string, string>,
): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch
  const init: RequestInit = { signal: options.signal ?? null }
  if (headers) init.headers = headers
  const response = await doFetch(url, init)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response
}

async function fetchWithRetry(path: string, options: RetryOptions): Promise<Response> {
  const url = `${options.root ?? dataRoot()}${path}`
  return withRetries(
    options,
    () => fetchOnce(url, options),
    () => new Error(`failed to fetch ${url}`),
  )
}

function assertContractVersion(file: string, version: number): void {
  if (version !== CONTRACT_VERSION) {
    throw new ContractError(
      `${file} is contract v${version}, this build speaks v${CONTRACT_VERSION}`,
    )
  }
}

export async function loadManifest(options: RetryOptions = {}): Promise<Manifest> {
  const manifest = (await (await fetchWithRetry('manifest.json', options)).json()) as Manifest
  assertContractVersion('manifest.json', manifest.contractVersion)
  return manifest
}

export async function loadPlanes(options: RetryOptions = {}): Promise<PlanesFile> {
  const planes = (await (await fetchWithRetry('planes.json', options)).json()) as PlanesFile
  assertContractVersion('planes.json', planes.contractVersion)
  return planes
}

export async function loadSearch(options: RetryOptions = {}): Promise<SearchFile> {
  const search = (await (await fetchWithRetry('search.json', options)).json()) as SearchFile
  assertContractVersion('search.json', search.contractVersion)
  return search
}

export async function loadSets(options: RetryOptions = {}): Promise<SetsSidecar> {
  return decodeSets(await (await fetchWithRetry('sets.bin', options)).arrayBuffer())
}

/** Non-streaming `stars.bin` load, for tests and for the bench route's fixed path. */
export async function loadStars(options: RetryOptions = {}): Promise<Stars> {
  return decodeStars(await (await fetchWithRetry('stars.bin', options)).arrayBuffer())
}

/** `Content-Range: bytes 1234-5678/9012` → 1234; `null` if it is absent or not a byte range. */
function contentRangeStart(response: Response): number | null {
  const match = /^\s*bytes\s+(\d+)-/i.exec(response.headers.get('Content-Range') ?? '')
  if (!match) return null
  const start = Number(match[1])
  return Number.isSafeInteger(start) ? start : null
}

/**
 * Push one chunk, dropping the first `skip` of its bytes, and return the drop still owed.
 *
 * Dropping rather than seeking is what makes a resumed attempt safe against a server that ignores
 * `Range` and answers 200 with the whole file: the prefix the reader already holds goes in the
 * bin as it arrives, and the reader — with the draw range and the plane reveals built on top of
 * it — only ever moves forward.
 */
function pushChunk(
  reader: StarStreamReader,
  chunk: Uint8Array,
  skip: number,
  onProgress: (reader: StarStreamReader) => void,
): number {
  if (skip >= chunk.byteLength) return skip - chunk.byteLength
  const fresh = skip > 0 ? chunk.subarray(skip) : chunk
  if (fresh.byteLength === 0) return 0
  reader.push(fresh)
  onProgress(reader)
  return 0
}

/** Drain a response body into `reader`, given how many leading bytes it already holds. */
async function drainInto(
  reader: StarStreamReader,
  response: Response,
  resumeFrom: number,
  onProgress: (reader: StarStreamReader) => void,
): Promise<void> {
  let skip = resumeFrom
  if (response.status === 206) {
    const start = contentRangeStart(response)
    // A 206 must say where it starts. Without that the bytes cannot be placed, and guessing they
    // begin at the requested offset is how a partial response gets spliced into the middle of the
    // largest artefact in the contract. Fail the attempt instead; the next one asks again.
    if (start === null) throw new Error('206 response with no usable Content-Range')
    if (start > resumeFrom) {
      throw new Error(`Content-Range starts at ${start}, past the ${resumeFrom} bytes held`)
    }
    skip = resumeFrom - start
  }

  const body = response.body
  if (!body) {
    // No streaming body — a buffering `fetch` or a test double. Same prefix rule, one chunk.
    pushChunk(reader, new Uint8Array(await response.arrayBuffer()), skip, onProgress)
    return
  }

  const stream = body.getReader()
  for (;;) {
    const { done, value } = await stream.read()
    if (done) break
    if (value) skip = pushChunk(reader, value, skip, onProgress)
  }
}

/**
 * PRD 8.3's streaming load. `onProgress` fires per chunk with the record count that is safe to
 * draw, so the star geometry's draw range can grow and planes fade in one by one (PRD 6.8.1).
 *
 * Resumable, which is the rest of PRD 7.4.1 for this artefact. `stars.bin` is the largest file in
 * the contract and much the likeliest to fail *after* its response headers came back fine, and
 * that failure used to get no retries at all — {@link withRetries} sat around the response, and a
 * `read()` rejection came out past it. Here the attempt covers the whole transfer, and a second
 * attempt asks only for the bytes still missing.
 *
 * Two failures are treated alike, because to the user they are the same failure:
 *
 *  - the body rejects mid-stream;
 *  - the body *ends* mid-stream without rejecting. The header declares the record count, so a
 *    short file is detectable, and returning one as though it were whole is the quiet version of
 *    the same bug — planes past the cut simply never appear and nothing is ever reported.
 */
export async function streamStars(
  onProgress: (reader: StarStreamReader) => void,
  options: RetryOptions = {},
): Promise<Stars> {
  const url = `${options.root ?? dataRoot()}stars.bin`
  const reader = new StarStreamReader()

  await withRetries(
    options,
    async () => {
      // Zero on the first attempt, so the happy path sends no `Range` header and looks to a cache
      // exactly as it did before.
      const resumeFrom = reader.receivedBytes
      const response = await fetchOnce(
        url,
        options,
        resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : undefined,
      )
      await drainInto(reader, response, resumeFrom, onProgress)
      if (!reader.done) {
        throw new Error(
          `${url} ended after ${reader.receivedBytes} bytes, ` +
            `${reader.completeRecords} of ${reader.expectedRecords} records`,
        )
      }
    },
    () => new Error(`failed to fetch ${url}`),
  )

  return reader.snapshot()
}

/** PRD 8.7.6 / amendment A1: plane detail arrives shard by shard, uniform across every plane. */
export async function loadPlaneShard(
  slug: string,
  shard: number,
  options: RetryOptions = {},
): Promise<PlaneShardFile> {
  const file = (await (
    await fetchWithRetry(`planes/${slug}.${shard}.json`, options)
  ).json()) as PlaneShardFile
  assertContractVersion(`planes/${slug}.${shard}.json`, file.contractVersion)
  if (file.slug !== slug || file.shard !== shard) {
    throw new ContractError(
      `planes/${slug}.${shard}.json declares ${file.slug} shard ${file.shard}`,
    )
  }
  if (file.shardSize !== SHARD_SIZE) {
    throw new ContractError(`shard size ${file.shardSize}, this build speaks ${SHARD_SIZE}`)
  }
  return file
}
