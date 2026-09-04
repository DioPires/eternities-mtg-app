/**
 * Modal dialog behaviour, shared by every `aria-modal` surface in the shell — PRD 7.5.2, "search,
 * panels, and the control cluster are fully keyboard-operable with visible focus states".
 *
 * Phase 4 gave the overlays the right *markup* (`role="dialog"`, `aria-modal="true"`, a label) but
 * not the behaviour that markup promises. `aria-modal="true"` tells a screen reader that
 * everything outside the dialog is inert; if Tab can still walk out into the HUD behind the scrim,
 * the announcement and the reality disagree and a keyboard user is left tabbing through controls
 * their reader says do not exist. Three things fix that, and all three are here:
 *
 *  1. **focus moves in** when the dialog opens, so the next Tab starts inside it;
 *  2. **focus stays in** — Tab from the last element wraps to the first and Shift+Tab does the
 *     reverse. A click on the scrim, which leaves `document.body` focused, is pulled back in too;
 *  3. **focus goes home** when the dialog closes, to whatever opened it. Without this, dismissing
 *     the search box drops the caret at the top of the document and the user has to tab in from
 *     the beginning of the HUD to reach the control they just used.
 *
 * Esc is deliberately *not* here. `useKeyboardMap` owns it for the whole app, in one place, so the
 * close ordering of PRD 6.11 (overlay, then hint, then camera) has a single producer.
 */

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Tab order, as the browser would compute it, restricted to a subtree.
 *
 * `tabindex="-1"` is excluded — it is programmatically focusable but not tabbable, and this list
 * is a tab order. Hidden elements are dropped by measuring an offset box rather than by reading
 * `display`, which catches an ancestor's `display: none` as well as the element's own.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute('inert') &&
      element.closest('[inert]') === null &&
      // `getClientRects()` rather than `offsetParent`, which is also null for a `position: fixed`
      // element that is perfectly visible.
      element.getClientRects().length > 0,
  )
}

/**
 * Where Tab should land, given where it is now. Pure, so the wrap-around is unit-testable without
 * a DOM (`test/dialog.test.ts`); the hook below is the thin part that reads and writes the page.
 *
 * `current` is the index of the focused element within `count`, or `-1` when focus has escaped the
 * dialog entirely — a scrim click, say. From outside, Tab enters at the top and Shift+Tab at the
 * bottom, which is what a user pressing either key after clicking the backdrop expects.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return backwards ? count - 1 : 0
  if (backwards) return current === 0 ? count - 1 : current - 1
  return current === count - 1 ? 0 : current + 1
}

/**
 * Attach modal focus behaviour to a dialog element for as long as it is mounted.
 *
 * `autoFocus` names a selector inside the dialog to open on. The default — the first tabbable
 * element — is right for a sheet whose first control is its subject, and wrong for the search box,
 * where the input is what the user came for and is not first in the DOM.
 */
export function useDialog<T extends HTMLElement>(autoFocus?: string): RefObject<T> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return

    // Captured before anything moves, so it is genuinely the control that opened the dialog.
    const opener = document.activeElement

    const chosen = autoFocus === undefined ? null : dialog.querySelector<HTMLElement>(autoFocus)
    const first = chosen ?? focusablesIn(dialog)[0] ?? null
    // A dialog with nothing tabbable in it still has to receive focus, or the reader announces
    // nothing; `tabindex="-1"` on the container is the standard way in, and it is set here rather
    // than in the markup so no caller can forget it.
    if (first === null) {
      dialog.tabIndex = -1
      dialog.focus()
    } else {
      first.focus()
    }

    /**
     * Whether focus is still the dialog's to give back.
     *
     * Tracked as we go rather than read at teardown, because by the time a passive effect's
     * cleanup runs React has already detached the dialog and the browser has reset
     * `document.activeElement` to `<body>` — asking then would always answer "no" and the opener
     * would never get focus back. A `focusout` with a `relatedTarget` outside the dialog is the
     * one case where something else deliberately took focus and we must not take it away again.
     */
    let holdsFocus = true
    const onFocusIn = (): void => {
      holdsFocus = true
    }
    const onFocusOut = (event: FocusEvent): void => {
      const to = event.relatedTarget
      holdsFocus = to === null || (to instanceof Node && dialog.contains(to))
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const order = focusablesIn(dialog)
      if (order.length === 0) {
        // Nothing to move to: hold focus on the container rather than letting Tab leave.
        event.preventDefault()
        dialog.focus()
        return
      }
      const active = document.activeElement
      const current = active instanceof HTMLElement ? order.indexOf(active) : -1
      const next = nextFocusIndex(order.length, current, event.shiftKey)
      // Inside the dialog and not at either end, the browser's own Tab is already correct —
      // leaving it alone keeps the order right for anything focusable this selector list misses.
      if (current >= 0 && next === current + (event.shiftKey ? -1 : 1)) return
      event.preventDefault()
      order[next]?.focus()
    }

    dialog.addEventListener('keydown', onKeyDown)
    dialog.addEventListener('focusin', onFocusIn)
    dialog.addEventListener('focusout', onFocusOut)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      dialog.removeEventListener('focusin', onFocusIn)
      dialog.removeEventListener('focusout', onFocusOut)
      // `isConnected` because the opener can go away with the dialog — the chip-row "add filter"
      // button disappears when clearing the last chip closes the sheet.
      if (holdsFocus && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [autoFocus])

  return ref
}
