/**
 * Label placement and collision (PRD 5.3.8–12, 5.4.5).
 *
 * Pure screen-space arithmetic: in, a projected candidate per plane and per chronology band; out, a
 * position, a size, an opacity and whether to draw the card count. No DOM, no three.js — the
 * component in `PlaneLabels.tsx` does the projecting and the writing, this decides.
 *
 * Two constraints shape it:
 *
 * - **PRD 7.3.2 forbids allocation in the frame path**, and this runs every frame over all 83 rows
 *   of fixture-scale. So the solver writes into a caller-owned array of reusable records and
 *   returns how many it filled; nothing is allocated after the first frame.
 * - **PRD 7.3.3 forbids layout-triggering style changes**, which rules out measuring the real DOM
 *   boxes. Widths are estimated from the text and the font size instead. The estimate is
 *   deliberately generous (see `estimateWidth`): over-estimating separates labels that would have
 *   just fitted, which is invisible, while under-estimating leaves the overlap PRD 9.3's "no label
 *   overlaps another at the home view" is judged on.
 */

/** PRD 5.4.5: a chronology band's label appears only when the band is at least this wide. */
export const BAND_MIN_WIDTH_PX = 120

/** PRD 5.3.9's clamp on label size. */
export const MIN_FONT_PX = 11
export const MAX_FONT_PX = 24
/** Font size as a fraction of the plane's on-screen radius, before the clamp. */
const FONT_PER_RADIUS = 0.42

/** PRD 5.3.11. */
export const OCCLUDED_OPACITY = 0.4

/** How many times a colliding label tries to shift before it gives up and fades (PRD 5.3.10). */
const MAX_SHIFTS = 3
/** Breathing room between two label boxes, in pixels. */
const GAP_PX = 4
/** And between a label box and the edge of the screen. */
const EDGE_PX = 6

/** PRD 5.4.5: set labels sit "at low priority beneath star labels", so they are placed last. */
export type LabelTier = 'plane' | 'band'

export interface LabelCandidate {
  readonly key: string
  readonly text: string
  /** PRD 5.3.12: the card count line. `null` on zero-card planes, which show no count. */
  readonly sub: string | null
  readonly tier: LabelTier
  /**
   * Higher wins a collision. PRD 5.3.10 makes it the card count for planes; bands come after every
   * plane by construction of `tier`.
   */
  readonly priority: number
  /** Projected screen position of the thing being labelled, in CSS pixels. */
  readonly x: number
  readonly y: number
  /** The thing's on-screen radius, which drives both the font size and the anchor offset. */
  readonly radiusPx: number
  /** Distance from the camera, for the occlusion test of PRD 5.3.11. */
  readonly depth: number
  /** False when the thing is behind the camera or off screen; skipped without a slot. */
  readonly onScreen: boolean
  /** PRD 5.4.5's ≥ 120 px rule. Only meaningful for the band tier. */
  readonly widthPx?: number
}

export interface LabelPlacement {
  key: string
  text: string
  sub: string | null
  tier: LabelTier
  x: number
  y: number
  fontPx: number
  opacity: number
  /** Reported so a caller can style occlusion differently from a collision fade if it wants. */
  occluded: boolean
}

/**
 * There is deliberately no `focusedPlaneKey` here. PRD 5.4.15 moves the focused plane's name to the
 * fixed HUD and fades every other plane's label out, so at plane level *every* plane label in this
 * overlay goes — the focused one because it has moved, the rest because the requirement says so.
 * `planeLevelFade` says all of that, and the solver never needed to know which plane it was.
 */
export interface LabelLayoutOptions {
  /**
   * The screen a label has to stay on. PRD 5.3.10's shift walks a label along the separating axis,
   * and without these it can walk straight off an edge; `keepOnScreen` is what stops it.
   */
  readonly viewportWidth: number
  readonly viewportHeight: number
  /** 0 at multiverse level, 1 at plane level: how far the plane labels have faded (PRD 5.4.15). */
  readonly planeLevelFade?: number
  /** PRD 6.10.1's labels on/off setting. */
  readonly enabled?: boolean
}

export function createPlacement(): LabelPlacement {
  return {
    key: '',
    text: '',
    sub: null,
    tier: 'plane',
    x: 0,
    y: 0,
    fontPx: MIN_FONT_PX,
    opacity: 0,
    occluded: false,
  }
}

/**
 * Width of a label box, without touching the DOM.
 *
 * 0.58 em per character is a deliberate over-estimate for the UI sans-serif Phase 5 will settle on
 * — a real average is nearer 0.5. The error is one-sided on purpose: too wide only spaces labels
 * that would have just fitted, too narrow leaves the overlaps PRD 9.3 is judged on.
 */
function estimateWidth(text: string, sub: string | null, fontPx: number): number {
  const main = text.length * fontPx * 0.58
  const subWidth = sub === null ? 0 : sub.length * fontPx * 0.52
  return Math.max(main, subWidth) + 10
}

/**
 * One line, or two.
 *
 * PRD 5.3.12 gives a zero-card plane no count, so its label is a single line and its box is a
 * little over half as tall. Anything re-deriving label geometry has to honour that or it will see
 * collisions that are not there — a roster is mostly zero-card planes.
 */
function estimateHeight(sub: string | null, fontPx: number): number {
  return sub === null ? fontPx * 1.3 : fontPx * 2.15
}

/**
 * The collision box this module reserves for a label, and the clearance it insists on around it.
 *
 * Exported so a test can check the *arrangement* against the geometry actually used, rather than
 * re-deriving the geometry and drifting from it. The estimates themselves are asserted directly in
 * `test/labels.test.ts`; this is the one place they are defined.
 */
export const LABEL_GAP_PX = GAP_PX

export function labelHalfExtents(
  text: string,
  sub: string | null,
  fontPx: number,
): { halfWidth: number; halfHeight: number } {
  return {
    halfWidth: estimateWidth(text, sub, fontPx) / 2,
    halfHeight: estimateHeight(sub, fontPx) / 2,
  }
}

interface Box {
  x: number
  y: number
  halfWidth: number
  halfHeight: number
}

/** Reused across frames; the solver never allocates one. */
const boxes: Box[] = []
const order: number[] = []

function boxAt(index: number): Box {
  let box = boxes[index]
  if (!box) {
    box = { x: 0, y: 0, halfWidth: 0, halfHeight: 0 }
    boxes[index] = box
  }
  return box
}

function overlaps(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth + GAP_PX &&
    Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight + GAP_PX
  )
}

/**
 * Pull a coordinate back inside the viewport. A label that is wider (or taller) than the screen has
 * no legal position at all, so it is centred: the least-bad of the two edges it must overhang.
 */
function keepOnScreen(value: number, half: number, extent: number): number {
  const margin = half + EDGE_PX
  if (extent <= margin * 2) return extent / 2
  return value < margin ? margin : value > extent - margin ? extent - margin : value
}

/**
 * Place every candidate.
 *
 * Returns how many entries of `out` were filled. `out` is grown as needed and its records are
 * rewritten in place, so a caller that keeps one array across frames allocates nothing.
 */
export function layoutLabels(
  candidates: readonly LabelCandidate[],
  out: LabelPlacement[],
  options: LabelLayoutOptions,
): number {
  if (options.enabled === false) return 0

  const fade = options.planeLevelFade ?? 0

  // Priority order: planes before bands (PRD 5.4.5), then card count descending, then alphabetical
  // — PRD 5.3.10's "priority ties resolve by alphabetical order", which is also what makes the
  // layout stable frame to frame instead of flickering between two equal-count planes.
  order.length = 0
  for (let i = 0; i < candidates.length; i += 1) order.push(i)
  order.sort((a, b) => {
    const ca = candidates[a]!
    const cb = candidates[b]!
    if (ca.tier !== cb.tier) return ca.tier === 'plane' ? -1 : 1
    if (ca.priority !== cb.priority) return cb.priority - ca.priority
    return ca.key.localeCompare(cb.key)
  })

  let written = 0
  // Boxes a later label has to avoid — the *visible* ones only. A label faded out by the shift
  // budget (PRD 5.3.10) or by plane level (PRD 5.4.15) is not on screen, so letting it keep a
  // collision box would have visible labels yielding to labels nobody can see. Tracked separately
  // from `written` because every candidate still gets a placement, faded or not.
  let reserved = 0
  for (const index of order) {
    const candidate = candidates[index]!
    if (!candidate.onScreen) continue
    // PRD 5.4.5: a band label only exists once its band is at least 120 px wide on screen.
    if (candidate.tier === 'band' && (candidate.widthPx ?? 0) < BAND_MIN_WIDTH_PX) continue

    const fontPx = Math.min(
      MAX_FONT_PX,
      Math.max(MIN_FONT_PX, candidate.radiusPx * FONT_PER_RADIUS),
    )
    const sub = candidate.sub
    const halfWidth = estimateWidth(candidate.text, sub, fontPx) / 2
    const halfHeight = estimateHeight(sub, fontPx) / 2

    // The label hangs just below the thing it names, and never off the edge of the screen.
    let x = keepOnScreen(candidate.x, halfWidth, options.viewportWidth)
    let y = keepOnScreen(
      candidate.y + candidate.radiusPx + halfHeight + 6,
      halfHeight,
      options.viewportHeight,
    )

    const box = boxAt(reserved)
    box.halfWidth = halfWidth
    box.halfHeight = halfHeight

    let opacity = 1
    let shifts = 0
    for (;;) {
      box.x = x
      box.y = y
      let blocker: Box | null = null
      for (let i = 0; i < reserved; i += 1) {
        const other = boxes[i]!
        if (overlaps(box, other)) {
          blocker = other
          break
        }
      }
      if (!blocker) break
      if (shifts >= MAX_SHIFTS) {
        // PRD 5.3.10: "shifts along its screen-space normal, then fades if still overlapping".
        opacity = 0
        break
      }
      // The screen-space normal of the contact: push straight out of the blocker along whichever
      // axis it is least deeply penetrated on, which is the shortest way to stop overlapping.
      const dx = x - blocker.x
      const dy = y - blocker.y
      const pushX = box.halfWidth + blocker.halfWidth + GAP_PX - Math.abs(dx)
      const pushY = box.halfHeight + blocker.halfHeight + GAP_PX - Math.abs(dy)
      if (pushY <= pushX) y += (dy >= 0 ? 1 : -1) * pushY
      else x += (dx >= 0 ? 1 : -1) * pushX
      // A shift that would leave the screen is pulled back in, which usually means the next pass
      // finds the same blocker and the label spends a shift getting nowhere — correctly, since
      // there was nowhere to go. Three of those and PRD 5.3.10 fades it, which is the right answer.
      x = keepOnScreen(x, halfWidth, options.viewportWidth)
      y = keepOnScreen(y, halfHeight, options.viewportHeight)
      shifts += 1
    }

    // PRD 5.3.11: a plane behind a nearer plane is dimmed to 40%.
    let occluded = false
    if (candidate.tier === 'plane' && opacity > 0) {
      for (const other of candidates) {
        if (other === candidate || other.tier !== 'plane' || !other.onScreen) continue
        if (other.depth >= candidate.depth) continue
        const dx = other.x - candidate.x
        const dy = other.y - candidate.y
        if (dx * dx + dy * dy < other.radiusPx * other.radiusPx) {
          occluded = true
          break
        }
      }
      if (occluded) opacity *= OCCLUDED_OPACITY
    }

    // PRD 5.4.15: at plane level *every* overlay plane label goes — the focused plane's because it
    // has moved to the fixed HUD, the others because the requirement says they fade out. Band
    // labels are the plane level's own labels (PRD 5.4.5) and are untouched by this.
    if (candidate.tier === 'plane' && fade > 0) opacity *= 1 - fade

    // Every opacity rule has now had its say, so this is the last honest moment to ask whether the
    // label is on screen at all — which is what decides whether it keeps its collision box.
    if (opacity > 0) reserved += 1

    const placement = out[written] ?? createPlacement()
    out[written] = placement
    placement.key = candidate.key
    placement.text = candidate.text
    placement.sub = sub
    placement.tier = candidate.tier
    placement.x = x
    placement.y = y
    placement.fontPx = fontPx
    placement.opacity = opacity
    placement.occluded = occluded
    written += 1
  }

  return written
}
