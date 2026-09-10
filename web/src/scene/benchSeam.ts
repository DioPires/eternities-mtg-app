/**
 * What PRD 9.1.2's `/bench` asks of the scene, and the context it hands the runner.
 *
 * Split out of `EternitiesScene` (review §6.3). Every call reaches the same code a user's click
 * would — `flyToPlane` is the navigation contract's, `focusCard` runs the caller's `focusStar` —
 * so a bench segment cannot end up measuring a path only the bench can take.
 *
 * `immediate` throughout: the camera is the bench's for the duration, so a tween here would change
 * nothing visible and would only land the focus later than the segment it belongs to.
 */

import { useMemo, type MutableRefObject, type RefObject } from 'react'
import type { Vector3 } from 'three'

import type { BenchContext, BenchDrive } from '../bench/BenchRunner'
import type { CardRecord } from '../data'
import type { SceneNavigation } from '../navigation/scene'

import type { CardTierHandle } from './cards/CardTier'
import { pickLoadedCard } from './cards/pickCard'
import type { SceneDataState } from './useSceneData'

export interface BenchSeamDeps {
  /** Null when the URL did not ask for the bench, which is when this returns no context. */
  readonly bench: boolean
  readonly data: SceneDataState
  readonly focusStar: (index: number, planeIndex: number) => void
  readonly sceneRef: RefObject<SceneNavigation | null>
  readonly cardTier: RefObject<CardTierHandle | null>
  readonly cardsRef: MutableRefObject<Map<number, CardRecord>>
}

/** @returns the runner's context, or null until the bench is wanted and the data has landed. */
export function useBenchSeam(deps: BenchSeamDeps): BenchContext | null {
  const { bench, data, focusStar } = deps

  const drive: BenchDrive = useMemo(
    () => ({
      focusPlane: (slug: string) => {
        deps.sceneRef.current?.api.flyToPlane(slug, { immediate: true, reason: 'programmatic' })
      },
      focusMultiverse: () => {
        deps.sceneRef.current?.api.flyToMultiverse({ immediate: true, reason: 'programmatic' })
      },
      focusCard: () => {
        const geometry = data.resources?.geometry
        if (!geometry) return false
        const best = pickLoadedCard(deps.cardsRef.current)
        if (best < 0) return false
        focusStar(best, geometry.planeRowOf(best))
        return true
      },
      cardPosition: (out: Vector3) => {
        const slot = deps.cardTier.current?.card
        if (!slot?.visible) return false
        out.copy(slot.root.position)
        return true
      },
    }),
    // The refs are stable for the component's life; only the geometry and `focusStar` decide what
    // this closes over.
    [data.resources, focusStar],
  )

  return useMemo(() => {
    if (!bench || !data.resources || !data.planes || !data.manifest) return null
    return {
      dataset: data.manifest.dataset,
      stars: data.manifest.counts.stars,
      planes: data.manifest.counts.planes,
      positionMode: data.resources.positionMode,
      multiverseRadius: data.planes.multiverseRadius,
      table: data.resources.table,
      drive,
    }
  }, [bench, data.resources, data.planes, data.manifest, drive])
}
