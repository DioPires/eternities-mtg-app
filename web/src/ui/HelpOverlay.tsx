/**
 * PRD 6.11's keyboard map, shown. "`/` search · Esc up one level or close overlay · Enter select ·
 * arrows navigate search results · `?` help. No other shortcuts in v1." — so this list is closed,
 * and a shortcut that is not on it is a spec change, not a feature.
 *
 * PRD 6.1's pointer controls are here too, because a user pressing `?` is asking how to drive the
 * thing, not specifically about keys.
 */

import type { ReactElement } from 'react'

import { useStore } from '../store/store'
import { Sheet } from './Sheet'

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Search'],
  ['Esc', 'Up one level, or close what is open'],
  ['Enter', 'Select the highlighted result'],
  ['↑ ↓', 'Move through search results'],
  ['?', 'This help'],
]

const POINTER: ReadonlyArray<readonly [string, string]> = [
  ['Drag', 'Orbit around whatever is in focus'],
  ['Scroll', 'Zoom toward the pointer'],
  ['Click', 'Fly to a plane, a star or a thumbnail'],
]

export function HelpOverlay(): ReactElement {
  const setOverlay = useStore((state) => state.setOverlay)
  return (
    <Sheet
      label="Help"
      title="Getting around"
      footer={
        <>
          {/* PRD 4.11's About view. Reached from here rather than from a seventh cluster control,
              because PRD 6.3.3's list of six is closed. */}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOverlay('about')
            }}
          >
            About &amp; credits
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOverlay(null)
            }}
          >
            Close
          </button>
        </>
      }
    >

        <h3 className="panel-heading">Pointer</h3>
        <dl className="keymap">
          {POINTER.map(([key, meaning]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>

        <h3 className="panel-heading">Keyboard</h3>
        <dl className="keymap">
          {KEYS.map(([key, meaning]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>

        <p className="muted">
          Touch is not supported in this version. Everything here needs a pointer and a keyboard.
        </p>

    </Sheet>
  )
}
