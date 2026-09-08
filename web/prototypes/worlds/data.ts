/**
 * Data loading for the concept B prototype (DEC-694 / review §4.2).
 *
 * Reads the *shipped* production artefacts — `planes.json` for the system and the per-plane shard
 * JSON for the two detailed worlds — so what the owner judges is the real card population, not a
 * mock. Nothing here is production code: the app's own loader (`src/data/load.ts`) streams,
 * budgets and retries, and none of that is reproduced.
 *
 * The one thing this file fakes is the swatch: the review's concept B needs a per-card colour
 * derived from the *art*, which today's contract does not carry (it has `hueClass`, not a pixel
 * statistic — `docs/data-contract.md:136-149`). So the swatch here is the hue-class colour plus
 * deterministic per-card noise, exactly the placeholder review §4.3 asks the prototype to use.
 */

import datasets from '../../datasets.json'
import { imageUri } from '../../src/data/images'
import type { PlaneRecord, PlaneShardFile, PlanesFile, PrintingTuple } from '../../src/data/types'

/** WUBRG letters in the order the colour identity string uses. */
const COLOUR_LETTERS = ['W', 'U', 'B', 'R', 'G'] as const

/**
 * The eight surface classes latitude is banded by. `Colourless` becomes the two ice caps and
 * `Gold` the equatorial belt; see `layout.ts` for how the order becomes latitudes.
 */
export const Band = { White: 0, Blue: 1, Black: 2, Red: 3, Green: 4, Gold: 5, Colourless: 6 } as const
export type Band = (typeof Band)[keyof typeof Band]

export const BAND_COUNT = 7

/**
 * Hue colours, copied from `src/scene/tuning.ts:HUE_COLOURS` rather than imported: that module
 * pulls in the whole scene's tuning graph, and a prototype should not make the production tuning
 * a dependency of a throwaway route. Linear-space RGB, indexed by {@link Band}.
 */
export const BAND_COLOURS: readonly (readonly [number, number, number])[] = [
  [1.0, 0.949, 0.827],
  [0.322, 0.639, 1.0],
  [0.616, 0.412, 0.949],
  [1.0, 0.451, 0.239],
  [0.322, 0.831, 0.494],
  [1.0, 0.812, 0.361],
  [0.812, 0.855, 0.898],
]

export interface WorldCard {
  readonly name: string
  readonly band: Band
  /** Index into the plane's `sets` array — the chronology band of PRD 5.4.2, used as longitude. */
  readonly setIndex: number
  /** Swatch colour, linear RGB. Faked; see the module comment. */
  readonly swatch: readonly [number, number, number]
  /** The printing whose `art_crop` the near view streams. */
  readonly printing: PrintingTuple
  readonly setCode: string
  readonly year: number
}

export interface WorldData {
  readonly plane: PlaneRecord
  readonly cards: readonly WorldCard[]
  /** Card count per `sets` index, derived from the cards themselves rather than trusted. */
  readonly setCounts: readonly number[]
}

export function dataBase(): string {
  const requested = new URLSearchParams(location.search).get('dataset')
  const hash = requested ?? datasets.production
  return `/data/${hash}/`
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { mode: 'same-origin' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function loadPlanes(): Promise<PlanesFile> {
  return fetchJson<PlanesFile>(`${dataBase()}planes.json`)
}

/** A cheap deterministic hash, so the faked swatch noise is stable across reloads and captures. */
function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function bandOf(ci: string): Band {
  if (ci.length === 0) return Band.Colourless
  if (ci.length > 1) return Band.Gold
  const index = COLOUR_LETTERS.indexOf(ci as (typeof COLOUR_LETTERS)[number])
  return index >= 0 ? (index as Band) : Band.Colourless
}

/**
 * How far a swatch is pulled towards its own luminance. A raw colour-pie hue is far more saturated
 * than any painting is, so a mosaic of raw hues reads as a beach ball; real per-card art swatches
 * would sit around here. This is the single most load-bearing fake in the prototype — see the
 * honest-fakes note in `prototypes/README.md`.
 */
const SWATCH_DESATURATION = 0.45

/**
 * The swatch stand-in: the band's hue, desaturated, then nudged per card.
 *
 * Three independent nudges, because one is not enough to read as terrain — a value shift (so the
 * mosaic has light and dark tiles, which is what makes a globe look like ground from far away), a
 * small hue rotation towards a neighbouring band, and a saturation shift. All three are seeded
 * from the oracle id, so a given card is always the same colour.
 */
function fakeSwatch(band: Band, oracleId: string): [number, number, number] {
  const base = BAND_COLOURS[band]!
  const luminance = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722
  const h = hash32(oracleId)
  const value = 0.42 + ((h & 0xff) / 255) * 0.72
  const tint = (((h >>> 8) & 0xff) / 255 - 0.5) * 0.16
  const grey = SWATCH_DESATURATION * (0.72 + (((h >>> 16) & 0xff) / 255) * 0.5)
  const mix = (channel: number, shift: number): number =>
    Math.max(0, (channel * (1 - grey) + luminance * grey) * value + shift)
  return [mix(base[0], tint), mix(base[1], 0), mix(base[2], -tint)]
}

/**
 * Which of the plane's own sets a card belongs to.
 *
 * The star record does not carry a set index — the chronology band is baked into the star's radius
 * (`docs/data-contract.md`), not stored — so this recovers it the way the pipeline decided it:
 * the earliest of the plane's sets that the card was actually printed in. Cards whose printings do
 * not intersect the plane's set list at all (a card assigned to a plane by its story rather than
 * its printing) fall back to the plane's first set.
 */
function setIndexOf(card: { readonly p: readonly PrintingTuple[] }, setOrder: Map<number, number>): number {
  let best = -1
  for (const printing of card.p) {
    const index = setOrder.get(printing[1])
    if (index !== undefined && (best < 0 || index < best)) best = index
  }
  return best < 0 ? 0 : best
}

/** The printing to stream art from: the one from the card's own plane-set, else the earliest. */
function artPrinting(
  card: { readonly p: readonly PrintingTuple[] },
  setId: number,
): PrintingTuple | null {
  for (const printing of card.p) if (printing[1] === setId) return printing
  return card.p[0] ?? null
}

export async function loadWorld(plane: PlaneRecord): Promise<WorldData> {
  const base = dataBase()
  const shards = await Promise.all(
    Array.from({ length: plane.shardCount }, (_unused, shard) =>
      fetchJson<PlaneShardFile>(`${base}planes/${plane.slug}.${shard}.json`),
    ),
  )

  const setOrder = new Map<number, number>()
  plane.sets.forEach((set, index) => setOrder.set(set.id, index))

  const cards: WorldCard[] = []
  const setCounts = new Array<number>(Math.max(1, plane.sets.length)).fill(0)

  for (const shard of shards) {
    for (const card of shard.cards) {
      const setIndex = setIndexOf(card, setOrder)
      const set = plane.sets[setIndex]
      const printing = artPrinting(card, set?.id ?? -1)
      if (printing === null) continue
      const band = bandOf(card.ci)
      cards.push({
        name: card.n,
        band,
        setIndex,
        swatch: fakeSwatch(band, card.u),
        printing,
        setCode: set?.code ?? '??',
        year: set?.year ?? 0,
      })
      setCounts[setIndex] = (setCounts[setIndex] ?? 0) + 1
    }
  }

  return { plane, cards, setCounts }
}

export function artUri(card: WorldCard): string {
  return imageUri(card.printing[0], card.printing[3], 'art_crop')
}

/**
 * How hard a plane's palette is pushed away from the multiverse mean before it becomes a colour.
 *
 * Review §4.1's finding is that Magic's colour pie is *balanced*: every plane over 500 cards has
 * near-uniform WUBRG weights, which is why the shipped renderer's colour-skew arm law is inert.
 * Mixed straight, that makes all 27 undetailed worlds the same grey — technically honest and
 * useless, because it hides the planes that genuinely are skewed (Alara 58% gold, Ravnica 39%).
 * So the mix runs on the *deviation* from the card-weighted mean palette, amplified: a plane at
 * the average is grey, and a plane that is unusual is unusual in the direction it is unusual in.
 * A contrast stretch, and stated as one.
 */
const PALETTE_GAIN = 3.2

/** The card-weighted mean of every plane's palette — the grey point of the stretch above. */
export function multiversePalette(planes: readonly PlaneRecord[]): number[] {
  const mean = new Array<number>(BAND_COUNT).fill(0)
  let cards = 0
  for (const plane of planes) {
    if (plane.cardCount === 0) continue
    cards += plane.cardCount
    for (let i = 0; i < BAND_COUNT; i += 1) {
      mean[i] = (mean[i] ?? 0) + (plane.palette[i] ?? 0) * plane.cardCount
    }
  }
  if (cards === 0) return mean.fill(1 / BAND_COUNT)
  return mean.map((value) => value / cards)
}

/**
 * A plane's overall colour, for the worlds this prototype does not load cards for.
 *
 * `planes.json` already carries the WUBRG-multi-colourless weights (`palette`), which is exactly
 * the colour statistic concept B wants at system distance — so the undetailed worlds get a real
 * number rather than a guess, and the system view is honest about which planes are gold-heavy.
 */
export function paletteColour(
  plane: PlaneRecord,
  reference?: readonly number[],
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  let total = 0
  for (let i = 0; i < BAND_COUNT; i += 1) {
    const raw = plane.palette[i] ?? 0
    const mean = reference?.[i]
    const weight =
      mean === undefined ? raw : Math.max(0, mean + (raw - mean) * PALETTE_GAIN)
    const colour = BAND_COLOURS[i]!
    out[0] += colour[0] * weight
    out[1] += colour[1] * weight
    out[2] += colour[2] * weight
    total += weight
  }
  if (total <= 0) return [0.25, 0.26, 0.3]
  return [out[0] / total, out[1] / total, out[2] / total]
}
