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

async function fetchWithRetry(path: string, options: RetryOptions): Promise<Response> {
  const attempts = options.attempts ?? 3
  const base = options.baseDelayMs ?? 250
  const doFetch = options.fetchImpl ?? fetch
  const url = `${options.root ?? dataRoot()}${path}`

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await doFetch(url, { signal: options.signal ?? null })
      if (!response.ok) throw new Error(`${url} returned ${response.status}`)
      return response
    } catch (error) {
      if (options.signal?.aborted) throw error
      lastError = error
      options.onRetry?.(attempt + 1, error)
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, base * 2 ** attempt))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`failed to fetch ${url}`)
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

/**
 * PRD 8.3's streaming load. `onProgress` fires per chunk with the record count that is safe to
 * draw, so the star geometry's draw range can grow and planes fade in one by one (PRD 6.8.1).
 */
export async function streamStars(
  onProgress: (reader: StarStreamReader) => void,
  options: RetryOptions = {},
): Promise<Stars> {
  const response = await fetchWithRetry('stars.bin', options)
  const reader = new StarStreamReader()
  const body = response.body
  if (!body) {
    reader.push(new Uint8Array(await response.arrayBuffer()))
    onProgress(reader)
    return reader.snapshot()
  }
  const stream = body.getReader()
  for (;;) {
    const { done, value } = await stream.read()
    if (done) break
    if (value) {
      reader.push(value)
      onProgress(reader)
    }
  }
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
