/**
 * PRD 4.11's About view.
 *
 *  1. "Eternities is free and non-commercial, as required by the Wizards of the Coast Fan Content
 *     Policy, and displays the policy's required notice in an About view."
 *  2. "Scryfall is credited as the data and image source in the same view."
 *  3. "Images are always loaded from Scryfall's URIs at the size the view needs, never mirrored or
 *     resized server-side" — stated here as well as implemented, because the credit is only
 *     meaningful if it says what is actually being used.
 *
 * The notice in `FAN_CONTENT_NOTICE` is Wizards' required wording and is quoted verbatim, with the
 * product name substituted where the policy asks for it. It is a constant rather than inline JSX
 * so that `test/design.test.ts` can assert the five clauses the policy requires are all present —
 * a paraphrase here is a licensing problem, not a copy edit.
 *
 * Reached from the help sheet rather than from a seventh control: PRD 6.3.3 lists exactly six
 * cluster controls and that list is closed. A user looking for the legal notice is already in the
 * "what is this thing" frame of mind that `?` puts them in.
 */

import type { ReactElement } from 'react'

import { useStore } from '../store/store'
import { useDialog } from './dialog'

/** Wizards of the Coast Fan Content Policy, required notice, verbatim. */
export const FAN_CONTENT_NOTICE =
  'Eternities is unofficial Fan Content permitted under the Wizards of the Coast Fan Content ' +
  'Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of ' +
  'Wizards of the Coast. ©Wizards of the Coast LLC.'

export function AboutOverlay(): ReactElement {
  const setOverlay = useStore((state) => state.setOverlay)
  const dialog = useDialog<HTMLDivElement>()

  return (
    <div
      className="overlay-scrim overlay-scrim-top"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOverlay(null)
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label="About" ref={dialog}>
        <header className="sheet-head">
          <h2>About Eternities</h2>
        </header>

        <div className="sheet-prose">
          <p>
            Every card in Magic: The Gathering, placed as a star on the plane it comes from. Card
            names, types, rarities and set history come from Scryfall; the arrangement of the
            planes is this project&rsquo;s own.
          </p>
        </div>

        <section className="facet">
          <h3>Data and images</h3>
          <div className="sheet-prose">
            <p>
              Card data and card images come from{' '}
              {/* PRD 7.6.2: external links carry rel="noopener noreferrer". */}
              <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
                Scryfall
              </a>
              . Images are loaded directly from Scryfall at the size each view needs. Nothing is
              mirrored, cached on a server, or resized by this site.
            </p>
            <p className="muted">
              Scryfall is not affiliated with this project and does not endorse it.
            </p>
          </div>
        </section>

        <section className="facet">
          <h3>Fan content</h3>
          <div className="sheet-prose">
            <p>
              Eternities is free and non-commercial. It carries no advertising, takes no payment,
              and collects nothing about you &mdash; there is no account, no server and no
              analytics.
            </p>
            <p>{FAN_CONTENT_NOTICE}</p>
            <p className="muted">
              <a
                href="https://company.wizards.com/en/legal/fancontentpolicy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Wizards of the Coast Fan Content Policy
              </a>
            </p>
          </div>
        </section>

        <footer className="sheet-foot">
          {/*
            Back to help rather than straight out. The help sheet is the only way in, and it takes
            focus on mount — so a keyboard user leaving this view lands somewhere, instead of on
            `<body>` with the whole HUD to tab through. Esc still closes everything, via
            `useKeyboardMap`.
          */}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setOverlay('help')
            }}
          >
            Back to help
          </button>
        </footer>
      </div>
    </div>
  )
}
