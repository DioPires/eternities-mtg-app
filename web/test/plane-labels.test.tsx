/**
 * The label overlay's frame path, counted (DEC-695 N2).
 *
 * PRD 8.4.4 puts a CPU projection of every plane centre in the frame loop. PRD 6.10.1 lets the
 * user turn labels off. Those two met badly: `layoutLabels` returned 0 for the off case, but only
 * *after* the component had projected the whole roster and rebuilt the band candidates — so the
 * setting removed the labels from the screen and left the work in the frame.
 *
 * The assertion is a call count rather than a frame time, because a frame time measured in jsdom
 * against a fake rAF would be noise. `Projector.project` is the per-plane unit of the work N2 is
 * about, so counting it is counting exactly the thing that was supposed to stop.
 *
 * **The clock changed under this test in W4.2 and the count did not.** The overlay used to run a
 * `requestAnimationFrame` of its own; it is now a subscriber to the loop's `labels` phase, which
 * runs after the camera matrices are final (review §3.6 phase 3, item 2). So the harness below
 * steps a real {@link FrameLoop} by hand rather than advancing fake timers — which is a better test
 * of the same thing, because a step that never ran would now show up as a count of zero rather than
 * as a pump that silently did nothing.
 */

import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyTether } from '../src/camera/framing'
import { CameraRig } from '../src/camera/rig'
import { BLIND_ETERNITIES_SLUG, isWorldPlane, type PlanesFile } from '../src/data/types'
import { PlaneLabels } from '../src/labels/PlaneLabels'
import { Projector } from '../src/labels/project'
import { FrameLoop } from '../src/scene/renderer/frameLoop'

import { loadFixturePlanes } from './fixtures'

const planes = loadFixturePlanes('scale')
/**
 * The overlay's subject count, derived the way the overlay derives it (worlds spec §1.11).
 *
 * PRD 5.3.8: the dust plane carries no label, so it is not in the per-frame projection either.
 * On a worlds dataset the subject narrows again to the worlds — the moons are unlabelled until
 * hover and take no seat in the solver — so this counts what the fixture actually is rather than
 * restating a number. `labelSubjectCount` below pins the *rule*; this is its consequence.
 */
const withoutBelt = planes.planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG)
const LABELLED = (withoutBelt.some(isWorldPlane) ? withoutBelt.filter(isWorldPlane) : withoutBelt)
  .length

/**
 * The loop the overlay subscribes to. Never started: `requestFrame` is a no-op, so the only ticks
 * are the ones {@link pump} asks for and the count is exact.
 */
let loop = new FrameLoop({ requestFrame: () => 0, cancelFrame: () => {}, now: () => 0 })
let clock = 0

/** Step the loop by hand, `frames` times. */
function pump(frames: number): void {
  for (let i = 0; i < frames; i += 1) {
    clock += 17
    act(() => {
      loop.tick(clock)
    })
  }
}

beforeEach(() => {
  loop = new FrameLoop({ requestFrame: () => 0, cancelFrame: () => {}, now: () => 0 })
  clock = 0
})

function rigAtHome(): CameraRig {
  const rig = new CameraRig(planes)
  rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
  rig.update(1 / 60)
  return rig
}

afterEach(() => {
  vi.useRealTimers()
})

/**
 * §1.11's label subject, pinned as a rule rather than as a count (DEC-751).
 *
 * `LABELLED` above derives the count the same way the component does, so on its own it would go on
 * agreeing with any rule the component happened to implement — including no rule at all. These two
 * rows drive the *same* component with two rosters that differ in exactly one property and assert
 * that the subject set changes, which is a claim the derivation cannot make about itself.
 *
 * The DOM is the subject because that is also leg G's instrument: W5 sweeps `[data-plane-slug]`.
 */
describe('§1.11 the label subject narrows to the worlds on a worlds dataset', () => {
  /** Every plane slug the overlay put a *plane* label in the DOM for. */
  function renderedSlugs(file: PlanesFile): string[] {
    const rig = new CameraRig(file)
    rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
    rig.update(1 / 60)
    const view = render(
      <PlaneLabels loop={loop} planes={file} rig={rig} focusedPlaneSlug={null} level="multiverse" enabled />,
    )
    const slugs = [...view.container.querySelectorAll('[data-plane-slug]')].map(
      (node) => node.getAttribute('data-plane-slug')!,
    )
    view.unmount()
    return slugs
  }

  /** The same roster with every `rowCells` stripped — which is exactly what a v2 dataset is. */
  const asV2: PlanesFile = {
    ...planes,
    contractVersion: 2,
    planes: planes.planes.map((plane) => {
      const copy: Record<string, unknown> = { ...plane }
      delete copy.rowCells
      return copy as unknown as (typeof planes.planes)[number]
    }),
  }

  it('labels the worlds and not the moons on v3, and every plane on v2', () => {
    const worlds = planes.planes.filter(isWorldPlane)
    const moons = planes.planes.filter(
      (plane) => !isWorldPlane(plane) && plane.slug !== BLIND_ETERNITIES_SLUG,
    )
    // The fixture has to contain both kinds or neither row below can fail.
    expect(worlds.length).toBeGreaterThan(0)
    expect(moons.length).toBeGreaterThan(0)

    const v3 = new Set(renderedSlugs(planes))
    expect(v3).toEqual(new Set(worlds.map((plane) => plane.slug)))
    for (const moon of moons) expect(v3.has(moon.slug), moon.slug).toBe(false)

    // The v2 arm, which is the control: the same component, the same roster, one field removed,
    // and PRD 5.3.4's rule unchanged. Without it, a component that labelled nothing but worlds
    // *always* would pass the assertions above while regressing the shipping galaxy.
    const v2 = new Set(renderedSlugs(asV2))
    expect(v2.size).toBe(planes.planes.length - 1)
    for (const moon of moons) expect(v2.has(moon.slug), moon.slug).toBe(true)
  })

  it('never puts a band label in the world sweep, however the plane is keyed', () => {
    // The `tier` guard. A band's key is `${slug}:${code}`, so dropping the guard adds one
    // `data-plane-slug` per set of the focused plane — and W5 would score them as worlds.
    const focused = planes.planes.find((plane) => isWorldPlane(plane) && plane.sets.length > 0)
    expect(focused).toBeDefined()
    const rig = new CameraRig(planes)
    rig.snapTo({ tether: rig.framing.plane(emptyTether(), focused!), durationS: 0, holdS: 0 })
    rig.update(1 / 60)
    const view = render(
      <PlaneLabels
        loop={loop}
        planes={planes}
        rig={rig}
        focusedPlaneSlug={focused!.slug}
        level="plane"
        enabled
      />,
    )
    const slugs = [...view.container.querySelectorAll('[data-plane-slug]')].map((node) =>
      node.getAttribute('data-plane-slug'),
    )
    // The bands are in the DOM — otherwise this row proves nothing about the guard.
    expect(view.container.querySelectorAll('.label-band').length).toBeGreaterThan(0)
    expect(slugs.some((slug) => slug!.includes(':'))).toBe(false)
    view.unmount()
  })
})

describe('the label overlay frame path (PRD 8.4.4)', () => {
  it('projects every plane centre per frame while labels are on', () => {
    vi.useFakeTimers()
    const project = vi.spyOn(Projector.prototype, 'project')
    render(<PlaneLabels loop={loop} planes={planes} rig={rigAtHome()} focusedPlaneSlug={null} level="multiverse" enabled />)

    project.mockClear()
    pump(3)
    // Exactly one per labelled plane per frame. No bands: nothing is focused.
    expect(LABELLED).toBeGreaterThan(50)
    expect(project.mock.calls.length).toBe(3 * LABELLED)
  })

  /**
   * N2. Before the fix this counted the same ~86 projections per frame as the case above: the
   * component ran the whole projection pass and only then asked `layoutLabels`, which returned 0.
   */
  it('projects nothing at all while labels are off (DEC-695 N2)', () => {
    vi.useFakeTimers()
    const project = vi.spyOn(Projector.prototype, 'project')
    render(
      <PlaneLabels
        loop={loop}
        planes={planes}
        rig={rigAtHome()}
        focusedPlaneSlug={null}
        level="multiverse"
        enabled={false}
      />,
    )

    project.mockClear()
    pump(10)
    expect(project.mock.calls.length).toBe(0)
  })

  it('blanks the labels once when they go off, and does not keep rewriting them', () => {
    vi.useFakeTimers()
    const rig = rigAtHome()
    const { container, rerender } = render(
      <PlaneLabels loop={loop} planes={planes} rig={rig} focusedPlaneSlug={null} level="multiverse" enabled />,
    )
    pump(2)

    rerender(
      <PlaneLabels
        loop={loop}
        planes={planes}
        rig={rig}
        focusedPlaneSlug={null}
        level="multiverse"
        enabled={false}
      />,
    )
    pump(3)

    const opacities = [...container.querySelectorAll<HTMLElement>('.label')].map(
      (node) => node.style.opacity,
    )
    expect(opacities.length).toBeGreaterThan(0)
    expect(opacities.every((value) => value === '0')).toBe(true)
  })

  it('picks the projection back up when labels come back on', () => {
    vi.useFakeTimers()
    const project = vi.spyOn(Projector.prototype, 'project')
    const rig = rigAtHome()
    const { rerender } = render(
      <PlaneLabels
        loop={loop}
        planes={planes}
        rig={rig}
        focusedPlaneSlug={null}
        level="multiverse"
        enabled={false}
      />,
    )
    pump(3)
    project.mockClear()

    rerender(
      <PlaneLabels loop={loop} planes={planes} rig={rig} focusedPlaneSlug={null} level="multiverse" enabled />,
    )
    pump(2)
    expect(project.mock.calls.length).toBe(2 * LABELLED)
  })

  it('is hidden from the accessibility tree — the names are the HUD breadcrumb’s job', () => {
    vi.useFakeTimers()
    const { container } = render(
      <PlaneLabels loop={loop} planes={planes} rig={rigAtHome()} focusedPlaneSlug={null} level="multiverse" enabled />,
    )
    expect(container.querySelector('.labels')).toHaveAttribute('aria-hidden', 'true')
  })
})
