/**
 * `Sheet`, the one scrim-and-dialog shell the five overlays share (review §6.2), and `Toasts`.
 *
 * The reason to test the shell rather than each overlay through it: the properties that matter
 * here are accessibility properties, and they were previously restated five times. One of the five
 * could have been the one that forgot the focus trap and no test would have known. Now there is
 * one implementation and this is the check on it — plus `settings-overlay.test.tsx`, which proves
 * a real caller still comes out with the same dialog it had.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '../src/store/store'
import { Sheet } from '../src/ui/Sheet'
import { Toasts } from '../src/ui/Toasts'

beforeEach(() => {
  useStore.setState({ overlay: 'help', toasts: [] })
})

describe('the shared sheet (PRD 7.5.2)', () => {
  it('is a labelled modal dialog with its heading visible', () => {
    render(
      <Sheet label="Help" title="Getting around">
        <p>body</p>
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Help' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Getting around')
  })

  it('moves focus inside on open, so `aria-modal` is not a lie', () => {
    render(
      <Sheet label="Help" title="Getting around">
        <button type="button">first</button>
        <button type="button">second</button>
      </Sheet>,
    )
    expect(screen.getByRole('dialog', { name: 'Help' })).toContainElement(
      document.activeElement as HTMLElement,
    )
  })

  it('honours an explicit initial focus, for a sheet that leads with a filter box', () => {
    render(
      <Sheet
        label="Plane index"
        title="Planes"
        initialFocus=".sheet-filter"
        head={<input className="sheet-filter" aria-label="Filter the plane roster" />}
      >
        <button type="button">a row</button>
      </Sheet>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Filter the plane roster'))
  })

  it('closes on a press that landed on the scrim, and not on one inside the sheet', () => {
    const { container } = render(
      <Sheet label="Help" title="Getting around">
        <button type="button">inside</button>
      </Sheet>,
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: 'inside' }))
    expect(useStore.getState().overlay).toBe('help')

    fireEvent.pointerDown(container.querySelector('.overlay-scrim')!)
    expect(useStore.getState().overlay).toBeNull()
  })

  it('omits the footer element entirely when there is no footer', () => {
    const { container, rerender } = render(
      <Sheet label="Help" title="Getting around">
        <p>body</p>
      </Sheet>,
    )
    expect(container.querySelector('.sheet-foot')).toBeNull()

    rerender(
      <Sheet label="Help" title="Getting around" footer={<button type="button">Done</button>}>
        <p>body</p>
      </Sheet>,
    )
    expect(container.querySelector('.sheet-foot')).toContainElement(
      screen.getByRole('button', { name: 'Done' }),
    )
  })

  it('adds a caller class beside the base one rather than replacing it', () => {
    const { container } = render(
      <Sheet label="Filters" title="Filters" className="sheet-filters">
        <p>body</p>
      </Sheet>,
    )
    expect(container.querySelector('.sheet')).toHaveClass('sheet', 'sheet-filters')
  })
})

describe('toasts (PRD 7.4.1)', () => {
  it('renders nothing at all when there is nothing to report', () => {
    const { container } = render(<Toasts />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is a polite live region, not a dialog — a failed chunk must not block the multiverse', () => {
    useStore.setState({ toasts: [{ id: 1, message: 'planes.json failed', tone: 'error', timeoutMs: null }] })
    render(<Toasts />)
    const list = screen.getByRole('list')
    expect(list).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('planes.json failed')).toBeInTheDocument()
  })

  it('dismisses on the close button', () => {
    useStore.setState({ toasts: [{ id: 7, message: 'Link copied', tone: 'info', timeoutMs: 6000 }] })
    render(<Toasts />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useStore.getState().toasts).toEqual([])
  })

  /**
   * PRD 7.4.1 reports a failure and keeps it until acknowledged; a confirmation fades. The store
   * carries that as `timeoutMs: null`, and nothing but a test says the two are different.
   */
  it('keeps a data failure on screen and lets a confirmation fade', () => {
    const push = useStore.getState().pushToast
    push('planes.json failed', 'error', null)
    push('Link copied')
    const [failure, confirmation] = useStore.getState().toasts
    expect(failure?.timeoutMs).toBeNull()
    expect(confirmation?.timeoutMs).toBe(6000)
  })

  it('drops an identical message rather than stacking a second copy of the same report', () => {
    const push = useStore.getState().pushToast
    const first = push('planes.json failed', 'error', null)
    const second = push('planes.json failed', 'error', null)
    expect(second).toBe(first)
    expect(useStore.getState().toasts).toHaveLength(1)
  })
})
