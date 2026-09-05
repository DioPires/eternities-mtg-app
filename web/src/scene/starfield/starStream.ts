/**
 * PRD 8.7.3: `stars.bin` streams, and planes fill in one by one.
 *
 * This is the join between Phase 0's loader (which does the fetching, the exponential backoff and
 * the three attempts of PRD 7.4.1) and the geometry (which owns the GPU buffers). It adds the two
 * things neither of them can know on their own:
 *
 *  - the draw range grows to whatever has arrived, so the first plane is on screen long before the
 *    last one has been requested;
 *  - a plane is revealed the moment its own slice of the file is complete, which is what makes
 *    PRD 6.8.1's one-by-one fade-in fall out of the byte order rather than needing a schedule.
 *
 * Records are plane-ordered and `planes.json` carries `starOffset`/`starCount`, so "this plane is
 * complete" is a comparison, not a scan.
 */

import type { Stars, StarStreamReader } from '../../data/decode'
import { streamStars, type RetryOptions } from '../../data/load'
import type { PlaneRecord } from '../../data/types'
import type { SceneErrorHub } from '../errors'
import type { PlaneTable } from './planeTable'
import type { StarGeometry } from './starGeometry'

/** PRD 7.4.1: three attempts before the single non-blocking report. */
const ATTEMPTS = 3

export interface StarStreamOptions extends RetryOptions {
  /** Fires on every chunk with the number of records now drawable. For the bench and the shell. */
  readonly onProgress?: (drawable: number, expected: number) => void
  /** Fires once per plane, when its last star has arrived. Phase 2b's intro listens for the end. */
  readonly onPlaneComplete?: (plane: PlaneRecord) => void
}

/**
 * Plane reveal, in one pass per chunk over a cursor rather than over the roster: planes are sorted
 * by `starOffset`, so completion is monotonic and the cursor only ever moves forward.
 */
class PlaneCursor {
  private index = 0
  private readonly ordered: readonly PlaneRecord[]

  constructor(planes: readonly PlaneRecord[]) {
    this.ordered = [...planes]
      .filter((plane) => plane.starCount > 0)
      .sort((a, b) => a.starOffset - b.starOffset)
  }

  /** Reveal every plane fully contained in the first `drawable` records. */
  advance(drawable: number, reveal: (plane: PlaneRecord) => void): void {
    while (this.index < this.ordered.length) {
      const plane = this.ordered[this.index]!
      if (plane.starOffset + plane.starCount > drawable) return
      this.index += 1
      reveal(plane)
    }
  }
}

/**
 * Stream `stars.bin` into `geometry`, revealing planes in `table` as they complete.
 *
 * Resolves when the file is complete. Rejects only if the caller aborted; a genuine load failure
 * is reported through `errors` (PRD 7.4.1) and resolves, because a scene with three quarters of
 * the multiverse in it is still a scene.
 *
 * Returns the decoded {@link Stars} on a complete transfer, and `null` when the transfer failed and
 * was reported. The GPU does not need it — `geometry` already holds those bytes — but the CPU does:
 * PRD 6.6.5's filter evaluation walks the records to build the dimming mask and PRD 6.3.2 counts
 * what survives, both per record and both on the main thread. Handing the snapshot back is what
 * lets the shell do that off the *same* transfer instead of fetching the largest artefact in the
 * contract a second time.
 */
export async function streamStarsIntoScene(
  geometry: StarGeometry,
  table: PlaneTable,
  planes: readonly PlaneRecord[],
  errors: SceneErrorHub,
  options: StarStreamOptions = {},
): Promise<Stars | null> {
  const cursor = new PlaneCursor(planes)
  const { onProgress, onPlaneComplete, ...retry } = options
  let attempts = 0

  const consume = (reader: StarStreamReader): void => {
    const drawable = reader.completeRecords
    if (drawable === 0) return
    geometry.append(reader.body(), drawable)
    cursor.advance(geometry.drawCount, (plane) => {
      table.revealPlane(plane.index)
      onPlaneComplete?.(plane)
    })
    onProgress?.(geometry.drawCount, reader.expectedRecords)
  }

  try {
    return await streamStars(consume, {
      ...retry,
      attempts: retry.attempts ?? ATTEMPTS,
      onRetry: (attempt, error) => {
        attempts = attempt
        retry.onRetry?.(attempt, error)
      },
    })
  } catch (error) {
    if (retry.signal?.aborted) throw error
    // What was actually tried, not the budget. `onRetry` fires once per failed attempt, and since
    // the resumable retry landed that includes the mid-body failures — the attempt loop in
    // `streamStars` wraps the whole transfer — so the count is now the honest one whichever way it
    // broke, where it used to stay at zero for exactly the likeliest failure of the largest
    // artefact in the contract.
    //
    // The floor of one is for the throws that happen before any attempt is made: `dataRoot()` with
    // no `<meta>` in the document is the real one. Nothing was retried because nothing was tried.
    errors.report('stars.bin', Math.max(attempts, 1), error)
    return null
  }
}
