/**
 * Scryfall URI derivation. The Python twin is `pipeline/src/eternities/contract/images.py`.
 *
 * Verified against live Scryfall responses in Phase 0; see `docs/scryfall-policy.md`.
 * PRD 4.11.3 still holds: the browser loads Scryfall's own URIs at the size the view needs,
 * never a mirror and never a server-side resize.
 *
 * Every fetch of these must set `crossOrigin`/`mode: 'cors'` so the texture upload is never
 * tainted. `cards.scryfall.io` sends `access-control-allow-origin: *`, verified in Phase 0.
 */

import type { CardLayout, CardRecord, PrintingTuple } from './types'

export type ImageSize = 'small' | 'normal' | 'large' | 'art_crop' | 'border_crop'
export type CardFaceSide = 'front' | 'back'

export const IMAGE_ORIGIN = 'https://cards.scryfall.io'
export const BACKS_ORIGIN = 'https://backs.scryfall.io'
export const PAGE_ORIGIN = 'https://scryfall.com'

/** The Scryfall-provided card back of PRD 5.6.2. */
export const CARD_BACK_URI = `${BACKS_ORIGIN}/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg`

export function imageUri(
  printingId: string,
  imageTs: number,
  size: ImageSize,
  face: CardFaceSide = 'front',
): string {
  if (printingId.length < 2) throw new Error(`printing id ${printingId} is too short`)
  return `${IMAGE_ORIGIN}/${size}/${face}/${printingId[0]}/${printingId[1]}/${printingId}.jpg?${imageTs}`
}

/**
 * Scryfall page for a printing (PRD 6.4's "Open on Scryfall").
 *
 * Both halves are percent-encoded: Scryfall collector numbers carry `★` and `†` (`266★`), which a
 * browser papers over inside an `href` but which breaks the moment the string is fetched or
 * re-templated.
 */
export function pageUri(setCode: string, collectorNumber: string): string {
  return `${PAGE_ORIGIN}/card/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}`
}

export function printingImageUri(
  printing: PrintingTuple,
  size: ImageSize,
  face: CardFaceSide = 'front',
): string {
  return imageUri(printing[0], printing[3], size, face)
}

export function printingPageUri(printing: PrintingTuple, setCode: string): string {
  return pageUri(setCode, printing[4])
}

/**
 * The layouts whose printings have a `.../back/<id>.jpg` image.
 *
 * Two faces is **not** the same thing as a back image. Split, adventure and flip cards have two
 * faces — PRD line 156 needs the per-face oracle text, and a split card's text exists *only* inside
 * Scryfall's `card_faces` — but they are printed on one physical side, carry no per-face
 * `image_uris`, and their derived back URI 404s. `CardRecord.b` therefore answers "is there a
 * second face"; this answers "is there a second image". Verified against live Scryfall in Phase 0
 * (`docs/scryfall-policy.md`). The Python twin is `BACK_IMAGE_LAYOUTS` in `images.py`.
 */
export const BACK_IMAGE_LAYOUTS: ReadonlySet<CardLayout> = new Set<CardLayout>([
  'transform',
  'modal_dfc',
  'double_faced_token',
  'reversible_card',
  'art_series',
])

/** Whether a printing of this layout has a back image (PRD 4.2.2, 5.6.2). */
export function hasBackImage(layout: CardLayout): boolean {
  return BACK_IMAGE_LAYOUTS.has(layout)
}

/**
 * The back image of a card as printed, or `null` when it has none. Use this rather than
 * `printingImageUri(p, size, 'back')`, which cannot know whether a back exists.
 *
 * Two sources, because there are two kinds of back:
 *
 * - A **meld** result (PRD line 125) is its own Scryfall card with its own `id` and its own
 *   `image_uris`, and no `card_faces`. Its image is a *front*, keyed by `b.id`/`b.ts`.
 * - A **transform**-family printing has a genuine back image under the same printing id.
 *
 * Everything else — split, adventure, flip, and every single-faced layout — returns `null`.
 */
export function cardBackImageUri(
  card: Pick<CardRecord, 'l' | 'b'>,
  printing: PrintingTuple,
  size: ImageSize,
): string | null {
  const back = card.b
  if (back?.id !== undefined && back.ts !== undefined) {
    return imageUri(back.id, back.ts, size, 'front')
  }
  if (hasBackImage(card.l)) return imageUri(printing[0], printing[3], size, 'back')
  return null
}
