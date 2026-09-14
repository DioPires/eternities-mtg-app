/**
 * The harness readout panel: what `?probe=1` and `scripts/verify-browser.mjs` assert against.
 *
 * Split out of `EternitiesScene` (review §6.3) rather than deleted. Review §6.1 group B lists this
 * panel and `CameraReadout` for deletion, but two scripts read it and neither is group B's to
 * delete. `verify-browser.mjs` is group C — held until the §4.3 concept decision, and until T3
 * ports its a11y and CSP assertions to `e2e/`. `visual-gate.mjs` group C explicitly *keeps*, as
 * the acceptance instrument for PRD 9.3, and two of its reads are load-bearing rather than
 * tolerant of absence: it sources every capture sidecar on `--target scene` from this panel, and
 * hard-waits on its attract field.
 *
 * So the panel does not merely wait for group C, it outlives it. Deleting it is deliverable only
 * once `visual-gate` sources those sidecars from `ProbeState` on both targets — which it already
 * knows how to do, because that is what it does on `?probe=shell`. Until then it moves out of the
 * shipped scene's file and stays. (DEC-715 attention point 1.)
 *
 * The shell renders none of this: PRD section 6's HUD is the real one.
 */

import { useEffect, useState, type ReactElement } from 'react'

import { BLIND_ETERNITIES_SLUG, type PlanesFile } from '../data'
import type { NavigationSnapshot } from '../navigation/types'

import { CameraReadout } from './CameraReadout'
import { formatMb, gpuMemoryReport } from './cards/gpuMemory'
import {
  copyFrameStats,
  sameDisplayedStats,
  FRAME_STATS_POLL_MS,
  type FrameStatsSnapshot,
} from './renderer/frameStats'
import type { SceneHost } from './renderer/sceneHost'
import type { SceneDataError } from './errors'
import type { SceneNavigation } from '../navigation/scene'
import type { PickResult } from './picking/scenePicker'
import type { PlaneDetailStatus } from './usePlaneDetail'

/**
 * The readout's two live counters: **the one leaf that polls `FrameStats`** (review §3.6 phase 3,
 * item 3).
 *
 * These used to be `useState` in `SceneView`, written by a 500 ms `setInterval` from two getters
 * that return a fresh object every call. Both writes re-rendered the component that owns
 * `<Canvas>` twice a second for the whole session, and R3F pushes that component's children into
 * its own reconciler on every render — which rebuilt `SelectiveBloomEffect` and its render targets
 * each time (DEC-692 R1, review §2.2; ~308 MB/s of GPU memory, measured on the live site).
 *
 * Two things changed when the loop left React. The poll now reads the **mutable `FrameStats`
 * record** the tick writes, rather than reaching into the card tier's handle for two getters that
 * allocate — so this leaf holds no scene object at all, only plain numbers. And it re-renders only
 * when {@link sameDisplayedStats} says a value it actually prints has moved: `frameMs` changes on
 * every single tick, so a poller that compared raw samples would re-render twice a second forever,
 * including on a still scene under reduced motion, which is the case PRD 5.9 exists to make cheap.
 */
function SceneStats({ stats }: { stats: FrameStatsSnapshot }): ReactElement {
  const [shown, setShown] = useState(() => copyFrameStats(stats))

  useEffect(() => {
    const read = (): void => {
      setShown((previous) => (sameDisplayedStats(previous, stats) ? previous : copyFrameStats(stats)))
    }
    read()
    const timer = window.setInterval(read, FRAME_STATS_POLL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [stats])

  const memory = gpuMemoryReport(shown.atlasBytes, shown.cardBytes)
  return (
    <>
      <li data-testid="thumbnails">
        thumbnails: {shown.thumbnails} drawn · {shown.thumbnailCells} / {shown.thumbnailCapacity}{' '}
        cells · {shown.thumbnailsFailed} failed
      </li>
      <li data-testid="gpu">
        gpu: {formatMb(memory.totalBytes)} of {formatMb(memory.targetBytes)} target (atlas{' '}
        {formatMb(memory.atlasBytes)}, card {formatMb(memory.cardBytes)}) ·{' '}
        {memory.withinTarget
          ? 'within target'
          : memory.withinCeiling
            ? 'over target'
            : 'OVER CEILING'}
      </li>
    </>
  )
}

export interface SceneReadoutProps {
  readonly scene: SceneNavigation | null
  readonly snapshot: NavigationSnapshot | null
  readonly planes: PlanesFile | null
  readonly focusedSlug: string | null
  readonly focusedCardName: string | null
  readonly focusedPrintings: number
  /** The renderer. The readout reads its `FrameStats` record and its card handle. */
  readonly host: SceneHost
  readonly detail: PlaneDetailStatus | null
  readonly hover: PickResult
  readonly reducedMotion: boolean
  readonly quality: { readonly label: string; readonly changes: number }
  readonly stars: { readonly drawable: number; readonly expected: number; readonly complete: boolean }
  readonly decodeOk: boolean
  readonly toast: SceneDataError | null
}

export function SceneReadout({
  scene,
  snapshot,
  planes,
  focusedSlug,
  focusedCardName,
  focusedPrintings,
  host,
  detail,
  hover,
  reducedMotion,
  quality,
  stars,
  decodeOk,
  toast,
}: SceneReadoutProps): ReactElement {
  return (
    <div className="scene-status" data-testid="eternities-status">
      <h1>Eternities</h1>
      <p className="muted">
        Drag to orbit · scroll to zoom · click a plane, a star or a thumbnail · Esc to go back ·{' '}
        <kbd>b</kbd> the Blind Eternities · <kbd>a</kbd> attract mode · <kbd>f</kbd> flip
      </p>
      <ul>
        <li data-testid="focus">
          focus: {snapshot?.focus.kind ?? '—'}
          {focusedSlug !== null ? ` (${focusedSlug})` : ''} · level {snapshot?.level ?? '—'}
        </li>
        <li data-testid="flight">
          flight: {snapshot?.flight ? `#${snapshot.flight.id}` : 'idle'} · attract{' '}
          {String(snapshot?.attract ?? false)} · reduced motion {String(reducedMotion)}
        </li>
        {scene && <CameraReadout rig={scene.rig} />}
        <li data-testid="stars">
          stars: {stars.drawable} / {stars.expected}
          {stars.complete ? ' (complete)' : ' (streaming)'} · quality {quality.label} ·{' '}
          {quality.changes} change{quality.changes === 1 ? '' : 's'}
        </li>
        <li data-testid="detail">
          detail:{' '}
          {detail === null
            ? '—'
            : `${detail.slug} ${detail.cards} cards over ${detail.shards} shard(s)` +
              (detail.slug === BLIND_ETERNITIES_SLUG ? ' (sharded, worker-parsed)' : '')}
        </li>
        <SceneStats stats={host.stats} />
        <li data-testid="card">
          card:{' '}
          {focusedCardName === null
            ? '—'
            : `${focusedCardName} · ${host.cardTier?.card.planetCount ?? 0} planet(s)` +
              ` of ${focusedPrintings} printing(s)` +
              (host.cardTier?.card.canFlip ? ' · flippable' : '')}
        </li>
        <li data-testid="hover">
          hover:{' '}
          {hover === null
            ? '—'
            : hover.kind === 'star'
              ? `star ${hover.index}`
              : hover.kind === 'planet'
                ? `planet ${hover.index}`
                : `plane ${planes?.planes[hover.index]?.displayName ?? hover.index}`}
        </li>
      </ul>
      {!decodeOk && <p className="bad">the data contract decode failed — see the console</p>}
      {toast && (
        <p className="bad" data-testid="data-error">
          {toast.message}
        </p>
      )}
    </div>
  )
}
