import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// PRD 7.1.2: without WebGL2 the page shows a plain explanation, not a broken canvas.
// Phase 4 owns the real fallback page; Phase 0 only has to not render a black rectangle.
const probe = document.createElement('canvas')
if (!probe.getContext('webgl2')) {
  container.innerHTML =
    '<div class="fallback"><h1>Eternities needs WebGL2</h1>' +
    '<p>This browser or machine does not provide WebGL2, which Eternities uses to draw the ' +
    'multiverse. Current Chrome, Safari or Firefox on a machine with hardware acceleration ' +
    'enabled will work.</p></div>'
} else {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
