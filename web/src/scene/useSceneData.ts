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

import type { SetsSidecar, Stars, Swatches } from '../data/decode'
import {
  LOAD_ATTEMPTS,
  loadManifest,
  loadPlanes,
  loadSearch,
  loadSets,
  loadSwatches,
} from '../data/load'
import {
  SWATCHES_FILE,
  shouldLoadSwatches,
  type Manifest,
  type PlanesFile,
  type SearchFile,
} from '../data/types'
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
  /**
   * `swatches.bin`, on a **worlds** dataset only (worlds spec §2.2).
   *
   * `null` on any dataset that did not publish the file — a v2 one, the fixtures until DEC-796 gave
   * them a synthetic swatch column of their own — and `null`
   * on a dataset that published it and whose fetch failed, which is reported rather than passed
   * over silently. The two cases are told apart before the fetch, by the manifest's `files` list
   * and `planes.json`'s `rowCells` together (see the gate below, and {@link shouldLoadSwatches});
   * `load.ts` is explicit that once the caller has decided, a missing file is an error and not a
   * degraded mode, because a world painted from anything but its cards' art is a picture that reads
   * as the product working.
   *
   * **Failing this artefact does not fail the load, today.** §3.2 keeps the galaxy and the worlds
   * path coexisting until the gate, the owner, the W0.1 field reports and feature parity all clear,
   * so a broken `swatches.bin` must not cost a user the multiverse it is not part of. What it does
   * cost is every world: nothing composes, and `__eternitiesProbe.worlds()` answers `undefined`,
   * which §3.1 defines as a **setup failure** rather than a measurement. At cutover this joins
   * `planes.json` on the fatal row, because there is then nothing else to draw.
   */
  readonly swatches: Swatches | null
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
  swatches: null,
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
       * probe costs a context, two shader compiles and a `readPixels` — **measured once at 68 ms on
       * this M5 Pro through ANGLE Metal, a figure that has not reproduced since; see the corrections
       * below** — against the ~1 ms review §3.5 estimates, because a synchronous readback is a full
       * pipeline flush however small the target. Paid at the call site that is two network round
       * trips deep, a cost of that size is dead main thread between `planes.json` landing and the
       * first star being drawable.
       *
       * Paid *here*, one frame in, it is a main thread that is otherwise waiting on the network —
       * and `bootPositionMode` caches, so the call below is free. If the fetches somehow win the
       * race the probe simply runs at its old moment; nothing depends on the ordering for
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
       * Second, **68 ms does not reproduce — now on three independent measurements.** Measured in
       * situ against this scheduling, on an M5 Pro through Chrome 141 on a `vite preview` build:
       * `getContext` 2.2 ms, probe 3.3 ms, ~5.5 ms end to end. DEC-756's reviewer then measured it
       * a third time on a different instrument — `getContext` hooked on the prototype before any app
       * code runs, fresh browser and cold page per run — and got a median of **5.3 ms** end to end
       * across seven runs, of which the excluded `getContext` is ~2.2 ms. It is not context-creation
       * cost hiding on a cold page either: the page's genuinely first WebGL2 context is the
       * renderer's 300x150, and across those runs it cost 3.6-14.1 ms. Nothing near 68.
       *
       * The 68 is left on the record rather than deleted because it is what the deferral was
       * designed against, and a scheduling choice with no stated reason is a worse comment than one
       * carrying a figure with its refutation attached. Nothing rides on the value either way — the
       * deferral costs nothing, so it stays whichever number is right.
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

      /*
       * `swatches.bin`, beside `stars.bin` rather than in the background pair (§2.2, `load.ts`).
       *
       * Issued here, awaited after the star stream: the worlds surface cannot compose without it,
       * and it is ~200 KB against `stars.bin`'s megabytes, so it costs the stream nothing to have
       * it in flight alongside. Asked for only when the dataset can actually compose a world, and
       * that is **two** questions, not one — because a speculative fetch is a broken artefact and a
       * toast on every page load, which is the outcome this gate exists to prevent.
       *
       * Both questions live in {@link shouldLoadSwatches}, with the reasoning for each half. They
       * were spelled inline here until DEC-807, which is what left the *conjunction* unfalsifiable
       * once DEC-796 gave the fixtures a swatch column and no committed dataset separated the two
       * halves any more: dropping either conjunct was invisible to the whole suite. Named, the
       * decision can be struck at directly, and `web/test/swatch-gate.test.ts` does.
       */
      const swatchLoad = shouldLoadSwatches(manifest, planes.planes)
        ? loadSwatches({ signal }).catch((error: unknown) => {
            if (!signal.aborted) sceneErrors.report(SWATCHES_FILE, LOAD_ATTEMPTS, error)
            return null
          })
        : Promise.resolve(null)

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

      // **Awaited after `starsComplete` is published, never before it.** `starsComplete` gates the
      // program warm-up and the GPU self-check, and `swatches.bin` can spend three attempts with
      // exponential backoff before it gives up — folding it into the line above would hold the
      // warm-up behind a fetch that has nothing to do with it. So the two land in separate patches,
      // and the worlds pass is handed all three artefacts at once by its caller rather than
      // assembling them from setters that can arrive in either order — see `EternitiesScene`.
      const swatches = await swatchLoad
      if (swatches) lines.push(`swatches.bin: ${swatches.count} records`)
      patch({ swatches })

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
