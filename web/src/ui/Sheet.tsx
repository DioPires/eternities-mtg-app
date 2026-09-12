/**
 * The scrim-and-sheet shell every overlay in PRD 6.3.3's cluster shares.
 *
 * Five surfaces — filters, settings, help, about, the plane index — each wrote out the same
 * twelve lines: a scrim that closes on a pointer-down that did not come from a child, a
 * `role="dialog" aria-modal="true"` element with a label, `useDialog` for the focus trap of PRD
 * 7.5.2, and a `sheet-head` with a heading in it. Five copies of a focus trap is five chances for
 * one overlay to be the one that forgot it (review §6.2).
 *
 * What stays with the caller is everything that differs: the body, the footer, and any extra
 * control in the header (the plane index's roster filter, the filter sheet's subtitle).
 *
 * **Esc is not here**, deliberately, and neither is it in `useDialog`. `useKeyboardMap` owns Esc
 * for the whole app so PRD 6.11's close ordering — overlay, then hint, then camera — has a single
 * producer. See `./dialog`.
 */

import type { ReactElement, ReactNode } from 'react'

import { useStore } from '../store/store'
import { useDialog } from './dialog'

export interface SheetProps {
  /** The dialog's accessible name, and what a screen reader announces on open. */
  readonly label: string
  /** The visible heading. Usually the label in sentence case; occasionally shorter. */
  readonly title: string
  /** Extra `class` on the sheet itself, for a surface that needs a different width. */
  readonly className?: string
  /**
   * Where focus goes when the sheet opens, as a selector inside it. Defaults to the first element
   * in the tab order, which is right unless the sheet leads with a text input.
   */
  readonly initialFocus?: string
  /** Beside the heading: a subtitle, a filter box. */
  readonly head?: ReactNode
  readonly children: ReactNode
  readonly footer?: ReactNode
}

export function Sheet({
  label,
  title,
  className,
  initialFocus,
  head,
  children,
  footer,
}: SheetProps): ReactElement {
  const setOverlay = useStore((state) => state.setOverlay)
  const dialog = useDialog<HTMLDivElement>(initialFocus)

  return (
    <div
      className="overlay-scrim overlay-scrim-top"
      onPointerDown={(event) => {
        // Only a press that landed on the scrim itself. A press that started inside the sheet and
        // released out here is a drag, not a dismissal.
        if (event.target === event.currentTarget) setOverlay(null)
      }}
    >
      <div
        className={className === undefined ? 'sheet' : `sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={dialog}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          {head}
        </header>

        {children}

        {footer !== undefined && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  )
}
