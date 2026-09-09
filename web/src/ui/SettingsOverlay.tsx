/**
 * PRD 6.10: "Reduced motion (default: follows the OS preference), bloom intensity (three steps),
 * labels on/off, hint reset. Persisted locally; no accounts, no server."
 *
 * Reduced motion is three-valued here rather than a checkbox, because "follows the OS" is the
 * default and a checkbox cannot express it (see `../store/settings`). PRD 5.9 also disables
 * attract mode whenever it resolves to on, which the panel says out loud — a user who wonders
 * where the cinematic drift went should not have to guess.
 */

import type { ReactElement } from 'react'

import { useStore, reducedMotionOf } from '../store/store'
import type { BloomSetting, ReducedMotionSetting } from '../store/settings'
import { Sheet } from './Sheet'

const REDUCED_MOTION_OPTIONS: ReadonlyArray<{ value: ReducedMotionSetting; label: string }> = [
  { value: 'os', label: 'Follow the system' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

const BLOOM_OPTIONS: ReadonlyArray<{ value: BloomSetting; label: string }> = [
  { value: 0, label: 'Subtle' },
  { value: 1, label: 'Default' },
  { value: 2, label: 'Strong' },
]

export function SettingsOverlay(): ReactElement {
  const settings = useStore((state) => state.settings)
  const osReducedMotion = useStore((state) => state.osReducedMotion)
  const updateSettings = useStore((state) => state.updateSettings)
  const setOverlay = useStore((state) => state.setOverlay)
  const setHintVisible = useStore((state) => state.setHintVisible)
  const resolved = reducedMotionOf({ settings, osReducedMotion })

  return (
    <Sheet
      label="Settings"
      title="Settings"
      footer={
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setOverlay(null)
          }}
        >
          Done
        </button>
      }
    >

        <fieldset className="setting">
          <legend>Reduced motion</legend>
          <div className="facet-row">
            {REDUCED_MOTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  settings.reducedMotion === option.value
                    ? 'facet-toggle facet-toggle-active'
                    : 'facet-toggle'
                }
                aria-pressed={settings.reducedMotion === option.value}
                onClick={() => {
                  updateSettings({ reducedMotion: option.value })
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="muted">
            {resolved
              ? 'Motion is reduced: rotation, drift and twinkle stop, fly-to shortens, and attract mode is off.'
              : `The system currently asks for ${osReducedMotion ? 'reduced' : 'full'} motion.`}
          </p>
        </fieldset>

        <fieldset className="setting">
          <legend>Bloom intensity</legend>
          <div className="facet-row">
            {BLOOM_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  settings.bloom === option.value ? 'facet-toggle facet-toggle-active' : 'facet-toggle'
                }
                aria-pressed={settings.bloom === option.value}
                onClick={() => {
                  updateSettings({ bloom: option.value })
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="setting">
          <legend>Labels</legend>
          <button
            type="button"
            className={settings.labels ? 'facet-toggle facet-toggle-active' : 'facet-toggle'}
            aria-pressed={settings.labels}
            onClick={() => {
              updateSettings({ labels: !settings.labels })
            }}
          >
            {settings.labels ? 'Shown' : 'Hidden'}
          </button>
        </fieldset>

        <fieldset className="setting">
          <legend>First-visit hint</legend>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              updateSettings({ hintDismissed: false })
              setHintVisible(true)
              setOverlay(null)
            }}
          >
            Show it again
          </button>
        </fieldset>

    </Sheet>
  )
}
