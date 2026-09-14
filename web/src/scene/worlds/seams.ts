/**
 * The worlds gate's control seams (spec §3.1, §1.6) — **normative renderer surface, owned here**.
 *
 * DEC-744's B1 ruling, restated on DEC-746's D5 because §3.1 and §4 word it inconsistently: there
 * are **five** seams, `?probe=` is one of them, and **all five are R1's**. Leg G consumes them and
 * may not patch the build to get them, because the acceptance gate's whole subject is the behaviour
 * of the *shipped* policy — a control that runs against a patched renderer measures the patch.
 *
 * | Seam | Turns off | Negative control for |
 * |---|---|---|
 * | `?swatch=mean` | the per-card swatch | W2 — the surface carries per-card colour |
 * | `?bands=shuffle` | the latitude-is-colour law | W3 — bands are separable in Lab |
 * | `?artThreshold=fixed24` | the per-frame quantile | W4 — art is chosen, not exhausted |
 * | `?layers=N` | the tier's pool size | W4 / §1.12 — the ladder moves the pool |
 * | `?probe=` | nothing; it *reports* | every row, and the read-backs below |
 *
 * > **Normative — every seam reports a value the gate can check moved (§1.6, DEC-752).** Without a
 * > read-back, a seam that silently fails to parse its own query parameter runs the *unmodified*
 * > policy, its criterion passes, and the matrix records a passing control — the
 * > `verify-browser --dataset all` shape of failure. {@link WorldsSeams} is that read-back, and
 * > `?probe=` publishes it.
 */

/**
 * `?layers=N` is **not** `?quality=N` and must never be aliased to it.
 *
 * Tier 4 differs from tier 0 in five quantities — `pixelRatioCap`, `bloomScale`, `bloomLevels`,
 * `thumbnailCapacity` and `glow` — so routing a pool-size request through the quality ladder would
 * make W4's *expected-GREEN* row measure four other things at once. This is a request for one
 * number, and the renderer answers with the number it actually allocated.
 */
export interface WorldsSeams {
  /**
   * One swatch for the whole world — its mean — instead of one per card.
   *
   * > W2's control, and it has to falsify **both** halves of that criterion. A flat wash still
   * > carries §1.4's wrapped-lambert gradient across the front-facing cap, which on its own gives
   * > `IQR(L*)` between 11.9 and 21.6 depending on swatch luminance — so a W2 half written against
   * > the whole visible disc **cannot fail**, with or without this seam. §3.1 measures the spread
   * > over the **iso-shade subset** instead, which is why the probe's per-cell record carries
   * > `shade` as a normative field rather than letting the gate re-derive it.
   */
  readonly swatchMean: boolean
  /**
   * A **single global permutation of cards across the plane's cells**, grid and reported `band`
   * untouched.
   *
   * > **Three spellings of this control are silently green** and only the fourth works: relabelling
   * > the reported `band` alongside the card, permuting the band-to-colour-class map, and permuting
   * > *within* a band all leave every band internally uniform, so W3 — "the bands are separable" —
   * > still passes. The distinguishing assertion is that **the multiset of swatches within any
   * > single band must change**, which only a global permutation produces.
   */
  readonly bandsShuffle: boolean
  /** The prototype's constant 24 px threshold: no histogram, no hysteresis, let the pool run out. */
  readonly artThresholdFixed24: boolean
  /** A requested art-pool size, before {@link artPoolSize} clamps it. `null` means "use the tier". */
  readonly layersRequested: number | null
}

/** The seams as read from a URL. Nothing here reads `location` unless the caller declines to pass one. */
export function readWorldsSeams(
  search: string = typeof location === 'undefined' ? '' : location.search,
): WorldsSeams {
  const params = new URLSearchParams(search)
  return {
    swatchMean: params.get('swatch') === 'mean',
    bandsShuffle: params.get('bands') === 'shuffle',
    artThresholdFixed24: params.get('artThreshold') === 'fixed24',
    layersRequested: readLayers(params.get('layers')),
  }
}

/**
 * `?layers=N`, or `null`.
 *
 * A typo degrades nothing — the same rule `?quality=` follows, and for the same reason: a control
 * that half-parses is worse than one that does not parse at all, because the run still produces
 * numbers. `0` is accepted and is meaningful: §1.6 makes a zero-layer pool a legal swatch-only
 * world, and it is the cheapest way to reach that state on hardware where the limit is slack.
 */
function readLayers(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  return Number(value)
}

/**
 * A global permutation of `count` cells, deterministic in `seed`.
 *
 * Deterministic because a control whose effect differs between two runs cannot be compared across
 * them, and the gate reruns the shuffled pass against the unshuffled one. A Fisher-Yates over a
 * small xorshift is enough — this is a control path, not a security boundary, and it runs once per
 * world at build time.
 */
export function shufflePermutation(count: number, seed = 0x9e3779b9): Uint32Array {
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i += 1) order[i] = i
  let state = (seed | 0) === 0 ? 1 : seed >>> 0
  for (let i = count - 1; i > 0; i -= 1) {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    const j = state % (i + 1)
    const swap = order[i]!
    order[i] = order[j]!
    order[j] = swap
  }
  return order
}
