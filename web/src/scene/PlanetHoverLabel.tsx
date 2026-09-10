/**
 * PRD 5.6.9's hover label: written by the frame loop, read by its own rAF (PRD 7.3.3).
 *
 * Never React state — a hover moves every frame the pointer does, and re-rendering the component
 * that owns the `<Canvas>` at that rate is what PRD 7.3.2 and 7.3.3 rule out.
 */

import { useEffect, useRef, type ReactElement } from 'react'

import type { PlanetLabelState } from './cards/CardTier'

export function PlanetHoverLabel({
  state,
  text,
}: {
  readonly state: PlanetLabelState
  readonly text: (printing: number) => string
}): ReactElement {
  const node = useRef<HTMLDivElement>(null)
  const shown = useRef(-1)

  useEffect(() => {
    let handle = 0
    const tick = (): void => {
      handle = requestAnimationFrame(tick)
      const element = node.current
      if (!element) return
      if (!state.visible) {
        if (shown.current !== -1) {
          element.style.opacity = '0'
          shown.current = -1
        }
        return
      }
      element.style.transform = `translate3d(${Math.round(state.x)}px, ${Math.round(state.y)}px, 0)`
      if (shown.current !== state.printing) {
        element.textContent = text(state.printing)
        element.style.opacity = '1'
        shown.current = state.printing
      }
    }
    handle = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(handle)
    }
  }, [state, text])

  return <div ref={node} className="planet-label" data-testid="planet-label" />
}
