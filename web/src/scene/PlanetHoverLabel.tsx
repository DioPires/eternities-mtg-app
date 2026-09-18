/**
 * PRD 5.6.9's hover label: written by the frame loop, read on the loop's own `labels` phase
 * (PRD 7.3.3).
 *
 * Never React state — a hover moves every frame the pointer does, and re-rendering the component
 * that owns the scene at that rate is what PRD 7.3.2 and 7.3.3 rule out.
 *
 * Like `labels/PlaneLabels`, this used to run a `requestAnimationFrame` of its own, and for the same
 * reason it no longer does (review §3.6 phase 3, item 2): the position it reads is written by the
 * `cards` phase, and reading it from an unrelated callback meant the label could be placed from the
 * previous tick's projection. `labels` runs after `cards`, so what it reads is this tick's.
 */

import { useEffect, useRef, type ReactElement } from 'react'

import type { PlanetLabelState } from './cards/focusedCardHost'
import type { FrameLoop } from './renderer/frameLoop'

export function PlanetHoverLabel({
  state,
  text,
  loop,
}: {
  readonly state: PlanetLabelState
  readonly text: (printing: number) => string
  readonly loop: FrameLoop
}): ReactElement {
  const node = useRef<HTMLDivElement>(null)
  const shown = useRef(-1)
  // The text resolver changes whenever the focused card does; holding it in a ref keeps that from
  // re-subscribing the label to the loop.
  const textRef = useRef(text)
  textRef.current = text

  useEffect(
    () =>
      loop.subscribe('labels', () => {
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
          element.textContent = textRef.current(state.printing)
          element.style.opacity = '1'
          shown.current = state.printing
        }
      }),
    [state, loop],
  )

  return <div ref={node} className="planet-label" data-testid="planet-label" />
}
