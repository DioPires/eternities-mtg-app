/**
 * §1.2's pass list, as `renderOrder` values — the one place the frame's draw order is written.
 *
 * > *"Drawn in this order, every frame: 1 backdrop, 2 system, 3 belt, 4 worlds with sheets,
 * > 5 tether, 6 printing ring, 7 focused card, 8 atmosphere, 9 composite. Steps 2–4 are opaque and
 * > depth-tested. Steps 5, 6, 8 are transparent; **8 is last because an atmosphere must not
 * > depth-reject the tether passing in front of it**."*
 *
 * **three's own sort is not enough, and the failure is silent.** three renders the opaque list, then
 * the transparent list sorted back-to-front by *distance*, so the order between two transparent
 * objects is whichever happens to be further from the eye this frame. The tether's free span passes
 * in front of one world and behind another in the same frame, and an atmosphere shell is a big
 * sphere whose centroid is nearer than the ribbon's for half a turn — so the pair swaps over as the
 * camera orbits, and the tether disappears into the air shell and comes back with nothing in the
 * scene having changed. An explicit `renderOrder` takes the decision away from the camera, which is
 * what §1.2's last clause asks for in terms.
 *
 * Numbers rather than an enum so that a step which later needs a sub-order has room, and spaced by
 * ten so inserting one does not renumber the rest.
 */

/** Step 2 — the system icospheres. Opaque; the value is inert but kept so the list is complete. */
export const RENDER_ORDER_SYSTEM = 20

/** Step 3 — the belt. Opaque. */
export const RENDER_ORDER_BELT = 30

/** Step 4 — the cell sheets. Opaque. */
export const RENDER_ORDER_SHEET = 40

/** Step 5 — §1.9's ribbon and its two anchor pads. Transparent. */
export const RENDER_ORDER_TETHER = 50

/** Step 8 — the atmosphere shells. Transparent, and **after** the tether by §1.2's own reasoning. */
export const RENDER_ORDER_ATMOSPHERE = 80
