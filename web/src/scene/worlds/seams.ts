/**
 * The worlds gate's control seams (spec §3.1, §1.6) — **normative renderer surface, owned here**.
 *
 * DEC-744's B1 ruling, restated on DEC-746's D5 because §3.1 and §4 word it inconsistently: the
 * seams are **R1's**, `?probe=` is one of them, and leg G consumes them and may not patch the build
 * to get them — because the acceptance gate's whole subject is the behaviour of the *shipped*
 * policy, and a control that runs against a patched renderer measures the patch. That ruling named
 * five; the board's `art_off_seam` ruling on DEC-752 (answered 2026-09-16, DEC-821) added the
 * sixth, for the reason {@link WorldsSeams.artOff} states.
 *
 * | Seam | Turns off | Negative control for |
 * |---|---|---|
 * | `?swatch=mean` | the per-card swatch | W2 — the surface carries per-card colour |
 * | `?bands=shuffle` | the latitude-is-colour law | W3 — bands are separable in Lab |
 * | `?art=off` | the art path; every cell draws its swatch | W2 / W3 — it is what makes the two rows above reach the capture |
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
 * Tier 4 differs from tier 0 in four quantities besides the pool — `pixelRatioCap`, `bloomScale`,
 * `bloomLevels` and `glow` — so routing a pool-size request through the quality ladder would make
 * W4's *expected-GREEN* row measure four other things at once. This is a request for one
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
  /**
   * **Art off: every cell draws its swatch, and the stream is never asked for a printing.**
   *
   * > **Why a sixth seam exists at all (board ruling `art_off_seam`, DEC-752, DEC-821).** The two
   * > seams above perturb the **swatch**; at §3.1's 2.2-radii pose the capture is almost entirely
   * > **art** — `artFraction` measures **0.987–0.997** over four dominaria sessions (DEC-752, on
   * > main `28d4676`), so it is ten cells in ten and not seven — and on the capture both are inert.
   * > The 0.61–0.76 first recorded here predates DEC-812, which raised the art byte budget from
   * > 67,108,864 to 155,129,856; dominaria no longer starves mid-visit, so this seam's case is
   * > **stronger** than when it was argued. Measured on DEC-816: `?swatch=mean` leaves
   * > `W2.lightnessIqr` at 24.89 against no-seam siblings reading 16.09 / 21.28 / 25.89, inside the
   * > spread; `?bands=shuffle` moves `W3.minAdjacentBandDeltaE` only 0.815 → 0.476.
   * > Both seams engage — every read-back moves — so this was never wiring: at that pose the
   * > capture and the swatch are different quantities. `?art=off&swatch=mean` and
   * > `?art=off&bands=shuffle` are the rows that discriminate, and measured they do:
   * > `?art=off&swatch=mean` reads 0.954 / 4.673 against a `?art=off` sibling at 17.92 / 16.50.
   *
   * > **Not `?layers=0`, which is also swatch-only (§1.6).** A zero-layer pool moves
   * > `pool.layers` — the quantile's own divisor — and composes **no stream at all**, so the
   * > payload's `stream` goes `null` and the threshold policy is answering a different question.
   * > This seam leaves the pool, the texture, the stream and admission byte-identical to the
   * > no-seam run: `wantsArt` reports the same set, `admitted` is the same count, and the single
   * > difference is that no cell asks and no cell draws. A control that also moved the renderer's
   * > configuration would measure the configuration.
   */
  readonly artOff: boolean
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
    // Exact, like every other seam here: `?art=0`, `?art=none` and `?art=Off` are typos, and a
    // control that half-parses is worse than one that does not parse at all, because the run still
    // produces numbers. `?art=` with no value is the same typo and reads as absent.
    artOff: params.get('art') === 'off',
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
