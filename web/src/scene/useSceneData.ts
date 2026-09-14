/**
 * PRD 8.7's loading order, as one hook.
 *
 *   1. the shell renders the sky and the background starfield — no data involved (`Background`);
 *   2. `manifest.json` and `planes.json`, after which plane glows appear (PRD 8.7.2);
 *   3. `stars.bin` streamed, planes filling in one by one (PRD 8.7.3);
 *   4. `search.json` and `sets.bin` in the background, after the first frame (PRD 8.7.5).
 *
 * Steps 5 and 6 — the intro fly-to and the per-plane detail shards — belong to Phase 2b, which is
 * why `onStarsComplete` exists rather than an intro being triggered here.
 *
 * Every fetch goes through Phase 0's loader, so the three attempts with exponential backoff of PRD
 * 7.4.1 apply throughout; what this adds is the single non-blocking report per artefact and the
 * decision to keep going. A missing `search.json` costs the set facet, not the multiverse.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { SetsSidecar, Stars } from '../data/decode'
import { LOAD_ATTEMPTS, loadManifest, loadPlanes, loadSearch, loadSets } from '../data/load'
import type { Manifest, PlanesFile, SearchFile } from '../data/types'
import { sceneErrors } from './errors'
import { bootPositionMode } from './platform/capabilities'
import { createNebulaTexture } from './starfield/nebulaTexture'
import { PlaneTable } from './starfield/planeTable'
import { createStarField, type StarField } from './starfield/starFieldObjects'
import { StarGeometry, resolvePositionMode, type PositionMode } from './starfield/starGeometry'
import { streamStarsIntoScene } from './starfield/starStream'

export interface SceneResources {
  readonly table: PlaneTable
  readonly geometry: StarGeometry
  readonly field: StarField
  readonly positionMode: PositionMode
}

export interface SceneDataState {
  readonly manifest: Manifest | null
  readonly planes: PlanesFile | null
  readonly resources: SceneResources | null
  /** Records currently drawable — the growing draw range of PRD 8.7.3. */
  readonly drawable: number
  readonly expected: number
  readonly starsComplete: boolean
  /**
   * The decoded `stars.bin`, once the transfer completed. The scene itself never reads it — the
   * geometry owns those bytes on the GPU — but PRD 6.6.5's filter mask and PRD 6.3.2's count are
   * built per record on the CPU, and this is how the shell gets them without a second transfer of
   * the largest artefact on the page. `null` while streaming, and after a failed transfer.
   */
  readonly stars: Stars | null
  readonly search: SearchFile | null
  readonly sets: SetsSidecar | null
  /** Human-readable progress, and the Phase 0 contract check it inherited. */
  readonly report: readonly string[]
  readonly ok: boolean
}

const INITIAL: SceneDataState = {
  manifest: null,
  planes: null,
  resources: null,
  drawable: 0,
  expected: 0,
  starsComplete: false,
  stars: null,
  search: null,
  sets: null,
  report: [],
  ok: true,
}

export function useSceneData(): SceneDataState {
  const [state, setState] = useState<SceneDataState>(INITIAL)
  // The nebula lookup is deterministic and shared; building it twice would be pure waste.
  const noise = useMemo(() => createNebulaTexture(), [])
  const disposers = useRef<Array<() => void>>([])

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    const lines: string[] = []
    const patch = (next: Partial<SceneDataState>): void => {
      if (signal.aborted) return
      setState((previous) => ({ ...previous, ...next, report: [...lines] }))
    }

    /**
     * PRD 7.4.1's "reports once via a non-blocking toast", for the two artefacts that had no
     * reporter at all.
     *
     * `stars.bin` has always reported — `streamStarsIntoScene` takes the hub. `search.json` and
     * `sets.bin` report in their own `catch` below. `manifest.json` and `planes.json` did not: they
     * rejected, the rejection fell through to the outer `catch`, and all the user got was a
     * `FAILED:` line in a report that nothing renders. Those two are the artefacts whose absence
     * means there is no multiverse at all, so they were the only ones a user could not be told
     * about.
     *
     * Rethrows, because these are still fatal to the load: the report is an addition to the
     * existing control flow, not a replacement for it. `reportedFailure` is what keeps the outer
     * catch from adding a second, vaguer toast on top of this one.
     *
     * **The `aborted` guard is not defensive, it is load-bearing.** `withRetries` rethrows an abort
     * on the spot, and under `StrictMode` React mounts, unmounts and remounts, so the first run's
     * loads reject with an `AbortError` on *every healthy page load* in development. Reporting
     * those would put "Could not load manifest.json" on screen while the second run was quietly
     * succeeding — and worse, the hub reports each artefact only once, so the abort would consume
     * the one report a real failure needed. Same test the outer catch has always made.
     */
    let reportedFailure = false
    const failing =
      (artefact: string) =>
      (error: unknown): never => {
        if (!signal.aborted) {
          reportedFailure = true
          sceneErrors.report(artefact, LOAD_ATTEMPTS, error)
        }
        throw error
      }

    async function run(): Promise<void> {
      lines.push(`data directory ${dataRootSafe()}`)
      patch({})

      /*
       * Ask the GPU about half-float vertex attributes while the first two artefacts are in flight
       * (DEC-739, `scene/platform/halfFloatProbe`).
       *
       * The answer is needed below, at the moment the `StarGeometry` is built, and asking for it
       * there would be the worst available time: `resolvePositionMode` is synchronous, and the
       * probe costs a context, two shader compiles and a `readPixels` — **measured at 68 ms on this
       * M5 Pro through ANGLE Metal**, not the ~1 ms review §3.5 estimates, because a synchronous
       * readback is a full pipeline flush however small the target. Paid at the call site that is
       * two network round trips deep, that is 68 ms of dead main thread between `planes.json`
       * landing and the first star being drawable.
       *
       * Paid *here*, one frame in, it is 68 ms of a main thread that is otherwise waiting on the
       * network — and `bootPositionMode` caches, so the call below is free. If the fetches somehow
       * win the race the probe simply runs at its old moment; nothing depends on the ordering for
       * correctness, only for when the cost lands.
       *
       * **Two corrections to the paragraph above, from DEC-747 N1.**
       *
       * First, the 68 ms is wall-clock for the whole of `bootPositionMode` and it is *not* what the
       * bench's `halfFloatProbeMs` reports. That field's clock starts inside
       * `probeHalfFloatAttributes`, so it excludes the `getContext('webgl2')` — two different
       * numbers, both wanted: this one decides *when* to run the probe, the bench field compares
       * GPUs at the readback. `e2e/quality.spec.ts` bounds the field, not the wall-clock.
       *
       * Second, **68 ms does not reproduce.** Measured in situ against this scheduling, on an M5
       * Pro through Chrome 141 on a `vite preview` build: `getContext` 2.2 ms, probe 3.3 ms, ~5.5 ms
       * end to end. It is not context-creation cost hiding on a cold page either — the *first*
       * WebGL2 context of a fresh page timed 1.8 ms and the second 1.2 ms. The 68 ms is left on the
       * record rather than deleted because it is what the deferral was designed against and the
       * conditions that produced it are not known; what is measured is that on this machine the
       * probe is cheap wherever it runs, and the ordering here costs nothing to keep.
       */
      void afterFirstFrame().then(() => {
        if (!signal.aborted) bootPositionMode()
      })

      const manifest = await loadManifest({ signal }).catch(failing('manifest.json'))
      lines.push(
        `manifest: ${manifest.dataset}, contract v${manifest.contractVersion}, ` +
          `${manifest.counts.stars} stars, ${manifest.counts.planes} planes`,
      )
      patch({ manifest })

      const planes = await loadPlanes({ signal }).catch(failing('planes.json'))
      lines.push(`planes.json: ${planes.planes.length} rows, R = ${planes.multiverseRadius}`)

      // PRD 8.7.2: the roster is enough to draw the plane glows, so build the scene now and let
      // the stars arrive into it. Zero-card planes are complete at this point (PRD 5.3.6).
      const positionMode = resolvePositionMode()
      const table = new PlaneTable(planes.planes, planes.multiverseRadius)
      const geometry = new StarGeometry(manifest.counts.stars, positionMode)
      const field = createStarField(table, geometry, noise)
      table.revealEmptyPlanes()
      disposers.current.push(() => {
        field.dispose()
        geometry.dispose()
        table.dispose()
      })
      lines.push(`star buffer: ${manifest.counts.stars} records, ${positionMode} positions`)
      patch({ planes, resources: { table, geometry, field, positionMode }, expected: manifest.counts.stars })

      // PRD 8.7.5: the background artefacts wait for the first frame.
      //
      // What that buys, precisely (review §5.2 F6): they are not *issued* before the first paint,
      // so the paint is never behind them. It is not a guarantee that they never compete with
      // `stars.bin` — the star transfer is still streaming at that point and these start beside
      // it. Gating on `starsComplete` instead would deliver non-competition and cost the search
      // index its head start; PRD 8.7.5 asks for the frame, so the frame is what this waits on.
      const background = afterFirstFrame().then(async () => {
        const [search, sets] = await Promise.all([
          loadSearch({ signal }).catch((error: unknown) => {
            sceneErrors.report('search.json', LOAD_ATTEMPTS, error)
            return null
          }),
          loadSets({ signal }).catch((error: unknown) => {
            sceneErrors.report('sets.bin', LOAD_ATTEMPTS, error)
            return null
          }),
        ])
        if (search) lines.push(`search.json: ${search.cardNames.length} names, ${search.sets.length} sets`)
        if (sets) {
          const oracleId = sets.oracleId(0)
          lines.push(
            `sets.bin: star 0 is ${oracleId}, resolves back to index ${sets.starIndexOf(oracleId)}, ` +
              `${sets.setIdsOf(0).length} set id(s)`,
          )
        }
        patch({ search, sets })
      })

      const stars = await streamStarsIntoScene(geometry, table, planes.planes, sceneErrors, {
        signal,
        onPlaneComplete: () => {
          patch({ drawable: geometry.drawCount })
        },
      })
      lines.push(
        `stars.bin: ${geometry.drawCount} of ${manifest.counts.stars} records drawable, ` +
          `${planes.planes.filter((p) => (table.planes[p.index]?.fade ?? 0) > 0).length} planes revealed`,
      )
      patch({ drawable: geometry.drawCount, starsComplete: true, stars })

      await background
      patch({})
    }

    void run().catch((error: unknown) => {
      if (signal.aborted) return
      lines.push(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
      // Anything that got this far without a named artefact — the plane-shard contract check, or a
      // bug in the sequence itself. Still the user's problem, so it still becomes a toast; named
      // vaguely because at this point all that is honestly known is that the load stopped.
      if (!reportedFailure) sceneErrors.report('the multiverse', LOAD_ATTEMPTS, error)
      patch({ ok: false })
    })

    const cleanup = disposers.current
    return () => {
      controller.abort()
      for (const dispose of cleanup.splice(0)) dispose()
    }
  }, [noise])

  useEffect(
    () => () => {
      noise.dispose()
    },
    [noise],
  )

  return state
}

/**
 * Resolves after the browser has painted at least once (PRD 8.7.5's "after the first frame").
 *
 * One rAF plus a macrotask. Not "after `stars.bin`" — see the call site.
 */
function afterFirstFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      // One more turn, so the resolution lands after the paint rather than inside it.
      setTimeout(resolve, 0)
    })
  })
}

/** The data root, or a readable placeholder — the loader itself will produce the real error. */
function dataRootSafe(): string {
  const meta = document.querySelector('meta[name="eternities:data"]')
  return meta?.getAttribute('content') ?? '(not injected)'
}
