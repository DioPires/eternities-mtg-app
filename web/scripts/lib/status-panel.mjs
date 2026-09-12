/**
 * The development readout is on screen, not merely in the DOM.
 *
 * Shared by `verify-browser.mjs`, which turns a fault into a failed run, and `visual-gate.mjs`,
 * which turns one into a note beside the frames. They used to carry two different checks: the
 * gate's was a pure-overlap boolean, so a panel pushed almost entirely off screen, or one clipped
 * by its own `max-height`, produced no note at all. A capture run is the first thing anyone points
 * at a new build, which is exactly when the stronger version is wanted, so there is now one.
 *
 * Every other assertion in either script reads the panel's `textContent`, and `textContent` is
 * happy with a node that never paints. It was: for two phases both scenes asked for
 * `class="overlay"`, Phase 5's stylesheet had no such rule, and the panel laid out
 * `position: static` after a canvas that already fills `.app` — a viewport below the fold, on a
 * `body` with `overflow: hidden`. The whole suite stayed green through it. That is the class of
 * defect a text-only assertion cannot see, so this one is deliberately not about text.
 *
 * Four things are asked, because each catches a different way to be invisible:
 *
 *  - `checkVisibility` for `display: none`, `visibility: hidden`, zero opacity and an unrendered
 *    subtree — the failures that leave a box behind;
 *  - the intersection with the viewport, for the failure that actually happened: a laid-out,
 *    perfectly visible box positioned somewhere nobody can see;
 *  - `position`, because `static` is what put it there, and naming it makes the diagnosis obvious
 *    from the message alone;
 *  - the scroll overflow, for the one invisibility the other three all pass: `max-height` with
 *    `overflow: hidden` (both in the `.scene-status` rule, and the `max-height` deliberately so)
 *    clips the readout's last lines while the box itself paints, at full size, exactly where it
 *    belongs. Nothing above can see a panel that is on screen and truncated.
 *
 * Occlusion is out of scope here: `pointer-events: none` takes the panel out of hit testing on
 * purpose (the harness clicks stars through this corner), so `elementsFromPoint` would report the
 * canvas whatever the panel is doing. The check is geometry and computed style, as PRD 9.3's
 * follow-up asks.
 */

/**
 * Measure the panel in the page. Returns `null` when it is not in the DOM at all — the callers
 * word that one themselves, because "missing" means something different to each of them.
 */
export async function measureStatusPanel(page, testid) {
  return page.evaluate((id) => {
    const node = document.querySelector(`[data-testid="${id}"]`)
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0))
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0))
    return {
      rendered: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      onScreen: { width, height },
      position: style.position,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      // Content height against the height on offer. Both are integers, and both include the
      // padding, so they are directly comparable.
      scroll: { height: node.scrollHeight, client: node.clientHeight },
    }
  }, testid)
}

/** Where the panel is and how big, in one clause. Every message below ends with it. */
export function describeStatusPanel(seen) {
  return (
    `${Math.round(seen.box.width)}x${Math.round(seen.box.height)} at ` +
    `(${Math.round(seen.box.x)}, ${Math.round(seen.box.y)}) in a ` +
    `${seen.viewport.width}x${seen.viewport.height} viewport, position:${seen.position}`
  )
}

/**
 * Every way this panel can be present and unreadable, worst first, as ready-to-print sentences.
 * Empty when the panel is fine. Ordered because `verify-browser.mjs` reports only the first, and
 * the first should be the one that explains the rest.
 */
export function statusPanelFaults(seen) {
  const where = describeStatusPanel(seen)
  const faults = []

  if (!seen.rendered) {
    faults.push(`the status panel is in the DOM but does not render — ${where}`)
  }
  if (seen.position === 'static') {
    faults.push(
      `the status panel is statically positioned, so it lays out after the canvas that fills ` +
        `.app instead of over it — ${where}. Its textContent still reads, which is why only this ` +
        `assertion can see it. Check the .scene-status rule in styles.css.`,
    )
  }

  // Two floors per axis, and the panel has to clear both:
  //
  //  - a tenth of the viewport, so a stray sliver poking in from off screen is not mistaken for a
  //    panel that can be read;
  //  - 60% of the panel's own box, because a viewport fraction alone scales with the wrong thing.
  //    The viewport tenth is 108px at 1080 whatever the panel, and the two panels are not the same
  //    size: measured on `small`, ?probe=1's is 248px tall and the self-check host's is 374px. So the flat floor
  //    is 44% of the one and 29% of the other, and a regression that pushed the tall one 71% off
  //    the bottom would still leave more than 108px on screen and pass.
  //
  // Deliberately unclamped. A `Math.min(…, side)` used to sit here, to keep a panel larger than
  // the window from being asked for the impossible, but it could not bind (`.scene-status` caps
  // the box at `26rem` by `calc(100% - var(--space-6))`, so `box * 0.6` stays under the viewport)
  // and asking for `side` would have demanded that an edge-offset panel cover the whole axis,
  // which is less satisfiable than what it replaced. Both terms are already answerable on their
  // own: `box * 0.6` is a fraction of the box being measured, and the viewport tenth is
  // unanswerable only for a panel that has collapsed — which is the point of having it.
  const floor = (side, box) => Math.max(side / 10, box * 0.6)
  const floorW = floor(seen.viewport.width, seen.box.width)
  const floorH = floor(seen.viewport.height, seen.box.height)
  if (!(seen.onScreen.width >= floorW && seen.onScreen.height >= floorH)) {
    faults.push(
      `the status panel is positioned off screen — only ${Math.round(seen.onScreen.width)}x` +
        `${Math.round(seen.onScreen.height)} of it is inside the viewport, and this check wants at ` +
        `least ${Math.round(floorW)}x${Math.round(floorH)} of its own ` +
        `${Math.round(seen.box.width)}x${Math.round(seen.box.height)} box (${where})`,
    )
  }

  // Height only: `.scene-status` clips vertically by design (`max-height` plus `overflow: hidden`)
  // and the readout grows downwards, so vertical is where content is lost. Horizontally the rule
  // sets `overflow-wrap: anywhere` on the panel, inherited by every line in it, so a long unbroken
  // token — a hash, a URL, a slug — wraps rather than overflowing past `max-width`.
  //
  // The threshold is exact on purpose. Both panels sit at `scrollHeight == clientHeight` because
  // their height is content-driven while `max-height` is not binding, so the padding box and the
  // content bottom are the same edge and round identically. A slack margin would blind this to the
  // small truncations it exists for.
  if (!(seen.scroll.height <= seen.scroll.client)) {
    faults.push(
      `the status panel is on screen but its readout is truncated — ${seen.scroll.height}px of ` +
        `content in ${seen.scroll.client}px of box, so ${seen.scroll.height - seen.scroll.client}px ` +
        `is clipped by the max-height in the .scene-status rule. The clipped lines still read ` +
        `through textContent, so only this assertion can see it (${where})`,
    )
  }

  return faults
}

/** The one-line "it is fine, and here is what was measured" readout. */
export function summariseStatusPanel(seen) {
  return (
    `the status panel paints: ${describeStatusPanel(seen)}, ` +
    `${Math.round(seen.onScreen.width)}x${Math.round(seen.onScreen.height)} of it on screen, ` +
    `${seen.scroll.height}px of content in ${seen.scroll.client}px of box`
  )
}
