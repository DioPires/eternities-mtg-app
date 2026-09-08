/**
 * PRD 6.3: "The HUD is a 2D HTML overlay. It never occludes the focused object and is hidden
 * entirely during attract mode."
 *
 * Both halves of that sentence are structural, not cosmetic:
 *  - the HUD is `pointer-events: none` and only its controls opt back in, so the middle of the
 *    screen — where the focused object is — stays clickable through it;
 *  - attract mode removes it from the tree entirely rather than fading it, because PRD 5.3.23 says
 *    "hidden entirely" and a transparent HUD still eats pointer events.
 */

import { useEffect, useState, type ReactElement } from 'react'

import { useNavSnapshot } from '../app/hooks'
import { useStore } from '../store/store'
import { Breadcrumb } from './Breadcrumb'
import { ControlCluster } from './ControlCluster'
import { FilterChips } from './FilterChips'

const NUMBER = new Intl.NumberFormat('en-GB')

/**
 * PRD 6.8.1: "there is never a spinner over a black screen" — so this is a line, not a spinner.
 *
 * **Not a live region.** It used to be, and PRD 8.7.3 reveals the roster plane by plane, so the
 * count changed ~87 times during a load and a screen reader read out all 87 of them — eighty-seven
 * interruptions to say the same thing. A progress readout that changes faster than a person can
 * listen is a `role="status"` misuse, not an accommodation. The number stays on screen for anyone
 * watching it; the announcement is {@link LoadAnnouncement}'s, once, at the end.
 */
function LoadingLine(): ReactElement | null {
  const manifest = useStore((state) => state.manifest)
  const stars = useStore((state) => state.stars)
  const drawable = useStore((state) => state.starsDrawable)
  if (stars !== null || manifest === null) return null
  return (
    <p className="hud-loading">
      {NUMBER.format(drawable)} of {NUMBER.format(manifest.counts.stars)} stars
    </p>
  )
}

/**
 * The one announcement: "N stars loaded", when `stars.bin` completes.
 *
 * Mounted empty and filled later, rather than mounted with its text — an `aria-live` region has to
 * be in the accessibility tree *before* its content changes for the change to be announced at all,
 * so a region that appears already-populated is a region most screen readers say nothing about.
 * That is also why this sits outside `LoadingLine`, which unmounts at exactly the moment the
 * announcement is due.
 *
 * Visually hidden rather than `display: none`, which would take it out of the tree with the same
 * result.
 */
function LoadAnnouncement(): ReactElement {
  const manifest = useStore((state) => state.manifest)
  const stars = useStore((state) => state.stars)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (stars === null || manifest === null) return
    setMessage(`${NUMBER.format(stars.count)} stars loaded.`)
  }, [stars, manifest])

  return (
    <p className="visually-hidden" role="status">
      {message}
    </p>
  )
}

export function Hud(): ReactElement | null {
  const attract = useNavSnapshot().attract
  // PRD 6.10.1's "labels on/off" is about the scene's plane and set labels (PRD 5.3.8-12, 5.4.5),
  // not the HUD: the breadcrumb is how PRD 6.3.1 says where you are, and hiding it behind a
  // setting would leave a user with no way back up but Esc.
  if (attract) return null
  return (
    <div className="hud">
      <header className="hud-left">
        <Breadcrumb />
        <FilterChips />
        <LoadingLine />
        <LoadAnnouncement />
      </header>
      <ControlCluster />
    </div>
  )
}
