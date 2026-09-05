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
import { loadManifest, loadPlaneShard, loadPlanes, loadSearch, loadSets } from '../data/load'
import { BLIND_ETERNITIES_SLUG, type Manifest, type PlanesFile, type SearchFile } from '../data/types'
import { sceneErrors } from './errors'
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

    async function run(): Promise<void> {
      lines.push(`data directory ${dataRootSafe()}`)
      patch({})

      const manifest = await loadManifest({ signal })
      lines.push(
        `manifest: ${manifest.dataset}, contract v${manifest.contractVersion}, ` +
          `${manifest.counts.stars} stars, ${manifest.counts.planes} planes`,
      )
      patch({ manifest })

      const planes = await loadPlanes({ signal })
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

      // PRD 8.7.5: the background artefacts wait for the first frame, so they never compete with
      // `stars.bin` for the connection the intro is waiting on.
      const background = afterFirstFrame().then(async () => {
        const [search, sets] = await Promise.all([
          loadSearch({ signal }).catch((error: unknown) => {
            sceneErrors.report('search.json', 3, error)
            return null
          }),
          loadSets({ signal }).catch((error: unknown) => {
            sceneErrors.report('sets.bin', 3, error)
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

      // The Phase 0 contract check, kept: a plane detail shard is the one artefact the scene does
      // not otherwise touch until Phase 2b, and it is the last line `scripts/verify-browser.mjs`
      // waits for.
      const blind = planes.planes.find((plane) => plane.slug === BLIND_ETERNITIES_SLUG)
      if (blind) {
        const shard = await loadPlaneShard(blind.slug, blind.shardCount - 1, { signal })
        lines.push(
          `plane shard ${blind.slug}.${shard.shard}: ${shard.cards.length} cards ` +
            `(of ${blind.shardCount} shards)`,
        )
      }
      patch({})
    }

    void run().catch((error: unknown) => {
      if (signal.aborted) return
      lines.push(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
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

/** Resolves after the browser has painted at least once (PRD 8.7.5's "after the first frame"). */
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
