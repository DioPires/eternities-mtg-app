/**
 * The tab-order arithmetic behind PRD 7.5.2's "fully keyboard-operable".
 *
 * `nextFocusIndex` is the pure half of the focus trap: given how many things are focusable, where
 * focus is now, and which direction Tab went, where should it land. The DOM half — reading the
 * order, moving focus, restoring it on close — is driven in a real browser by `e2e/a11y.spec.ts`
 * 9c, which is the only place a focus trap can honestly be tested.
 *
 * The case worth having a test for is `current === -1`: the focused element is not in the tab
 * order. It is reached whenever focus sits on something inside the dialog that `focusablesIn`
 * excludes — the `tabindex="-1"` container an empty dialog opens on, most of all — and a trap that
 * mishandles it either throws or silently lets Tab walk out into the HUD the dialog claims is
 * inert.
 *
 * It is *not* reached by focus leaving the dialog. `useDialog` binds `keydown` to the dialog
 * element, and a `keydown` is dispatched at the focused element, so focus out on `<body>` means
 * this function is never consulted in the first place.
 */

import { describe, expect, it } from 'vitest'

import { nextFocusIndex } from '../src/ui/dialog'

describe('nextFocusIndex', () => {
  it('advances and retreats within the dialog', () => {
    expect(nextFocusIndex(4, 0, false)).toBe(1)
    expect(nextFocusIndex(4, 2, false)).toBe(3)
    expect(nextFocusIndex(4, 3, true)).toBe(2)
    expect(nextFocusIndex(4, 1, true)).toBe(0)
  })

  it('wraps at both ends rather than letting focus leave', () => {
    expect(nextFocusIndex(4, 3, false)).toBe(0)
    expect(nextFocusIndex(4, 0, true)).toBe(3)
  })

  it('enters the order at the end Tab came from, off an untabbable element', () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0)
    expect(nextFocusIndex(4, -1, true)).toBe(3)
  })

  it('holds still when the dialog has exactly one focusable thing', () => {
    // The search box: an input plus `aria-activedescendant` rows that are not themselves tabbable.
    // Tab must not escape to the HUD, so the only correct answer is "stay".
    expect(nextFocusIndex(1, 0, false)).toBe(0)
    expect(nextFocusIndex(1, 0, true)).toBe(0)
    expect(nextFocusIndex(1, -1, false)).toBe(0)
  })

  it('reports "nowhere to go" for an empty dialog instead of returning a bad index', () => {
    // The caller focuses the container itself in this case; an index of 0 into an empty list would
    // become an `undefined?.focus()` and Tab would leak out unnoticed.
    expect(nextFocusIndex(0, -1, false)).toBe(-1)
    expect(nextFocusIndex(0, 0, true)).toBe(-1)
  })

  it('is a bijection on the index set, in both directions', () => {
    // A cycle that visits every element exactly once is what "trapped, and complete" means: no
    // element is unreachable by Tab and none is visited twice before the others.
    for (const count of [1, 2, 5, 9]) {
      for (const backwards of [false, true]) {
        const seen = new Set<number>()
        let at = 0
        for (let step = 0; step < count; step += 1) {
          seen.add(at)
          at = nextFocusIndex(count, at, backwards)
        }
        expect(seen.size).toBe(count)
        expect(at).toBe(0)
      }
    }
  })
})
