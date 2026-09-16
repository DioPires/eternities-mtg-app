/**
 * The worlds acceptance criteria, and the negative-control matrix that keeps them honest.
 *
 * Spec §3.1 makes the matrix normative: "a criterion that has never been seen to fail is not an
 * instrument, it is a rubber stamp". `worlds-gate.mjs --negative-controls` runs the matrix against
 * the live renderer, which needs leg R1's seams. This file runs the same matrix against the
 * *arithmetic*, out of the prototype's measured numbers (Appendix A) — so the criteria are known to
 * go red on the frames they exist to forbid before the renderer that produces those frames exists.
 *
 * What this can and cannot prove: it pins the measurement, not the seam. That `?swatch=mean` makes
 * every cell take the plane's mean swatch is R1's to deliver and the live matrix's to check; that a
 * frame in which every cell took the mean swatch fails W2 is settled here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BAND_ORDER,
  FLOORS,
  ROSTER_V3,
  W2_MIN_SAMPLES,
  W2_MIN_RING_SAMPLES,
  W2_CONTROL_SUBJECT_MIN_RING,
  W3_MIN_BAND_SHARE,
  checkControlRow,
  deltaE76,
  deltaEab,
  evaluateW1,
  evaluateW2,
  evaluateW3,
  evaluateW4,
  evaluateW5,
  evictionRate,
  SMALLEST_SHIPPED_POOL_LAYERS,
  W5_MIN_AZIMUTHS,
  homeLabelCeiling,
  iqr,
  isLabelVisible,
  median,
  quantile,
  rowCellsFaults,
  rowsClosedForm,
  srgbToLab,
  LABEL_VISIBLE_MIN_OPACITY,
  type Criterion,
  type Measure,
  type CellSample,
  type Rgb,
} from "../scripts/lib/worlds-metrics.mjs";

// ------------------------------------------------------------------------------------------------
// Fixtures — Appendix A's measured poses, and a modelled world surface
// ------------------------------------------------------------------------------------------------

/**
 * Appendix A, `docs/worlds/spec.md`. Production dataset `6d4779695fde33ea`, 1920×1080 CSS, dpr 1,
 * art threshold 24 px, pool 1,024 layers, Apple Silicon. Not a Windows measurement.
 */
const PROTOTYPE = {
  dominariaFrame: {
    radii: 3.0,
    cellHeightPx: 25.3,
    drawn: 333,
    wanted: 333,
    evicted: 0,
  },
  dominariaFar: {
    radii: 6.0,
    cellHeightPx: 10.1,
    drawn: 0,
    wanted: 0,
    evicted: 0,
  },
  tetherSurface: {
    radii: 2.2,
    cellHeightPx: 42.1,
    drawn: 1_024,
    wanted: 2_759,
    evicted: 925,
  },
} as const;

/** The 29 worlds, as W1 sees them: Dominaria is the binding plane and the rest sit above it. */
function worldsAtSettle(dominariaMedianPx: number) {
  const cells = (height: number) =>
    Array.from({ length: 200 }, (_, i) => ({
      height: height + (i % 5) * 0.1,
      frontFacing: true,
    }));
  return [
    { slug: "dominaria", cells: cells(dominariaMedianPx) },
    ...Array.from({ length: 28 }, (_, i) => ({
      slug: `world-${i}`,
      cells: cells(dominariaMedianPx + 4 + i),
    })),
  ];
}

/**
 * A swatch per band class, standing in for what `swatches.bin` will carry.
 *
 * These are the *class means*. Real swatches are per card — a green card's `art_crop` may average
 * to brown, to near-black, to bright gold — and `jitterSwatch` below is what models that. Getting
 * this wrong is not cosmetic: give every cell in a band one identical swatch and W2 fails on a
 * perfectly good mosaic, because a cell's nearest neighbour is almost always in its own band.
 */
const BAND_SWATCH: Record<string, Rgb> = {
  colourless: [150, 150, 150],
  green: [60, 140, 70],
  red: [190, 70, 55],
  black: [70, 60, 65],
  blue: [60, 110, 180],
  white: [225, 215, 180],
  gold: [200, 170, 80],
};

/**
 * §1.4's shading, exactly as the fragment shader writes it.
 *
 *   shade = clamp(dot(n, light) · 0.5 + 0.5, 0, 1);  shade = 0.10 + 0.95 · shade²
 *
 * The light is camera-relative (§1.7, Q6), so `dot(n, light)` is the cell normal's z. This is
 * modelled rather than hand-waved because the W2 control turns on it: shading alone spreads L\*
 * across the disc even when every cell carries the same swatch.
 */
function shade(nz: number): number {
  const s = Math.min(1, Math.max(0, nz * 0.5 + 0.5));
  return 0.1 + 0.95 * s * s;
}

function shadeRgb(swatch: Rgb, nz: number): Rgb {
  const k = shade(nz);
  return [
    Math.min(255, Math.round(swatch[0] * k)),
    Math.min(255, Math.round(swatch[1] * k)),
    Math.min(255, Math.round(swatch[2] * k)),
  ];
}

/** A deterministic hash in [0, 1). No `Math.random` — a fixture that moves between runs is not one. */
function hash01(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** One card's swatch: its class mean, plus the per-card spread that makes a mosaic a mosaic. */
function jitterSwatch(base: Rgb, i: number, amount = 26): Rgb {
  return [0, 1, 2].map((c) =>
    Math.min(
      255,
      Math.max(
        0,
        Math.round((base[c] as number) + (hash01(i, c) - 0.5) * 2 * amount),
      ),
    ),
  ) as unknown as Rgb;
}

/**
 * A world's front-facing cells, laid out on the projected disc.
 *
 * Three knobs, kept separate because each control turns exactly one of them:
 *
 * - `bandAt` — which band the cell *reports*, from its latitude. The grid.
 * - `classAt` — which colour class the card sitting in that cell belongs to. `?bands=shuffle`
 *   permutes the assignment, so the grid is untouched and every band ends up holding a mix.
 * - `swatchOf` — the colour that card draws with. `?swatch=mean` collapses it to one value.
 *
 * Folding `classAt` into `bandAt` is the mistake that makes a shuffle control look green: shuffle
 * the label and the colour together and each band is still perfectly uniform, just relabelled.
 */
function modelWorld({
  radiusPx = 400,
  step = 20,
  bandAt = (v: number) => bandByLatitude(v),
  classAt,
  swatchOf,
  shaded = true,
}: {
  radiusPx?: number;
  step?: number;
  bandAt?: (v: number, i: number) => number;
  classAt: (v: number, i: number) => string;
  swatchOf: (cls: string, i: number) => Rgb;
  shaded?: boolean;
}): CellSample[] {
  const cells: CellSample[] = [];
  let i = 0;
  for (let v = -radiusPx + step / 2; v < radiusPx; v += step) {
    for (let u = -radiusPx + step / 2; u < radiusPx; u += step) {
      const r2 = (u * u + v * v) / (radiusPx * radiusPx);
      if (r2 >= 1) continue;
      const nz = Math.sqrt(1 - r2);
      // §1.6's facing test: reject if dot(normal, toCamera) <= 0.12.
      if (nz <= 0.12) continue;
      const swatch = swatchOf(classAt(v / radiusPx, i), i);
      cells.push({
        x: 960 + u,
        y: 540 + v,
        // Cells foreshorten towards the limb, which is why W2 has a 6 px floor at all.
        height: Math.max(2, 30 * nz),
        frontFacing: true,
        band: bandAt(v / radiusPx, i),
        rgb: shaded ? shadeRgb(swatch, nz) : swatch,
        // What the renderer reports, not what the gate re-derives. An unshaded frame still has a
        // shade term — it is simply constant, which is why the flat-wash case degenerates to one
        // iso-shade ring holding every cell.
        shade: shaded ? shade(nz) : shade(1),
      });
      i += 1;
    }
  }
  return cells;
}

/** The plane's mean swatch, which is what `?swatch=mean` hands every cell. */
const MEAN_SWATCH: Rgb = [132, 124, 118];

/** Production: the card's own swatch, spread about its class mean. */
const productionSwatch = (cls: string, i: number) =>
  jitterSwatch(BAND_SWATCH[cls] as Rgb, i);

const classByLatitude = (v: number) => BAND_ORDER[bandByLatitude(v)] as string;

/** Latitude → band index. `v` runs −1 (north) to +1 (south) across the disc. */
const bandByLatitude = (v: number) =>
  Math.min(
    BAND_ORDER.length - 1,
    Math.max(0, Math.floor(((v + 1) / 2) * BAND_ORDER.length)),
  );

/** Every mono class 15% (7.5% per mirrored band), gold 10%, colourless 15%. Sums to 1. */
const BAND_SHARES: number[] = BAND_ORDER.map((c) =>
  c === "gold" ? 0.1 : 0.075,
);

// ------------------------------------------------------------------------------------------------

describe("colour", () => {
  it("puts the sRGB primaries and greys where CIELAB says they are", () => {
    const white = srgbToLab([255, 255, 255]);
    expect(white.L).toBeCloseTo(100, 3);
    expect(white.a).toBeCloseTo(0, 3);
    expect(white.b).toBeCloseTo(0, 3);

    expect(srgbToLab([0, 0, 0]).L).toBeCloseTo(0, 6);

    // Mid grey is L* ≈ 53.6, not 50 — the check that the transfer function is applied at all.
    expect(srgbToLab([128, 128, 128]).L).toBeCloseTo(53.585, 2);

    const red = srgbToLab([255, 0, 0]);
    expect(red.L).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);
  });

  it("separates the full ΔE from the a*b*-only distance", () => {
    // Two greys: far apart in L*, identical in chroma. W2 should see a difference; W3 must not.
    const dark = srgbToLab([60, 60, 60]);
    const light = srgbToLab([200, 200, 200]);
    expect(deltaE76(dark, light)).toBeGreaterThan(50);
    expect(deltaEab(dark, light)).toBeLessThan(0.5);
  });
});

describe("statistics", () => {
  it("takes the median of an even-length sample as the midpoint of the middle pair", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it("interpolates quantiles the way NumPy and R do", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 10);
    expect(iqr([1, 2, 3, 4])).toBeCloseTo(1.5, 10);
  });
});

describe("W1 — cells are resolvable at framing distance", () => {
  it("passes on the prototype-measured 25.3 px at the plane-level settle", () => {
    const w1 = evaluateW1(
      worldsAtSettle(PROTOTYPE.dominariaFrame.cellHeightPx),
    );
    expect(w1.pass).toBe(true);
    expect(w1.worstPlane).toBe("dominaria");
    expect(w1.measures[0]?.value).toBeGreaterThanOrEqual(FLOORS.cellHeightPx);
  });

  it("goes RED on its control — the 6× radius capture, where cells measured 10.1 px", () => {
    const w1 = evaluateW1(worldsAtSettle(PROTOTYPE.dominariaFar.cellHeightPx));
    expect(w1.pass).toBe(false);
    expect(w1.measures[0]?.value).toBeLessThan(FLOORS.cellHeightPx);
  });

  it("is decided by the worst world, not by the pooled median", () => {
    // 28 comfortable worlds and one that is not. Pooling would bury it; "cells are resolvable" is a
    // claim about every world.
    const planes = worldsAtSettle(40);
    planes[0] = { slug: "rabiah", cells: [{ height: 9, frontFacing: true }] };
    const w1 = evaluateW1(planes);
    expect(w1.pass).toBe(false);
    expect(w1.worstPlane).toBe("rabiah");
  });

  it("ignores back-facing cells", () => {
    const w1 = evaluateW1([
      {
        slug: "dominaria",
        cells: [
          { height: 30, frontFacing: true },
          { height: 30, frontFacing: true },
          { height: 0.4, frontFacing: false },
          { height: 0.4, frontFacing: false },
          { height: 0.4, frontFacing: false },
        ],
      },
    ]);
    expect(w1.measures[0]?.value).toBe(30);
  });

  /**
   * W1's domain, which it did not have until the 45-world tour walked into it.
   *
   * Six worlds presented **no** front-facing cell at the measurement pose. A world turned away has
   * no median front-facing height at all, and scoring that absence as a failure both reds the gate
   * on a sampling artefact and — worse — outranks the genuine sub-floor world underneath it.
   */
  describe("a world with no front-facing cell is outside the domain, not the worst world", () => {
    /** One turned-away world, one comfortable world, one genuinely below the floor. */
    const mixed = () => [
      { slug: "moag", cells: [{ height: 400, frontFacing: false }] },
      { slug: "alara", cells: [{ height: 59, frontFacing: true }] },
      { slug: "dominaria", cells: [{ height: 17.45, frontFacing: true }] },
    ];

    it("names the sub-floor world, not the turned-away one", () => {
      const w1 = evaluateW1(mixed());
      // The whole point: `dominaria` is the finding, `moag` is noise. Before the fix `moag` won,
      // because a null median compared as smaller than every number.
      expect(w1.worstPlane).toBe("dominaria");
      expect(w1.measures[0]?.value).toBeCloseTo(17.45, 10);
      expect(w1.status).toBe("fail");
    });

    it("counts the turned-away world rather than dropping it", () => {
      // Reported, not silently excluded: a criterion that quietly stops measuring planes is how a
      // gate comes to print green while measuring nothing.
      expect(evaluateW1(mixed()).undefinedPlanes).toEqual(["moag"]);
      expect(evaluateW1(mixed()).measures[0]?.label).toContain("2 of 3 worlds");
    });

    it("still goes GREEN when every measurable world clears the floor", () => {
      // The row that makes the fix a domain rule rather than a way of losing failures: with the
      // sub-floor world removed, the turned-away world must not keep the criterion red.
      const w1 = evaluateW1([
        { slug: "moag", cells: [{ height: 400, frontFacing: false }] },
        { slug: "alara", cells: [{ height: 59, frontFacing: true }] },
      ]);
      expect(w1.status).toBe("pass");
      expect(w1.worstPlane).toBe("alara");
    });

    it("reports insufficient — never pass — when no world presented a cell at all", () => {
      // Nothing measurable anywhere is a harness failure, and the one case that must not read as a
      // clean run. `pass` stays false so a caller branching on it cannot mistake it for green.
      const w1 = evaluateW1([
        { slug: "moag", cells: [{ height: 400, frontFacing: false }] },
        { slug: "ergamon", cells: [{ height: 300, frontFacing: false }] },
      ]);
      expect(w1.status).toBe("insufficient");
      expect(w1.pass).toBe(false);
      expect(w1.measures[0]?.insufficientReason).toMatch(
        /no plane presented a front-facing cell/,
      );
    });
  });
});

describe("W2 — the mosaic reads as tiles", () => {
  const mosaic = modelWorld({
    classAt: classByLatitude,
    swatchOf: productionSwatch,
  });

  /** `?swatch=mean`: every cell takes the plane's mean swatch. Grid and bands unchanged. */
  const meanSwatch = modelWorld({
    classAt: classByLatitude,
    swatchOf: () => MEAN_SWATCH,
  });

  it("passes on a banded mosaic", () => {
    const w2 = evaluateW2(mosaic);
    expect(w2.pass).toBe(true);
  });

  it("goes RED on its control — ?swatch=mean — via the neighbour-ΔE half", () => {
    const w2 = evaluateW2(meanSwatch);
    expect(w2.pass).toBe(false);

    const neighbour = w2.measures.find(
      (m) => m.key === "medianNeighbourDeltaE",
    );
    expect(neighbour?.pass).toBe(false);
    // Adjacent cells share a normal to within a few degrees, so all that survives is a sliver of
    // the lambert gradient — a median around 1.3 against a floor of 6, and steepest at the limb
    // where the normal turns fastest.
    expect(neighbour?.value).toBeLessThan(FLOORS.neighbourDeltaE / 3);
  });

  /**
   * The iso-shade subset, and why it replaced a gate-side sixth control row.
   *
   * Measured over *every* sampled cell, IQR(L\*) could not be red under `?swatch=mean` — §1.4's
   * shade spreads a ~3× luminance range across the disc with one swatch throughout, so the measure
   * was reading the lit sphere rather than the mosaic. DEC-749 re-derived it and showed the
   * un-subsetted measure cannot go below ~12 for *any* single swatch: not a half without a control,
   * a half that could not fail. Holding shade fixed leaves swatch-to-swatch lightness, which is
   * what W2's title claims to measure — and `?swatch=mean` then drives it to ≈ 0, so one real
   * control row falsifies both halves.
   */
  it("goes RED on ?swatch=mean via the lightness half too, once shade is held fixed", () => {
    const w2 = evaluateW2(meanSwatch);
    const lightness = w2.measures.find((m) => m.key === "lightnessIqr");
    expect(lightness?.pass).toBe(false);
    // One colour at one shade is one colour: the ring collapses to a point in L*.
    expect(lightness?.value).toBeLessThan(1);
  });

  it("measures the lightness half over a strict subset of the sampled cells", () => {
    const w2 = evaluateW2(mosaic);
    // The guard against the tolerance being widened until the subset is everything, which would
    // silently restore the measure that could not fail.
    expect(w2.isoShadeSampled).toBeGreaterThan(0);
    expect(w2.isoShadeSampled).toBeLessThan(w2.sampled);
    expect(w2.measures.find((m) => m.key === "lightnessIqr")?.pass).toBe(true);
  });

  /**
   * The negative control for the subset itself: a flat unshaded wash is one iso-shade ring holding
   * every cell, so if the subsetting were inert this frame would be indistinguishable from the
   * un-subsetted measure. Both halves must still go red.
   */
  it("goes RED on a flat unshaded wash — the degenerate single-ring frame", () => {
    const flat = modelWorld({
      classAt: classByLatitude,
      swatchOf: () => MEAN_SWATCH,
      shaded: false,
    });
    const w2 = evaluateW2(flat);
    expect(w2.isoShadeSampled).toBe(w2.sampled);
    expect(w2.measures.find((m) => m.key === "lightnessIqr")?.pass).toBe(false);
    expect(
      w2.measures.find((m) => m.key === "medianNeighbourDeltaE")?.pass,
    ).toBe(false);
  });

  it("drops cells below the 6 px floor", () => {
    const w2 = evaluateW2(mosaic);
    expect(w2.sampled).toBeLessThan(mosaic.length);
    expect(w2.sampled).toBeGreaterThan(0);
  });

  /**
   * **The lightness half's domain is the ring, not the sampled set (DEC-752, found by the 45-world
   * acceptance run at main `28ec706`).**
   *
   * `W2_MIN_SAMPLES` guarded `sampled` for both halves. The neighbour half walks `sampled`, but the
   * lightness half is an IQR over the iso-shade ring, and ±2.5% of the median shade selects a few
   * per cent of the disc by construction — so the guard was a bound that could not bind for it.
   * Live consequence: `kylem` scored `lightnessIqr` **0.020 against a floor of 8 from two cells**,
   * with `capenna`, `fiora` and `shenmeng` scored from two or three, and all four were counted as
   * planes failing W2 while the guard read their 21, 76, 31 and 7 sampled cells and passed them.
   * An IQR over two points is the spread of two points.
   */
  describe("the iso-shade ring carries its own sample-size domain", () => {
    /**
     * A disc whose shades are spread far enough apart that the ±2.5% ring around the median holds
     * exactly `ringSize` cells — the live shape, where the ring is a sliver of a well-sampled
     * plane. Every cell is well over the 6 px floor and front-facing, so `sampled` is never the
     * binding constraint.
     */
    const ringOf = (ringSize: number, ringRgb: [number, number, number][]) => {
      const spread: CellSample[] = Array.from({ length: 40 }, (_, i) => ({
        x: 100 + i * 20,
        y: 500,
        height: 40,
        frontFacing: true,
        band: 6,
        // 0.30 to 1.08 in steps of 0.02: the median lands on 0.70 and the ±2.5% window is
        // ±0.0175, so no other cell in the ladder falls inside it.
        shade: 0.3 + i * 0.02,
        rgb: [40 + i * 4, 60, 200 - i * 4] as [number, number, number],
      }));
      const ring: CellSample[] = Array.from({ length: ringSize }, (_, i) => ({
        x: 1500 + i * 20,
        y: 700,
        height: 40,
        frontFacing: true,
        band: 6,
        shade: 0.7,
        rgb: ringRgb[i % ringRgb.length] as [number, number, number],
      }));
      // Drop the ladder's own 0.70 rung so the ring is exactly `ringSize`.
      return [...spread.filter((c) => Math.abs(c.shade - 0.7) > 1e-9), ...ring];
    };

    it("reports insufficient when the ring is below the domain, however many cells were sampled", () => {
      const w2 = evaluateW2(ringOf(3, [[128, 128, 128]]));

      expect(w2.sampled).toBeGreaterThanOrEqual(W2_MIN_SAMPLES * 5);
      expect(w2.isoShadeSampled).toBe(3);
      expect(w2.isoShadeThin).toBe(true);
      const lightness = w2.measures.find((m) => m.key === "lightnessIqr");
      expect(lightness?.status).toBe("insufficient");
      expect(lightness?.insufficientReason).toMatch(/median shade/);
      // The neighbour half is untouched: its own domain is the sampled set and that is amply met.
      // Scoring both halves off one set is the defect; scoring neither would be the over-correction.
      expect(
        w2.measures.find((m) => m.key === "medianNeighbourDeltaE")?.status,
      ).not.toBe("insufficient");
    });

    /**
     * **The two domains are different numbers, and this is the row that says so (ruling `w2_ring`).**
     *
     * A ring of `W2_MIN_SAMPLES` used to be scored. It is now out of domain, because four cells is
     * where an IQR stops being a gap between two points and *not* where it stops moving: across the
     * two 45-world acceptance runs, worlds admitted at a ring of four moved `lightnessIqr` by up to
     * 58% of its own value between two runs of the same build.
     *
     * Asserting the strict inequality rather than the literal 20 is deliberate — the finding is that
     * the lightness half needs a *larger* domain than the sampled set does, and a test pinned to 20
     * would go green again the day someone quietly lowered both to four together.
     */
    it("puts a four-cell ring out of domain — the lightness half's domain is the larger one", () => {
      expect(W2_MIN_RING_SAMPLES).toBeGreaterThan(W2_MIN_SAMPLES);

      const w2 = evaluateW2(ringOf(W2_MIN_SAMPLES, [[128, 128, 128]]));

      expect(w2.isoShadeSampled).toBe(W2_MIN_SAMPLES);
      expect(w2.isoShadeThin).toBe(true);
      expect(w2.measures.find((m) => m.key === "lightnessIqr")?.status).toBe(
        "insufficient",
      );
    });

    it("scores the ring one cell below and one cell at the domain differently", () => {
      // The guard binds and does not swallow: the *same flat wash* that goes `insufficient` one
      // cell short is a real, scored RED at the domain. Without this pair the change above would be
      // indistinguishable from "stop scoring the lightness half", which is the over-correction the
      // ruling explicitly did not pick.
      const below = evaluateW2(
        ringOf(W2_MIN_RING_SAMPLES - 1, [[128, 128, 128]]),
      );
      const at = evaluateW2(ringOf(W2_MIN_RING_SAMPLES, [[128, 128, 128]]));

      expect(below.isoShadeThin).toBe(true);
      expect(below.measures.find((m) => m.key === "lightnessIqr")?.status).toBe(
        "insufficient",
      );

      expect(at.isoShadeSampled).toBe(W2_MIN_RING_SAMPLES);
      expect(at.isoShadeThin).toBe(false);
      const lightness = at.measures.find((m) => m.key === "lightnessIqr");
      expect(lightness?.status).toBe("fail");
      expect(lightness?.value).toBeLessThan(1);
    });

    it("passes at the domain when the ring really does vary in lightness", () => {
      const w2 = evaluateW2(
        ringOf(W2_MIN_RING_SAMPLES, [
          [20, 20, 20],
          [90, 90, 90],
          [170, 170, 170],
          [240, 240, 240],
        ]),
      );

      expect(w2.isoShadeSampled).toBe(W2_MIN_RING_SAMPLES);
      expect(w2.measures.find((m) => m.key === "lightnessIqr")?.status).toBe(
        "pass",
      );
    });

    /**
     * **The falsifier has to clear the domain it is falsifying against.**
     *
     * `swatch-mean` is the only negative control W2's lightness half has. Raising the ring domain
     * to 20 put that control one edit from dying on its precondition arm: a control row measured on
     * a world whose ring is smaller than the domain reports `insufficient`, which is not RED, and
     * the matrix would record a retired falsifier as a passing row.
     *
     * Measured, on the two acceptance runs: dominaria's ring is 61 and 64, ravnica's is 22, and
     * **every other world on the v3 roster is under 20**. So the matrix's subject is not a free
     * choice any more, and this row is what makes moving it a test failure rather than a silence.
     */
    it("keeps the swatch-mean control's subject above the domain it must go red against", () => {
      expect(W2_CONTROL_SUBJECT_MIN_RING).toBeGreaterThanOrEqual(
        W2_MIN_RING_SAMPLES,
      );

      // dominaria at its measured ring, washed flat by `?swatch=mean`: scored, and RED.
      const control = evaluateW2(ringOf(61, [[128, 128, 128]]));
      expect(control.isoShadeSampled).toBeGreaterThanOrEqual(
        W2_CONTROL_SUBJECT_MIN_RING,
      );
      expect(control.measures.find((m) => m.key === "lightnessIqr")?.status).toBe(
        "fail",
      );

      // The same wash on the largest ring any *other* v3 world offers but dominaria and ravnica —
      // eight cells, forgotten-realms — is not a control at all. This is the row that would go
      // quietly green if the subject moved.
      const tooSmall = evaluateW2(ringOf(8, [[128, 128, 128]]));
      expect(tooSmall.measures.find((m) => m.key === "lightnessIqr")?.status).toBe(
        "insufficient",
      );
    });
  });
});

/**
 * **The one-card world — six of them on the v3 roster (DEC-751).**
 *
 * ergamon, muraganda, pyrulea, regatha, segovia and shandalar hold exactly one card each, and 15
 * worlds hold ≤ 4. `minWorld` across tracked datasets was {41, 30, 6}; production now contributes
 * **1**, a case no tracked dataset has ever rendered.
 *
 * W2 and W3 are not merely noisy there, they are **undefined**: "nearest on-screen neighbour" has
 * no referent with one cell, an interquartile range of a single sample is 0, and one populated band
 * yields zero adjacent pairs. Scored as ordinary failures — which is what a floor comparison does
 * to a `null` — those six worlds take the matrix's expected-GREEN row down against a renderer doing
 * exactly what §3.1 asks. That is W5's stale-30 failure one criterion over.
 */
describe("worlds below the criteria’s domain", () => {
  const oneCell: CellSample[] = [
    {
      x: 960,
      y: 540,
      height: 420,
      frontFacing: true,
      band: 6,
      rgb: [120, 90, 60],
      shade: 0.9,
    },
  ];
  const oneBandShares = BAND_ORDER.map((_, i) => (i === 6 ? 1 : 0));

  it("reports W2 as insufficient on a one-card world, not as a failure", () => {
    const w2 = evaluateW2(oneCell);
    expect(w2.status).toBe("insufficient");
    expect(w2.measures.every((m) => m.status === "insufficient")).toBe(true);
    // The distinction that matters: not passing, but not red either.
    expect(w2.pass).toBe(false);
    expect(w2.measures[0]?.insufficientReason).toContain("below W2");
  });

  it("reports W3 as insufficient when no adjacent band pair qualifies", () => {
    const w3 = evaluateW3(oneCell, oneBandShares);
    expect(w3.status).toBe("insufficient");
    expect(w3.pairs).toHaveLength(0);
  });

  it("still measures W1 on a one-card world — that criterion is defined at n = 1", () => {
    const w1 = evaluateW1([
      {
        slug: "dominaria",
        cells: Array.from({ length: 40 }, () => ({
          height: 26,
          frontFacing: true,
        })),
      },
      { slug: "segovia", cells: [{ height: 420, frontFacing: true }] },
    ]);
    expect(w1.status).toBe("pass");
    // A one-cell world's cell is enormous, so it is never the worst plane — W1 needs no exemption.
    expect(w1.worstPlane).toBe("dominaria");
  });

  /**
   * The regression this whole section exists to prevent: the expected-GREEN row of the matrix must
   * survive a roster that contains degenerate worlds.
   */
  it("keeps the unmodified-build row GREEN across a roster holding six one-card worlds", () => {
    const healthy = modelWorld({
      classAt: classByLatitude,
      swatchOf: productionSwatch,
    });
    const rows = [
      ...[
        "ergamon",
        "muraganda",
        "pyrulea",
        "regatha",
        "segovia",
        "shandalar",
      ].map(() => oneCell),
      healthy,
    ];
    const verdicts = rows.map((cells) => evaluateW2(cells).status);
    expect(verdicts.filter((v) => v === "insufficient")).toHaveLength(6);
    expect(verdicts.filter((v) => v === "pass")).toHaveLength(1);
    // Nothing went red, so nothing fails the run.
    expect(verdicts).not.toContain("fail");
  });

  it("asserts the n/a as a matrix row, so the precondition cannot be widened unnoticed", () => {
    const criteria = [evaluateW2(oneCell), evaluateW3(oneCell, oneBandShares)];
    for (const row of [
      {
        criterion: "W2",
        measure: "medianNeighbourDeltaE",
        expect: "N/A" as const,
      },
      { criterion: "W2", measure: "lightnessIqr", expect: "N/A" as const },
      {
        criterion: "W3",
        measure: "minAdjacentBandDeltaE",
        expect: "N/A" as const,
      },
    ]) {
      expect(checkControlRow(criteria, row).ok).toBe(true);
    }
    // And N/A is not GREEN: "not measured" may never be recorded as "measured and fine".
    expect(
      checkControlRow(criteria, {
        criterion: "W2",
        measure: "lightnessIqr",
        expect: "GREEN",
      }).ok,
    ).toBe(false);
  });
});

describe("W3 — latitude reads as colour", () => {
  const banded = modelWorld({
    classAt: classByLatitude,
    swatchOf: productionSwatch,
  });

  /**
   * `?bands=shuffle`: band assignment permuted, grid unchanged.
   *
   * The grid — and so each cell's reported band — is untouched. What moves is which *card* sits in
   * the cell: the permutation scatters the classes across latitudes, so every band ends up holding
   * a mix of all seven and their mean a\*b\* converge on the plane's mean.
   */
  const shuffled = modelWorld({
    classAt: (_v, i) => BAND_ORDER[(i * 7 + 3) % BAND_ORDER.length] as string,
    swatchOf: productionSwatch,
  });

  it("passes when each band holds one class", () => {
    const w3 = evaluateW3(banded, BAND_SHARES);
    expect(w3.pass).toBe(true);
    expect(w3.pairs.length).toBe(BAND_ORDER.length - 1);
  });

  it("collapses on its control — ?bands=shuffle", () => {
    // **The claim here is the collapse, not a verdict against the shipped floor.** This is a model
    // world: its absolute ΔE scale is set by `productionSwatch` and the stride permutation, so
    // asserting `value < FLOORS.bandDeltaE` was tying a synthetic fixture to a constant derived from
    // the *real* swatches — and when DEC-752 re-derived that constant from 10 to 0.55, this row went
    // green while measuring exactly what it always had. The fixture had not changed; the coupling
    // had always been wrong.
    //
    // What the control actually establishes is that scattering the classes across latitudes drives
    // every band's mean a*b* onto the plane's mean. That is a ratio, and it is enormous: 25.23 banded
    // against 0.82 shuffled, a 30× collapse. Whether the collapsed value clears the shipped floor is
    // a question about the shipped swatches, and `w3-floor-shipped` / `w3-floor-control` answer it on
    // the live build.
    const banded3 = evaluateW3(banded, BAND_SHARES);
    const w3 = evaluateW3(shuffled, BAND_SHARES);
    const collapsed = w3.measures[0]?.value ?? Infinity;
    const separated = banded3.measures[0]?.value ?? 0;
    expect(collapsed).toBeLessThan(separated / 10);
    // Not ≈ 0: the residue is the sampling asymmetry between two bands holding different counts of
    // the same seven classes, and pinning it to zero would be asserting the fixture is balanced
    // rather than that the seam works.
    expect(collapsed).toBeLessThan(1);
  });

  // The floor comparison itself, which the collapse row above deliberately no longer carries. Two
  // adjacent bands of one flat colour each, chosen to straddle `FLOORS.bandDeltaE`: one pair 27%
  // under it, one 157% over. Both rows matter — the RED one alone cannot tell a working comparison
  // from a criterion that reds on everything.
  const twoBands = (other: Rgb): CellSample[] => [
    ...Array.from({ length: 20 }, (_, i) => ({
      x: i, y: 0, height: 20, frontFacing: true, band: 5, rgb: [120, 120, 120] as Rgb, shade: 0.9,
    })),
    ...Array.from({ length: 20 }, (_, i) => ({
      x: i, y: 40, height: 20, frontFacing: true, band: 6, rgb: other, shade: 0.9,
    })),
  ];
  const twoBandShares = BAND_ORDER.map((_, i) => (i === 5 || i === 6 ? 0.5 : 0));

  it("reds a band pair that has converged below the floor", () => {
    const w3 = evaluateW3(twoBands([121, 120, 120]), twoBandShares);
    expect(w3.measures[0]?.value).toBeCloseTo(0.4016, 3);
    expect(w3.pass).toBe(false);
  });

  it("greens the same pair once it separates — the floor is a threshold, not a veto", () => {
    const w3 = evaluateW3(twoBands([122, 120, 118]), twoBandShares);
    expect(w3.measures[0]?.value).toBeCloseTo(1.412, 3);
    expect(w3.pass).toBe(true);
  });

  it("keeps those two fixtures straddling the floor", () => {
    // The precondition the pair above rests on. `FLOORS.bandDeltaE` is re-derived from the shipped
    // swatches whenever they move (DEC-752), and a floor that drifted outside this bracket would
    // send both rows the same way — leaving a two-sided test that had quietly become one-sided.
    // This fails loudly and says to re-pick the colours instead.
    expect(FLOORS.bandDeltaE).toBeGreaterThan(0.4016);
    expect(FLOORS.bandDeltaE).toBeLessThan(1.412);
  });

  it("skips a pair whose smaller band is under the 5% share", () => {
    const shares = [...BAND_SHARES];
    shares[0] = W3_MIN_BAND_SHARE / 2;
    const w3 = evaluateW3(banded, shares);
    expect(w3.pairs.some((p) => p.bands.includes(0))).toBe(false);
    expect(w3.pairs.length).toBe(BAND_ORDER.length - 2);
  });

  it("does not treat the two ice caps as adjacent", () => {
    // North and south colourless sit at opposite poles with the whole mosaic between them. An
    // adjacency built from the class list rather than the band chain would compare them.
    const w3 = evaluateW3(banded, BAND_SHARES);
    const caps = [0, BAND_ORDER.length - 1];
    expect(
      w3.pairs.some((p) => p.bands[0] === caps[0] && p.bands[1] === caps[1]),
    ).toBe(false);
  });

  it("is blind to a pair that differs only in lightness", () => {
    // Two adjacent bands, same hue, very different brightness. W3 asks whether latitude reads as
    // *colour*; the lambert shade already supplies lightness for free, so this must fail.
    const grey: CellSample[] = [
      ...Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 0,
        height: 20,
        frontFacing: true,
        band: 5,
        rgb: [50, 50, 50] as Rgb,
        shade: 0.9,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 40,
        height: 20,
        frontFacing: true,
        band: 6,
        rgb: [210, 210, 210] as Rgb,
        shade: 0.9,
      })),
    ];
    const shares = BAND_ORDER.map(() => 0);
    shares[5] = 0.5;
    shares[6] = 0.5;
    const w3 = evaluateW3(grey, shares);
    expect(w3.pass).toBe(false);
  });
});

describe("W4 — art resolves without exhausting", () => {
  const cells = (wanted: number, drawn: number) =>
    Array.from({ length: wanted }, (_, i) => ({
      frontFacing: true,
      onScreen: true,
      wantsArt: true,
      showingArt: i < drawn,
    }));

  /** A settled pool: the counter has stopped moving. */
  const settled = (at: number) => [
    { t: 0, evictions: at },
    { t: 2.5, evictions: at },
    { t: 5, evictions: at },
  ];

  /** The prototype's own pool — Appendix A's `tether-surface` drew 1,024 layers. */
  const PROTOTYPE_POOL = { layers: 1_024, resident: 1_024 };

  /**
   * The stream report at the entry to a world's visit, in the fresh session the gate now gives each
   * world: nothing outstanding, nothing in flight, the whole budget still to spend, and the renderer
   * saying so.
   *
   * Passed explicitly at every call site rather than defaulted, because that is what the signature
   * is for — a default would switch `budgetBoundAtEntry` off on every row here and leave the guard
   * exercised only where it is itself the subject.
   *
   * This is the shape of all 111 entry readings on record, which is why the DEC-812 spelling change
   * moved no landed number and why that is not reassuring — see {@link budgetBoundAtEntry}.
   */
  const FRESH_SESSION = {
    swatchOnly: false,
    bytesOutstanding: 0,
    bytesReserved: 0,
    byteBudget: 64 * 1024 * 1024,
  };

  it("goes RED on its control — ?artThreshold=fixed24 — reproducing tether-surface", () => {
    const { drawn, wanted, evicted } = PROTOTYPE.tetherSurface;
    // The pool is exhausted and churning: the prototype reached this pose "with no sign of
    // settling", so the counter is still climbing across the measurement window.
    const churning = [
      { t: 0, evictions: evicted - 240 },
      { t: 2.5, evictions: evicted - 120 },
      { t: 5, evictions: evicted },
    ];
    const w4 = evaluateW4(
      cells(wanted, drawn),
      churning,
      PROTOTYPE_POOL,
      FRESH_SESSION,
    );

    expect(w4.pass).toBe(false);
    const fraction = w4.measures.find((m) => m.key === "artFraction");
    expect(fraction?.pass).toBe(false);
    // 1,024 of 2,759 is 37%, against a 90% floor.
    expect(fraction?.value).toBeCloseTo(0.371, 3);
    expect(w4.measures.find((m) => m.key === "evictionsPerSecond")?.pass).toBe(
      false,
    );
  });

  /**
   * Appendix A's 925 is a *cumulative* counter, not a rate.
   *
   * §3.1 reads both halves of W4 as red at `tether-surface`, and the art half certainly is — 37%
   * against 90%, from the drawn/wanted column directly. The eviction half is an inference from "no
   * sign of settling", and an inference is not a measurement: the same 925 cumulative evictions
   * spread over a settled window is 0/s and passes. The gate must take the rate over §3.1's own
   * 2 s window rather than reading the counter, which is what `evictionRate` is for.
   */
  it("reads 925 cumulative evictions as passing once the pool has settled", () => {
    const { drawn, wanted, evicted } = PROTOTYPE.tetherSurface;
    const w4 = evaluateW4(
      cells(wanted, drawn),
      settled(evicted),
      PROTOTYPE_POOL,
      FRESH_SESSION,
    );
    expect(w4.measures.find((m) => m.key === "evictionsPerSecond")?.value).toBe(
      0,
    );
    // The art half still fails, so the row is red either way — but for one reason, not two.
    expect(w4.pass).toBe(false);
  });

  it("stays GREEN on ?layers=128 — tier 4, where the quantile raises the threshold to match", () => {
    // §1.6 defines demand relative to pool capacity, so a 128-layer pool does not starve: the
    // effective threshold rises until ~128 cells want art and ~128 resolve. Condemning this row
    // would be condemning the low-end device the ladder exists to protect.
    const w4 = evaluateW4(
      cells(128, 128),
      settled(4_100),
      { layers: 128, resident: 128 },
      FRESH_SESSION,
    );
    expect(w4.pass).toBe(true);
    expect(w4.measures.find((m) => m.key === "artFraction")?.value).toBe(1);
  });

  /**
   * The capacity ceiling — reported on every row, and scoring nothing (DEC-770 N1).
   *
   * A showing cell holds a layer, so `min(1, layers / wanting)` bounds `artFraction` whatever the
   * policy does. The rows below fix both that arithmetic and the fact that it is *not* wired to the
   * verdict, because the tempting fix — excusing a row whose ceiling sits under the floor — would
   * retire `?artThreshold=fixed24`, which is W4's only falsifier and is starved on purpose.
   */
  describe("capacity ceiling", () => {
    it("reports what the pool could show, not what it did", () => {
      const w4 = evaluateW4(
        cells(2_759, 1_024),
        settled(0),
        PROTOTYPE_POOL,
        FRESH_SESSION,
      );
      // 1,024 layers against 2,759 cells wanting art.
      expect(w4.capacityCeiling).toBeCloseTo(1_024 / 2_759, 6);
      // ...and the fraction actually shown is a different, lower number: the ceiling is a bound on
      // the row, not a restatement of it.
      const fraction = w4.measures.find((m) => m.key === "artFraction");
      expect(fraction?.value).toBeCloseTo(1_024 / 2_759, 6);
    });

    it("caps at 1 rather than reporting spare capacity as headroom above full", () => {
      const w4 = evaluateW4(
        cells(90, 90),
        settled(0),
        { layers: 224, resident: 90 },
        FRESH_SESSION,
      );
      expect(w4.capacityCeiling).toBe(1);
    });

    it("is null where nothing wants art, rather than dividing by zero", () => {
      const w4 = evaluateW4(
        cells(0, 0),
        settled(0),
        { layers: 128, resident: 0 },
        FRESH_SESSION,
      );
      expect(w4.capacityCeiling).toBeNull();
    });

    it("leaves the fixed24 control RED even though its ceiling is under the floor", () => {
      // The row this guard exists for. `fixed24` starves the pool deliberately, so its ceiling is
      // 0.37 against a 0.9 floor — exactly the shape a "the floor was unreachable" excuse would
      // forgive, and forgiving it would make W4's only falsifier inert.
      const { drawn, wanted } = PROTOTYPE.tetherSurface;
      const w4 = evaluateW4(
        cells(wanted, drawn),
        settled(0),
        PROTOTYPE_POOL,
        FRESH_SESSION,
      );
      expect(w4.capacityCeiling).toBeLessThan(0.9);
      const fraction = w4.measures.find((m) => m.key === "artFraction");
      // `fail`, and specifically not `insufficient`: the row must stay a claim about the picture.
      // An excused ceiling would land here as `insufficient`, which reports as "not measured".
      expect(fraction?.status).toBe("fail");
    });
  });

  it("passes the unexhausted prototype pose, dominaria-frame at 333/333", () => {
    const { drawn, wanted, evicted } = PROTOTYPE.dominariaFrame;
    const w4 = evaluateW4(
      cells(wanted, drawn),
      settled(evicted),
      PROTOTYPE_POOL,
      FRESH_SESSION,
    );
    expect(w4.pass).toBe(true);
  });

  it("averages the eviction rate over the trailing 2 s, not the whole run", () => {
    // A burst while the camera flew, then quiet. The criterion is about the settled pose.
    const timeline = [
      { t: 0, evictions: 0 },
      { t: 1, evictions: 900 },
      { t: 3, evictions: 910 },
      { t: 5, evictions: 912 },
    ];
    expect(evictionRate(timeline)).toBeCloseTo(1, 6);
  });

  /**
   * **The denominator's two visibility terms, each bound by its own row (DEC-749's 14T note).**
   *
   * `wantsArt` is the size test *alone* — deliberately wider than the renderer's admission, which
   * is `wantsArt && frontFacing && onScreen`, so that the payload can still distinguish a cell that
   * was too small from one that was merely turned away. The gate must re-form the conjunction or
   * its denominator counts cells the renderer correctly never fetched, and W4 goes red on correct
   * behaviour.
   *
   * Every other test in this block draws its population from `cells()`, which hardcodes both terms
   * to `true` — so the conjunction could be deleted outright and the block stayed green. Measured:
   * all three mutants (drop both terms / drop `frontFacing` / drop `onScreen`) survived 62/62,
   * while breaking the *numerator* reddened two tests, so the block bound W4 but not this. The two
   * rows below are split one per term precisely so that a mutant dropping a single term cannot
   * survive on the other's row.
   *
   * **The `onScreen` row is not a duplicate of the live matrix — it is the only guard that half
   * has, and that is a proof rather than a reading.** `AdaptiveThreshold` floors the quantile at
   * `BASE_THRESHOLD_PX`: `offer()` drops anything under 24 px, the chosen bucket is never negative,
   * and `bucketEdgePx(0)` is 24. So `wantsArt` under the quantile, *at any capacity*, is a subset of
   * `wantsArt` under `?artThreshold=fixed24` — verified over the roster at 16/64/128/224/1,024
   * layers, 39,254 adaptive-wanting cells, **zero** outside the fixed24 set. `wantsArt && !onScreen`
   * is empty on all 45 worlds under fixed24, and fixed24 dominates every capacity, so **no live
   * control row can redden it at any pool size** — this row is the half's only guard, permanently.
   *
   * `frontFacing` is the opposite case: it binds live, but *how widely* is a function of pool
   * capacity, not a constant — see the row below that records it.
   */
  const visible = (n: number) =>
    Array.from({ length: n }, () => ({
      frontFacing: true,
      onScreen: true,
      wantsArt: true,
      showingArt: true,
    }));

  it("excludes back-facing cells from the denominator, so a turned-away world is not a failure", () => {
    // 90 visible cells all showing art, plus 20 that are big enough to want art but face away.
    // Counting the 20 would read 90/110 = 0.818 against the 0.9 floor and condemn a correct frame.
    const cells = [
      ...visible(90),
      ...Array.from({ length: 20 }, () => ({
        frontFacing: false,
        onScreen: true,
        wantsArt: true,
        showingArt: false,
      })),
    ];
    const w4 = evaluateW4(cells, settled(0), PROTOTYPE_POOL, FRESH_SESSION);

    expect(w4.wanting).toBe(90);
    expect(w4.showing).toBe(90);
    // The exclusion must actually be doing work, or this row is vacuous like the ones above it.
    expect(w4.wanting).toBeLessThan(cells.length);
    expect(w4.measures.find((m) => m.key === "artFraction")?.value).toBe(1);
    expect(w4.pass).toBe(true);
  });

  it("excludes off-screen cells from the denominator, the half no live control row can reach", () => {
    const cells = [
      ...visible(90),
      ...Array.from({ length: 20 }, () => ({
        frontFacing: true,
        onScreen: false,
        wantsArt: true,
        showingArt: false,
      })),
    ];
    const w4 = evaluateW4(cells, settled(0), PROTOTYPE_POOL, FRESH_SESSION);

    expect(w4.wanting).toBe(90);
    expect(w4.showing).toBe(90);
    expect(w4.wanting).toBeLessThan(cells.length);
    expect(w4.measures.find((m) => m.key === "artFraction")?.value).toBe(1);
    expect(w4.pass).toBe(true);
  });

  /**
   * **The capacity a W4 count was taken at is part of the count** (§3.1, DEC-749).
   *
   * The adaptive quantile is taken *relative to* pool capacity, so the same roster at the same pose
   * yields a different answer per capacity — `wantsArt && !frontFacing` is non-empty on 18/45
   * worlds at 16 layers, 30/45 at 64, 37/45 at 128, 42/45 at 224 and 45/45 at 1,024, where it meets
   * `?artThreshold=fixed24`'s 12,771 cells exactly because the threshold never leaves its 24 px
   * floor. Measured on R1's `caa3c4f` over the shipped 45-world roster at 2.2 radii.
   *
   * This bit this leg: the seam contract recorded the 30/45 without recording that 64 was the pool,
   * and 64 is below every rung the renderer ships. An unlabelled count reads as a property of the
   * renderer when it is a property of the harness.
   */
  it("records the capacity beside the count, because the quantile is relative to it", () => {
    const w4 = evaluateW4(
      visible(90),
      settled(0),
      { layers: 224, resident: 90 },
      FRESH_SESSION,
    );
    expect(w4.poolLayers).toBe(224);
    expect(w4.belowShippedPool).toBe(false);
  });

  it("refuses to produce a count at all when the capacity is not supplied", () => {
    // The provenance is positional and required rather than optional: an optional parameter
    // defaults the label back off, and a silently unlabelled count is the whole defect.
    expect(() =>
      (evaluateW4 as unknown as (c: unknown, e: unknown) => unknown)(
        visible(90),
        settled(0),
      ),
    ).toThrow();
  });

  it("flags a sub-shipped capacity as a harness reading without calling the measurement absent", () => {
    // Tier 4's 128 is the smallest rung; 64 is below every configuration a browser can be in.
    const harness = evaluateW4(
      visible(90),
      settled(0),
      { layers: 64, resident: 64 },
      FRESH_SESSION,
    );
    const shipped = evaluateW4(
      visible(90),
      settled(0),
      {
        layers: SMALLEST_SHIPPED_POOL_LAYERS,
        resident: 1,
      },
      FRESH_SESSION,
    );

    expect(harness.belowShippedPool).toBe(true);
    expect(shipped.belowShippedPool, "128 is tier 4, and tier 4 ships").toBe(
      false,
    );
    // The flag is provenance, not a verdict. At 64 layers the policy still works and `artFraction`
    // is still a true measurement of it — scoring it `insufficient` would call a real measurement
    // absent, which is the opposite error. Both rows must agree on the status.
    expect(harness.status).toBe(shipped.status);
    expect(harness.status).toBe("pass");
    expect(harness.measures.find((m) => m.key === "artFraction")?.value).toBe(
      shipped.measures.find((m) => m.key === "artFraction")?.value,
    );
  });

  it("puts the boundary at tier 4 itself, not one layer either side of it", () => {
    // A bound-check is vacuous when the bound never binds, so both sides of it are named.
    expect(
      evaluateW4(
        visible(1),
        settled(0),
        {
          layers: SMALLEST_SHIPPED_POOL_LAYERS - 1,
          resident: 1,
        },
        FRESH_SESSION,
      ).belowShippedPool,
    ).toBe(true);
    expect(
      evaluateW4(
        visible(1),
        settled(0),
        {
          layers: SMALLEST_SHIPPED_POOL_LAYERS,
          resident: 1,
        },
        FRESH_SESSION,
      ).belowShippedPool,
    ).toBe(false);
    expect(SMALLEST_SHIPPED_POOL_LAYERS).toBe(128);
  });

  /**
   * DEC-752 -> DEC-772. Measured on main `f049dca`: the composition never supplies `cardOf`
   * (`sceneHost.ts:207`), so `stream.request` is unreachable and `showingArt` is false for every
   * cell on every world. The art half then reads a flat 0%.
   *
   * Scored as `fail` that is indistinguishable from a policy that genuinely exhausts — and it makes
   * *both* W4 matrix rows inert at once: the `fixed24` expected-RED row goes red for the wrong
   * cause, and the `?layers=128` expected-GREEN row can never go green, so neither row can falsify
   * the instrument. An instrument that reports RED on a frame it never measured is the same defect
   * as one that reports GREEN, pointed the other way.
   */
  describe("a dead art stream is a setup failure, not a policy failure", () => {
    it("reports insufficient when the pool has capacity and demand but nothing resident", () => {
      const dead = evaluateW4(
        cells(1_008, 0),
        settled(0),
        {
          layers: 1_024,
          resident: 0,
        },
        FRESH_SESSION,
      );

      expect(dead.streamNeverRan).toBe(true);
      const art = dead.measures.find((m) => m.key === "artFraction");
      expect(art?.status).toBe("insufficient");
      expect(art?.insufficientReason).toMatch(/art stream never ran/);
      // Not a pass either: `insufficient` is the absence of a measurement, not a third flavour of
      // success. The gate must not green-light a cutover off this row.
      expect(dead.status).not.toBe("pass");
    });

    /**
     * The controls that stop this being vacuous. Each row is one edit away from the dead one and
     * must stay a real measurement — otherwise the guard would swallow the very failures W4 exists
     * to catch, which is a worse bug than the one it fixes.
     */
    it("does not fire on a policy that genuinely exhausts", () => {
      // The prototype's own capture: art resolved, then the pool churned. `resident` is non-zero,
      // so the stream demonstrably ran and 37% is a true reading of the policy.
      const exhausted = evaluateW4(
        cells(2_759, 1_024),
        settled(925),
        {
          layers: 1_024,
          resident: 1_024,
        },
        FRESH_SESSION,
      );

      expect(exhausted.streamNeverRan).toBe(false);
      expect(
        exhausted.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("fail");
    });

    it("does not fire on §1.6's legal swatch-only world", () => {
      // A zero-layer pool is a measurement, not a setup failure (`?layers=0`, or a device whose
      // limit is slack). Nothing is resident there *by construction*, so keying on `resident`
      // alone would misread the one configuration the spec explicitly blesses.
      const swatchOnly = evaluateW4(
        cells(1_008, 0),
        settled(0),
        {
          layers: 0,
          resident: 0,
        },
        FRESH_SESSION,
      );

      expect(swatchOnly.streamNeverRan).toBe(false);
    });

    it("does not fire when nothing wants art", () => {
      // No demand means no layer *should* be resident. Firing here would flag a world that is
      // simply too far away as broken.
      const idle = evaluateW4(
        cells(0, 0),
        settled(0),
        {
          layers: 1_024,
          resident: 0,
        },
        FRESH_SESSION,
      );

      expect(idle.streamNeverRan).toBe(false);
      // ...and scores it out of domain rather than failing it. 0/0 is not 0, and a bare `null`
      // value is a `fail` — which on the 45-world acceptance run reddened **nine** worlds that
      // simply presented no front-facing cell at the sampled azimuth (belenon, ergamon, karsus,
      // muraganda, pyrulea, regatha, segovia, shandalar, zhalfir), eight of them the same worlds
      // W1 reports undefined for the same reason.
      const art = idle.measures.find((m) => m.key === "artFraction");
      expect(art?.value).toBe(null);
      expect(art?.status).toBe("insufficient");
      expect(art?.insufficientReason).toMatch(/none is front-facing/);
      // The eviction half is NOT carried along: no demand says nothing about whether the pool is
      // churning through layers a neighbour's demand bought, so that stays a real reading.
      expect(
        idle.measures.find((m) => m.key === "evictionsPerSecond")?.status,
      ).toBe("pass");
    });

    it("still fails a world whose cells want art and do not get it", () => {
      // The row that keeps the domain rule from becoming a way to lose failures: one wanting cell
      // showing nothing is 0/1, a measurement, and it is red.
      const starved = evaluateW4(
        cells(1, 0),
        settled(0),
        { layers: 1_024, resident: 5 },
        FRESH_SESSION,
      );

      expect(
        starved.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("fail");
    });

    it("calls the forced zero an absent eviction reading too", () => {
      // An eviction is the far end of an admission. A pool with nothing resident has handed out no
      // layer, so it can evict none, and `evictionsPerSecond` is 0 whatever the policy would do —
      // scoring that 0 green is scoring a number the reading could not have moved. Half a criterion
      // passing on a frame it never measured is how a dead row reads as a half-healthy one.
      const dead = evaluateW4(
        cells(1_008, 0),
        settled(0),
        { layers: 1_024, resident: 0 },
        FRESH_SESSION,
      );

      expect(
        dead.measures.find((m) => m.key === "evictionsPerSecond")?.status,
      ).toBe("insufficient");
    });

    it("refuses a pool that omits resident rather than silently passing", () => {
      // The guard's own provenance trap: `undefined === 0` is false, so an omitted field would
      // switch the check off and restore the false RED. Same argument as `pool` being positional.
      expect(() =>
        evaluateW4(
          cells(1_008, 0),
          settled(0),
          // @ts-expect-error — the omission is the thing under test.
          { layers: 1_024 },
          FRESH_SESSION,
        ),
      ).toThrow(/pool\.resident/);
    });
  });

  /**
   * **A tour's carried-over spend is not this world's policy failing (DEC-752, measured on the
   * 45-world acceptance run at main `28ec706`).**
   *
   * The art byte budget is session-lifetime and cumulative — `artStream.ts` sizes it as "a backstop
   * against a pathological session", 729 bodies and then the stream stops asking. Toured in one
   * page, `bytesFetched` crossed 64 MiB at the **8th** world; the remaining **37** each reported
   * `showing` 0 of up to 967 wanting, with `declinedBudget` climbing to 3,046,465, and W4 scored
   * every one of them a flat `fail` at `artFraction` 0 on a renderer doing exactly as specified.
   *
   * `streamNeverRan` cannot see it: that guard asks whether anything is *resident*, and a session
   * that has spent its budget is still holding the layers it bought on the first seven worlds. Two
   * mechanisms, one zero numerator — and a guard written against one says nothing about the other.
   */
  describe("a budget spent before the world was visited is a setup failure", () => {
    /**
     * dominaria's own entry report from that run, as the renderer would publish it today: the
     * session is holding more than its budget and says so.
     */
    const SPENT = {
      swatchOnly: true,
      bytesOutstanding: 67_163_595,
      bytesReserved: 0,
      byteBudget: 67_108_864,
    };

    it("reports insufficient on a world entered with the budget already gone", () => {
      // dominaria's own row from that run: 967 cells wanting art, 0 showing, a full pool of
      // residents bought by earlier worlds.
      const carried = evaluateW4(
        cells(967, 0),
        settled(0),
        { layers: 1_024, resident: 837 },
        SPENT,
      );

      expect(carried.budgetBoundAtEntry).toBe(true);
      expect(carried.streamNeverRan).toBe(false);
      const art = carried.measures.find((m) => m.key === "artFraction");
      expect(art?.status).toBe("insufficient");
      expect(art?.insufficientReason).toMatch(
        /already committed before this world/,
      );
      expect(carried.status).not.toBe("pass");
      // Both halves: with every request declined for budget nothing is admitted, so nothing is
      // evicted, and the eviction rate is 0 by construction rather than by policy.
      expect(
        carried.measures.find((m) => m.key === "evictionsPerSecond")?.status,
      ).toBe("insufficient");
    });

    it("scores a world that spends the budget itself, because that is W4 failing", () => {
      // Entry, not exit. The budget is untouched when this world is entered and its own demand
      // exhausts it — a real reading of the product, and the case the guard must not swallow.
      // `?artThreshold=fixed24` is exactly this shape, and it is W4's only falsifier.
      const ownSpend = evaluateW4(
        cells(2_759, 1_024),
        settled(925),
        PROTOTYPE_POOL,
        FRESH_SESSION,
      );

      expect(ownSpend.budgetBoundAtEntry).toBe(false);
      expect(
        ownSpend.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("fail");
    });

    it("does not fire one byte short of the budget", () => {
      // The boundary is the renderer's, and the row below it must stay a scored reading — otherwise
      // the guard is not "was this stream allowed to fetch" but "was it nearly out", and the last
      // world before the cap would lose a real failure. Same demand and the same starved numerator
      // as the bound row above; only the renderer's verdict differs, and ours flips with it.
      const nearly = evaluateW4(
        cells(967, 100),
        settled(0),
        { layers: 1_024, resident: 100 },
        {
          swatchOnly: false,
          bytesOutstanding: 67_108_863,
          bytesReserved: 0,
          byteBudget: 67_108_864,
        },
      );

      expect(nearly.budgetBoundAtEntry).toBe(false);
      expect(nearly.measures.find((m) => m.key === "artFraction")?.status).toBe(
        "fail",
      );
    });

    /**
     * **The two rows that make this a read rather than a re-derivation (DEC-820 rider 2).**
     *
     * The guard used to carry its own copy of the renderer's condition. That copy was correct when
     * written and wrong after DEC-812, and nothing here noticed, because every fixture had been
     * chosen to sit far from the boundary in agreement with both spellings. These two put the flag
     * and the arithmetic into open disagreement, in both directions, so a guard that recomputes
     * fails one of them whichever stale spelling it reaches for.
     */
    it("believes the renderer over the byte counts when a long session has been evicting", () => {
      // The DEC-812 shape, and the one that matters: a session that has fetched far more than its
      // budget over its lifetime while *holding* almost none of it, because the pool evicted and the
      // stream reclaimed. The renderer is fetching happily. A guard recomputing the retired
      // `bytesFetched + bytesReserved >= byteBudget` calls this budget-bound and throws away a real
      // W4 reading on a healthy world — the guard swallowing what it exists to protect.
      // Declared as a `const` rather than inline so the extra `bytesFetched` survives TypeScript's
      // excess-property check. It is here on purpose: it is what makes this row a mutation kill
      // rather than a rename. With it present the retired spelling is *evaluable* — and wrong,
      // 90,040,620 + 0 >= 19,391,232 — so a guard that reaches for it goes red here. The numbers are
      // the DEC-820 reclaim positive control's, measured live at `?layers=128` on dominaria.
      const entry = {
        swatchOnly: false,
        bytesFetched: 90_040_620,
        bytesOutstanding: 11_991_323,
        bytesReserved: 0,
        byteBudget: 19_391_232,
      };

      const evicting = evaluateW4(
        cells(967, 100),
        settled(29),
        { layers: 128, resident: 128 },
        entry,
      );

      expect(evicting.budgetBoundAtEntry).toBe(false);
      expect(
        evicting.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("fail");
    });

    it("believes the renderer when it declares swatch-only under a slack-looking budget", () => {
      // The other direction. Nothing in the byte counts is near the budget, so every re-derivation
      // — retired or current — reads "plenty left"; the renderer nonetheless reports `swatchOnly`.
      // Whatever produced that, it is the shipped policy's answer to "may this stream fetch", and
      // the gate's job is to read it, not to overrule it with arithmetic of its own.
      const declared = evaluateW4(
        cells(967, 0),
        settled(0),
        { layers: 1_024, resident: 837 },
        {
          swatchOnly: true,
          bytesOutstanding: 1_000,
          bytesReserved: 0,
          byteBudget: 67_108_864,
        },
      );

      expect(declared.budgetBoundAtEntry).toBe(true);
      expect(
        declared.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("insufficient");
    });

    it("refuses an entry report that omits a field rather than defaulting it to zero", () => {
      // `swatchOnly` is the predicate, so its absence is the silent one: `undefined` is falsy, and a
      // guard that let it through would read every world as "allowed to fetch" and disqualify
      // nothing, which is the guard switched off.
      expect(() =>
        evaluateW4(
          cells(967, 0),
          settled(0),
          PROTOTYPE_POOL,
          // @ts-expect-error — the omission is the thing under test.
          { bytesOutstanding: 67_163_595, bytesReserved: 0, byteBudget: 67_108_864 },
        ),
      ).toThrow(/swatchOnly/);

      // The byte counts no longer decide anything, but they are what the disqualification message
      // quotes, and a setup failure reported as `undefined outstanding` names no cause at all.
      expect(() =>
        evaluateW4(
          cells(967, 0),
          settled(0),
          PROTOTYPE_POOL,
          // @ts-expect-error — the omission is the thing under test.
          { swatchOnly: true, byteBudget: 67_108_864 },
        ),
      ).toThrow(/bytesOutstanding/);

      expect(() =>
        // @ts-expect-error — a missing entry report entirely.
        evaluateW4(cells(967, 0), settled(0), PROTOTYPE_POOL),
      ).toThrow(/swatchOnly/);
    });
  });
});

describe("W5 — the home view is not a wall of labels, and every world is reachable", () => {
  const ceiling = homeLabelCeiling(ROSTER_V3);

  /** 45 world slugs, standing in for the v3 roster's `worldsWithCards`. */
  const WORLDS = Array.from(
    { length: ROSTER_V3.worlds },
    (_, i) => `world-${i + 1}`,
  );

  const opts = (minAzimuths = W5_MIN_AZIMUTHS) => ({
    worldsWithCards: WORLDS,
    minAzimuths,
  });

  /** A sweep of `n` azimuths, each labelling `labelledAt(i)`. */
  const sweep = (n: number, labelledAt: (i: number) => readonly string[]) =>
    Array.from({ length: n }, (_, i) => {
      const labelled = labelledAt(i);
      return {
        azimuth: (i / n) * Math.PI * 2,
        labelCount: labelled.length,
        labelledWorlds: labelled,
      };
    });

  /** Every world labelled at every azimuth. */
  const perfect = (n = 24) => sweep(n, () => WORLDS);

  /**
   * The shipping renderer's measured shape: coverage swings 33–42 of 45 across azimuth, but the
   * *rotating* misses mean every world is labelled somewhere. World `i` is dropped at the azimuths
   * where `i` is congruent to the phase, so each world misses a fixed share and none misses all.
   */
  const rotatingMisses = (n = 24, dropPerFrame = 8) =>
    sweep(n, (i) =>
      WORLDS.filter(
        (_, w) =>
          (w - i * dropPerFrame + WORLDS.length * n) % WORLDS.length >=
          dropPerFrame,
      ),
    );

  const measureOf = (c: Criterion, key: string): Measure =>
    c.measures.find((m) => m.key === key)!;

  // ----------------------------------------------------------------------------------------------
  // The ceiling half — a suppression regression check, and honest about being only that
  // ----------------------------------------------------------------------------------------------

  it("derives its ceiling from the roster rather than carrying a number", () => {
    // §3.1 published "≤ 30 (29 worlds plus the belt)". DEC-745 / PR #46 took the v3 dataset to 45
    // worlds, so the same derivation moves with it. Held at 30, W5 would be unsatisfiable by
    // construction on the dataset §3.2 requires it to accept.
    expect(ceiling).toBe(45);
    expect(homeLabelCeiling({ worlds: 29 })).toBe(29);
  });

  it("leaves the belt out of the ceiling, because the belt can never carry a label", () => {
    // `PlaneLabels.tsx:116` filters `blind-eternities` by slug before projection, so its 4,204
    // cards put it in `planesWithCards` without making it labellable. Counting it buys the ceiling
    // a permanent slack of one — in the one direction a ceiling exists to refuse.
    expect(homeLabelCeiling({ worlds: 45, labellableBelts: 1 })).toBe(46);
    expect(homeLabelCeiling(ROSTER_V3)).toBe(45);
    // A renderer that labelled all 45 worlds *and* resurrected the belt's label passes at 46 and
    // fails at 45. That difference is the whole reason the belt comes out.
    const withBelt = sweep(24, () => [...WORLDS, "blind-eternities"]);
    expect(
      measureOf(evaluateW5(withBelt, ROSTER_V3, opts()), "homeLabels").status,
    ).toBe("fail");
    expect(
      measureOf(
        evaluateW5(withBelt, { worlds: 45, labellableBelts: 1 }, opts()),
        "homeLabels",
      ).status,
    ).toBe("pass");
  });

  it("goes RED on its control — labels forced on for the empty planes", () => {
    // Suppression regressed: every plane labelled, so the sweep reads the 87 labellable planes
    // against a ceiling of 45. This is the one thing the ceiling half can still detect.
    const unsuppressed = sweep(24, () => WORLDS).map((s) => ({
      ...s,
      labelCount: ROSTER_V3.planes - ROSTER_V3.belts,
    }));
    expect(
      measureOf(evaluateW5(unsuppressed, ROSTER_V3, opts()), "homeLabels")
        .status,
    ).toBe("fail");
  });

  it("cannot bind once §1.8 has landed, which is why it is named a regression check", () => {
    // Measured, 360 azimuths on `3ce85aed66e9dc3a` at 1920x1080: post-suppression the label count
    // reads 33–42 against a ceiling of 45 and holds 360/360 — there are only 45 candidates, so the
    // bound cannot bind. A bound-check is vacuous when the bound never binds, and the honest repair
    // is to say what it *is* testing rather than to delete it or to trust it.
    for (const count of [33, 38, 42, 45]) {
      const s = sweep(24, () => WORLDS).map((x) => ({
        ...x,
        labelCount: count,
      }));
      expect(
        measureOf(evaluateW5(s, ROSTER_V3, opts()), "homeLabels").status,
      ).toBe("pass");
    }
    // Pre-suppression it fails at every azimuth in the measured band.
    for (const count of [66, 72, 77]) {
      const s = sweep(24, () => WORLDS).map((x) => ({
        ...x,
        labelCount: count,
      }));
      expect(
        measureOf(evaluateW5(s, ROSTER_V3, opts()), "homeLabels").status,
      ).toBe("fail");
    }
  });

  it("reads the ceiling at its worst azimuth, not at a convenient one", () => {
    // One frame under the ceiling proves nothing about the frames either side of it.
    const mostlyFine = sweep(24, () => WORLDS).map((x, i) => ({
      ...x,
      labelCount: i === 7 ? 77 : 40,
    }));
    expect(
      measureOf(evaluateW5(mostlyFine, ROSTER_V3, opts()), "homeLabels").value,
    ).toBe(77);
    expect(
      measureOf(evaluateW5(mostlyFine, ROSTER_V3, opts()), "homeLabels").status,
    ).toBe("fail");
  });

  // ----------------------------------------------------------------------------------------------
  // The reachability half (DEC-751's finding, DEC-752's measurement)
  // ----------------------------------------------------------------------------------------------

  it("cannot tell a good sweep from a lossy one on the ceiling alone", () => {
    // The defect's shape: a ceiling is satisfied by rendering *fewer* labels and does not care
    // which. A renderer that permanently loses three worlds sits *further* under the ceiling than
    // a correct one, so the ceiling half reads GREEN more comfortably on the worse renderer.
    const lost = sweep(24, () => WORLDS.slice(0, 42));
    expect(
      measureOf(evaluateW5(lost, ROSTER_V3, opts()), "homeLabels").status,
    ).toBe("pass");
    expect(
      measureOf(evaluateW5(perfect(), ROSTER_V3, opts()), "homeLabels").status,
    ).toBe("pass");
    // ...and only the reachability half separates them.
    expect(
      measureOf(evaluateW5(lost, ROSTER_V3, opts()), "worldsNeverLabelled")
        .status,
    ).toBe("fail");
    expect(
      measureOf(evaluateW5(perfect(), ROSTER_V3, opts()), "worldsNeverLabelled")
        .status,
    ).toBe("pass");
  });

  it("separates a world hidden this frame from a world permanently lost", () => {
    // This is the distinction a coverage *count* cannot draw, and the reason reachability replaces
    // it. Both sweeps miss eight worlds on every single frame; only one of them loses a world.
    const rotating = rotatingMisses();
    const stuck = sweep(24, () => WORLDS.slice(0, 37));

    for (const s of [rotating, stuck]) {
      // identical single-frame coverage at every azimuth — 37 of 45
      expect(new Set(s.map((f) => f.labelledWorlds.length))).toEqual(
        new Set([37]),
      );
    }
    expect(evaluateW5(rotating, ROSTER_V3, opts()).neverLabelledWorlds).toEqual(
      [],
    );
    expect(
      evaluateW5(stuck, ROSTER_V3, opts()).neverLabelledWorlds,
    ).toHaveLength(8);
  });

  it("does not adopt DEC-751's coverage floor, which its own sweep fails 343 azimuths in 360", () => {
    // Pinned because it is the third instance of one defect — the stale 30, the 0.9 floor, and the
    // coverage proposal that replaced it — and the shape is always a threshold read off a single
    // measurement of a moving system. Over 360 azimuths on `3ce85aed66e9dc3a` the shipping renderer
    // meets ">= 90% of worlds labelled" (equivalently "<= 4 missing") at 17 azimuths. Adopting it
    // would score a compliant renderer RED at 95% of the frames the harness might grab.
    const V3_AZIMUTHS_MEETING_90_PERCENT = 17;
    expect(V3_AZIMUTHS_MEETING_90_PERCENT / 360).toBeLessThan(0.05);
    // The same renderer is fully reachable across that sweep, which is the criterion that survives.
    expect(
      evaluateW5(rotatingMisses(360, 8), ROSTER_V3, opts()).neverLabelledWorlds,
    ).toEqual([]);
  });

  it("does not let labelled moons buy reachability of a world", () => {
    // Reachability is the intersection with `worldsWithCards`. A renderer that labels 45 things,
    // six of them moons, has not reached 45 worlds.
    const s = sweep(24, () => [
      ...WORLDS.slice(0, 39),
      "moon-a",
      "moon-b",
      "moon-c",
      "moon-d",
      "moon-e",
      "moon-f",
    ]);
    const c = evaluateW5(s, ROSTER_V3, opts());
    expect(measureOf(c, "worldsNeverLabelled").value).toBe(6);
    expect(c.neverLabelledWorlds).toEqual(WORLDS.slice(39));
  });

  it("names the worlds it never reached, rather than only counting them", () => {
    const c = evaluateW5(
      sweep(24, () => WORLDS.slice(0, 42)),
      ROSTER_V3,
      opts(),
    );
    expect(c.neverLabelledWorlds).toEqual(WORLDS.slice(42));
    expect(c.wantedWorlds).toBe(45);
    expect(c.azimuths).toBe(24);
  });

  it("reports how often each world is legible, without turning it into a floor", () => {
    // The share is the open ruling: v3's weakest is `karsus` at 20.3% of azimuths, v2's is
    // `avishkar` at 49.7%, so v3 is a regression on a measure nobody has set a bar for. Routed,
    // not guessed — picking a number here is exactly how the 0.9 happened.
    const c = evaluateW5(rotatingMisses(45, 9), ROSTER_V3, opts());
    expect(c.weakestWorlds).toHaveLength(5);
    for (const w of c.weakestWorlds) expect(w.share).toBeGreaterThan(0);
    // Sorted weakest-first, so the gate's output leads with the world closest to being lost.
    const shares = c.weakestWorlds.map((w) => w.share!);
    expect([...shares].sort((a, b) => a - b)).toEqual(shares);
  });

  // ----------------------------------------------------------------------------------------------
  // One frame is not a sweep
  // ----------------------------------------------------------------------------------------------

  it("reports insufficient below its azimuth floor rather than passing or failing", () => {
    // The dangerous direction is silent: handed one frame, reachability degenerates into exactly
    // the single-frame coverage count it replaces, and reads as the stronger claim. `insufficient`
    // is a distinct verdict from both, for the same reason W2's n=1 rows are.
    const one = evaluateW5(perfect(1), ROSTER_V3, opts());
    expect(measureOf(one, "worldsNeverLabelled").status).toBe("insufficient");
    expect(measureOf(one, "homeLabels").status).toBe("insufficient");
    expect(one.status).toBe("insufficient");
    expect(one.pass).toBe(false);
  });

  it("reports insufficient when the sweep is clustered rather than spread around the turn", () => {
    // Enough samples, wrong places. Twelve azimuths bunched into a 30-degree arc is the shape that
    // flakes: measured on `3ce85aed66e9dc3a`, random 12-azimuth sweeps report a world unreachable
    // 2.5% of the time on a renderer that reaches all 45, while every one of the 30 evenly-spaced
    // 12-sweeps reports 0. The count floor cannot see the difference, so the spacing is checked.
    const clustered = perfect(W5_MIN_AZIMUTHS).map((s, i) => ({
      ...s,
      azimuth: (i / W5_MIN_AZIMUTHS) * (Math.PI / 6),
    }));
    expect(
      measureOf(evaluateW5(clustered, ROSTER_V3, opts()), "worldsNeverLabelled")
        .status,
    ).toBe("insufficient");
    expect(evaluateW5(clustered, ROSTER_V3, opts()).pass).toBe(false);

    // The negative control, without which the row above scores identically on a guard that simply
    // refused every sweep: the same count, evenly spaced, still passes.
    expect(evaluateW5(perfect(W5_MIN_AZIMUTHS), ROSTER_V3, opts()).pass).toBe(
      true,
    );
  });

  it("accepts a uniform sweep that is offset, wrapped past a turn, or out of order", () => {
    // The guard bounds where the samples are, not how the sampler spelled them. All three of these
    // are the same comb: refusing one would make the criterion a property of the harness's phase.
    const base = perfect(W5_MIN_AZIMUTHS);
    const shifted = base.map((s, i) => ({
      ...s,
      azimuth: (i / W5_MIN_AZIMUTHS) * Math.PI * 2 + 0.3,
    }));
    const wrapped = base.map((s, i) => ({
      ...s,
      azimuth: (i / W5_MIN_AZIMUTHS) * Math.PI * 2 + Math.PI * 4,
    }));
    const shuffled = [...base].reverse();
    for (const sweep of [shifted, wrapped, shuffled]) {
      expect(evaluateW5(sweep, ROSTER_V3, opts()).pass).toBe(true);
    }
  });

  it("does not score a lossy renderer green just because the sweep was too short", () => {
    // The control on the control: a single azimuth at which every world happens to be labelled is
    // not evidence of reachability, even though the numbers all look right.
    expect(evaluateW5(perfect(1), ROSTER_V3, opts()).pass).toBe(false);
    expect(evaluateW5(perfect(W5_MIN_AZIMUTHS), ROSTER_V3, opts()).pass).toBe(
      true,
    );
    expect(
      evaluateW5(perfect(W5_MIN_AZIMUTHS - 1), ROSTER_V3, opts()).status,
    ).toBe("insufficient");
  });

  it("takes its azimuth floor from the caller, with no default to inherit", () => {
    const s = perfect(16);
    expect(evaluateW5(s, ROSTER_V3, opts(12)).pass).toBe(true);
    expect(evaluateW5(s, ROSTER_V3, opts(24)).status).toBe("insufficient");
  });
});

describe("the W5 visibility predicate", () => {
  it("reads opacity, because the node count is a constant", () => {
    // `labels/layout.ts` places every candidate and signals the drop with opacity alone, so
    // `querySelectorAll('.label').length` is 87 on v3 for *every* renderer — a criterion that cannot
    // vary with its subject. A faded-out label is not on screen.
    expect(isLabelVisible({ opacity: 0 })).toBe(false);
    expect(isLabelVisible({ opacity: 1 })).toBe(true);
  });

  it("counts a label dimmed by occlusion, which is visible and readable", () => {
    // PRD 5.3.11 dims a plane behind a nearer plane to 40%. Thresholding anywhere at or above 0.4
    // would silently drop those from W5 and flatter the ceiling half.
    expect(LABEL_VISIBLE_MIN_OPACITY).toBeLessThan(0.4);
    expect(isLabelVisible({ opacity: 0.4 })).toBe(true);
  });

  it("sits above zero rather than at it", () => {
    expect(LABEL_VISIBLE_MIN_OPACITY).toBeGreaterThan(0);
    expect(isLabelVisible({ opacity: LABEL_VISIBLE_MIN_OPACITY })).toBe(false);
  });
});

describe("the negative-control matrix", () => {
  /**
   * §3.1's matrix, as `checkControlRow` consumes it.
   *
   * Each row names the *measure* it targets, not just the criterion, so a row cannot be scored
   * green by a half it never touches. W2 and W4 are conjunctions and each contributes two rows —
   * one per half — which is what makes a half with no control of its own visible as a gap rather
   * than borrowed from its partner.
   *
   * W2's lightness half has its own row against the same `?swatch=mean` seam only because DEC-749
   * moved the measure onto the iso-shade subset. Before that it was un-failable, and this matrix
   * carried a sixth gate-side row (a flat unshaded wash) to cover for it.
   */
  const MATRIX = [
    {
      row: "W1 · capture at 6× radius",
      criterion: "W1",
      measure: "minMedianCellHeightPx",
      expect: "RED",
    },
    {
      row: "W2 · ?swatch=mean",
      criterion: "W2",
      measure: "medianNeighbourDeltaE",
      expect: "RED",
    },
    {
      row: "W2 · ?swatch=mean (iso-shade half)",
      criterion: "W2",
      measure: "lightnessIqr",
      expect: "RED",
    },
    {
      row: "W3 · ?bands=shuffle",
      criterion: "W3",
      measure: "minAdjacentBandDeltaE",
      expect: "RED",
    },
    {
      row: "W4 · ?artThreshold=fixed24",
      criterion: "W4",
      measure: "artFraction",
      expect: "RED",
    },
    {
      row: "W4 · ?artThreshold=fixed24 (evictions)",
      criterion: "W4",
      measure: "evictionsPerSecond",
      expect: "RED",
    },
    {
      row: "W5 · labels forced on for empty planes",
      criterion: "W5",
      measure: "homeLabels",
      expect: "RED",
    },
    {
      row: "W5 · viewport 800×600",
      criterion: "W5",
      measure: "worldsNeverLabelled",
      expect: "RED",
    },
    {
      row: "W1 · one-card world",
      criterion: "W1",
      measure: "minMedianCellHeightPx",
      expect: "GREEN",
    },
    {
      row: "W2 · one-card world",
      criterion: "W2",
      measure: "lightnessIqr",
      expect: "N/A",
    },
    {
      row: "W3 · one-card world",
      criterion: "W3",
      measure: "minAdjacentBandDeltaE",
      expect: "N/A",
    },
    { row: "W4 · ?layers=128 (tier 4)", criterion: "W4", expect: "GREEN" },
    {
      row: "W5 · viewport 1920×1080",
      criterion: "W5",
      measure: "worldsNeverLabelled",
      expect: "GREEN",
    },
    { row: "all · the unmodified build", criterion: "W2", expect: "GREEN" },
  ] as const;

  it("has eight expected-RED rows, four expected-GREEN and two expected-N/A", () => {
    expect(MATRIX.filter((r) => r.expect === "RED")).toHaveLength(8);
    expect(MATRIX.filter((r) => r.expect === "GREEN")).toHaveLength(4);
    expect(MATRIX.filter((r) => r.expect === "N/A")).toHaveLength(2);
  });

  it("gives every W5 half both a RED row and a GREEN partner", () => {
    // Negative controls distinguish a guard from rubble: an always-red instrument scores the same
    // as a perfect one on RED rows alone, so each half needs an expected-GREEN row too. The
    // viewport pair is the coverage half's — 800×600 loses `thunder-junction` at all 360 azimuths,
    // 1920×1080 loses nothing — and the two rows differ *only* in the harness parameter.
    const w5 = MATRIX.filter((r) => r.criterion === "W5");
    for (const half of ["homeLabels", "worldsNeverLabelled"]) {
      const rows = w5.filter((r) => "measure" in r && r.measure === half);
      expect(rows.some((r) => r.expect === "RED")).toBe(true);
    }
    // The ceiling half's GREEN partner is every other row's unmodified build; the coverage half's
    // is explicit, because its RED row moves a harness parameter rather than a renderer seam.
    expect(
      w5.filter((r) => "measure" in r && r.measure === "worldsNeverLabelled"),
    ).toHaveLength(2);
  });

  it("names only measures the criteria actually emit", () => {
    // A key no criterion returns is reported as a failing row with a confusing detail rather than
    // as a silent pass — safe, but only once. §3.1 shipped two such keys (`medianCellHeightPx`,
    // `worstBandPairDeltaE`); this pins the seven real ones.
    const EMITTED = new Set([
      "minMedianCellHeightPx",
      "medianNeighbourDeltaE",
      "lightnessIqr",
      "minAdjacentBandDeltaE",
      "artFraction",
      "evictionsPerSecond",
      "homeLabels",
      "worldsNeverLabelled",
    ]);
    for (const row of MATRIX) {
      if ("measure" in row) expect(EMITTED.has(row.measure)).toBe(true);
    }
  });

  it("closes W5's coverage gap with a control the harness already owns", () => {
    // This was a declared gap: the one W5 control (`labels forced on for empty planes`) *adds* moon
    // labels and cannot take a world label away, so it tested the ceiling and nothing else, and
    // DEC-752 routed a coverage seam to R1 as the only way out.
    //
    // It does not need one. The collision solver's pressure is set by the viewport, which the gate
    // chooses — no renderer seam involved. Measured over 360 azimuths on `3ce85aed66e9dc3a`: at
    // 1920×1080 every world is labelled at some azimuth, at 800×600 `thunder-junction` is labelled
    // at none. That is a RED row and its non-binding GREEN partner, differing in one harness
    // parameter, aimed squarely at the half the empty-planes row cannot reach.
    const targeted: readonly string[] = MATRIX.flatMap((r) =>
      "measure" in r ? [r.measure] : [],
    );
    expect(targeted).toContain("worldsNeverLabelled");
    expect(targeted.filter((k) => k === "homeLabels")).toHaveLength(1);
  });

  const W = Array.from(
    { length: ROSTER_V3.worlds },
    (_, i) => `world-${i + 1}`,
  );
  const W5_OPTS = { worldsWithCards: W, minAzimuths: W5_MIN_AZIMUTHS };

  /** A 24-azimuth sweep with `labelCount` labels and full reachability, unless told otherwise. */
  const w5Sweep = (labelCount: number, labelled: readonly string[] = W) =>
    Array.from({ length: 24 }, (_, i) => ({
      azimuth: (i / 24) * Math.PI * 2,
      labelCount,
      labelledWorlds: labelled,
    }));

  it("scores a row against the measure it names", () => {
    const red = [evaluateW5(w5Sweep(87), ROSTER_V3, W5_OPTS)];
    expect(
      checkControlRow(red, {
        criterion: "W5",
        measure: "homeLabels",
        expect: "RED",
      }).ok,
    ).toBe(true);
    expect(
      checkControlRow(red, {
        criterion: "W5",
        measure: "homeLabels",
        expect: "GREEN",
      }).ok,
    ).toBe(false);

    const green = [
      evaluateW5(w5Sweep(homeLabelCeiling(ROSTER_V3)), ROSTER_V3, W5_OPTS),
    ];
    expect(
      checkControlRow(green, {
        criterion: "W5",
        measure: "homeLabels",
        expect: "GREEN",
      }).ok,
    ).toBe(true);
  });

  it("scores W5's halves apart, so the ceiling cannot carry the coverage row", () => {
    // The conjunction guard, at the level the matrix consumes it. The 800×600 sweep passes the
    // ceiling — fewer labels fit, so the ceiling reads *better* — and fails reachability; a row
    // asserted at criterion level would read the whole of W5 as RED and never say which half,
    // which is how `?swatch=mean` came to look like a working control for both halves of W2.
    const starved = [
      evaluateW5(w5Sweep(35, W.slice(0, 44)), ROSTER_V3, W5_OPTS),
    ];
    expect(
      checkControlRow(starved, {
        criterion: "W5",
        measure: "homeLabels",
        expect: "GREEN",
      }).ok,
    ).toBe(true);
    expect(
      checkControlRow(starved, {
        criterion: "W5",
        measure: "worldsNeverLabelled",
        expect: "RED",
      }).ok,
    ).toBe(true);
    expect(
      checkControlRow(starved, { criterion: "W5", expect: "GREEN" }).ok,
    ).toBe(false);
  });

  it("fails loudly rather than passing when a criterion or measure is missing", () => {
    // A control row that silently matched nothing would be the `verify-browser --dataset all`
    // failure again: a matrix printing seven greens while running none of them.
    const absent = checkControlRow(
      [evaluateW5(w5Sweep(45), ROSTER_V3, W5_OPTS)],
      {
        criterion: "W4",
        expect: "GREEN",
      },
    );
    expect(absent.ok).toBe(false);
    expect(absent.detail).toContain("was not run");

    const mistyped = checkControlRow(
      [evaluateW5(w5Sweep(45), ROSTER_V3, W5_OPTS)],
      {
        criterion: "W5",
        measure: "labelCount",
        expect: "GREEN",
      },
    );
    expect(mistyped.ok).toBe(false);
    expect(mistyped.detail).toContain("no measure");
  });
});

describe("§1.3's rowCells table", () => {
  /**
   * The published v3 table, vendored on DEC-749's `ab6f5a3` so this runs on a tree without the
   * dataset. It is the *expected-GREEN* row of this section: every mutant below is a one-field edit
   * to it, so a checker that had become always-red would be caught here rather than read as a guard.
   */
  interface PublishedWorld {
    readonly cardCount: number;
    readonly rowCells: readonly number[];
  }
  const PUBLISHED = (
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../../docs/worlds/rowcells-v3.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as { worlds: Record<string, PublishedWorld> }
  ).worlds;

  const published = (slug: string): PublishedWorld => {
    const world = PUBLISHED[slug];
    if (!world) throw new Error(`${slug} is not in the vendored v3 table`);
    return world;
  };

  const worlds = () =>
    Object.entries(PUBLISHED).map(([slug, w]) => ({
      slug,
      kind: "spiral",
      cardCount: w.cardCount,
      rowCells: [...w.rowCells],
    }));

  /**
   * The roster with one world's table replaced — every mutant below is Alara's 510 cards over 23
   * rows, edited one way, so each fault is attributable to the assertion it was aimed at.
   */
  const mutate = (edit: (cells: readonly number[]) => number[]) => {
    const planes = worlds();
    const alara = planes.find((w) => w.slug === "alara");
    if (!alara) throw new Error("alara is not in the vendored v3 table");
    return planes.map((p) =>
      p === alara ? { ...p, rowCells: edit(p.rowCells) } : p,
    );
  };
  const at = (cells: readonly number[], i: number) => cells[i] ?? 0;

  it("passes on the published table, and on the belt and moons that carry none", () => {
    expect(rowCellsFaults(worlds())).toEqual([]);
    expect(Object.keys(PUBLISHED)).toHaveLength(ROSTER_V3.worlds);

    expect(
      rowCellsFaults([
        { slug: "blind-eternities", kind: "dust", cardCount: 4204 },
        { slug: "a-moon", kind: "moon", cardCount: 12 },
      ]),
    ).toEqual([]);
  });

  it("asserts no equatorial symmetry, on the worlds that break every form of it", () => {
    // DEC-749's ruling, as a test rather than a comment: these are the real published tables, and a
    // gate asserting strict symmetry — or the ≤1-pair relaxation, or ≤2 — goes RED on all of them
    // against a correct renderer. Dominaria differs in 15 mirrored pairs; the other four carry a
    // pair differing by two.
    const asymmetric = [
      "dominaria",
      "innistrad",
      "zendikar",
      "theros",
      "thunder-junction",
    ];
    for (const slug of asymmetric) {
      const cells = published(slug).rowCells;
      const pairs = cells.filter((c, i) => c !== cells[cells.length - 1 - i]);
      expect(pairs.length).toBeGreaterThan(0);
      expect(rowCellsFaults(worlds().filter((w) => w.slug === slug))).toEqual(
        [],
      );
    }
  });

  // One mutant per assertion, each moving that assertion's own precondition and nothing else — a
  // mutant that broke the table wholesale would die at the first check and prove only that one.
  it("catches a dropped card, which is §1.3's silent direction", () => {
    // One fewer card placed; rows, the floor and the row count are all still right.
    const faults = rowCellsFaults(
      mutate((cells) => cells.map((c, i) => (i === 4 ? c - 1 : c))),
    );
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("Σ rowCells is 509 against 510 cards");
  });

  it("catches an empty row", () => {
    // Σ stays intact, so this is the floor's own mutant and not the exact-N check firing again.
    const faults = rowCellsFaults(
      mutate((cells) =>
        cells.map((c, i) => (i === 0 ? 0 : i === 10 ? c + at(cells, 0) : c)),
      ),
    );
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("row 0 holds 0 cells");
  });

  it("catches a row count the closed form does not give", () => {
    // Fold the last row into its neighbour: Σ holds, every row stays ≥ 1, only `rows` moves.
    const faults = rowCellsFaults(
      mutate((cells) =>
        cells
          .slice(0, -1)
          .map((c, i, a) =>
            i === a.length - 1 ? c + at(cells, cells.length - 1) : c,
          ),
      ),
    );
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("22 rows against the closed form's 23");
  });

  it("catches a table on a plane that has no cell sheet, and a world with none", () => {
    expect(
      rowCellsFaults([
        { slug: "a-moon", kind: "moon", cardCount: 2, rowCells: [2] },
      ]),
    ).toEqual(["a-moon: kind moon carries a rowCells table"]);
    expect(
      rowCellsFaults([{ slug: "ergamon", kind: "irregular", cardCount: 1 }]),
    ).toEqual(["ergamon: world with no rowCells table"]);
  });

  it("records that the closed form's `min(rows, N)` clamp is unreachable", () => {
    // §1.3 writes `rows = max(1, min(rows_closed, N))`. The clamp never binds — so the gate's third
    // assertion is `rows == rows_closed` on every input, and this is the sweep that says so. A
    // reader scoring that clause as a tested guard is reading a decoration (DEC-752 → DEC-749).
    const binding = [];
    for (let n = 1; n <= 200_000; n += 1)
      if (rowsClosedForm(n) > n) binding.push(n);
    expect(binding).toEqual([]);

    // ...and the control for that sweep: the floor's *other* half, `max(1, ·)`, does bind — at
    // N = 1 and N = 2 the closed form gives one row, which is what §1.3's small-N block ships.
    expect([1, 2, 3].map(rowsClosedForm)).toEqual([1, 1, 2]);
  });
});
