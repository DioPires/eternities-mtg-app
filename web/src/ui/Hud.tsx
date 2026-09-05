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

import type { ReactElement } from 'react'

import { useNavSnapshot } from '../app/hooks'
import { useStore } from '../store/store'
import { Breadcrumb } from './Breadcrumb'
import { ControlCluster } from './ControlCluster'
import { FilterChips } from './FilterChips'

const NUMBER = new Intl.NumberFormat('en-GB')

/** PRD 6.8.1: "there is never a spinner over a black screen" — so this is a line, not a spinner. */
function LoadingLine(): ReactElement | null {
  const manifest = useStore((state) => state.manifest)
  const stars = useStore((state) => state.stars)
  const drawable = useStore((state) => state.starsDrawable)
  if (stars !== null || manifest === null) return null
  return (
    <p className="hud-loading" aria-live="polite">
      {NUMBER.format(drawable)} of {NUMBER.format(manifest.counts.stars)} stars
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
      </header>
      <ControlCluster />
    </div>
  )
}
