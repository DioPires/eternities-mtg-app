/**
 * PRD 6.4's card panel.
 *
 *  1. Card name, mana cost, type line, oracle text (both faces for double-faced cards).
 *  2. Colour identity and rarity, as rendered in the star encoding, so the encoding is learnable.
 *  3. Printings list: set name, year, rarity, ordered as the planets are (5.6.7). The active
 *     printing is highlighted; clicking a row activates that printing and its planet.
 *  4. "Open on Scryfall" link to the active printing.
 *
 * Plus PRD 6.5.6's inline "clear filters", which belongs here because that is where the PRD puts
 * it: a search result can be a card the active filter dims, and the offer to clear is made in the
 * card panel rather than by refusing to focus it.
 *
 * PRD 7.5.3 is why (2) is text and not a swatch: "colour identity and rarity are shown as text in
 * panels, so the encoding never carries meaning alone".
 *
 * "Both faces" follows `CardRecord.b`, which the data contract is emphatic about: it means "there
 * is another face", not "there is a back image". Split and adventure cards have per-face oracle
 * text and one physical side, and this panel wants the text, so `b` is the right test *here* — the
 * image gate is `cardBackImageUri`, and that is Phase 3's problem, not this file's.
 */

import type { ReactElement } from 'react'

import { useFilters } from '../app/hooks'
import {
  HueClass,
  printingPageUri,
  type CardRecord,
  type PlaneRecord,
  type PrintingTuple,
} from '../data'
import { HUE_LABEL, RARITY_LABEL, RARITY_OF_CLASS, isFilterActive } from '../filters/types'
import { useStore } from '../store/store'

const RARITY_CHAR_LABEL: Readonly<Record<string, string>> = {
  c: 'Common',
  u: 'Uncommon',
  r: 'Rare',
  m: 'Mythic',
}

/**
 * PRD 5.4.8's seven hue classes, from the colour identity letters the shard carries.
 *
 * A second implementation of the pipeline's `hue_class_for`, because the shard hands this panel
 * the letters and not the packed byte. Exported so the shared test vector can pin the two
 * together: unasserted, a drift here mislabels a card's colour and nothing fails. The duplicate
 * goes when the exact-colour-filter leg moves this panel onto the record's own `colourIdentity`.
 */
export function hueClassOf(colourIdentity: string): HueClass {
  if (colourIdentity.length === 0) return HueClass.Colourless
  if (colourIdentity.length > 1) return HueClass.Multicolour
  return (
    { W: HueClass.White, U: HueClass.Blue, B: HueClass.Black, R: HueClass.Red, G: HueClass.Green }[
      colourIdentity
    ] ?? HueClass.Colourless
  )
}

function colourIdentityText(colourIdentity: string): string {
  const names: Readonly<Record<string, string>> = {
    W: 'White',
    U: 'Blue',
    B: 'Black',
    R: 'Red',
    G: 'Green',
  }
  if (colourIdentity.length === 0) return 'Colourless'
  return [...colourIdentity].map((letter) => names[letter] ?? letter).join(', ')
}

function Face({
  name,
  mana,
  type,
  oracle,
}: {
  readonly name: string
  readonly mana: string
  readonly type: string
  readonly oracle: string
}): ReactElement {
  return (
    <div className="card-face">
      <div className="card-face-head">
        <h3 className="card-face-name">{name}</h3>
        {mana ? <span className="card-mana">{mana}</span> : null}
      </div>
      <p className="card-type">{type}</p>
      {oracle
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line, index) => (
          <p key={`${index}-${line.slice(0, 12)}`} className="card-oracle">
            {line}
          </p>
        ))}
    </div>
  )
}

export interface CardPanelProps {
  readonly card: CardRecord
  readonly plane: PlaneRecord
  /** PRD 6.5.6: the card is in the results but dimmed by the active filter. */
  readonly dimmed: boolean
}

export function CardPanel({ card, plane, dimmed }: CardPanelProps): ReactElement {
  const setById = useStore((state) => state.setById)
  const activePrinting = useStore((state) => state.activePrinting)
  const setActivePrinting = useStore((state) => state.setActivePrinting)
  const { filters, clearAll } = useFilters()

  const printings = card.p
  const index = Math.min(activePrinting, Math.max(0, printings.length - 1))
  const active: PrintingTuple | undefined = printings[index]
  const activeSet = active ? setById.get(active[1]) : undefined
  // `planes.json` is the fallback roster for a set the search index has not delivered yet: the
  // focused plane's own set list covers every printing first-printed here, which is the common case.
  const planeSet = active ? plane.sets.find((set) => set.id === active[1]) : undefined
  const setCode = activeSet?.code ?? planeSet?.code ?? null

  return (
    <div className="panel-body">
      <Face name={card.n} mana={card.m} type={card.t} oracle={card.o} />
      {card.b ? <Face name={card.b.n} mana={card.b.m} type={card.b.t} oracle={card.b.o} /> : null}

      <dl className="card-encoding">
        <div>
          <dt>Colour identity</dt>
          <dd>
            {colourIdentityText(card.ci)}
            <span className="muted"> · renders {HUE_LABEL[hueClassOf(card.ci)] ?? 'Colourless'}</span>
          </dd>
        </div>
        <div>
          <dt>Rarity</dt>
          <dd>{RARITY_LABEL[RARITY_OF_CLASS[card.r] ?? 'common']}</dd>
        </div>
        <div>
          <dt>Plane</dt>
          <dd>{plane.displayName}</dd>
        </div>
      </dl>

      {dimmed && isFilterActive(filters) ? (
        <div className="card-dimmed" role="status">
          <p>This card is dimmed by the active filter.</p>
          <button type="button" className="link-button" onClick={clearAll}>
            Clear filters
          </button>
        </div>
      ) : null}

      <h3 className="panel-heading">
        Printings <span className="muted">({printings.length})</span>
      </h3>
      <ul className="printing-list">
        {printings.map((printing, at) => {
          const record = setById.get(printing[1]) ?? plane.sets.find((set) => set.id === printing[1])
          return (
            <li key={printing[0]}>
              <button
                type="button"
                className={at === index ? 'printing-row printing-row-active' : 'printing-row'}
                onClick={() => {
                  // PRD 6.2.2: activating a printing changes no route and pushes no history.
                  setActivePrinting(at)
                }}
                aria-current={at === index}
              >
                <span className="printing-set">{record?.name ?? `Set ${String(printing[1])}`}</span>
                <span className="printing-year">{record?.year ?? ''}</span>
                <span className="printing-rarity">{RARITY_CHAR_LABEL[printing[2]] ?? printing[2]}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {active && setCode !== null ? (
        <p className="panel-external">
          {/* PRD 7.6.2: external links carry rel="noopener noreferrer". */}
          <a
            href={printingPageUri(active, setCode)}
            target="_blank"
            rel="noopener noreferrer"
            className="link-button"
          >
            Open on Scryfall ↗
          </a>
        </p>
      ) : null}
    </div>
  )
}
