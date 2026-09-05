/**
 * The card tier's browser test seam, behind `?probe=1`.
 *
 * Phase 3's exit criterion is "the full multiverse → card journey works end to end", and the middle
 * of that journey is not reachable by a script that can only click pixels: a star is one to four
 * pixels wide at plane level, and finding a *double-faced* one to satisfy PRD 9.3's checkpoint 4
 * means knowing which card is where. So this publishes the same calls the pointer makes —
 * `focusStar` is literally the click handler's callee — and the assertions in
 * `scripts/verify-browser.mjs` are made against the state that follows.
 *
 * The same shape as Phase 2a's `./selfCheck`: nothing is installed unless the URL asks, and what it
 * exposes is the product's own code path rather than a second implementation of it.
 */

export interface ProbeCardState {
  readonly name: string
  readonly printings: number
  readonly planets: number
  readonly overflow: number
  readonly canFlip: boolean
  readonly flipped: boolean
  readonly activePrinting: number
  readonly starIndex: number
}

export interface ProbeState {
  readonly focus: string
  readonly level: string
  readonly flying: boolean
  readonly cameraDistance: number
  readonly planeSlug: string | null
  /** Cards of the focused plane whose shards have landed. */
  readonly cardsLoaded: number
  readonly thumbnails: {
    readonly drawn: number
    readonly cells: number
    readonly capacity: number
    readonly requested: number
    readonly loaded: number
    readonly failed: number
  }
  readonly images: {
    readonly inFlight: number
    readonly waiting: number
    readonly completed: number
    readonly failed: number
    readonly peakInFlight: number
  }
  readonly gpu: {
    readonly atlasBytes: number
    readonly cardBytes: number
    readonly totalBytes: number
    readonly targetBytes: number
    readonly ceilingBytes: number
    readonly withinTarget: boolean
    readonly withinCeiling: boolean
  }
  /**
   * What the quality ladder has actually done to the frame, for PRD 9.1.4's forced-degradation
   * check (`?quality=N`, see `scene/quality/adaptiveQuality`).
   *
   * Every field below `tier` is read back off a live object — the renderer, the bloom's render
   * target, the atlas, the geometry, the shader uniform — rather than off `QUALITY_TIERS`. That is
   * the whole point: a tier the scene *reports* proves nothing, and until Phase 6 no caller had ever
   * pinned one, so no rung of the ladder had been watched landing. `starsDrawn` and `motion` are
   * here for the other half of PRD 8.5.11 — that geometry and motion never degrade.
   */
  readonly quality: {
    readonly tier: string
    readonly tierIndex: number
    /** The tier `?quality=` pinned, or `null` when the ladder is free to move. */
    readonly pinned: number | null
    /** `WebGLRenderer.getPixelRatio()`, which the ladder's first rung caps. */
    readonly pixelRatio: number
    readonly drawingBuffer: { readonly width: number; readonly height: number }
    /** The bloom's render-target size. `null` before the composer has sized it. */
    readonly bloom: { readonly width: number; readonly height: number } | null
    /** The atlas's live capacity, after `CardTier.setCapacity`. */
    readonly thumbnailCapacity: number
    readonly starsDrawn: number
    /** The `uMotion` uniform the star shader reads. */
    readonly motion: number
  }
  readonly card: ProbeCardState | null
  /**
   * How far the focused card is drawn from the point the camera is looking at, in world units.
   *
   * PRD 5.6.1 flies the camera to *frame* the card, so this is the whole claim as one number. It is
   * not a formality: the card is drawn by the star field's motion function and the camera aims at
   * the rig's tether, and those were two different functions until Phase 3 made them one. A card
   * 0.63 units wide framed from 2.2 units away shows a tenth of a unit of disagreement plainly.
   */
  readonly cardFrameOffset: number
  /**
   * Where the focused card lands on screen, as a fraction of the viewport (0.5, 0.5 is the centre).
   *
   * The world-space offset above says the camera *aims* at the card. This says the projection
   * agrees, and only the pair of them is PRD 5.6.1's "the camera flies to frame it".
   */
  readonly cardScreen: { readonly x: number; readonly y: number } | null
  /**
   * The true eye-to-card distance, beside the rig's own `cameraDistance`.
   *
   * They are not the same quantity: the rig's is the spherical radius it maintains, and PRD 5.7.5's
   * collision avoidance moves the camera afterwards without revising it. What the card subtends on
   * screen follows this one.
   */
  readonly cardEyeDistance: number
}

export interface Probe {
  state: () => ProbeState
  /** Planes with cards, largest first — enough to choose one to fly to. */
  planes: () => Array<{ slug: string; index: number; cardCount: number }>
  focusPlane: (slug: string) => boolean
  /**
   * Focus a card of the currently focused plane. `dfc` picks one with a genuine back image, for
   * PRD 9.3's checkpoint 4; otherwise the `nth` card with the most printings, so the planets of PRD
   * 5.6.7 have something to show. Returns the star index, or -1.
   */
  focusCard: (options?: { dfc?: boolean; nth?: number }) => number
  flip: () => boolean
  activatePrinting: (index: number) => boolean
  /** Star indices the thumbnail tier is currently drawing. */
  thumbnailStars: () => number[]
  /**
   * Where a planet of the focused card is, as a fraction of the viewport. `null` if there is no
   * such planet or it is behind the camera.
   *
   * Deliberately **not** an assertion seam. It exists so the browser check can aim a real pointer
   * at a real planet: everything it then asserts — the hover label, the active printing — is read
   * back out of the DOM, having gone through the id buffer and the pick path the user's pointer
   * uses. PRD 5.6.9's hover shipped broken precisely because every planet assertion went through
   * `activatePrinting`, which bypasses the picker entirely.
   */
  planetScreen: (index: number) => { x: number; y: number } | null
}

declare global {
  interface Window {
    __eternitiesProbe?: Probe
  }
}

export function probeRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  const value = new URLSearchParams(search).get('probe')
  return value !== null && value !== '0'
}
