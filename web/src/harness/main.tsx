/**
 * The harness entry: the bench, the GPU self-check and the `?probe=1` scene, and nothing the
 * product ships.
 *
 * Review §3.6 phase 3, item 4. These three were `lazy()` branches of `App`. That kept them out of
 * the product's *first chunk* — which was the defect §5.4 B1 and §6.3 were about, and it was
 * genuinely fixed — but not out of the product's *build*: `App` named the modules, so rollup
 * emitted `BenchScene`, `SelfCheckScene` and everything they reach as chunks of the product entry,
 * and a reviewer diffing `dist/` could not tell the product from its instruments. Now they are a
 * second Vite input (`web/harness.html`), reachable from nothing the product imports.
 *
 * **The URLs did not change.** `main.tsx` redirects `/bench`, `?bench`, `?hold=`, `?selfcheck` and
 * `?probe=1` here with their query strings intact, so `scripts/bench.mjs`, `scripts/warmup-probe.mjs`,
 * `scripts/visual-gate.mjs` and the `e2e/` suite drive exactly what they drove before — and this
 * leg's own before/after bench numbers stay comparable, which they would not be if the route had
 * moved. See `app/harnessRoute.ts` for why that trade was made.
 *
 * Each route bypasses the shell rather than rendering inside it. Each owns its own camera, and the
 * bench and the self-check drive that camera themselves, which they cannot do in a scene where the
 * rig is flying it.
 */

import { StrictMode, Suspense, lazy, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

import { benchRouteWanted } from '../app/harnessRoute'
import { ServicesProvider, createServices, type ServicesOptions } from '../app/services'
import { EternitiesScene } from '../scene/EternitiesScene'
import { initSettings } from '../store/store'
import { WebGLFallback, hasWebGL2 } from '../ui/WebGLFallback'
import '../styles.css'
import './harness.css'

/**
 * Still `lazy()`, and still for the original reason: the three routes are mutually exclusive, and
 * opening the self-check should not download the bench runner. The boundary that moved is the one
 * between the product and all three of them, not the ones between them.
 */
const BenchScene = lazy(async () => ({ default: (await import('../bench/BenchScene')).BenchScene }))

type HarnessRoute = 'bench' | 'probe' | null

/**
 * Which harness the URL asks for.
 *
 * The same three tests `App` used to run, in the same order, against the same spellings. `/bench`
 * is still honoured as a path even though the redirect appends `bench=1`, because a person can type
 * `/harness.html` only after being told it exists — `/bench` is the documented route (PRD 9.1.2).
 */
function harnessRequested(): HarnessRoute {
  const search = typeof location === 'undefined' ? '' : location.search
  const pathname = typeof location === 'undefined' ? '' : location.pathname
  if (benchRouteWanted(pathname, search)) return 'bench'
  // The scene on its own, with the `scene/probe.ts` seam installed — what `verify-browser.mjs`
  // drives the card tier through. `?probe=shell` never arrives here: it is the shipped
  // composition, and the product entry keeps it.
  return new URLSearchParams(search).get('probe') === null ? null : 'probe'
}

/**
 * What this route needs of the renderer before the handle exists.
 *
 * Both read the canvas back, so both need the drawing buffer preserved — without it a read gives
 * whatever frame the compositor last kept rather than the frame the assertions were made against.
 * (The GPU self-check was a third route, with its own far plane; it compared the star field's id
 * buffer against the CPU mirror, and retired with the star field at the cutover — DEC-752. It is
 * archived under the `galaxy-cutover` tag.)
 *
 * This is the half of item 4 that `createServices` used to do by reading `location.search` itself.
 */
function servicesOptions(route: HarnessRoute): ServicesOptions {
  if (route === null) return {}
  return { preserveDrawingBuffer: true }
}

function Harness({ route }: { route: HarnessRoute }): ReactElement {
  switch (route) {
    case 'bench':
      return (
        <Suspense fallback={null}>
          <BenchScene />
        </Suspense>
      )
    case 'probe':
      return <EternitiesScene />
    case null:
      return <HarnessIndex />
  }
}

/**
 * What a person gets for opening `harness.html` with no query: the list.
 *
 * Plain DOM — no scene, no store, no canvas. Someone who lands here has taken a wrong turn, and the
 * useful answer is which turns exist, not a black rectangle.
 */
function HarnessIndex(): ReactElement {
  return (
    <main className="harness-index">
      <h1>Eternities — measurement harness</h1>
      <p>Not the product. Two routes live here; each bypasses the shell and drives its own camera.</p>
      <ul>
        <li>
          <a href="/bench">/bench</a> — PRD 9.1.2's scripted flight over the shipped scene.{' '}
          <code>?hold=&lt;segment&gt;</code> parks it at the end of one segment.
        </li>
        <li>
          <a href="?probe=1">?probe=1</a> — the scene on its own with the probe seam installed.
        </li>
      </ul>
      <p>
        <a href="/">Back to the product.</a> For the shipped composition <em>with</em> the seam —
        what PRD 9.3 is judged on — use <a href="/?probe=shell">/?probe=shell</a>, which stays on the
        product entry.
      </p>
    </main>
  )
}


const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from harness.html')

const root = createRoot(container)

// PRD 7.1.2, same as the product entry: the WebGL2 probe runs before anything mounts a canvas.
if (!hasWebGL2()) {
  root.render(
    <StrictMode>
      <WebGLFallback />
    </StrictMode>,
  )
} else {
  const route = harnessRequested()
  initSettings()
  const services = createServices(servicesOptions(route))

  root.render(
    <StrictMode>
      <ServicesProvider services={services}>
        <Harness route={route} />
      </ServicesProvider>
    </StrictMode>,
  )
}
