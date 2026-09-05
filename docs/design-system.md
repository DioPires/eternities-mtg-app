# The design system, and the accessibility checklist

Phase 5 of `implementation-plan.md`. Companion to `docs/app-shell.md`, which describes the
structure this puts a surface on.

Two files hold the whole system:

- `web/src/tokens.css` — every colour, size, radius, shadow and duration in the product, named
  once. Nothing else declares a value.
- `web/src/styles.css` — the rules, which may only reference tokens. A literal colour or duration
  in that file fails `test/design.test.ts`.

## 1. The idea

The UI is instrument glass over a void. The canvas is the product; the HTML is a thin, cold layer
of readouts floating on it. Three consequences, and everything else follows from them:

1. **Nothing is a box on a background.** Surfaces are translucent and hug their content, so the
   starfield stays the largest thing on screen.
2. **Three surfaces, three elevations, one accent.** HUD chrome is glass; the drawer is denser
   glass because it is read rather than glanced at; modal sheets are solid, because a modal has
   already taken the scene away.
3. **The accent is a state, never a decoration.** `--accent` means exactly one thing: *this is the
   thing you selected, or the thing your keyboard is on.* It is never used to make something look
   nice, which is what keeps it readable as a signal.

### Surfaces

| Token | Alpha | Used for |
| --- | --- | --- |
| `--surface-glass` | 88% | HUD chrome: breadcrumb rail, chips, control cluster, loading line |
| `--surface-panel` | 94% | the drawer and the first-visit hint — surfaces with paragraphs on them |
| `--surface-sheet` | solid | modal sheets: search, plane index, filters, settings, help, about |

The alphas are **load-bearing, not decorative**. See §3.

### Type

One family: Inter, self-hosted, variable weight, SIL OFL 1.1 (`web/src/fonts/Inter-OFL.txt`). Two
`unicode-range` subsets — `latin` (48 KB) and `latin-ext` (85 KB). In practice only the first is
ever fetched: the shipped dataset's names live entirely inside `latin` plus U+2013, which the
browser confirms by never requesting the second file (`verify-browser.mjs` reports
`1 face(s)`).

Five sizes on a 1.2 ratio from `0.6875rem`, three weights, one eyebrow treatment (uppercase,
tracked, `--ink-muted`) shared by every section label in the product. Anything that is a column of
numbers — counts, years, rarities — gets tabular figures.

### Space, shape, motion

A 4px grid (`--space-1` … `--space-6`), four radii, three durations on one easing curve. The
durations exist as tokens so the reduced-motion block can collapse all of them at once (§5).

## 2. What is a requirement, not taste

These survive any future redesign, and each is commented at its site:

- `.hud { pointer-events: none }` with opt-in on controls — PRD 6.3, the HUD never occludes the
  focused object;
- the `touch-action` and `overscroll-behavior` rules — PRD 6.1.5, touch must not break the page;
- the `prefers-reduced-motion` block — PRD 5.9, 7.5.1;
- the `:focus-visible` sandwich and its `forced-colors` fallback — PRD 7.5.2;
- `will-change: transform` and `position: absolute` on `.label` — PRD 7.3.3.

## 3. Contrast, and why the worst case is white

PRD 7.5.4 asks for 4.5:1 "against the sky". Against `--sky` alone every token passes with room to
spare, and that would be a comfortable thing to report and a misleading one.

The panels are **translucent and float over a starfield**. The real backdrop under the drawer is
the sky only in the quiet case. A bloomed star core passing under it is close to white, and PRD
risk 7 — "bloom versus legibility" — is precisely the observation that this happens.

So every pairing is tuned and asserted against the **worst-case composite**: the surface
alpha-blended over pure white.

| Surface | Composite over white | Effect |
| --- | --- | --- |
| `--surface-glass` (88%) | `rgb(37 39 46)` | HUD chrome |
| `--surface-panel` (94%) | `rgb(22 25 32)` | the drawer |

Against those, with every hover and selection fill stacked on top:

| Token | Worst ratio | Where the worst case is | Role |
| --- | --- | --- | --- |
| `--ink` | 10.28:1 | `.crumb:hover` on the rail | body copy, titles, selected rows |
| `--ink-muted` | 6.44:1 | row meta on hover, in the drawer | meta, eyebrows, resting controls |
| `--accent` | 5.34:1 | `.chip-add-active` | selection and focus |
| `--danger` | 8.16:1 | `.toast-error` | the error toast |
| `--ink-faint` | 3.97:1 | on glass | **non-text only** — separators, the scrollbar thumb |

Each figure is the **minimum over every pairing `test/design.test.ts` enumerates** for that token.
That is the only definition under which the table and the test cannot disagree: move a token and
the worst case may move to a different row of `TEXT_PAIRS`, so this column is re-derived from that
list rather than kept by hand. Four of the five were stale until DEC-632 caught them — pre-lift
figures that were never re-derived after the tokens changed, all four understating real headroom.

`--ink-faint` is deliberately below the text floor. It clears WCAG 1.4.11's 3:1 for non-text
against its own surface and is allowed exactly one glyph: the breadcrumb's `›`, which is
`aria-hidden` decoration between two labelled crumbs. `test/design.test.ts` enumerates that
exemption and re-checks the `aria-hidden` in the markup, so it cannot quietly stop being true.

**Lowering a surface alpha lowers the composite's contrast and fails the test.** That is the
intended coupling: the glass look and the legibility guarantee are the same number.

Two defects fixed by this pass, both pre-existing:

1. `--muted` `#8b93ab` on the old 82% panel measured **3.94:1** over a bright star — a real
   failure of 7.5.4 wherever a panel crossed a bloomed core. Fixed by lifting the token to
   `#a6afc6` and taking the drawer to 94%.
2. A **selected** set or printing row left its year and rarity muted on top of the accent wash:
   **2.87:1**, on the drawer's panel. Selection is a state that adds emphasis; it was quietly
   subtracting legibility from half the row. Selected rows now promote every span to `--ink`,
   which takes the pairing to 11.34:1 on the panel and 12.67:1 on a sheet.

   This figure was first recorded as 4.25:1, which is wrong in the direction that matters: the
   defect was **worse** than the record claimed, not better. Sweeping every text ink against
   every surface, fill and base in both the old and the new token set — 336 pairings — produces
   no 4.25 at all, and the two nearest (4.29 and 4.19) each mix an old value with a new one, so
   4.25 looks like a figure derived mid-edit. The 2.87 is old `--muted` `#8b93ab` on the old 82%
   panel under the old `rgb(143 183 255 / 16%)` wash, composited over white — 2.8747 exactly.

The breadcrumb changed shape for the same reason. It was bare text directly on the canvas, where
the ratio is a property of *where the camera happens to be* rather than of the design — a bloomed
core under the word "Multiverse" takes it to roughly 1:1 for as long as it is there. It is now a
glass rail, on the same surface as the control cluster, which fixes the backdrop.

### The focus ring

A single accent ring is **1.99:1 against a white star**, and the HUD floats over exactly that. So
`--focus-ring` is a three-band sandwich: `--sky`, `--accent`, `--sky`. One of the two edges always
has contrast — dark-on-white is 20:1, accent-on-dark is 10:1 — whatever is behind the control.

The transparent `outline` declared alongside it is not decoration. In forced-colors mode the
box-shadow is dropped and the outline is repainted in a system colour, so keeping it declared is
what preserves the indicator there.

## 4. Keyboard operability

PRD 7.5.2 asks for "fully keyboard-operable with visible focus states". Phase 4 shipped the right
*markup* — `role="dialog"`, `aria-modal="true"`, an accessible name on every overlay — without the
behaviour that markup promises. `aria-modal="true"` tells a screen reader that everything outside
is inert; if Tab can still walk out into the HUD behind the scrim, the announcement and the
reality disagree, and a keyboard user tabs through controls their reader says do not exist.

`web/src/ui/dialog.ts` supplies the missing half to all six modal surfaces:

1. **focus moves in** on open — the first tabbable element, or a named one (`.search-input` for
   search, `.sheet-filter` for the plane index, because in both cases that is what the user came
   for and neither is first in the DOM);
2. **focus stays in** — Tab wraps at both ends, and a Tab from something inside the dialog that is
   not itself tabbable enters the order at an end;
3. **focus goes home** on close, to the control that opened it.

The pointer path holds too, but not because of the trap: clicking non-focusable content inside a
sheet drops `document.activeElement` to `<body>`, and a `keydown` there never reaches a listener
bound to the dialog. It holds because the click sets the spec's *sequential focus navigation
starting point* inside the dialog, so the browser's own Tab stays there — and from the next Tab
onwards focus is on a real element and the trap takes over. Verified by hand on three sheets
during the DEC-632 review.

Esc is deliberately not in that file. `useKeyboardMap` owns it for the whole app so PRD 6.11's
close ordering — overlay, then hint, then camera — has a single producer.

Two shapes are covered. A sheet has many tabbable children and Tab cycles them. The search box has
exactly one — the input, with `aria-activedescendant` rows that are not themselves tabbable — so
Tab has nowhere to go, and "nowhere to go" must mean *stay*, not *leave*.

The About view's footer goes **back to help** rather than straight out, because help is its only
entrance and it takes focus on mount; closing outright would drop a keyboard user on `<body>` with
the whole HUD to tab through.

## 5. Reduced motion

Two halves, and both are needed:

- the three duration tokens collapse to `0ms`, which stops everything that reads them;
- the blanket `!important` rule catches anything that does not — including a future dependency's
  stylesheet.

`test/design.test.ts` asserts that **no duration literal exists outside that block**, so the token
override is not merely a nicety backed up by the blanket rule; it genuinely reaches every
transition in the file.

The scene's own motion is not CSS and is not here: `useReducedMotion` stops rotation, drift,
twinkle, fly-to easing and attract mode in the renderer, because a shader does not read a media
query. `verify-browser.mjs` drives both halves under an emulated
`prefers-reduced-motion: reduce`.

## 6. The accessibility checklist

The exit criterion is "accessibility checklist green". A checklist a person ticks is green until
the next commit, so this one is executable. Every row below is a test that runs in CI or a real
browser.

| # | PRD | Claim | Checked by |
| --- | --- | --- | --- |
| 1 | 7.5.4 | Every text/surface pairing reaches 4.5:1 against a **bloomed-star** backdrop | `test/design.test.ts`, 33 enumerated pairs |
| 2 | 7.5.4 | …and against the sky, the reading the PRD's wording gives | `test/design.test.ts` |
| 3 | 7.5.4 | The stylesheet actually paints with those tokens | `verify-browser.mjs` — computed colours compared back to the tokens |
| 4 | 1.4.11 | Controls with no fill have a 3:1 boundary | `test/design.test.ts` |
| 5 | 7.5.2 | Focus is visible on any backdrop, including a white star | `test/design.test.ts` + `verify-browser.mjs` reads the computed ring |
| 6 | 7.5.2 | A modal opens focused, on the right element | `verify-browser.mjs` |
| 7 | 7.5.2 | Tab cannot leave a modal — 40 presses, drawer rows live behind the scrim | `verify-browser.mjs` |
| 8 | 7.5.2 | Closing hands focus back to the control that opened it | `verify-browser.mjs` |
| 9 | 7.5.2 | The search combobox holds focus on its input | `verify-browser.mjs` |
| 10 | 7.5.2 | Tab order arithmetic, including focus-outside and single-element cases | `test/dialog.test.ts` |
| 11 | 7.5.3 | Colour identity and rarity are text in the card panel | `verify-browser.mjs` (Phase 4's walk, step 5) |
| 12 | 7.5.1, 5.9 | Duration tokens collapse and nothing transitions | `verify-browser.mjs` under emulated reduced motion |
| 13 | 7.5.1, 5.9 | Every duration is a token, so the override reaches all of them | `test/design.test.ts` |
| 14 | 5.9 | Scene motion stops | `verify-browser.mjs`, Phase 2a self-check readout |
| 15 | 7.6.1 | Fonts are self-hosted, same-origin, and in use | `verify-browser.mjs` |
| 16 | 7.6.1 | No third-party origin in any `@font-face` | `test/design.test.ts` |
| 17 | 4.11 | The Fan Content notice appears verbatim, all five clauses | `test/design.test.ts` + `verify-browser.mjs` |
| 18 | 4.11 | Scryfall credited for data and images | `verify-browser.mjs` |
| 19 | 7.6.2 | Every external link is `rel="noopener noreferrer"` | `test/design.test.ts` + `verify-browser.mjs` |
| 20 | 7.6.1 | The page does not violate its own CSP | `verify-browser.mjs`, `securitypolicyviolation` listener |

### What is not claimed

- **No screen reader was driven.** The markup is correct and the focus model is verified, but
  nobody ran VoiceOver or NVDA against this build. That is a Phase 6 cross-browser-pass item.
- **Contrast is proved for the HTML layer only.** Text drawn *inside* the canvas — none today; the
  card tier of Phase 3 may add some — is outside this proof.
- **`forced-colors` (Windows High Contrast) is handled but untested**: the fallback outline is
  declared, and no Windows machine was available to confirm it renders. Phase 6 owns the Windows
  combination.
- **Touch is out of scope by PRD 6.1.5** — checked only for not breaking the page.

## 7. The visual review

PRD 9.3's seven checkpoints and the owner's acceptance of the look are Phase 6's gate, run against
the integrated scene. Phase 5's exit criterion is the checklist above plus the owner accepting
the UI; the checkpoints are not re-run here because Phase 3 has not yet folded the two harness
scenes into the shell, so four of the seven (card-sheet tier, card focus, a flipped double-faced
card, attract mode) cannot be photographed yet.
