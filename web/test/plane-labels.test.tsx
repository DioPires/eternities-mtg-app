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
 */

import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyTether } from '../src/camera/framing'
import { CameraRig } from '../src/camera/rig'
import { BLIND_ETERNITIES_SLUG } from '../src/data/types'
import { PlaneLabels } from '../src/labels/PlaneLabels'
import { Projector } from '../src/labels/project'

import { loadFixturePlanes } from './fixtures'

const planes = loadFixturePlanes('scale')
/** PRD 5.3.8: the dust plane carries no label, so it is not in the per-frame projection either. */
const LABELLED = planes.planes.filter((plane) => plane.slug !== BLIND_ETERNITIES_SLUG).length

/** Drive the component's own `requestAnimationFrame` loop by hand, `frames` times. */
function pump(frames: number): void {
  for (let i = 0; i < frames; i += 1) {
    act(() => {
      vi.advanceTimersByTime(17)
    })
  }
}

function rigAtHome(): CameraRig {
  const rig = new CameraRig(planes)
  rig.snapTo({ tether: rig.framing.multiverse(emptyTether()), durationS: 0, holdS: 0 })
  rig.update(1 / 60)
  return rig
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the label overlay frame path (PRD 8.4.4)', () => {
  it('projects every plane centre per frame while labels are on', () => {
    vi.useFakeTimers()
    const project = vi.spyOn(Projector.prototype, 'project')
    render(<PlaneLabels planes={planes} rig={rigAtHome()} focusedPlaneSlug={null} level="multiverse" enabled />)

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
      <PlaneLabels planes={planes} rig={rig} focusedPlaneSlug={null} level="multiverse" enabled />,
    )
    pump(2)

    rerender(
      <PlaneLabels
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
      <PlaneLabels planes={planes} rig={rig} focusedPlaneSlug={null} level="multiverse" enabled />,
    )
    pump(2)
    expect(project.mock.calls.length).toBe(2 * LABELLED)
  })

  it('is hidden from the accessibility tree — the names are the HUD breadcrumb’s job', () => {
    vi.useFakeTimers()
    const { container } = render(
      <PlaneLabels planes={planes} rig={rigAtHome()} focusedPlaneSlug={null} level="multiverse" enabled />,
    )
    expect(container.querySelector('.labels')).toHaveAttribute('aria-hidden', 'true')
  })
})
