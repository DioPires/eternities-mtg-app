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

import type { PrintingTuple } from './types'

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

/** Scryfall page for a printing (PRD 6.4's "Open on Scryfall"). */
export function pageUri(setCode: string, collectorNumber: string): string {
  return `${PAGE_ORIGIN}/card/${setCode}/${collectorNumber}`
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
