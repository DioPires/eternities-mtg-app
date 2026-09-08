/**
 * Concept B's surface law: **latitude is colour, longitude is time** (review §4.2).
 *
 * The review's sketch says "five bands, gold as an equatorial belt, colourless as ice caps". Five
 * bands plus a belt plus two caps does not fit one hemisphere, so this lays the bands out
 * *mirrored* about the equator: each mono colour is a matched pair of bands, gold is the single
 * belt straddling the equator, and colourless is split between the two caps. That makes the
 * review's three named readings literally true — Alara wears a golden belt, New Phyrexia has ice
 * caps — and it makes a world symmetric, which is what stops the mosaic reading as a bar chart
 * wrapped round a ball.
 *
 * Bands are **equal-area**, not equal-angle: a band's share of `sin(latitude)` is its share of the
 * plane's cards, so the area a colour covers is the fraction of the plane that colour is. Longitude
 * is sliced **per plane**, not globally, so a single-set plane is one slice covering all 360° and
 * looks complete rather than looking 97% missing.
 *
 * Cells are a fixed size on a given world (`√N` radius, so every card owns the same area) and the
 * grid is the standard equal-area sphere tiling: rows of constant latitude height, each row
 * holding as many cells as its circumference allows. Cell aspect is 4:3 because that is what an
 * `art_crop` letterboxes into (review §4.2), so a cell showing art never stretches it — Scryfall's
 * terms forbid that, and review §4.4 flags the current planet shader for exactly this.
 */

import type { WorldCard } from './data'
import { Band, BAND_COUNT } from './data'

/** Width : height of a cell, and of the art layer a cell samples. */
export const CELL_ASPECT = 4 / 3

/** North-to-south band order. `Band.Gold` appears once; every other band is a mirrored pair. */
const BAND_ORDER: readonly Band[] = [
  Band.Colourless,
  Band.Green,
  Band.Red,
  Band.Black,
  Band.Blue,
  Band.White,
  Band.Gold,
  Band.White,
  Band.Blue,
  Band.Black,
  Band.Red,
  Band.Green,
  Band.Colourless,
]

export interface Slot {
  /** Unit-sphere position. */
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** Unit east tangent; the cell's local +x. */
  readonly ex: number
  readonly ez: number
  /** Half-extents in units of world radius. */
  readonly halfW: number
  readonly halfH: number
  readonly band: Band
  readonly setIndex: number
  readonly lambda: number
}

export interface SurfaceLayout {
  readonly slots: readonly Slot[]
  /** Parallel to `slots`; `-1` where no card landed on the slot. */
  readonly cardOfSlot: Int32Array
  readonly rows: number
  readonly stats: {
    readonly cards: number
    readonly slots: number
    /** Placed on a slot whose colour *and* set both match. */
    readonly exact: number
    /** Placed on a slot whose colour matches but whose set does not. */
    readonly bandOnly: number
    /** Placed wherever a slot was free. */
    readonly displaced: number
    /** Slots no card landed on — bare ground. */
    readonly bare: number
  }
}

/** Cumulative `sin(latitude)` boundaries, north pole (+1) to south pole (-1). */
function bandBounds(counts: readonly number[], total: number): Float64Array {
  const weights = BAND_ORDER.map((band) => {
    const share = (counts[band] ?? 0) / Math.max(1, total)
    return band === Band.Gold ? share : share / 2
  })
  const sum = weights.reduce((a, b) => a + b, 0)
  const bounds = new Float64Array(BAND_ORDER.length + 1)
  bounds[0] = 1
  let cumulative = 0
  for (let i = 0; i < weights.length; i += 1) {
    cumulative += (weights[i] ?? 0) / (sum > 0 ? sum : 1)
    bounds[i + 1] = 1 - 2 * cumulative
  }
  bounds[BAND_ORDER.length] = -1
  return bounds
}

function bandAt(bounds: Float64Array, sinPhi: number): Band {
  for (let i = 0; i < BAND_ORDER.length; i += 1) {
    if (sinPhi <= bounds[i]! && sinPhi >= bounds[i + 1]!) return BAND_ORDER[i]!
  }
  return sinPhi > 0 ? Band.Colourless : Band.Colourless
}

/** Cumulative longitude fractions per set index, so a set's slice is its share of the plane. */
function setBounds(setCounts: readonly number[], total: number): Float64Array {
  const bounds = new Float64Array(setCounts.length + 1)
  let cumulative = 0
  for (let i = 0; i < setCounts.length; i += 1) {
    cumulative += (setCounts[i] ?? 0) / Math.max(1, total)
    bounds[i + 1] = cumulative
  }
  bounds[setCounts.length] = 1
  return bounds
}

function setAt(bounds: Float64Array, fraction: number): number {
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    if (fraction >= bounds[i]! && fraction < bounds[i + 1]!) return i
  }
  return Math.max(0, bounds.length - 2)
}

/** Centre longitude of a set's slice, in radians — the target a displaced card aims at. */
function setCentre(bounds: Float64Array, setIndex: number): number {
  const lo = bounds[setIndex] ?? 0
  const hi = bounds[setIndex + 1] ?? 1
  return ((lo + hi) / 2) * Math.PI * 2
}

export function buildSurface(cards: readonly WorldCard[], setCounts: readonly number[]): SurfaceLayout {
  const n = Math.max(1, cards.length)

  const bandCounts = new Array<number>(BAND_COUNT).fill(0)
  for (const card of cards) bandCounts[card.band] = (bandCounts[card.band] ?? 0) + 1
  const bounds = bandBounds(bandCounts, cards.length)
  const setSlices = setBounds(setCounts, cards.length)

  // Equal-area tiling: one cell covers 4π/n of the unit sphere, and is CELL_ASPECT wide.
  const rowHeightGuess = Math.sqrt((4 * Math.PI) / (CELL_ASPECT * n))
  const rows = Math.max(3, Math.round(Math.PI / rowHeightGuess))
  const dPhi = Math.PI / rows

  const slots: Slot[] = []
  for (let r = 0; r < rows; r += 1) {
    const phi = Math.PI / 2 - (r + 0.5) * dPhi
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    const perRow = Math.max(1, Math.round((2 * Math.PI * cosPhi) / (CELL_ASPECT * dPhi)))
    // Stagger alternate rows so the tiling reads as masonry rather than as a lat/long graticule.
    const offset = (r % 2) * 0.5
    const band = bandAt(bounds, sinPhi)
    for (let j = 0; j < perRow; j += 1) {
      const lambda = ((j + 0.5 + offset) / perRow) * Math.PI * 2
      slots.push({
        nx: cosPhi * Math.cos(lambda),
        ny: sinPhi,
        nz: cosPhi * Math.sin(lambda),
        ex: -Math.sin(lambda),
        ez: Math.cos(lambda),
        halfW: (Math.PI * cosPhi) / perRow,
        halfH: dPhi / 2,
        band,
        setIndex: setAt(setSlices, lambda / (Math.PI * 2)),
        lambda,
      })
    }
  }

  // Buckets, then three passes: exact (colour and set), colour only, anywhere.
  const buckets = new Map<number, number[]>()
  cards.forEach((card, index) => {
    const key = card.band * 4096 + card.setIndex
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [index])
    else bucket.push(index)
  })

  const cardOfSlot = new Int32Array(slots.length).fill(-1)
  let exact = 0
  slots.forEach((slot, slotIndex) => {
    const bucket = buckets.get(slot.band * 4096 + slot.setIndex)
    const card = bucket?.pop()
    if (card !== undefined) {
      cardOfSlot[slotIndex] = card
      exact += 1
    }
  })

  const leftovers: number[] = []
  for (const bucket of buckets.values()) leftovers.push(...bucket)

  const emptyByBand = new Map<Band, number[]>()
  const emptyAnywhere: number[] = []
  slots.forEach((slot, slotIndex) => {
    if (cardOfSlot[slotIndex] !== -1) return
    const list = emptyByBand.get(slot.band)
    if (list === undefined) emptyByBand.set(slot.band, [slotIndex])
    else list.push(slotIndex)
  })
  // Both sides sorted by longitude, then zipped: a monotone matching, so a displaced card lands
  // as close to its own era as the free ground allows.
  for (const list of emptyByBand.values()) list.sort((a, b) => slots[a]!.lambda - slots[b]!.lambda)

  let bandOnly = 0
  const stillLeft: number[] = []
  const byBand = new Map<Band, number[]>()
  for (const card of leftovers) {
    const band = cards[card]!.band
    const list = byBand.get(band)
    if (list === undefined) byBand.set(band, [card])
    else list.push(card)
  }
  for (const [band, list] of byBand) {
    list.sort((a, b) => setCentre(setSlices, cards[a]!.setIndex) - setCentre(setSlices, cards[b]!.setIndex))
    const free = emptyByBand.get(band) ?? []
    let f = 0
    for (const card of list) {
      if (f < free.length) {
        cardOfSlot[free[f]!] = card
        f += 1
        bandOnly += 1
      } else {
        stillLeft.push(card)
      }
    }
    free.splice(0, f)
  }

  for (const list of emptyByBand.values()) emptyAnywhere.push(...list)
  let displaced = 0
  for (let i = 0; i < stillLeft.length && i < emptyAnywhere.length; i += 1) {
    cardOfSlot[emptyAnywhere[i]!] = stillLeft[i]!
    displaced += 1
  }

  let bare = 0
  for (let i = 0; i < cardOfSlot.length; i += 1) if (cardOfSlot[i] === -1) bare += 1

  return {
    slots,
    cardOfSlot,
    rows,
    stats: {
      cards: cards.length,
      slots: slots.length,
      exact,
      bandOnly,
      displaced,
      bare,
    },
  }
}
