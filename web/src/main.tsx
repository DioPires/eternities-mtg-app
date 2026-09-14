/**
 * The product entry.
 *
 * Since review §3.6 phase 3 item 4 this is *only* the product: the bench, the GPU self-check and
 * the `?probe=1` scene have their own Vite input (`harness.html` -> `harness/main.tsx`) and nothing
 * reachable from here names them. What is left of them on this side is `harnessHref`, which is
 * three string tests and a URL.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { harnessHref } from './app/harnessRoute'
import { ServicesProvider, createServices } from './app/services'
import { initSettings } from './store/store'
import { WebGLFallback, hasWebGL2 } from './ui/WebGLFallback'
import './styles.css'

/**
 * The measurement routes leave before anything else happens.
 *
 * Checked before `createRoot` and before `createServices`, and everything below is in the `else`:
 * `location.replace` does not stop the script that called it, so a bare `if` would still build a
 * renderer and start a `requestAnimationFrame` loop on a page that is on its way out. Redirecting
 * *and* booting is worse than not redirecting at all — the loop would run, unobserved, for however
 * long the navigation takes.
 *
 * `replace` rather than `assign`, so a reviewer pressing Back from the bench lands wherever they
 * came from instead of bouncing off `/bench` again.
 */
const harness = harnessHref(location.pathname, location.search)
if (harness !== null) {
  location.replace(harness)
} else {
  const container = document.getElementById('root')
  if (!container) throw new Error('#root is missing from index.html')

  const root = createRoot(container)

  // PRD 7.1.2: the WebGL2 probe runs before anything mounts a canvas, so a machine without it never
  // sees a black rectangle — it gets the explanation and no scene at all.
  if (!hasWebGL2()) {
    root.render(
      <StrictMode>
        <WebGLFallback />
      </StrictMode>,
    )
  } else {
    // PRD 6.3.4 / 6.10.2: the persisted settings are read before the first render, so reduced motion
    // is already correct on the first frame rather than applied after a flash of full motion.
    initSettings()
    // The navigation API and the router live as long as the page. Created out here because
    // `StrictMode` remounts components while keeping their state, and a camera rig disposed on the
    // first unmount would come back disposed. See `./app/services`.
    const services = createServices()

    root.render(
      <StrictMode>
        <ServicesProvider services={services}>
          <App />
        </ServicesProvider>
      </StrictMode>,
    )
  }
}
