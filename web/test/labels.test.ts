/**
 * The label rules (PRD 5.3.8–12, 5.4.5), exercised against fixture-scale's real roster.
 *
 * The implementation plan asks for the collision rules "exercised against fixture-scale's 82
 * planes", and PRD 9.3's home-view criterion is "no label overlaps another". Both are checked here
 * on the actual home view — the multiverse framed at 30° elevation, every plane projected — rather
 * than on a hand-made arrangement that would prove nothing about 83 real positions.
 */

import { describe, expect, it } from 'vitest'

import { emptyTether } from '../src/camera/framing'
import { CameraRig } from '../src/camera/rig'
import { vec, type MutVec3 } from '../src/camera/vec'
import { BLIND_ETERNITIES_SLUG } from '../src/data/types'
import {
  BAND_MIN_WIDTH_PX,
  createPlacement,
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

  it('never overlaps two visible labels (PRD 5.3.10, 9.3)', () => {
    // The one criterion PRD 9.3 states as a flat rule rather than a judgement.
    const visible = boxesOf(out, count)
    expect(visible.length).toBeGreaterThan(20)
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i]!
        const b = visible[j]!
        const halfW = (a.text.length * a.fontPx * 0.58 + b.text.length * b.fontPx * 0.58) / 2
        const halfH = (a.fontPx * 2.15 + b.fontPx * 2.15) / 2
        const clear = Math.abs(a.x - b.x) >= halfW || Math.abs(a.y - b.y) >= halfH
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
    const count = layoutLabels(candidates, out, {
      ...VIEWPORT,
      focusedPlaneKey: 'ravnica',
      planeLevelFade: 1,
    })
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
