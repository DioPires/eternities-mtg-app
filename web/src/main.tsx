import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { ServicesProvider, createServices } from './app/services'
import { initSettings } from './store/store'
import { WebGLFallback, hasWebGL2 } from './ui/WebGLFallback'
import './styles.css'

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
