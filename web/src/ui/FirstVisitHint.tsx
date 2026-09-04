/**
 * PRD 6.8.3: "after the intro, a single dismissible overlay names the three controls (drag to
 * orbit, scroll to zoom, click to fly; Esc to go back). Dismissal is remembered locally. The help
 * control reopens it."
 *
 * Three controls plus Esc, exactly as listed, and nothing else — a first-visit card that explains
 * the whole product is a different thing from the one the PRD asked for.
 *
 * `boot()` decides *when* it appears (after the intro flight settles); this decides what it says
 * and what dismissing it means.
 */

import type { ReactElement } from 'react'

import { useStore } from '../store/store'

export function FirstVisitHint(): ReactElement {
  const setHintVisible = useStore((state) => state.setHintVisible)
  const updateSettings = useStore((state) => state.updateSettings)

  const dismiss = (): void => {
    setHintVisible(false)
    updateSettings({ hintDismissed: true })
  }

  return (
    <div className="hint" role="dialog" aria-label="How to get around">
      <p className="hint-lead">Drag to orbit. Scroll to zoom. Click to fly.</p>
      <p className="muted">
        Esc goes back up a level. Press <kbd>?</kbd> for the rest.
      </p>
      <button type="button" className="link-button" onClick={dismiss} autoFocus>
        Got it
      </button>
    </div>
  )
}
