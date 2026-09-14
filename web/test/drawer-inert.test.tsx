/**
 * PRD 7.5.2: the collapsed drawer's *contents* leave the tab order, and its toggle does not.
 *
 * `Drawer`'s own header calls that distinction load-bearing — `.drawer-toggle` is the only way to
 * reopen the panel and it rides the same transform, so taking the whole `<aside>` out would strand
 * a keyboard user with no way back in. Nothing asserted it until now.
 *
 * The test exists because DEC-741 changed how the attribute is produced, not what it means. Under
 * React 18 the prop had to be spread in as the empty string (`{...(open ? {} : { inert: '' })}`),
 * because React 18 rendered unknown attributes verbatim and `inert={false}` would have emitted
 * `inert="false"` — which HTML treats as inert, since any value counts. React 19 knows `inert` as
 * a real boolean and omits the attribute for `false`, so the prop is now written plainly. Both
 * spellings are supposed to produce the same DOM, and this pins that in both states.
 *
 * The state that carries the risk is the *open* one. A renderer that writes a falsey value instead
 * of omitting the attribute leaves an open panel inert, and the failure is silent to everything
 * except a keyboard or a screen reader. Checked against mutants: rendering the attribute
 * unconditionally and rendering it never are each caught, by their own row. Writing the literal
 * `inert="false"` only while collapsed is deliberately *not* caught, because it is not a defect —
 * HTML makes any value inert, so that spelling still behaves correctly in both states.
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Drawer } from '../src/ui/Drawer'
import { useStore } from '../src/store/store'

// The drawer's data hooks are not what is under test: with a `plane` focus and no plane record the
// component renders its "Loading plane…" placeholder, which is enough to have a contents element.
vi.mock('../src/app/hooks', () => ({
  useNavSnapshot: () => ({ focus: { kind: 'plane', slug: 'dominaria' } }),
  useFocusedPlane: () => null,
  useCardDetail: () => ({
    card: null,
    plane: null,
    starIndex: null,
    loading: false,
    failed: false,
  }),
}))

function scrollRegion(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.drawer-scroll')
  if (found === null) throw new Error('the drawer rendered no contents element')
  return found
}

describe('the collapsed drawer leaves the tab order (PRD 7.5.2)', () => {
  beforeEach(() => {
    useStore.setState({ panelOpen: true })
  })

  it('marks the contents inert while collapsed, and not the container', () => {
    useStore.setState({ panelOpen: false })
    render(<Drawer />)

    expect(scrollRegion()).toHaveAttribute('inert')
    // The toggle rides the same transform and is the only way back in, so the container itself
    // must stay reachable.
    expect(screen.getByRole('complementary')).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: /Expand/ })).toBeInTheDocument()
  })

  it('clears the attribute entirely when open, rather than writing a falsey value', () => {
    render(<Drawer />)

    // `toHaveAttribute('inert')` alone would pass on `inert="false"`, which is still inert per the
    // HTML spec — the absence is the assertion that matters.
    expect(scrollRegion().hasAttribute('inert')).toBe(false)
  })
})
