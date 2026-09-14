/**
 * PRD 8.7.6 / amendment A1: the focused plane's cards, fetched and parsed in a worker, shard by
 * shard.
 *
 * Split out of `EternitiesScene` (review §6.3), which asked for this to go "into `useSceneData`".
 * It is a sibling of that hook rather than part of it: `useSceneData` is the page's one dataset
 * load and takes no arguments, while this re-runs on every focus change. Same intent — the scene
 * component stops owning a second loader — with one responsibility per file.
 *
 * The card map is a ref behind a version counter, not state. Shards land a few per second and the
 * thumbnail tier asks it per star per pass, so it has to be O(1) and it must not re-render the
 * component that owns the `<Canvas>` (review §2.2). The counter is what tells the memos downstream
 * that the contents moved.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

import { dataRoot, type CardRecord, type PlaneRecord, type PlaneShardFile } from '../data'
import { createPlaneDetailLoader } from '../plane-detail/client'

import type { PlaneCards } from './cards/cardTier'

/** What the readout panel reports about the load, and nothing else reads. */
export interface PlaneDetailStatus {
  readonly slug: string
  readonly cards: number
  readonly shards: number
}

export interface PlaneDetailState {
  /** The stable lookup the card tier holds. */
  readonly cards: PlaneCards
  /** The same map, for the callers that need to ask "is this star loaded yet?". */
  readonly cardsRef: MutableRefObject<Map<number, CardRecord>>
  /** Ticks once per shard, and once per focus change when the map is cleared. */
  readonly cardVersion: number
  readonly detail: PlaneDetailStatus | null
}

/**
 * @param planesLoaded whether `planes.json` has landed — the worker is built once it has, and
 *   torn down with the page.
 * @param focusedPlane the plane whose shards to hold, or null at the multiverse.
 */
export function usePlaneDetail(
  planesLoaded: boolean,
  focusedPlane: PlaneRecord | null,
): PlaneDetailState {
  const cardsRef = useRef(new Map<number, CardRecord>())
  const [cardVersion, setCardVersion] = useState(0)
  const [detail, setDetail] = useState<PlaneDetailStatus | null>(null)

  const cards: PlaneCards = useMemo(
    () => ({ get: (star: number) => cardsRef.current.get(star) ?? null }),
    // `cardVersion` is the whole dependency, on purpose: the map is a ref, so its identity never
    // changes and nothing downstream would ever re-read it. The counter ticks once per shard.
    [cardVersion],
  )

  const loaderRef = useRef<ReturnType<typeof createPlaneDetailLoader> | null>(null)
  useEffect(() => {
    if (!planesLoaded) return
    const loader = createPlaneDetailLoader({ root: dataRoot() })
    loaderRef.current = loader
    return () => {
      loader.dispose()
      loaderRef.current = null
    }
  }, [planesLoaded])

  useEffect(() => {
    const loader = loaderRef.current
    if (!loader || !focusedPlane) return
    cardsRef.current.clear()
    setCardVersion((v) => v + 1)
    let cardCount = 0
    let shards = 0
    setDetail({ slug: focusedPlane.slug, cards: 0, shards: 0 })
    loader.load(focusedPlane.slug, focusedPlane.shardCount, {
      onShard: (file: PlaneShardFile) => {
        // Contract §: `starOffset` is the global star index of this shard's local index 0.
        for (let i = 0; i < file.cards.length; i += 1) {
          cardsRef.current.set(file.starOffset + i, file.cards[i]!)
        }
        cardCount += file.cards.length
        shards += 1
        setDetail({ slug: focusedPlane.slug, cards: cardCount, shards })
        setCardVersion((v) => v + 1)
      },
      onError: (message) => {
        // PRD 7.4.1's single non-blocking report; the shell's toast is `scene/errors`.
        console.warn(`plane detail: ${message}`)
      },
    })
    return () => {
      loader.cancel()
    }
  }, [focusedPlane])

  return { cards, cardsRef, cardVersion, detail }
}
