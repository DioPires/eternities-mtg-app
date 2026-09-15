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

/**
 * The two slots of a {@link PrintingTuple} that address its image: the printing id, and the
 * `imageTs` every image URI is cache-busted by.
 *
 * **This exists so those slot numbers are written once (DEC-777 N5).** `PrintingTuple` is
 * `[id, setId, rarity, imageTs, collector, artist?]`, and **indices 0, 2 and 4 are all `string`** —
 * so `printing[2]` (rarity) or `printing[4]` (collector number) where `printing[0]` was meant is a
 * silent swap `tsc` cannot see, surfacing only as a 404 on a URL nothing asserts. Index 3 is the
 * one that is `number`-typed, and therefore the one slot mistake the compiler does catch.
 *
 * Callers that want a URL should use {@link printingImageUri}. This is for the ones that have to
 * carry the pair itself: the worlds art stream (§1.6) keys its queue on the printing id and builds
 * the URL later, so it cannot take a finished string.
 */
export function printingImageKey(printing: PrintingTuple): {
  readonly printingId: string
  readonly imageTs: number
} {
  return { printingId: printing[0], imageTs: printing[3] }
}

export function printingImageUri(
  printing: PrintingTuple,
  size: ImageSize,
  face: CardFaceSide = 'front',
): string {
  const { printingId, imageTs } = printingImageKey(printing)
  return imageUri(printingId, imageTs, size, face)
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

/**
 * Whether a printing of this layout derives a back image from *its own printing id* (PRD 4.2.2,
 * 5.6.2).
 *
 * **Not the gate for rendering a back face.** That gate is `cardBackImageUri(...) !== null`. This
 * returns `false` for `meld`, whose back image exists but belongs to a different Scryfall object
 * (PRD line 125), so a card tier that gated on this would drop every meld back silently. The two
 * are not interchangeable; see `CardFaceRecord` in `./types`.
 */
export function hasBackImage(layout: CardLayout): boolean {
  return BACK_IMAGE_LAYOUTS.has(layout)
}

/**
 * The back image of a card as printed, or `null` when it has none. Use this rather than
 * `printingImageUri(p, size, 'back')`, which cannot know whether a back exists.
 *
 * **`cardBackImageUri(...) !== null` is the one correct gate on rendering a back face** —
 * `hasBackImage(card.l)` is not, because it misses meld (see below), and `card.b !== null` is not,
 * because split, adventure and flip cards have a second face and no second image.
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
