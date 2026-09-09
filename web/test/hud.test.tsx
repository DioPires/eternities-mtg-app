/**
 * The HUD's two accessibility promises, and the one that was broken (DEC-695 N3).
 *
 * PRD 6.3 hides the HUD "entirely" during attract mode, and PRD 6.8.1 makes exactly one
 * announcement — "N stars loaded" — when `stars.bin` completes. Those two requirements collided:
 * attract starts after 45 s of idle, a slow load finishes inside it, and the live region was
 * inside the subtree attract unmounts. The announcement had nothing to happen *to*, so it was
 * simply lost.
 *
 * The fix keeps the region mounted and the HUD gone. Both halves are asserted here, because
 * fixing the first by breaking the second would be a worse bug than the one it replaced.
 */

import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Manifest, Stars } from '../src/data'
import { useStore } from '../src/store/store'
import { Hud } from '../src/ui/Hud'

const MANIFEST = { counts: { stars: 28_532 } } as Manifest
const STARS = { count: 28_532 } as Stars

/** Attract is read from the navigation snapshot, not the store, so the hook is the seam. */
let attract = false
vi.mock('../src/app/hooks', () => ({
  useNavSnapshot: () => ({ attract, focus: { kind: 'multiverse' }, flight: null, level: 'multiverse' }),
  useNavigation: () => ({ on: () => () => undefined }),
  BLIND_ETERNITIES_SLUG: 'blind-eternities',
}))

vi.mock('../src/ui/Breadcrumb', () => ({ Breadcrumb: () => <nav>breadcrumb</nav> }))
vi.mock('../src/ui/FilterChips', () => ({ FilterChips: () => null }))
vi.mock('../src/ui/ControlCluster', () => ({ ControlCluster: () => <div>controls</div> }))

beforeEach(() => {
  attract = false
  useStore.setState({ manifest: null, stars: null, starsDrawable: 0 })
})

describe('the HUD (PRD 6.3)', () => {
  it('leaves the tree entirely during attract mode', () => {
    attract = true
    const { container } = render(<Hud />)
    expect(container.querySelector('.hud')).toBeNull()
    expect(screen.queryByText('controls')).not.toBeInTheDocument()
  })

  it('shows the loading line as a plain line, not a live region (PRD 6.8.1, F8)', () => {
    useStore.setState({ manifest: MANIFEST, starsDrawable: 12_000 })
    const { container } = render(<Hud />)
    const line = container.querySelector('.hud-loading')
    // ~87 reveals during a load: a live region here reads the same sentence 87 times.
    expect(line).toHaveTextContent('12,000 of 28,532 stars')
    expect(line).not.toHaveAttribute('role', 'status')
    expect(line).not.toHaveAttribute('aria-live')
  })

  it('mounts the live region empty first, so the change is what gets announced', () => {
    useStore.setState({ manifest: MANIFEST })
    render(<Hud />)
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('announces once when the transfer completes', () => {
    useStore.setState({ manifest: MANIFEST })
    render(<Hud />)
    act(() => {
      useStore.setState({ stars: STARS, starsDrawable: STARS.count })
    })
    expect(screen.getByRole('status')).toHaveTextContent('28,532 stars loaded.')
  })

  /**
   * DEC-695 N3. Before the fix this rendered nothing at all while `attract` was true, so there was
   * no `role="status"` node in the document for the completion to write into — `getByRole` below
   * threw, and on the real page the announcement was silently dropped.
   */
  it('keeps the live region mounted through attract, so a load inside it is still announced', () => {
    attract = true
    useStore.setState({ manifest: MANIFEST })
    const { container } = render(<Hud />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      useStore.setState({ stars: STARS, starsDrawable: STARS.count })
    })
    expect(screen.getByRole('status')).toHaveTextContent('28,532 stars loaded.')
    // ...and the HUD proper is still gone, which is the half PRD 6.3 asks for.
    expect(container.querySelector('.hud')).toBeNull()
  })
})
