/**
 * PRD 7.4.1: "any failed data chunk retries with exponential backoff (three attempts) and reports
 * once via a non-blocking toast."
 *
 * The retrying lives in `data/load.ts`, from Phase 0. This is the other half: after the third
 * attempt fails, the scene emits **one** event per artefact, and Phase 4's shell renders the toast.
 * The scene keeps rendering — a missing `stars.bin` costs the stars, not the app.
 *
 * "Once" is enforced here rather than left to the listener: an artefact that has already reported
 * is remembered, so a retry the user triggers later cannot produce a second toast for the same
 * failure.
 */

export interface SceneDataError {
  /** The artefact that failed, as its path relative to the data directory. */
  readonly artefact: string
  /** How many attempts were made before giving up (PRD 7.4.1's three). */
  readonly attempts: number
  readonly error: unknown
  /** A sentence Phase 4 can put in the toast without knowing anything about the loader. */
  readonly message: string
}

export type SceneDataErrorListener = (error: SceneDataError) => void

export class SceneErrorHub {
  private readonly listeners = new Set<SceneDataErrorListener>()
  private readonly reported = new Set<string>()

  subscribe(listener: SceneDataErrorListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** True if this artefact has already produced its one event. */
  hasReported(artefact: string): boolean {
    return this.reported.has(artefact)
  }

  /** Report a give-up. A second call for the same artefact is a no-op (PRD 7.4.1's "once"). */
  report(artefact: string, attempts: number, error: unknown): void {
    if (this.reported.has(artefact)) return
    this.reported.add(artefact)
    const payload: SceneDataError = {
      artefact,
      attempts,
      error,
      message: `Could not load ${artefact} after ${attempts} attempts. Some of the multiverse is missing.`,
    }
    for (const listener of this.listeners) listener(payload)
  }

  /** Test seam. Nothing in the app clears this — one failure, one toast, for the session. */
  reset(): void {
    this.reported.clear()
  }
}

/** The instance the scene reports to and Phase 4's toast subscribes to. */
export const sceneErrors = new SceneErrorHub()
