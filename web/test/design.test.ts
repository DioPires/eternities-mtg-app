/**
 * The accessibility checklist, as a test.
 *
 * PRD 7.5's exit criterion is "accessibility checklist green", and a checklist a person ticks is
 * green until the next commit. This file is the checklist: it reads `src/tokens.css` and
 * `src/styles.css` as data and re-derives the guarantees from them, so a token nudged one step
 * darker fails here rather than in a screen reader six months from now.
 *
 * What it proves, and what it cannot:
 *
 *  - **contrast** (PRD 7.5.4) is proved, pair by pair, against the *composite* backdrop each piece
 *    of text actually sits on — including the worst case where a bloomed star sits under a
 *    translucent panel. That is arithmetic on the shipped values, so it is real proof;
 *  - **encoding as text** (PRD 7.5.3) is proved by `verify-browser.mjs`, which reads the rendered
 *    card panel; this file only pins the labels the panel is built from;
 *  - **keyboard operability** (PRD 7.5.2) is `test/dialog.test.ts` for the ordering logic and
 *    `verify-browser.mjs` for the real focus behaviour in a real browser;
 *  - **reduced motion** (PRD 7.5.1, 5.9) has a CSS half asserted here and a renderer half that
 *    only a GPU can answer for, which `verify-browser.mjs` drives.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { FAN_CONTENT_NOTICE } from '../src/ui/AboutOverlay'
import { SKY_COLOUR } from '../src/scene/tuning'

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8')

const TOKENS = read('src/tokens.css')
const STYLES = read('src/styles.css')

// ---------------------------------------------------------------- colour maths

interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/** `#rrggbb`, `rgb(r g b)` and `rgb(r g b / p%)` — the three forms the token file uses. */
function parseColour(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:\/\s*([\d.]+)%\s*)?\)$/i.exec(
    value.trim(),
  )
  if (rgb === null) throw new Error(`cannot parse colour ${JSON.stringify(value)}`)
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
    a: rgb[4] === undefined ? 1 : Number(rgb[4]) / 100,
  }
}

/**
 * Source-over compositing, in sRGB space.
 *
 * sRGB and not linear light: CSS composites `background-color` in the sRGB space it was written
 * in, so blending in linear light here would compute a colour the browser never paints. The
 * gamma decode belongs in the luminance step below, and only there.
 */
function composite(front: Rgba, back: Rgba): Rgba {
  return {
    r: front.a * front.r + (1 - front.a) * back.r,
    g: front.a * front.g + (1 - front.a) * back.g,
    b: front.a * front.b + (1 - front.a) * back.b,
    a: 1,
  }
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

// ------------------------------------------------------------- token resolution

/** Every custom property declared in `:root`, with `var()` references resolved. */
function readTokens(css: string): ReadonlyMap<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)
  if (root === null) throw new Error('tokens.css has no :root block')
  const raw = new Map<string, string>()
  // Comments first, or a `--token:` inside prose would be read as a declaration.
  for (const line of (root[1] as string).replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(line)
    if (match) raw.set(match[1] as string, (match[2] as string).trim())
  }

  const resolving = new Set<string>()
  const resolve = (name: string): string => {
    const value = raw.get(name)
    if (value === undefined) throw new Error(`undefined token ${name}`)
    if (resolving.has(name)) throw new Error(`token cycle at ${name}`)
    resolving.add(name)
    const out = value.replace(/var\((--[\w-]+)\)/g, (_, ref: string) => resolve(ref))
    resolving.delete(name)
    return out
  }

  return new Map([...raw.keys()].map((name) => [name, resolve(name)]))
}

const tokens = readTokens(TOKENS)
const colour = (name: string): Rgba => parseColour(tokens.get(name) as string)

/**
 * A backdrop, as the browser builds it: a stack of surfaces composited over a base.
 *
 * The base is the argument that matters. `--sky` is the quiet case and the one PRD 7.5.4 names.
 * `WHITE` is the honest one: a bloomed star core under a translucent panel is close to white, and
 * PRD risk 7 is exactly the observation that bloom fights legibility. Everything below is held to
 * the white case, which is strictly harder than the contract asks for.
 */
function bed(base: Rgba, ...layers: string[]): Rgba {
  return layers.reduce<Rgba>((back, layer) => composite(colour(layer), back), base)
}

const SKY = colour('--sky')
const SHEET = colour('--surface-sheet')
/** HUD chrome — chips, the cluster, the breadcrumb rail — over the brightest possible star. */
const GLASS = bed(WHITE, '--surface-glass')
/** The drawer, which is denser glass because it is the one surface with paragraphs on it. */
const PANEL = bed(WHITE, '--surface-panel')

interface Pair {
  readonly what: string
  readonly ink: string
  readonly on: Rgba
}

/**
 * Every text-on-surface pairing the stylesheet actually produces.
 *
 * Enumerated rather than cross-producted: a cross-product would assert combinations that do not
 * exist and would have to be exempted one by one, which is how a contrast table stops meaning
 * anything. Each row names the rule it covers, so a new rule with a new pairing has to be added
 * here — and if it is not, the rule is outside the proof and that is the thing to catch in review.
 */
const TEXT_PAIRS: readonly Pair[] = [
  // Bare canvas: the plane and band labels of PRD 5.3.8-12, judged against the sky as 7.5.4 says.
  { what: '.label-name on the sky', ink: '--ink', on: SKY },
  { what: '.label-sub on the sky', ink: '--ink-muted', on: SKY },

  // HUD chrome, over a bloomed star.
  { what: '.crumb-current on the breadcrumb rail', ink: '--ink', on: GLASS },
  { what: '.crumb on the breadcrumb rail', ink: '--ink-muted', on: GLASS },
  { what: '.crumb:hover on the rail', ink: '--ink', on: bed(WHITE, '--surface-glass', '--fill-hover') },
  { what: '.hud-loading', ink: '--ink-muted', on: GLASS },
  { what: '.chip text', ink: '--ink', on: GLASS },
  { what: '.chip-facet / .chip-pending', ink: '--ink-muted', on: GLASS },
  { what: '.chip-add-active', ink: '--accent', on: bed(WHITE, '--surface-glass', '--fill-accent') },
  { what: '.control resting', ink: '--ink-muted', on: GLASS },
  { what: '.control:hover', ink: '--ink', on: bed(WHITE, '--surface-glass', '--fill-hover') },
  {
    what: '.control[aria-pressed] glyph',
    ink: '--accent',
    on: bed(WHITE, '--surface-glass', '--fill-accent'),
  },

  // The drawer.
  { what: '.panel-title / .card-oracle', ink: '--ink', on: PANEL },
  { what: '.panel-stat / .card-type / eyebrows', ink: '--ink-muted', on: PANEL },
  { what: 'row meta at rest', ink: '--ink-muted', on: PANEL },
  { what: 'row meta on hover', ink: '--ink-muted', on: bed(WHITE, '--surface-panel', '--fill-hover') },
  {
    what: 'a selected row promotes every span to --ink',
    ink: '--ink',
    on: bed(WHITE, '--surface-panel', '--fill-accent'),
  },
  { what: '.card-encoding dt', ink: '--ink-muted', on: bed(WHITE, '--surface-panel', '--fill-hover') },
  { what: '.card-encoding dd', ink: '--ink', on: bed(WHITE, '--surface-panel', '--fill-hover') },
  { what: '.hint-lead', ink: '--ink', on: PANEL },
  { what: '.hint body copy', ink: '--ink-muted', on: PANEL },

  // Modal sheets and toasts, which are opaque and therefore backdrop-independent.
  { what: 'sheet body copy', ink: '--ink', on: SHEET },
  { what: 'sheet eyebrows, .search-meta, placeholders', ink: '--ink-muted', on: SHEET },
  { what: 'sheet links', ink: '--accent', on: SHEET },
  { what: '.search-hit-active', ink: '--ink', on: bed(SHEET, '--fill-accent') },
  { what: '.facet-toggle resting', ink: '--ink-muted', on: SHEET },
  { what: '.facet-toggle-active', ink: '--ink', on: bed(SHEET, '--fill-accent') },
  { what: 'kbd', ink: '--ink', on: bed(SHEET, '--fill-hover') },
  { what: '.toast', ink: '--ink', on: SHEET },
  { what: '.toast-error', ink: '--danger', on: bed(SHEET, '--fill-danger') },

  // The WebGL2 fallback page has no canvas under it, so it is the sky and nothing else.
  { what: '.fallback body copy', ink: '--ink', on: SKY },
  { what: '.fallback .muted', ink: '--ink-muted', on: SKY },
]

describe('contrast (PRD 7.5.4)', () => {
  it.each(TEXT_PAIRS)('$what reaches 4.5:1', ({ ink, on }) => {
    expect(contrast(colour(ink), on)).toBeGreaterThanOrEqual(4.5)
  })

  it('holds against the sky as well as against a bloomed star', () => {
    // The PRD's own wording. Trivially true given the above, and asserted anyway so the weaker
    // reading of the requirement is on the record as checked.
    for (const ink of ['--ink', '--ink-muted', '--accent', '--danger']) {
      expect(contrast(colour(ink), SKY)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colour(ink), bed(SKY, '--surface-glass'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colour(ink), bed(SKY, '--surface-panel'))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps --ink-faint off anything a reader has to read', () => {
    // It clears WCAG 1.4.11's 3:1 for non-text but not 1.4.3's 4.5:1 for text, so it is allowed on
    // the scrollbar thumb, the toast's resting stripe — and exactly one glyph.
    expect(contrast(colour('--ink-faint'), GLASS)).toBeLessThan(4.5)
    expect(contrast(colour('--ink-faint'), GLASS)).toBeGreaterThanOrEqual(3)

    const selectors = [...STYLES.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => /(^|[\s;])color:\s*var\(--ink-faint\)/.test(body as string))
      .map(([, selector]) => (selector as string).trim().split('\n').pop()?.trim())
    // The breadcrumb's `›`. It is `aria-hidden` decoration between two labelled crumbs — it says
    // nothing a reader loses by not resolving it — which is what exempts it from 1.4.3, and the
    // markup is checked below so the exemption cannot quietly stop being true.
    expect(selectors).toEqual(['.crumb-sep'])
    expect(read('src/ui/Breadcrumb.tsx')).toMatch(
      /className="crumb-sep"\s*\n?\s*aria-hidden="true"/,
    )
  })

  it('gives a control that has no fill a boundary at 3:1 (WCAG 1.4.11)', () => {
    // An input and a resting chip are identifiable only by their border, so that border is a
    // non-text contrast case rather than decoration. `--line` is decoration and is exempt.
    for (const on of [SHEET, GLASS, PANEL]) {
      expect(contrast(composite(colour('--line-strong'), on), on)).toBeGreaterThanOrEqual(3)
    }
  })

  it('makes the focus ring visible on any backdrop (PRD 7.5.2)', () => {
    // A single accent ring is 1.99:1 on a white star. The sandwich works because one of its two
    // edges always has contrast: dark against a bright backdrop, accent against the dark bands.
    expect(tokens.get('--focus-ring')).toContain(tokens.get('--accent'))
    expect(contrast(colour('--accent'), SKY)).toBeGreaterThanOrEqual(3)
    expect(contrast(colour('--sky'), WHITE)).toBeGreaterThanOrEqual(3)
  })
})

describe('the token layer is the only source of colour', () => {
  it('leaves no colour literal in styles.css', () => {
    const withoutComments = STYLES.replace(/\/\*[\s\S]*?\*\//g, '')
    // `currentcolor` and `transparent` are keywords, not values, and both are load-bearing:
    // `transparent` is what keeps the focus outline alive in forced-colors mode.
    const literals = withoutComments.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? []
    expect(literals).toEqual([])
  })

  it('agrees with the renderer about what the sky is', () => {
    // `--sky` and `SKY_COLOUR` paint adjacent halves of the same screen — the HTML page behind the
    // canvas and the canvas's own clear colour. A seam here is visible during the first frame and
    // wherever the canvas does not fill the viewport.
    expect(tokens.get('--sky')).toBe(SKY_COLOUR)
  })

  it('resolves every var() it uses', () => {
    // `readTokens` throws on an undefined reference or a cycle, so reaching here is the assertion;
    // this states it out loud rather than leaving it as a side effect of module load.
    expect(tokens.size).toBeGreaterThan(30)
    for (const value of tokens.values()) expect(value).not.toContain('var(')
  })
})

describe('reduced motion (PRD 5.9, 7.5.1)', () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n/.exec(STYLES)?.[1]

  it('zeroes the duration tokens, so anything reading them stops', () => {
    expect(block).toBeDefined()
    for (const name of ['--dur-fast', '--dur-base', '--dur-slow']) {
      expect(block).toMatch(new RegExp(`${name}:\\s*0ms`))
    }
  })

  it('keeps the blanket rule for anything that does not read them', () => {
    expect(block).toContain('animation-duration: 0.01ms !important')
    expect(block).toContain('transition-duration: 0.01ms !important')
  })

  it('states every duration as a token, so the block above reaches all of them', () => {
    // A literal `220ms` on some transition would survive the token override and only be caught by
    // the blanket rule — which works, but leaves two mechanisms where the file claims one. Scanned
    // with the reduced-motion block itself cut out, since that block is where literals belong.
    const outside = STYLES.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/,
      '',
    )
    expect(outside.match(/\b\d+(?:\.\d+)?m?s\b/g) ?? []).toEqual([])
  })
})

describe('self-hosted fonts (PRD 7.6.1)', () => {
  it('serves every face from this origin', () => {
    const sources = TOKENS.match(/src:\s*url\(([^)]*)\)/g) ?? []
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).toContain('./fonts/')
      expect(source).not.toMatch(/https?:|\/\//)
    }
  })

  it('names a real family and falls back to the system stack', () => {
    expect(tokens.get('--font-ui')).toMatch(/^'Inter',/)
    expect(tokens.get('--font-ui')).toContain('system-ui')
  })

  it('swaps rather than blocking, so text is readable before the face lands', () => {
    for (const face of TOKENS.match(/@font-face \{[\s\S]*?\n\}/g) ?? []) {
      expect(face).toContain('font-display: swap')
      // `unicode-range` is what makes the second subset free for a session that never needs it.
      expect(face).toContain('unicode-range:')
    }
  })
})

describe('About view (PRD 4.11)', () => {
  it('carries all five clauses the Fan Content Policy requires', () => {
    // Paraphrasing any of these is a licensing problem, not a copy edit — hence a test.
    expect(FAN_CONTENT_NOTICE).toContain('unofficial Fan Content permitted under the')
    expect(FAN_CONTENT_NOTICE).toContain('Fan Content Policy')
    expect(FAN_CONTENT_NOTICE).toContain('Not approved/endorsed by Wizards')
    expect(FAN_CONTENT_NOTICE).toContain(
      'Portions of the materials used are property of Wizards of the Coast',
    )
    expect(FAN_CONTENT_NOTICE).toContain('©Wizards of the Coast LLC')
  })

  it('names the product, as the policy asks', () => {
    expect(FAN_CONTENT_NOTICE.startsWith('Eternities is ')).toBe(true)
  })

  it('opens every external link safely (PRD 7.6.2)', () => {
    const about = read('src/ui/AboutOverlay.tsx')
    const anchors = about.match(/<a\b[\s\S]*?>/g) ?? []
    expect(anchors.length).toBeGreaterThanOrEqual(2)
    for (const anchor of anchors) {
      expect(anchor).toContain('rel="noopener noreferrer"')
      expect(anchor).toContain('target="_blank"')
    }
  })

  it('credits Scryfall as the source of both the data and the images', () => {
    const about = read('src/ui/AboutOverlay.tsx')
    expect(about).toContain('https://scryfall.com')
    expect(about).toMatch(/Card data and card images come from/)
    // PRD 4.11.3: never mirrored or resized server-side, and the view says so.
    expect(about).toMatch(/Nothing is\s*\n?\s*mirrored/)
  })
})
