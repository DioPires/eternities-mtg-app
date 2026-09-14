/**
 * The label rules (PRD 5.3.8–12, 5.4.5), exercised against fixture-scale's real roster.
 *
 * The implementation plan asks for the collision rules "exercised against fixture-scale's whole
 * roster", and PRD 9.3's home-view criterion is "no label overlaps another". Both are checked here
 * on the actual home view — the multiverse framed at 30° elevation, every plane projected — rather
 * than on a hand-made arrangement that would prove nothing about the roster's real positions.
 */

import { describe, expect, it } from 'vitest'

import { emptyTether } from '../src/camera/framing'
import { CameraRig } from '../src/camera/rig'
import { vec, type MutVec3 } from '../src/camera/vec'
import { BLIND_ETERNITIES_SLUG } from '../src/data/types'
import {
  BAND_MIN_WIDTH_PX,
  createPlacement,
  LABEL_GAP_PX,
  labelHalfExtents,
  layoutLabels,
  MAX_FONT_PX,
  MIN_FONT_PX,
  OCCLUDED_OPACITY,
  type LabelCandidate,
  type LabelPlacement,
} from '../src/labels/layout'
import { createProjected, Projector } from '../src/labels/project'

import { loadFixturePlanes } from './fixtures'

const planes = loadFixturePlanes('scale')
const VIEWPORT = { viewportWidth: 1920, viewportHeight: 1080 }

/** The home view of PRD 8.6.1: the whole disc, at ~30° elevation. */
function homeViewCandidates(): LabelCandidate[] {
  const rig = new CameraRig(planes)
  rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
  rig.update(1 / 60)

  const projector = new Projector()
  projector.update({
    position: rig.position,
    target: rig.lookAt,
    fov: (55 * Math.PI) / 180,
    near: 0.1,
    ...VIEWPORT,
  })

  const point: MutVec3 = vec()
  const projected = createProjected()
  const candidates: LabelCandidate[] = []
  for (const plane of planes.planes) {
    // PRD 5.3.4: the dust has no centre to label; its name lives in the HUD when focused.
    if (plane.slug === BLIND_ETERNITIES_SLUG) continue
    rig.motion.planePosition(point, plane)
    projector.project(projected, point)
    candidates.push({
      key: plane.slug,
      text: plane.displayName,
      // PRD 5.3.12: zero-card planes show no count.
      sub: plane.cardCount > 0 ? `${plane.cardCount} cards` : null,
      tier: 'plane',
      priority: plane.cardCount,
      x: projected.x,
      y: projected.y,
      radiusPx: projector.radiusPx(plane.radius, projected.depth),
      depth: projected.depth,
      onScreen: projected.onScreen,
    })
  }
  return candidates
}

function boxesOf(placements: readonly LabelPlacement[], count: number) {
  return placements.slice(0, count).filter((p) => p.opacity > 0.01)
}

describe('plane labels at the home view (PRD 5.3.8-12, 9.3)', () => {
  const candidates = homeViewCandidates()
  const out: LabelPlacement[] = []
  const count = layoutLabels(candidates, out, VIEWPORT)

  it('labels the planes that are on screen', () => {
    expect(candidates.length).toBe(planes.planes.length - 1)
    expect(count).toBeGreaterThan(40)
  })

  it('sizes a label box by whether it carries a count line (PRD 5.3.12)', () => {
    // The geometry the overlap check below rests on, asserted instead of assumed.
    //
    // A zero-card plane shows no count, so its label is one line and its box is a little over half
    // as tall. The overlap check used to re-derive the box itself and treat every label as two
    // lines. At 83 planes nothing ever landed in the difference; at 87 it reported `karsus
    // overlaps vatraquaz` for two labels 27.5 px apart with 23.5 px of box between them.
    const withCount = labelHalfExtents('Karsus', '212 cards', 16)
    const withoutCount = labelHalfExtents('Karsus', null, 16)
    expect(withCount.halfHeight).toBeCloseTo((16 * 2.15) / 2)
    expect(withoutCount.halfHeight).toBeCloseTo((16 * 1.3) / 2)
    // Width takes the wider of the two lines, so a long count can outgrow a short name.
    expect(labelHalfExtents('Ir', '30000 cards', 16).halfWidth).toBeGreaterThan(
      labelHalfExtents('Ir', null, 16).halfWidth,
    )
  })

  it('never overlaps two visible labels (PRD 5.3.10, 9.3)', () => {
    // The one criterion PRD 9.3 states as a flat rule rather than a judgement, measured against
    // the boxes the layout actually reserves.
    //
    // Not circular: `layoutLabels` checks each candidate only against the boxes reserved *before*
    // it, so a fault in the shift loop, in the reservation count, or in the fade rules leaves two
    // visible labels overlapping in the finished arrangement. This walks every pair to find that.
    //
    // What it does *not* cover, stated so a green run is not over-read. Two holes, both real:
    //
    // 1. It measures with `labelHalfExtents` and `LABEL_GAP_PX`, the same estimator `overlaps()`
    //    uses. So it catches bookkeeping and cannot catch the estimator itself being wrong about
    //    the real DOM. That direction is pinned only by the 5.3.12 geometry test above, which is
    //    the one place the box shape is asserted rather than reused.
    // 2. A faded label is not a pair here at all — `boxesOf` keeps only what is visible — so the
    //    solver could hide a genuine collision by fading one side and this would still read clear.
    //
    // Hole 2 is bounded rather than left open: the assertion below caps how much of the roster may
    // vanish from the check. It is a ratio, not a count, so it neither goes stale on the next
    // roster change nor silently widens. The escape it closes is a fade rule that starts dropping
    // labels wholesale; a fade of one awkward pair is under it, which is the intended behaviour.
    const visible = boxesOf(out, count)
    expect(
      visible.length / candidates.length,
      `only ${visible.length} of ${candidates.length} labels are visible — the overlap check ` +
        'below cannot see the rest, so too many faded means it is proving less than it looks',
    ).toBeGreaterThan(0.65)
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i]!
        const b = visible[j]!
        const ea = labelHalfExtents(a.text, a.sub, a.fontPx)
        const eb = labelHalfExtents(b.text, b.sub, b.fontPx)
        const clear =
          Math.abs(a.x - b.x) >= ea.halfWidth + eb.halfWidth + LABEL_GAP_PX ||
          Math.abs(a.y - b.y) >= ea.halfHeight + eb.halfHeight + LABEL_GAP_PX
        expect(clear, `${a.key} overlaps ${b.key}`).toBe(true)
      }
    }
  })

  it('clamps the font size to the PRD 5.3.9 range', () => {
    for (let i = 0; i < count; i += 1) {
      expect(out[i]!.fontPx).toBeGreaterThanOrEqual(MIN_FONT_PX)
      expect(out[i]!.fontPx).toBeLessThanOrEqual(MAX_FONT_PX)
    }
  })

  it('shows no card count on a zero-card plane (PRD 5.3.12)', () => {
    const empty = planes.planes.filter((p) => p.cardCount === 0).map((p) => p.slug)
    expect(empty.length).toBeGreaterThan(0)
    for (let i = 0; i < count; i += 1) {
      if (empty.includes(out[i]!.key)) expect(out[i]!.sub).toBeNull()
    }
  })
})

describe('collision priority (PRD 5.3.10)', () => {
  const base = {
    tier: 'plane' as const,
    sub: null,
    radiusPx: 20,
    depth: 100,
    onScreen: true,
  }

  it('makes the plane with fewer cards yield', () => {
    const out: LabelPlacement[] = []
    const count = layoutLabels(
      [
        { ...base, key: 'big', text: 'Dominaria', priority: 5000, x: 500, y: 500 },
        { ...base, key: 'small', text: 'Segovia', priority: 12, x: 505, y: 505 },
      ],
      out,
      VIEWPORT,
    )
    expect(count).toBe(2)
    const big = out.find((p) => p.key === 'big')!
    const small = out.find((p) => p.key === 'small')!
    // The high-count plane sits where it wanted to; the low-count one moved.
    expect(big.y).toBeCloseTo(500 + base.radiusPx + big.fontPx * 1.3 * 0.5 + 6, 5)
    expect(small.x === 505 && small.y === 505 + base.radiusPx + small.fontPx * 0.65 + 6).toBe(false)
  })

  it('breaks a tie alphabetically, and does so stably', () => {
    const items: LabelCandidate[] = [
      { ...base, key: 'zendikar', text: 'Zendikar', priority: 100, x: 400, y: 400 },
      { ...base, key: 'alara', text: 'Alara', priority: 100, x: 402, y: 402 },
    ]
    const first: LabelPlacement[] = []
    const second: LabelPlacement[] = []
    layoutLabels(items, first, VIEWPORT)
    layoutLabels([...items].reverse(), second, VIEWPORT)
    // Alphabetically first wins the contested spot, whichever order the caller supplied.
    expect(first[0]!.key).toBe('alara')
    expect(second[0]!.key).toBe('alara')
    expect(first[0]!.y).toBeCloseTo(second[0]!.y, 9)
  })

  it('holds the tie-break across frames and across a changed candidate set (DEC-692 R7)', () => {
    // The collation is precomputed per candidate *array* rather than reached through
    // `localeCompare` per comparison, so two things need pinning: that reusing one array — which is
    // what the frame path does — keeps giving the same answer, and that a new array with different
    // keys is not answered out of the previous array's ranks.
    const roster: LabelCandidate[] = [
      { ...base, key: 'zendikar', text: 'Zendikar', priority: 100, x: 400, y: 400 },
      { ...base, key: 'alara', text: 'Alara', priority: 100, x: 402, y: 402 },
    ]
    const out: LabelPlacement[] = []
    for (let frame = 0; frame < 5; frame += 1) {
      layoutLabels(roster, out, VIEWPORT)
      expect(out[0]!.key).toBe('alara')
    }

    // A different set, same shape, whose winner is a key the ranks above have never seen.
    const other: LabelCandidate[] = [
      { ...base, key: 'theros', text: 'Theros', priority: 100, x: 400, y: 400 },
      { ...base, key: 'kaldheim', text: 'Kaldheim', priority: 100, x: 402, y: 402 },
    ]
    layoutLabels(other, out, VIEWPORT)
    expect(out[0]!.key).toBe('kaldheim')

    // And back, to show the switch is not one-way.
    layoutLabels(roster, out, VIEWPORT)
    expect(out[0]!.key).toBe('alara')
  })

  it('does not let a faded label push a visible one', () => {
    // PRD 5.4.15 fades every plane label out at plane level, and PRD 5.4.5's band labels share the
    // solver. A box nobody can see must not displace one they can: before DEC-606 the band was
    // shoved aside by an invisible plane name sitting on the same point.
    const shared = { sub: null, radiusPx: 20, depth: 60, onScreen: true, x: 800, y: 500 }
    const out: LabelPlacement[] = []
    const count = layoutLabels(
      [
        { ...shared, key: 'plane', text: 'Ravnica', tier: 'plane', priority: 900 },
        { ...shared, key: 'band', text: 'Guildpact', tier: 'band', priority: 0, widthPx: 400 },
      ],
      out,
      { ...VIEWPORT, planeLevelFade: 1 },
    )
    expect(count).toBe(2)
    const plane = out.find((p) => p.key === 'plane')!
    const band = out.find((p) => p.key === 'band')!
    expect(plane.opacity).toBe(0)
    expect(band.opacity).toBe(1)
    // Same anchor, same radius, same font: the band lands exactly where the invisible one asked to.
    expect(band.x).toBeCloseTo(shared.x, 6)
    expect(band.y).toBeCloseTo(plane.y, 6)
  })

  it('keeps a shifted label inside the viewport', () => {
    const out: LabelPlacement[] = []
    const count = layoutLabels(
      [
        {
          key: 'corner',
          text: 'A Very Long Plane Name Indeed',
          sub: null,
          tier: 'plane',
          priority: 1,
          // Bottom-right corner: the label hangs below and to the right of nothing at all.
          x: VIEWPORT.viewportWidth - 20,
          y: VIEWPORT.viewportHeight - 10,
          radiusPx: 40,
          depth: 10,
          onScreen: true,
        },
      ],
      out,
      VIEWPORT,
    )
    expect(count).toBe(1)
    const placed = out[0]!
    const halfWidth = (placed.text.length * placed.fontPx * 0.58 + 10) / 2
    const halfHeight = (placed.fontPx * 1.3) / 2
    expect(placed.x + halfWidth).toBeLessThanOrEqual(VIEWPORT.viewportWidth)
    expect(placed.x - halfWidth).toBeGreaterThanOrEqual(0)
    expect(placed.y + halfHeight).toBeLessThanOrEqual(VIEWPORT.viewportHeight)
    expect(placed.y - halfHeight).toBeGreaterThanOrEqual(0)
  })

  it('fades a label that cannot be shifted clear', () => {
    // Six long names stacked on one point: the shift budget runs out and PRD 5.3.10's "then fades"
    // is the only outcome left.
    const items: LabelCandidate[] = Array.from({ length: 6 }, (_, i) => ({
      ...base,
      key: `plane-${i}`,
      text: 'A Very Long Plane Name Indeed',
      priority: 100 - i,
      x: 600,
      y: 600,
    }))
    const out: LabelPlacement[] = []
    const count = layoutLabels(items, out, VIEWPORT)
    const faded = out.slice(0, count).filter((p) => p.opacity === 0)
    expect(faded.length).toBeGreaterThan(0)
    expect(out[0]!.opacity).toBe(1)
  })
})

describe('occlusion and level (PRD 5.3.11, 5.4.15)', () => {
  it('dims a plane behind a nearer one to 40%', () => {
    const out: LabelPlacement[] = []
    layoutLabels(
      [
        {
          key: 'near',
          text: 'Near',
          sub: null,
          tier: 'plane',
          priority: 10,
          x: 900,
          y: 400,
          radiusPx: 90,
          depth: 50,
          onScreen: true,
        },
        {
          key: 'far',
          text: 'Far',
          sub: null,
          tier: 'plane',
          priority: 9,
          x: 920,
          y: 410,
          radiusPx: 20,
          depth: 500,
          onScreen: true,
        },
      ],
      out,
      VIEWPORT,
    )
    const far = out.find((p) => p.key === 'far')!
    expect(far.occluded).toBe(true)
    expect(far.opacity).toBeCloseTo(OCCLUDED_OPACITY, 6)
    expect(out.find((p) => p.key === 'near')!.occluded).toBe(false)
  })

  it('fades every plane label out at plane level (PRD 5.4.15)', () => {
    const candidates = homeViewCandidates()
    const out: LabelPlacement[] = []
    const count = layoutLabels(candidates, out, { ...VIEWPORT, planeLevelFade: 1 })
    for (let i = 0; i < count; i += 1) expect(out[i]!.opacity).toBe(0)
  })

  it('draws nothing when labels are switched off (PRD 6.10.1)', () => {
    const out: LabelPlacement[] = [createPlacement()]
    expect(layoutLabels(homeViewCandidates(), out, { ...VIEWPORT, enabled: false })).toBe(0)
  })
})

describe('chronology band labels (PRD 5.4.5)', () => {
  const plane = { tier: 'band' as const, sub: null, radiusPx: 6, depth: 40, onScreen: true }

  it('hides a band narrower than 120 px and shows one wider', () => {
    const out: LabelPlacement[] = []
    const count = layoutLabels(
      [
        { ...plane, key: 'narrow', text: 'Ravnica: City of Guilds', priority: 0, x: 300, y: 300, widthPx: BAND_MIN_WIDTH_PX - 1 },
        { ...plane, key: 'wide', text: 'Return to Ravnica', priority: 0, x: 300, y: 700, widthPx: BAND_MIN_WIDTH_PX },
      ],
      out,
      VIEWPORT,
    )
    expect(count).toBe(1)
    expect(out[0]!.key).toBe('wide')
  })

  it('yields to a plane label rather than displacing it', () => {
    const out: LabelPlacement[] = []
    const count = layoutLabels(
      [
        {
          key: 'band',
          text: 'Guildpact',
          sub: null,
          tier: 'band',
          priority: 9999,
          x: 800,
          y: 500,
          radiusPx: 6,
          depth: 40,
          onScreen: true,
          widthPx: 400,
        },
        {
          key: 'plane',
          text: 'Ravnica',
          sub: '900 cards',
          tier: 'plane',
          priority: 1,
          x: 800,
          y: 500,
          radiusPx: 20,
          depth: 60,
          onScreen: true,
        },
      ],
      out,
      VIEWPORT,
    )
    expect(count).toBe(2)
    // "at low priority beneath star labels": the plane label placed first and kept its spot, even
    // though the band asked for a far higher priority number.
    expect(out[0]!.key).toBe('plane')
    expect(out[1]!.key).toBe('band')
    expect(out[1]!.y).not.toBeCloseTo(out[0]!.y, 1)
  })
})
