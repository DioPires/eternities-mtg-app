/**
 * PRD 6.3.3: "Control cluster, top-right: search, plane index, random, share, settings, help.
 * Icon buttons with tooltips."
 *
 * Exactly those six, in that order. The filter surface lives on the chip row instead (see
 * `Overlay` in the store), so this list stays as the PRD writes it.
 *
 * Tooltips are `title` plus `aria-label`: `title` is the hover affordance the requirement asks
 * for, `aria-label` is the accessible name PRD 7.5.2 needs, and an icon-only button needs both.
 */

import type { ReactElement } from 'react'

import { useRandom, useShare } from '../app/hooks'
import { useStore, type Overlay } from '../store/store'
import {
  HelpIcon,
  PlaneIndexIcon,
  RandomIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
} from './icons'

interface ControlProps {
  readonly label: string
  readonly hint: string
  readonly onClick: () => void
  readonly pressed?: boolean
  readonly disabled?: boolean
  readonly children: ReactElement
}

function Control({ label, hint, onClick, pressed, disabled, children }: ControlProps): ReactElement {
  return (
    <button
      type="button"
      className="control"
      onClick={onClick}
      title={hint}
      aria-label={label}
      {...(pressed !== undefined && { 'aria-pressed': pressed })}
      disabled={disabled ?? false}
    >
      {children}
    </button>
  )
}

export function ControlCluster(): ReactElement {
  const overlay = useStore((state) => state.overlay)
  const setOverlay = useStore((state) => state.setOverlay)
  const setHintVisible = useStore((state) => state.setHintVisible)
  const updateSettings = useStore((state) => state.updateSettings)
  const share = useShare()
  const random = useRandom()

  const toggle = (which: NonNullable<Overlay>) => () => {
    setOverlay(overlay === which ? null : which)
  }

  return (
    <div className="cluster" role="toolbar" aria-label="Controls">
      <Control label="Search" hint="Search — /" onClick={toggle('search')} pressed={overlay === 'search'}>
        <SearchIcon />
      </Control>
      <Control
        label="Plane index"
        hint="Plane index"
        onClick={toggle('plane-index')}
        pressed={overlay === 'plane-index'}
      >
        <PlaneIndexIcon />
      </Control>
      <Control
        label="Random card"
        hint={random.ready ? 'Fly to a random card' : 'Fly to a random card — still loading'}
        onClick={random.go}
        disabled={!random.ready}
      >
        <RandomIcon />
      </Control>
      <Control label="Copy link" hint="Copy a link to this view" onClick={share}>
        <ShareIcon />
      </Control>
      <Control
        label="Settings"
        hint="Settings"
        onClick={toggle('settings')}
        pressed={overlay === 'settings'}
      >
        <SettingsIcon />
      </Control>
      <Control
        label="Help"
        hint="Help — ?"
        onClick={() => {
          // PRD 6.8.3: "the help control reopens it" — the hint comes back *and* stops being
          // remembered as dismissed, or it would vanish again on the next load.
          updateSettings({ hintDismissed: false })
          setHintVisible(true)
          setOverlay(overlay === 'help' ? null : 'help')
        }}
        pressed={overlay === 'help'}
      >
        <HelpIcon />
      </Control>
    </div>
  )
}
