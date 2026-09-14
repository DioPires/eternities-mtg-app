# What `worlds-gate.mjs` needs from the renderer

**Status:** leg G's consumption contract for leg R1's seams. Written before R1 starts, deliberately.

`docs/worlds/spec.md` §3.1 makes five seams normative renderer surface and assigns them to legs R1
and R3, and DEC-744 B1 / DEC-746 D5 confirm that ownership: **the gate consumes these seams and does
not build them.** The rule that follows from that — if a seam is missing when the gate is built,
that is an R1 defect routed via the CEO — is a good rule and an expensive one to exercise. R1 is
five engineer-days, and a seam that lands in a shape the gate cannot read costs a second round trip
through review to find out.

So this document states what the gate will read, in the shape it will read it, while R1 is still
unstarted. Nothing here adds a requirement to §3.1; it fixes the *spelling* of requirements §3.1
already makes, so that R1 can build against something checkable.

The machine-readable half is `web/scripts/lib/worlds-metrics.d.mts` — `CellSample`, `ArtCell` and
`EvictionSample` are the gate's actual input types, and `web/test/worlds-metrics.test.ts` runs the
criteria against them today.

---

## 1. The `?probe=` payload

The gate extends the existing seam rather than adding a second one: `window.__eternitiesProbe`,
installed only when the URL asks, exactly as `scene/probeSeam.ts` does today. `visual-gate.mjs`
reads `state()`; the worlds gate needs one more call, because per-cell data is far too big to belong
in the state object the status panel renders from.

```js
window.__eternitiesProbe.worlds() // → WorldsProbe, or undefined on a build without the seam
```

Returning `undefined` rather than throwing matters: the gate reports "the worlds probe is not
installed on this page" as a setup failure, which is a different verdict from a criterion going red.

```ts
interface WorldsProbe {
  /** The plane in focus, or null at the home view. */
  planeSlug: string | null
  /** Camera distance in units of the plane's radius — W1 and W4 are both specified at a pose. */
  radii: number
  /** CSS pixels. Must match the screenshot's dimensions at dpr 1, or every sample is off. */
  viewport: { width: number; height: number }
  cells: ProbeCell[]
  pool: ProbePool
  /** Per band index, that band's share of the plane's cards. Gates W3's 5% rule. */
  bandShares: number[]
}

interface ProbeCell {
  /** Cell centre in CSS pixels, origin at the viewport's top-left. */
  x: number
  y: number
  /** On-screen height in CSS pixels — the W1 statistic and the W2 ≥ 6 px cut. */
  height: number
  /** `dot(normal, toCamera) > 0.12`, §1.6's own facing test. */
  frontFacing: boolean
  /** Passed §1.6's frustum test. Reported, not filtered — W4's denominator needs it explicitly. */
  onScreen: boolean
  /** Index into `BAND_ORDER`, the 13-band north-to-south chain of §1.3. Not a colour class. */
  band: number
  /** Above the *effective* threshold this frame. Under §1.6's quantile this is not "height ≥ 24". */
  wantsArt: boolean
  /** Resolved to art and cross-faded in — `iArt` at 1, not merely a layer having been claimed. */
  showingArt: boolean
}

interface ProbePool {
  /** After §1.6's `min(tierLayers, maxLayers − 32)` clamp, not the tier constant. */
  layers: number
  /** Must satisfy `resident <= layers`; the prototype's 1,031-in-1,024 is the bug this catches. */
  resident: number
  /** CSS px. Equals 24 exactly under `?artThreshold=fixed24`. */
  effectiveThresholdPx: number
  /** Cumulative since page load, monotonic. The gate differences it; see §3 below. */
  evictions: number
}
```

**Cells are reported for the focused plane only.** W1 flies to each of the 29 worlds in turn and
takes the statistic per plane; a single pooled array across the system would make the per-plane
median unrecoverable, and W1's verdict is the worst plane, not the pooled one.

**`band` is the band index, not the colour class.** §1.3's layout is `C G R B U W · Gold · W U B R
G C`, thirteen bands over seven classes, and W3 compares bands adjacent *on the sphere*. Reporting a
class would merge the two ice caps — which sit at opposite poles — into one group and invent an
adjacency the sphere does not have.

## 2. The four control seams

Straight from §3.1 and §1.6; restated only as what the gate asserts of each.

| Seam | Owner | What the gate needs to be true |
|---|---|---|
| `?swatch=mean` | R1 | Every cell takes the plane's mean swatch. **The grid and `band` are unchanged** — only the colour moves. |
| `?bands=shuffle` | R1 | Band *assignment* is permuted; the grid is unchanged. Cells keep their geometry and their reported `band`; which card sits in them moves. Permuting the reported `band` alongside the card relabels the mosaic and leaves every band internally uniform, which is a control that passes. |
| `?artThreshold=fixed24` | R1 | A constant 24 CSS px threshold: no histogram, no hysteresis, pool allowed to exhaust. `pool.effectiveThresholdPx` must read exactly 24 so the gate can prove the seam took effect rather than assuming it. |
| `?layers=N` | R1/R3 | Pins the pool size, **after** the `MAX_ARRAY_TEXTURE_LAYERS − 32` clamp. `?layers=128` is tier 4 and an expected-**GREEN** row. |

Every control run asserts the seam engaged before it reads a criterion. A control that silently
no-ops produces a green row and reads as a passing gate — the `verify-browser --dataset all` shape
of failure, where two fixtures printed "all datasets verified".

## 3. Two things the gate does that the seam list does not imply

**Evictions are differenced, not read.** `pool.evictions` is a cumulative counter; W4's floor is
"≤ 5 evictions per second over the last 2 s". The gate samples the counter across the settle and
takes the rate over §3.1's window. This is not pedantry: Appendix A's 925 at `tether-surface` is
cumulative, and the same 925 on a settled pool is 0/s and passes. W4's eviction half is red at that
pose only if a rate says so — the art half, 1,024 of 2,759, is red from the drawn/wanted column
directly and carries the row on its own.

**Criteria report per half, and the matrix scores per half.** W2 and W4 are conjunctions, and a
conjunction hides which half did the work. Under `?swatch=mean` the neighbour-ΔE half collapses to
≈ 1.2 against a floor of 6 and goes solidly red — but §1.4's shade runs 0.10 + 0.95·s² with s from
0.56 at the facing cut to 1.0 at the sub-camera point, so lightness still varies across the disc
with one swatch throughout, and **IQR(L\*) measures 14.1 against its floor of 8 and stays green.**
The row is still red, because W2 is a conjunction. But a gate reporting only the row would have
recorded `?swatch=mean` as exercising both halves of W2 when it exercises exactly one, and IQR(L\*)
would ship with no negative control at all. So `checkControlRow` names the measure a row targets,
and the matrix carries a sixth, gate-side row — a flat unshaded wash — as IQR(L\*)'s own control.

Neither of these changes a floor or a criterion. Both are recorded here because they are decisions a
reader of §3.1 alone would not arrive at, and the second one is the reason the gate's output shape
is what it is.
