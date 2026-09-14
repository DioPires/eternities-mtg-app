/**
 * PRD 9.1.2's hidden `/bench` route.
 *
 * > a hidden `/bench` route plays a fixed scripted camera path — one multiverse orbit, fly-to a
 * > large plane, fly-to a small plane, card-sheet approach, card focus with planets, Esc back to
 * > multiverse — and logs p50 and p95 frame time, CPU time per frame, and peak GPU memory to the
 * > console in JSON.
 *
 * **What changed in Phase 6.** Until now the bench was a `?bench` flag that routed to Phase 2a's
 * harness: a star field, an orbit control and nothing else. That was the honest thing to do while
 * the harness was all there was, but it means the committed baseline measures a scene with no card
 * tier, no thumbnails, no labels and no camera rig — roughly half of what a user's GPU actually
 * does. This route flies the same path over the *shipped* scene, so the numbers are the product's.
 *
 * It deliberately does not mount the shell. The HUD, the panels and the overlays are DOM, they do
 * not move per frame (PRD 7.3.3 forbids it), and including them would add a fixed cost to every
 * segment that tells you nothing about the renderer. What is measured is the canvas.
 *
 * Hidden in the sense PRD 9.1.2 means: nothing links to it, and it is not in `router/route.ts`'s
 * vocabulary — `parseRoute` would call `/bench` an unknown route and fall back to the multiverse
 * with a toast. `App` intercepts it before the router ever sees it.
 */

import { Suspense, lazy, useState, type ReactElement } from 'react'

import { useReducedMotion } from '../app/hooks'
import { SceneView } from '../scene/EternitiesScene'
import { motionOverride } from '../scene/motionOverride'
import { useSceneData } from '../scene/useSceneData'

// Type-only from the runner, so asking whether the URL wants the bench does not import it. The
// value — `benchHold` — moved to `benchPath`, which is the module the segment names live in and
// which costs nothing to load. See the note there.
import type { BenchResult } from './BenchRunner'
import { benchHold } from './benchPath'

/**
 * 612 lines that only a recording run can reach.
 *
 * This `lazy()` used to live in `scene/EternitiesScene`, which is the shipped scene — so the import
 * edge sat in the product's module graph and rollup emitted the runner from the product entry, even
 * though no product URL could ever mount it. Review §3.6 phase 3 item 4 moved it here, to the file
 * that was going to import the runner anyway; `SceneView` takes it as `bench.renderRunner`.
 *
 * Still lazy, for the reason it always was: `?hold=<segment>` parks the camera for a PRD 9.3
 * screenshot and records nothing, so that path should not download the sampler. The per-frame
 * `recordBenchCpu` writer stays static in `bench/cpuSamples` — six lines, and the runner reads
 * through it, so the split costs no samples.
 */
const BenchRunner = lazy(async () => ({
  default: (await import('./BenchRunner')).BenchRunner,
}))

/**
 * Which URL asks for the bench.
 *
 * Both spellings, on purpose. `/bench` is what PRD 9.1.2 specifies and what a person types;
 * `?bench` is what `scripts/bench.mjs` has driven since Phase 2a and what the committed baseline
 * was recorded through. Accepting both means the harness did not have to change in the same commit
 * that changed what it measures.
 *
 * `?hold=<segment>` parks the camera at a segment's end for a screenshot (PRD 9.3) and implies the
 * bench route too — there is nothing else to hold.
 */
export function benchRouteRequested(
  pathname = typeof location === 'undefined' ? '' : location.pathname,
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  if (pathname === '/bench' || pathname === '/bench/') return true
  const value = new URLSearchParams(search).get('bench')
  if (value !== null && value !== '0') return true
  return benchHold(search) !== null
}

export function BenchScene(): ReactElement {
  const data = useSceneData()
  // PRD 5.9. The bench resolves reduced motion the way everything else does, but `?motion=0` is
  // how the cross-browser pass holds the field still to compare two GPUs drawing the same thing.
  const resolved = useReducedMotion()
  const reducedMotion = motionOverride() ?? resolved
  const [result, setResult] = useState<BenchResult | null>(null)
  const hold = benchHold()

  return (
    <div className="app">
      <SceneView
        data={data}
        reducedMotion={reducedMotion}
        chrome={false}
        bench={{
          hold,
          renderRunner: (props) => (
            <Suspense fallback={null}>
              <BenchRunner {...props} />
            </Suspense>
          ),
          onComplete: (next) => {
            setResult(next)
            // PRD 9.1.2 says the console, in JSON. `scripts/bench.mjs` reads
            // `window.__eternitiesBench` instead, which the runner sets; this is for a human with
            // devtools open and for the cloud smoke test, which asserts valid JSON appears.
            console.log(JSON.stringify(next))
          },
        }}
      />
      {/* Progress, so a 39-second run does not look like a hang. Deliberately plain text: this is
          not a surface anyone designs, and PRD 9.3 does not judge it. */}
      <div className="overlay" data-testid="bench-status">
        <h1>bench</h1>
        <p className="muted">
          {hold !== null
            ? `parked at “${hold}”`
            : result
              ? 'complete'
              : data.starsComplete
                ? 'flying the path…'
                : `loading — ${data.drawable} / ${data.expected} stars`}
        </p>
        {result && (
          <pre data-testid="bench-result">{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}
