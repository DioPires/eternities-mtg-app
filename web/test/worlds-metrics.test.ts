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
  W3_DOMAIN_SIZE,
  w3QualifiesByShares,
  checkControlRow,
  deltaE76,
  deltaEab,
  evaluateW1,
  evaluateW2,
  evaluateW3,
  evaluateW4,
  evaluateW5,
  evictionRate,
  evictionTail,
  poolHighWater,
  foldCriteria,
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

/**
 * A disc whose shades are spread far enough apart that the ±2.5% ring around the median holds
 * exactly `ringSize` cells — the live shape, where the ring is a sliver of a well-sampled plane.
 * Every cell is well over the 6 px floor and front-facing, so `sampled` is never the binding
 * constraint.
 *
 * At module scope because two sections need the same world: W2's own ring-domain rows, and the
 * matrix's fold, which builds a roster of worlds either side of that domain. A second copy there
 * would be a fixture that could drift from the one the domain is actually pinned against.
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
      expect(
        control.measures.find((m) => m.key === "lightnessIqr")?.status,
      ).toBe("fail");

      // The same wash on the largest ring any *other* v3 world offers but dominaria and ravnica —
      // eight cells, forgotten-realms — is not a control at all. This is the row that would go
      // quietly green if the subject moved.
      const tooSmall = evaluateW2(ringOf(8, [[128, 128, 128]]));
      expect(
        tooSmall.measures.find((m) => m.key === "lightnessIqr")?.status,
      ).toBe("insufficient");
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
  // adjacent bands of one flat colour each, chosen to straddle `FLOORS.bandDeltaE`. Both rows
  // matter — the RED one alone cannot tell a working comparison from a criterion that reds on
  // everything.
  //
  // **The colours were re-picked when the floor moved to the mean fold (DEC-836), which is the third
  // row below doing its job.** It failed loudly on the new floor rather than letting both rows drift
  // to the same side, which is what "a two-sided test that had quietly become one-sided" looks like
  // from the inside. The exact ΔE values stay pinned, because they are also the only place the
  // a\*b\* distance itself is asserted against hand-computable input.
  const twoBands = (other: Rgb): CellSample[] => [
    ...Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: 0,
      height: 20,
      frontFacing: true,
      band: 5,
      rgb: [120, 120, 120] as Rgb,
      shade: 0.9,
    })),
    ...Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: 40,
      height: 20,
      frontFacing: true,
      band: 6,
      rgb: other,
      shade: 0.9,
    })),
  ];
  const twoBandShares = BAND_ORDER.map((_, i) =>
    i === 5 || i === 6 ? 0.5 : 0,
  );

  it("reds a band pair that has converged below the floor", () => {
    const w3 = evaluateW3(twoBands([123, 120, 117]), twoBandShares);
    expect(w3.measures[0]?.value).toBeCloseTo(2.1221, 3);
    expect(w3.pass).toBe(false);
  });

  it("greens the same pair once it separates — the floor is a threshold, not a veto", () => {
    const w3 = evaluateW3(twoBands([126, 120, 114]), twoBandShares);
    expect(w3.measures[0]?.value).toBeCloseTo(4.2683, 3);
    expect(w3.pass).toBe(true);
  });

  it("keeps those two fixtures straddling the floor", () => {
    // The precondition the pair above rests on. `FLOORS.bandDeltaE` is re-derived from the shipped
    // swatches whenever they move (DEC-752, DEC-836), and a floor that drifted outside this bracket
    // would send both rows the same way — leaving a two-sided test that had quietly become
    // one-sided. This fails loudly and says to re-pick the colours instead, which is exactly what it
    // did when the mean fold moved the floor from 0.55.
    expect(FLOORS.bandDeltaE).toBeGreaterThan(2.1221);
    expect(FLOORS.bandDeltaE).toBeLessThan(4.2683);
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

  /**
   * **W3's roster fold — the mean, and the denominator that has to come with it.**
   *
   * Board ruling `fold_mean` (card `7d3653f6`, 2026-09-17) replaced the worst-world fold, which over
   * five identical sessions spanned 1.88× and scored three different worlds. Every row here is about
   * the two things a mean needs that a worst-case fold did not: its verdict must come from the mean
   * itself, and its domain must not be allowed to thin — narrowing a mean *raises* it.
   *
   * The rosters are built by running the real `evaluateW3` over real samples, and the expected means
   * are computed from the readings it produced. Hand-written expectations would agree with a fold
   * that had stopped reading its input.
   */
  describe("the roster fold is the mean (board ruling `fold_mean`)", () => {
    /**
     * A tint at distance `k` from the grey band — a knob on the pair's ΔE, not a magic colour.
     *
     * `k` is continuous, and deliberately: the readings have to be placeable on either side of
     * `FLOORS.bandDeltaE` wherever the next derivation puts it, and at integer steps the smallest
     * tint available already reads 0.70. These are model samples feeding `srgbToLab`, which is
     * defined on the reals; nothing here is claiming a framebuffer holds fractional channels.
     */
    const tint = (k: number): Rgb => [120 + k, 120, 120 - k];
    const plane = (slug: string, k: number) => ({
      slug,
      criterion: evaluateW3(twoBands(tint(k)), twoBandShares),
    });
    const readingOf = (entry: { criterion: Criterion }) => entry.criterion.measures[0]!.value!;
    /**
     * A roster domain as the driver hands it over. `byShares` defaults **above** `scored`, because
     * that is the shipped shape and not a corner case: on the production dataset 30 worlds qualify
     * on their card distribution and 28 present both bands in the sampled cells. A fixture that let
     * the two default to the same number is how the first draft of this guard came to require they
     * be equal — and red every roster tour on the first one that ran it.
     */
    const domain = (
      scored: number | null,
      qualifying: number | null = scored === null ? null : scored + 2,
      byShares: number | null = qualifying,
    ) => ({
      expected: scored === null ? null : { scored, byShares: byShares ?? scored },
      qualifying,
      label: "the test roster",
    });
    const w3MeasureOf = (folded: ReturnType<typeof foldCriteria>) =>
      folded?.measures.find((m) => m.key === "minAdjacentBandDeltaE");

    /**
     * The tint whose pair first reaches `target` ΔE — so the fixture is placed relative to
     * `FLOORS.bandDeltaE` and follows it when the swatches are refreshed and the floor re-derived.
     * A roster pinned to fixed colours is how the two straddling rows above went one-sided when the
     * floor moved from 10 to 0.55, which is a test still passing while measuring nothing.
     */
    const tintReaching = (target: number) => {
      for (let k = 0.02; k <= 200; k += 0.02) {
        if (evaluateW3(twoBands(tint(k)), twoBandShares).measures[0]!.value! >= target) return k;
      }
      throw new Error(`no tint in range reaches ΔE ${target} — re-pick the fixture`);
    };

    // Six worlds spread across the floor, so no row below can be satisfied by a roster of clones: a
    // fold that minimised, maximised or took the first would all read differently here. Two sit
    // under the floor and four over it, which is the shape a mean is defined on and a worst-world
    // fold would have called RED.
    const roster = [
      plane("dim-1", tintReaching(FLOORS.bandDeltaE * 0.1)),
      plane("dim-2", tintReaching(FLOORS.bandDeltaE * 0.4)),
      plane("mid-1", tintReaching(FLOORS.bandDeltaE * 1.5)),
      plane("mid-2", tintReaching(FLOORS.bandDeltaE * 2)),
      plane("bright-1", tintReaching(FLOORS.bandDeltaE * 3)),
      plane("bright-2", tintReaching(FLOORS.bandDeltaE * 4)),
    ];
    const readings = roster.map(readingOf);
    const arithmeticMean = readings.reduce((a, b) => a + b, 0) / readings.length;

    it("takes the mean of the per-world readings, and not the worst of them", () => {
      const measure = w3MeasureOf(foldCriteria(roster, { rosterDomain: domain(6) }));
      expect(measure?.value).toBeCloseTo(arithmeticMean, 10);
      expect(measure?.foldKind).toBe("mean");
      // The control that makes the row a reading rather than a coincidence: the roster really does
      // hold a lower world and a higher one, so mean, min and max are three different numbers.
      expect(Math.min(...readings)).toBeLessThan(arithmeticMean);
      expect(Math.max(...readings)).toBeGreaterThan(arithmeticMean);
      expect(measure?.value).not.toBeCloseTo(Math.min(...readings), 4);
    });

    it("scores the mean itself, never the count of worlds under the floor", () => {
      // The substantive consequence of the ruling, and the one a careless fold would get wrong by
      // keeping `status = fail if any plane failed`: on a floor derived from a *mean*, worlds below
      // it are ordinary. This roster has some — asserted, so the row cannot pass vacuously.
      const under = roster.filter((entry) => readingOf(entry) < FLOORS.bandDeltaE);
      expect(under.length).toBeGreaterThan(0);
      expect(under.some((entry) => entry.criterion.measures[0]?.status === "fail")).toBe(true);

      const measure = w3MeasureOf(foldCriteria(roster, { rosterDomain: domain(6) }));
      expect(measure?.value).toBeGreaterThan(FLOORS.bandDeltaE);
      expect(measure?.status).toBe("pass");
    });

    it("reds a roster whose mean falls under the floor — the bound has to bind", () => {
      // The other side of the row above, and it is not decoration: with only passing rosters in this
      // file, replacing the comparison with `value >= 0` survives every one of them. A floor that is
      // never approached from below is quoted rather than tested. This is the unit shape of the
      // `w3-floor-control` tour, which is W3's only live falsifier.
      const dim = [
        plane("dim-a", tintReaching(FLOORS.bandDeltaE * 0.2)),
        plane("dim-b", tintReaching(FLOORS.bandDeltaE * 0.4)),
        plane("dim-c", tintReaching(FLOORS.bandDeltaE * 0.6)),
      ];
      const measure = w3MeasureOf(foldCriteria(dim, { rosterDomain: domain(3) }));
      expect(measure?.value).toBeLessThan(FLOORS.bandDeltaE);
      expect(measure?.status).toBe("fail");
      // RED on the value, not on the denominator — the two failures must stay distinguishable.
      expect(measure?.domainFaults).toEqual([]);
    });

    it("fails when it scored fewer worlds than the roster puts in domain", () => {
      // **And the thinned roster's mean is HIGHER than the full one's**, which is the whole reason
      // this check exists: dropping the low worlds improves a mean, so a fold that folded whatever
      // arrived would report its best number on its worst evidence.
      const thinned = roster.slice(2);
      const thinnedMean = thinned.map(readingOf).reduce((a, b) => a + b, 0) / thinned.length;
      expect(thinnedMean).toBeGreaterThan(arithmeticMean);

      const measure = w3MeasureOf(
        foldCriteria(thinned, { rosterDomain: domain(roster.length, thinned.length) }),
      );
      expect(measure?.value).toBeCloseTo(thinnedMean, 10);
      expect(measure?.status).toBe("fail");
      expect(measure?.domainFaults?.join(" ")).toContain("scored 4 of the 6 worlds");
      // Not `insufficient`: the measurement happened, it is simply not comparable to the floor.
      expect(measure?.status).not.toBe("insufficient");
    });

    it("still fails a short tour when the run cannot cross-check its own domain", () => {
      // The recorded size is the half that catches a tour which *visited* too few worlds, and it has
      // to bind on its own: a run whose payloads carry no band shares (an older `visits.json`, a
      // probe without them) reports `qualifying: null`, and a check that leaned on the run's own
      // count would go quiet exactly there — four worlds toured, four qualifying, four scored, green.
      const measure = w3MeasureOf(
        foldCriteria(roster.slice(2), { rosterDomain: domain(roster.length, null) }),
      );
      expect(measure?.status).toBe("fail");
      expect(measure?.domainFaults?.join(" ")).toContain("scored 4 of the 6 worlds");
      expect(measure?.qualifyingPlanes).toBeNull();
    });

    it("passes when more worlds qualify by share than the pose can score", () => {
      // **The shipped shape, and the row that keeps the two counts from being conflated again.** A
      // world whose cards qualify can still populate one band in the sampled cells — `shenmeng` and
      // `zhalfir` do — so `byShares` is an upper bound on `scored`, never a second spelling of it.
      // A guard that required them equal reds every correct roster tour.
      const measure = w3MeasureOf(
        foldCriteria(roster, { rosterDomain: domain(roster.length) }),
      );
      expect(measure?.qualifyingPlanes).toBe(roster.length + 2);
      expect(measure?.expectedPlanes).toBe(roster.length);
      expect(measure?.domainFaults).toEqual([]);
      expect(measure?.status).toBe("pass");
    });

    it("fails when the run's own band shares disagree with what the dataset recorded", () => {
      // The other half of the denominator, failing for a different reason: every world the tour
      // visited was scored, and the *dataset* put a different number in W3's reach. `byShares` is a
      // pure function of the band shares, so it is deterministic per refresh — which is what lets it
      // catch a refresh that lands on the same scored count by coincidence.
      const measure = w3MeasureOf(
        foldCriteria(roster, {
          rosterDomain: domain(roster.length, roster.length + 3, roster.length + 2),
        }),
      );
      expect(measure?.status).toBe("fail");
      expect(measure?.domainFaults?.join(" ")).toContain("qualify by band share");
      expect(measure?.qualifyingPlanes).toBe(roster.length + 3);
    });

    it("fails a domain that GREW, not only one that thinned", () => {
      // A mean over 29 worlds is not a better-evidenced mean over 28, it is a different statistic —
      // and the floor was derived over the stated one. Asserted because "thinning" is the obvious
      // half and a `<` comparison would look perfectly reasonable in review.
      const measure = w3MeasureOf(
        foldCriteria(roster, { rosterDomain: domain(roster.length - 1, roster.length + 1) }),
      );
      expect(measure?.status).toBe("fail");
      expect(measure?.domainFaults?.join(" ")).toContain("scored 6 of the 5 worlds");
    });

    it("fails on a dataset with no recorded domain size rather than folding what it has", () => {
      const measure = w3MeasureOf(foldCriteria(roster, { rosterDomain: domain(null, null) }));
      expect(measure?.status).toBe("fail");
      expect(measure?.domainFaults?.join(" ")).toContain("no W3 domain size is recorded");
    });

    it("reports insufficient on a row that toured one subject, not a one-world mean", () => {
      // A roster statistic measured on one world is a different number, not a small version of the
      // same one. Scored against the roster's floor it would red `?art=off` on dominaria — the
      // sibling every composed control row is read against — for arithmetic rather than a defect.
      const measure = w3MeasureOf(foldCriteria([roster[0]!], { rosterDomain: null }));
      expect(measure?.status).toBe("insufficient");
      expect(measure?.insufficientReason).toContain("is not a roster tour");
      // The reading is still carried: `insufficient` here is about the fold, not about the world.
      expect(measure?.value).toBeCloseTo(readings[0]!, 10);
    });

    it("publishes every reading it averaged, lowest first", () => {
      const measure = w3MeasureOf(foldCriteria(roster, { rosterDomain: domain(6) }));
      expect(measure?.readings?.map((r) => r.slug)).toEqual([
        "dim-1",
        "dim-2",
        "mid-1",
        "mid-2",
        "bright-1",
        "bright-2",
      ]);
      expect(measure?.readings?.map((r) => r.value)).toEqual(readings);
    });

    it("prints that it is a mean, with both denominators", () => {
      const folded = foldCriteria(roster, { rosterDomain: domain(6) })!;
      const detail = checkControlRow([folded], {
        criterion: "W3",
        measure: "minAdjacentBandDeltaE",
        expect: "GREEN",
      }).detail;
      // "worst of 6 worlds" and "mean of 6 of 6 worlds" are different claims about one number, and
      // the expected denominator beside the actual one is what makes a short tour visible.
      expect(detail).toContain("mean of 6 of 6 worlds in domain");
      expect(detail).not.toContain("worst of");
    });

    it("leaves every other criterion on the worst-world fold", () => {
      // The ruling is about W3 alone. A `fold` flag that had drifted onto W2 would average away the
      // single degenerate world §3.1 exists to catch, and nothing else in this file would notice.
      expect(evaluateW3(twoBands(tint(6)), twoBandShares).measures[0]?.fold).toBe("mean");
      const w2 = evaluateW2(
        ringOf(W2_MIN_RING_SAMPLES, [
          [110, 110, 110],
          [140, 140, 140],
        ]),
      );
      expect(w2.measures.length).toBeGreaterThan(0);
      for (const measure of w2.measures) expect(measure.fold).toBe("worst");
    });
  });

  /**
   * The domain's dataset half, separated from its pose half — see `w3QualifiesByShares`.
   *
   * Swept across the 5% boundary rather than asserted at a point: a predicate pinned at one share
   * would pass with the comparison inverted, or with the threshold anywhere below the sample.
   */
  describe("which worlds a dataset puts in W3's domain", () => {
    const shares = (a: number, b: number) => {
      const table = BAND_ORDER.map(() => 0);
      table[5] = a;
      table[6] = b;
      return table;
    };

    it("qualifies a pair exactly at the share floor and refuses one just below", () => {
      const step = 1e-9;
      expect(w3QualifiesByShares(shares(W3_MIN_BAND_SHARE, 0.9))).toBe(true);
      expect(w3QualifiesByShares(shares(W3_MIN_BAND_SHARE - step, 0.9))).toBe(false);
      // The smaller side is what binds — swapping the two must not change the answer.
      expect(w3QualifiesByShares(shares(0.9, W3_MIN_BAND_SHARE - step))).toBe(false);
    });

    it("refuses a plane whose only qualifying bands are not adjacent", () => {
      // The two ice caps, at opposite poles. A predicate built from the class list rather than
      // §1.3's band chain would call them a pair and put a one-band world in W3's domain.
      const caps = BAND_ORDER.map(() => 0);
      caps[0] = 0.5;
      caps[BAND_ORDER.length - 1] = 0.5;
      expect(w3QualifiesByShares(caps)).toBe(false);
    });

    it("refuses a plane with no shares at all rather than throwing", () => {
      expect(w3QualifiesByShares(BAND_ORDER.map(() => 0))).toBe(false);
      expect(w3QualifiesByShares(undefined)).toBe(false);
    });

    it("records both domain counts for the production dataset, and they differ", () => {
      // The numbers themselves are evidence, not a claim this file can check — they are measured on
      // the live roster. What is checkable here is that the dataset the gate ships against has them
      // at all (an unrecorded dataset reds every roster fold, and discovering that after a
      // fifteen-minute tour is the wrong time) and that they are **not** the same number, which is
      // the mistake the first draft shipped: 30 worlds qualify on their cards, 28 present both bands
      // in the sampled cells.
      const recorded = W3_DOMAIN_SIZE["c9468f1125bcddff"]!;
      expect(recorded.scored).toBe(28);
      expect(recorded.byShares).toBe(30);
      expect(recorded.byShares).toBeGreaterThan(recorded.scored);
    });
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

  /**
   * A settled pool: plateaued at `resident`, and the counter has stopped moving.
   *
   * **Six samples carrying occupancy, where this used to be three carrying none** — board ruling
   * `bd5c9aad` (option (a)) moved the rate onto a fill-excluded tail, and the fill is detected from
   * `resident`. A timeline without it is not a thin reading, it is an unreadable one: `evictionTail`
   * cannot tell a pool that plateaued from one still filling, and it reports that rather than
   * guessing. Six because the tail is scored against its own second half and a rate needs both.
   */
  const settled = (at: number, resident = 1_024) =>
    Array.from({ length: 6 }, (_, i) => ({
      t: i,
      evictions: at,
      resident,
      layers: resident,
    }));

  /**
   * A pool that has already plateaued at `resident` and is churning steadily at `perSecond`.
   *
   * Steady on purpose: this is the *tail*, after the fill. A timeline whose rate is still decaying
   * is a different fixture and belongs to the convergence rows, not to the rows that score a bound.
   */
  const churningAt = (
    perSecond: number,
    { resident = 1_024, from = 1_000, samples = 8 } = {},
  ) =>
    Array.from({ length: samples }, (_, i) => ({
      t: i,
      evictions: from + Math.round(perSecond * i),
      resident,
      layers: resident,
    }));

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

  /**
   * The stream report at the **exit** of a healthy visit: the world bought some art and the renderer
   * is still willing to fetch.
   *
   * **Deliberately not `FRESH_SESSION`, and the difference is load-bearing.** The two reports go into
   * `evaluateW4` as adjacent positionals of the same shape, so passing one object for both would
   * make a cross-wiring — entry read where exit is meant, or the reverse — invisible on every row
   * here. `bytesOutstanding` differs so the two are distinguishable at a glance in a failure
   * message, and the rows below that turn on the *predicate* put `swatchOnly` itself into
   * disagreement across the two ends, which is what actually kills the swap.
   *
   * See `a-test-double-that-agrees-with-the-bug`: a double chosen to match its sibling cannot
   * witness them being confused.
   */
  const HEALTHY_EXIT = {
    swatchOnly: false,
    bytesOutstanding: 12_000_000,
    bytesReserved: 0,
    byteBudget: 64 * 1024 * 1024,
  };

  /**
   * The exit report of a session that exhausted **during** the visit — `?artThreshold=fixed24`'s own
   * shape, measured: it entered clean and fetched 71.6 MB against a 67.1 MB budget.
   *
   * Entry is `FRESH_SESSION` on every row that uses this, so the two ends disagree and the eviction
   * half's domain can only come from the exit one.
   */
  const EXHAUSTED_DURING_VISIT = {
    swatchOnly: true,
    bytesOutstanding: 71_600_000,
    bytesReserved: 0,
    byteBudget: 67_108_864,
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
      HEALTHY_EXIT,
    );

    // RED on **both** halves, which is what §3.1 has always claimed of this frame — but it was RED
    // on the eviction half alone for the few hours `floor_times_ceiling` stood without an absolute
    // floor under it. Ruling `absolute_floor` (card `74114193`) restored the art half.
    expect(w4.pass).toBe(false);
    expect(w4.measures.find((m) => m.key === "evictionsPerSecond")?.pass).toBe(
      false,
    );
    // 1,024 of 2,759 is 37%, against a bar of 0.5. The bar is the absolute floor and **not**
    // `0.9 × ceiling` (0.334), which this value would clear — so this row is also the witness that
    // the `max` is the term doing the work here.
    const fraction = w4.measures.find((m) => m.key === "artFraction");
    expect(fraction?.value).toBeCloseTo(0.371, 3);
    expect(fraction?.bound).toBe(0.5);
    expect(fraction?.bound).toBeGreaterThan(0.9 * (1_024 / 2_759));
    expect(fraction?.status).toBe("fail");
    // What sees the starvation instead — and it cannot colour the row.
    const demand = w4.measures.find((m) => m.key === "demandFitsCapacity");
    expect(demand?.value).toBeCloseTo(2_759 / 1_024, 6);
    expect(demand?.status).toBe("fail");
    expect(demand?.scored).toBe(false);
  });

  /**
   * **The vacuity `floor_times_ceiling` introduced, and the floor that closes it** (DEC-752, ruling
   * `absolute_floor`, board card `74114193`).
   *
   * A showing cell holds a layer, so on a pool with every layer in use `showing == layers` and
   * `artFraction == layers / wanting == capacityCeiling` exactly. Against a bar of
   * `0.9 × capacityCeiling` the ratio of value to bar was therefore `1 / 0.9` **whatever the capacity
   * and whatever the demand** — a saturated pool could not fail this half at 37%, at 10%, or at 1%.
   *
   * These rows were written asserting that vacuity, and they now assert its repair, against the same
   * three fixtures. A bound-check that cannot fail is not a weaker check, it is not a check; see
   * `a-bound-check-is-vacuous-when-the-bound-never-binds`.
   */
  it("fails artFraction on a saturated pool that is starving it, at every capacity", () => {
    // Three capacities spanning two orders of magnitude, each drawing every layer it has against a
    // demand far beyond it. One of them is Appendix A's own `tether-surface` capture.
    for (const [layers, wanted] of [
      [1_024, 2_759],
      [128, 4_000],
      [16, 16_000],
    ] as const) {
      const w4 = evaluateW4(
        cells(wanted, layers),
        settled(0),
        { layers, resident: layers },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const fraction = w4.measures.find((m) => m.key === "artFraction");
      expect(fraction?.value).toBeCloseTo(layers / wanted, 9);
      // The bar is the absolute floor on all three: `0.9 × ceiling` is 0.334, 0.029 and 0.0009, each
      // of which the value would clear. Asserting the bar and not only the colour is what keeps this
      // a test of *which* term bound.
      expect(fraction?.bound).toBe(0.5);
      expect(
        fraction?.status,
        `${layers} layers against ${wanted} cells wanting art`,
      ).toBe("fail");
    }
    // The last of those shows 0.1% of the art that was wanted.
    expect(16 / 16_000).toBeCloseTo(0.001, 6);
  });

  /**
   * **What the 0.5 actually says, as the claim rather than the number** (ruling `absolute_floor`).
   *
   * On a saturated pool `artFraction == ceiling == layers / wanting`, so clearing an absolute floor
   * `f` is exactly `wanting / layers <= 1 / f`. At `f = 0.5` the floor *is* the rule "demand may
   * exceed pool capacity by at most 2×" — which gives `demandFitsCapacity`, left `reported_only` by
   * ruling `demand_measure_scored`, a scored bound of 2× on precisely the frames where the pool is
   * the constraint.
   *
   * The equivalence is swept rather than asserted at one point, because a single row on either side
   * of a boundary can hold for reasons that have nothing to do with the boundary.
   */
  it("is a 2x overshoot bound on a saturated pool — swept across the boundary", () => {
    const LAYERS = 1_000;
    for (const overshoot of [1.0, 1.5, 1.9, 1.99, 2.0, 2.01, 2.5, 2.69, 4.0]) {
      const wanted = Math.round(LAYERS * overshoot);
      const w4 = evaluateW4(
        cells(wanted, LAYERS),
        settled(0),
        { layers: LAYERS, resident: LAYERS },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const fraction = w4.measures.find((m) => m.key === "artFraction");
      const demand = w4.measures.find((m) => m.key === "demandFitsCapacity");
      // The art half's colour and "is the overshoot within 2x" are the same predicate here...
      expect(fraction?.status, `${overshoot}x overshoot`).toBe(
        overshoot <= 2 ? "pass" : "fail",
      );
      // ...and the unscored measure reports the very quantity the floor is bounding, so the two
      // halves of the ruling can be read against each other instead of taken on faith.
      expect(demand?.value).toBeCloseTo(wanted / LAYERS, 6);
      expect(demand?.scored).toBe(false);
    }
  });

  /**
   * Appendix A's 925 is a *cumulative* counter, not a rate.
   *
   * §3.1 reads both halves of W4 as red at `tether-surface`, and the art half certainly is — 37%
   * against 90%, from the drawn/wanted column directly. The eviction half is an inference from "no
   * sign of settling", and an inference is not a measurement: the same 925 cumulative evictions
   * spread over a settled window is 0/s and passes. The gate must take the rate over §3.1's own
   * 2 s window rather than reading the counter, which is what `evictionRate` is for.
   *
   * > **The art half is red here again, and the round trip is the reason this row is worth reading.**
   * > Under `floor_times_ceiling` alone the sentence above — "the art half certainly is" red — went
   * > false of this fixture: the pool is saturated, so `artFraction` equalled its ceiling and cleared
   * > `0.9 × ceiling`, and the settled `tether-surface` frame passed **both** halves of W4 while
   * > showing 37% of the art it wanted. Ruling `absolute_floor` put a 0.5 under the bar and the
   * > sentence is true again. What the frame demonstrates either way is that the *eviction* half
   * > cannot be inferred from Appendix A's cumulative 925 — that half still passes here, settled.
   */
  it("reds the settled tether-surface frame on art alone — its evictions are not a rate", () => {
    const { drawn, wanted, evicted } = PROTOTYPE.tetherSurface;
    const w4 = evaluateW4(
      cells(wanted, drawn),
      settled(evicted),
      PROTOTYPE_POOL,
      FRESH_SESSION,
      HEALTHY_EXIT,
    );
    // The original claim of this row, unchanged: 925 cumulative is not a rate. This is the half
    // §3.1 reads as red by inference and the gate declines to.
    expect(w4.measures.find((m) => m.key === "evictionsPerSecond")?.value).toBe(
      0,
    );
    expect(w4.measures.find((m) => m.key === "evictionsPerSecond")?.pass).toBe(
      true,
    );
    // And the half that does bind, restored by the absolute floor: 37% against 0.5.
    const fraction = w4.measures.find((m) => m.key === "artFraction");
    expect(fraction?.status).toBe("fail");
    expect(fraction?.bound).toBe(0.5);
    expect(w4.status).toBe("fail");
    // The measure that objected even while the row was green, and is `reported_only` by ruling —
    // it agrees with the art half now rather than standing alone.
    const demand = w4.measures.find((m) => m.key === "demandFitsCapacity");
    expect(demand?.status).toBe("fail");
    expect(demand?.scored).toBe(false);
  });

  it("stays GREEN on ?layers=128 — tier 4, where the quantile raises the threshold to match", () => {
    // §1.6 defines demand relative to pool capacity, so a 128-layer pool does not starve: the
    // effective threshold rises until ~128 cells want art and ~128 resolve. Condemning this row
    // would be condemning the low-end device the ladder exists to protect.
    const w4 = evaluateW4(
      cells(128, 128),
      settled(4_100, 128),
      { layers: 128, resident: 128 },
      FRESH_SESSION,
      HEALTHY_EXIT,
    );
    expect(w4.measures.find((m) => m.key === "artFraction")?.status).toBe(
      "pass",
    );
    expect(w4.measures.find((m) => m.key === "artFraction")?.value).toBe(1);
    // **The claim is on the art half, not on the criterion, since ruling `bd5c9aad`.** The eviction
    // half is out of domain at any capacity but 1,024, so this row's criterion status is now
    // `insufficient` — and asserting `w4.pass` here would quietly turn this row into a test of the
    // capacity domain instead of the one it was written for.
    expect(
      w4.measures.find((m) => m.key === "evictionsPerSecond")?.status,
    ).toBe("insufficient");
    expect(w4.atEvictionPool).toBe(false);
  });

  /**
   * The capacity ceiling — reported on every row, and **scoring since 2026-09-16** (DEC-770 N1,
   * then DEC-752 rulings `split_measures` + `floor_times_ceiling`).
   *
   * A showing cell holds a layer, so `min(1, layers / wanting)` bounds `artFraction` whatever the
   * policy does. The rows below fix that arithmetic, and now also the bar derived from it.
   *
   * > **The paragraph this block used to carry said the ceiling is deliberately not wired to the
   * > verdict, "because the tempting fix would retire `?artThreshold=fixed24`". The board wired it
   * > anyway, the worry was half right, and it took a second ruling to settle.** It was always wrong
   * > about the *live* `fixed24` row, which is budget-starved rather than pool-starved: its demand
   * > fits its pool, its ceiling is 1, its bar is the unmodified 0.9, and it stayed RED throughout —
   * > that row is tested below. It was right about Appendix A's pool-starved `tether-surface`
   * > capture, which passed this half until ruling `absolute_floor` put a 0.5 under the bar. Both are
   * > called "the fixed24 control" in §3.1, and the card that carried `floor_times_ceiling` to the
   * > board described only the first — which is how a named control went green for half a day.
   */
  describe("capacity ceiling", () => {
    it("reports what the pool could show, not what it did", () => {
      const w4 = evaluateW4(
        cells(2_759, 1_024),
        settled(0),
        PROTOTYPE_POOL,
        FRESH_SESSION,
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
      );
      expect(w4.capacityCeiling).toBe(1);
    });

    it("is null where nothing wants art, rather than dividing by zero", () => {
      const w4 = evaluateW4(
        cells(0, 0),
        settled(0),
        { layers: 128, resident: 0 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(w4.capacityCeiling).toBeNull();
    });

    it("keeps the LIVE fixed24 control RED, because its pool is not what starves it", () => {
      // **The half of W4's falsifier that survives the reachable bar, and the distinction the
      // ruling turns on.** Measured on leg G: at `?artThreshold=fixed24` dominaria's demand *fits*
      // its pool — it exhausts the byte BUDGET, 71.6 MB against 67.1 — so its ceiling is 1, its bar
      // is the unmodified 0.9, and 37% is a real failure against a bar it could have reached.
      const w4 = evaluateW4(
        cells(945, 350),
        settled(0),
        { layers: 1_024, resident: 350 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(w4.capacityCeiling).toBe(1);
      expect(w4.artFractionBar).toBeCloseTo(0.9, 9);
      const fraction = w4.measures.find((m) => m.key === "artFraction");
      // `fail`, and specifically not `insufficient`: the row must stay a claim about the picture.
      // An excused ceiling would land here as `insufficient`, which reports as "not measured".
      expect(fraction?.status).toBe("fail");
      // ...and the demand half agrees the pool was never the constraint, which is what makes this
      // row distinguishable from the pool-starved one above rather than a second copy of it.
      expect(
        w4.measures.find((m) => m.key === "demandFitsCapacity")?.status,
      ).toBe("pass");
    });

    it("publishes the bar it scored against, not just the ceiling it derived it from", () => {
      // A verdict that cannot be read without re-deriving its own bound is the shape the fold's
      // missing denominator had.
      const w4 = evaluateW4(
        cells(2_759, 1_024),
        settled(0),
        PROTOTYPE_POOL,
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(w4.artFractionBar).toBe(0.5);
      expect(w4.measures.find((m) => m.key === "artFraction")?.bound).toBe(
        w4.artFractionBar,
      );
      // The bar is strictly between the two terms it is the `max` of, so all three numbers are
      // distinguishable here — a row where any two coincided would pass whichever the code used.
      expect(w4.artFractionBar).toBeLessThan(0.9);
      expect(w4.artFractionBar).toBeGreaterThan(0.9 * (1_024 / 2_759));
    });

    it("takes the ceiling term, not the floor, wherever the ceiling term is higher", () => {
      // The other side of the `max`, without which the floor would be the whole rule and
      // `floor_times_ceiling` would have been reverted rather than repaired. Tier 4's numbers:
      // 0.9 × 0.6244 = 0.5619, above the 0.5.
      const tier4 = evaluateW4(
        cells(205, 125),
        settled(0),
        { layers: 128, resident: 128 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(tier4.artFractionBar).toBeCloseTo(0.9 * (128 / 205), 9);
      expect(tier4.artFractionBar).toBeGreaterThan(0.5);
      // ...and a frame whose demand fits outright keeps the unmodified flat floor.
      const roomy = evaluateW4(
        cells(90, 90),
        settled(0, 90),
        { layers: 224, resident: 90 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(roomy.artFractionBar).toBe(0.9);
    });
  });

  it("passes the unexhausted prototype pose, dominaria-frame at 333/333", () => {
    const { drawn, wanted, evicted } = PROTOTYPE.dominariaFrame;
    const w4 = evaluateW4(
      cells(wanted, drawn),
      settled(evicted),
      PROTOTYPE_POOL,
      FRESH_SESSION,
      HEALTHY_EXIT,
    );
    expect(w4.pass).toBe(true);
  });

  it("differences the rate over a trailing window, not over the whole run", () => {
    // A burst while the camera flew, then quiet. `evictionRate` is the primitive: hand it a window
    // and it differences the counter across it. Since ruling `bd5c9aad` the criterion no longer
    // calls it with a fixed 2 s — `evictionTail` chooses the window and then asks for all of it —
    // but the primitive's own behaviour is what the tail is built out of, so it keeps its row.
    const timeline = [
      { t: 0, evictions: 0 },
      { t: 1, evictions: 900 },
      { t: 3, evictions: 910 },
      { t: 5, evictions: 912 },
    ];
    expect(evictionRate(timeline)).toBeCloseTo(1, 6);
    // The whole window, which is what the tail asks for once it has picked one. 912 over 5 s.
    expect(evictionRate(timeline, Infinity)).toBeCloseTo(912 / 5, 6);
  });

  /**
   * **The fill-excluded tail** — board ruling on DEC-833 card `bd5c9aad`, option (a).
   *
   * A cold pool's first `layers` admissions are page load, not churn, and the old 3 s window could
   * not have told the two apart: dominaria's fill alone outlasts it. These rows are the two halves
   * of the repair, and each one is a trap that was walked into first.
   */
  describe("the eviction rate is taken on a fill-excluded tail", () => {
    /** A cold pool filling to `layers`, then churning steadily. `t` in seconds, 1 Hz. */
    const fillThenChurn = (
      { fillS = 10, tailS = 10, layers = 1_024, perSecond = 18.4 } = {},
    ) => [
      ...Array.from({ length: fillS }, (_, i) => ({
        t: i,
        // The fill admits far faster than the steady state — that is what makes it a fill.
        evictions: 0,
        resident: Math.round((layers * (i + 1)) / fillS) - 1,
        layers,
      })),
      ...Array.from({ length: tailS }, (_, i) => ({
        t: fillS + i,
        evictions: Math.round(perSecond * i),
        // **Saturated, and churning: 1024 → 1023 → 1024.** This is the trap.
        resident: i % 2 === 0 ? layers : layers - 1,
        layers,
      })),
    ];

    it("ends the fill at the plateau, never where resident last stopped climbing", () => {
      // **"Resident stops climbing" is the obvious detector and it is wrong on the one configuration
      // that matters.** A saturated pool churns, so `resident` ticks 1023 → 1024 forever and the
      // last upward tick lands in the final seconds: measured on a 60 s baseline that rule put the
      // fill's end at t = 57.1 s and left a two-row "steady state" — one sample dressed as a rate,
      // the same class of error as the label it replaced (DEC-835).
      //
      // The plateau is the FIRST sample holding `max(resident)`, and on this fixture that is t = 9,
      // where the naive rule would answer t = 18.
      const tail = evictionTail(fillThenChurn());
      expect(tail.peakResident).toBe(1_024);
      // t = 10: the fill's last sample holds 1023, and the first 1024 is the tail's own opening
      // sample. The naive "stopped climbing" rule answers t = 18 on this fixture, eight samples
      // later, because the churn ticks back up to 1024 there.
      expect(tail.plateauT).toBe(10);
      const lastClimb = 18;
      expect(tail.plateauT!).toBeLessThan(lastClimb);
      expect(tail.tailSamples).toBeGreaterThan(5);
      expect(tail.converged).toBe(true);
      expect(tail.rate!).toBeCloseTo(18.4, 1);
    });

    it("scores the whole window on a pool that never saturates, where the counter is pinned at 0", () => {
      // **The defect the first live tour found, and it is the mirror of the one above.** Below
      // saturation `claimLayer` always finds a free layer, so nothing is evicted and nothing leaves
      // the pool: `resident` only ever climbs. `max(resident)` is then *the last sample*, and the
      // tail collapses to whatever run of equal values the window happened to end on.
      //
      // alara, measured: the pool crept to 285 of 1,024 over a 45 s window and was scored off a
      // **2.0 s, two-sample tail** — one sample dressed as a rate, one jitter away from dropping the
      // world out of W4's domain. 44 of the 45 worlds have this shape.
      //
      // The rule is written from what the counter can do instead: there is no fill *in this counter*
      // below saturation, because the counter cannot move there at all.
      const creeping = Array.from({ length: 20 }, (_, i) => ({
        t: i,
        evictions: 0,
        // Monotone, and still climbing at the last sample — never reaching 1,024.
        resident: 100 + 9 * i,
        layers: 1_024,
      }));
      const tail = evictionTail(creeping);
      expect(tail.rate).toBe(0);
      expect(tail.converged).toBe(true);
      expect(tail.tailSamples).toBe(20);
      expect(tail.plateauT).toBe(0);

      // The naive rule, spelled out so the comparison is a reading and not a claim: it would have
      // opened the tail at the last sample.
      const peak = Math.max(...creeping.map((s) => s.resident));
      expect(creeping.findIndex((s) => s.resident === peak)).toBe(19);
    });

    it("needs capacity on every sample, not just occupancy", () => {
      // The saturation test is `resident >= layers`, so a timeline reporting occupancy without
      // capacity cannot be scored either — and the comfortable wrong answer is to treat it as
      // unsaturated and publish the whole window. On a pool that was in fact churning, that is the
      // fill republished as a steady state.
      const noCapacity = Array.from({ length: 8 }, (_, i) => ({
        t: i,
        evictions: 18 * i,
        resident: 1_024,
      }));
      const tail = evictionTail(noCapacity);
      expect(tail.rate).toBe(null);
      expect(tail.why).toMatch(/resident and layers/);
    });

    it("keeps the fill out of the number, which is the whole point of the window", () => {
      // The contaminated figure and the honest one, on the same timeline. Differenced from t = 0 the
      // run reads the churn amortised over a window that is half page load; differenced from the
      // plateau it reads the churn.
      const rows = fillThenChurn();
      const whole = evictionRate(rows, Infinity)!;
      const tail = evictionTail(rows).rate!;
      expect(tail).toBeGreaterThan(whole);
      expect(whole).toBeCloseTo(166 / 19, 1);
    });

    it("refuses a tail that has not settled against its own second half", () => {
      // **Excluding the fill is necessary and it is not sufficient.** DEC-835 measured a 60 s
      // baseline reading 1,461 KiB/s from t = 6, 1,445 from t = 18 and 1,382 from t = 36 — a
      // monotone decline *after* the pool held every layer it would hold. Quoting the earliest as
      // "sustained" is the same error as quoting the whole window, one order smaller.
      //
      // Here: a tail whose rate halves across itself. It is past the plateau and it is still not a
      // steady state, so no number is published.
      const decaying = Array.from({ length: 12 }, (_, i) => ({
        t: i,
        // 40/s for the first half, 10/s for the second.
        evictions: i <= 5 ? 40 * i : 200 + 10 * (i - 5),
        resident: 1_024,
        layers: 1_024,
      }));
      const tail = evictionTail(decaying);
      expect(tail.converged).toBe(false);
      expect(tail.rate).toBe(null);
      expect(tail.halfRate).not.toBe(null);
      expect(tail.why).toMatch(/not settled/);

      // ...and the criterion reports that rather than a verdict. A gate that scored the first half
      // of this tail would be publishing the fill under a different name.
      const w4 = evaluateW4(
        cells(945, 942),
        decaying,
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const evictions = w4.measures.find((m) => m.key === "evictionsPerSecond");
      expect(evictions?.status).toBe("insufficient");
      expect(evictions?.value).toBe(null);
    });

    it("calls two zeros converged, because 0/0 is not a drift", () => {
      // A relative drift is undefined at zero, and zero is the common case rather than an edge: 44
      // of the 45 worlds never saturate the pool, so they churn nothing and both halves read 0.
      // `0/0` would report the arms that have most obviously converged as unconverged, and every
      // quiet world would fall out of W4's domain at once.
      const tail = evictionTail(settled(925));
      expect(tail.converged).toBe(true);
      expect(tail.rate).toBe(0);
      expect(tail.drift).toBe(0);
    });

    it("publishes no rate from a timeline too short to have a tail", () => {
      // A rate needs a window, and below this the fill and the steady state are not separable in
      // this run. Reporting no sustained figure is the honest outcome; mislabelling one is the
      // defect being fixed, so a too-short window must not produce a number.
      const brief = [
        { t: 0, evictions: 0, resident: 900, layers: 1_024 },
        { t: 0.2, evictions: 4, resident: 1_024, layers: 1_024 },
        { t: 0.4, evictions: 8, resident: 1_024, layers: 1_024 },
      ];
      const tail = evictionTail(brief);
      expect(tail.rate).toBe(null);
      expect(tail.why).toMatch(/at least 5/);
    });

    it("reads a timeline with no occupancy as unreadable, not as a settled zero", () => {
      // The fill is detected from `resident`, so a timeline without it cannot be scored at all —
      // and the wrong answer here is the comfortable one. A `0` would sail through the bound on
      // every row that forgot to report occupancy, which is `streamNeverRan`'s lesson (a structural
      // zero wearing a passing verdict) arriving by a fourth route.
      const blind = Array.from({ length: 8 }, (_, i) => ({
        t: i,
        evictions: 30 * i,
      }));
      const tail = evictionTail(blind);
      expect(tail.rate).toBe(null);
      expect(tail.converged).toBe(false);
      // **The reason has to be pinned, not merely the null.** Dropping the occupancy check makes
      // `max(resident)` NaN, nothing matches it, the tail collapses to one sample and the function
      // still returns `rate: null` — so a row asserting only the null passes under the mutant, and
      // a row matching the loose word `resident` passes too, because the short-tail message says
      // "resident layers". The mutant survived both before this line. `null` is the answer; *which*
      // question it answers is the finding.
      expect(tail.why).toMatch(/must carry t, evictions and resident/);
      expect(tail.peakResident).toBe(null);

      // **Both fields, separately.** A timeline carrying capacity but no occupancy is the fixture
      // that was missing: with only the `layers` check left standing, every row above still went
      // unreadable for the *other* reason and the dropped occupancy check survived its own mutant.
      // Two conditions in one predicate need two witnesses.
      const capacityOnly = Array.from({ length: 8 }, (_, i) => ({
        t: i,
        evictions: 18 * i,
        layers: 1_024,
      }));
      expect(evictionTail(capacityOnly).rate).toBe(null);
      expect(evictionTail(capacityOnly).why).toMatch(
        /must carry t, evictions and resident/,
      );
    });

    it("publishes whether the pool filled and how far the counter moved, over three shapes", () => {
      // The two facts DEC-842's domain rule reads. They are published here rather than re-derived at
      // the call site for the reason the file already gives about `saturated`: a second spelling is
      // a second thing to keep in step.
      const creeping = Array.from({ length: 20 }, (_, i) => ({
        t: i,
        evictions: 0,
        resident: 100 + 9 * i,
        layers: 1_024,
      }));
      expect(evictionTail(creeping).saturated).toBe(false);
      expect(evictionTail(creeping).evictionsObserved).toBe(0);

      const churning = evictionTail(churningAt(18.4));
      expect(churning.saturated).toBe(true);
      expect(churning.evictionsObserved).toBe(Math.round(18.4 * 7));

      // **`null`, not `false`, on a timeline too short to ask.** "The pool never filled" is a
      // finding, and a run that could not be read has not made it. The domain rule tests `=== false`
      // so this row cannot borrow the stronger one.
      expect(evictionTail(settled(925).slice(0, 2)).saturated).toBe(null);
      expect(evictionTail(settled(925).slice(0, 2)).evictionsObserved).toBe(null);
    });
  });

  /**
   * **An unsaturated pool cannot fail this bound, so it is not scored against it** (DEC-842, rider 1
   * of the DEC-841 review of PR #77).
   *
   * `claimLayer` walks the pool for a free layer and only looks for a victim when it finds none, so
   * `pool.evictions` cannot move below saturation. A session whose pool never filled therefore
   * reports a 0 that is a fact about occupancy and not a reading of churn — and it used to score
   * `pass`. On the 45-world tour **44 worlds have that shape**, which made the headline "17.8969/s,
   * worst of 45 worlds" a fold over 44 readings that could not fail and one that could.
   *
   * Today's GREEN was not wrong: the worst-of fold takes dominaria's colour. The risk is that it goes
   * quiet — if dominaria stops saturating after a roster change or a larger pool, the half greens on
   * 45 structural zeros and nothing says the bound stopped binding. That is
   * `a-bound-check-is-vacuous-when-the-bound-never-binds` arriving through the domain rather than
   * through the constant, which is the shape DEC-834 used to kill option (b).
   */
  describe("a pool that never filled is out of the eviction half's domain", () => {
    /** The reviewer's measured shape: 1,024 layers, `resident` creeping 100 → 271, counter flat. */
    const creeping = Array.from({ length: 20 }, (_, i) => ({
      t: i,
      evictions: 0,
      resident: 100 + 9 * i,
      layers: 1_024,
    }));

    it("scores the structural zero insufficient, where the same window saturated is a rate", () => {
      // **Both arms, because a colour on its own does not say which rule produced it.** A blanket
      // `insufficient` on every eviction reading would satisfy the first half of this test and
      // destroy the measure; the second half is what forbids it.
      const unsaturated = evaluateW4(
        cells(271, 271),
        creeping,
        { layers: 1_024, resident: 271 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const quiet = unsaturated.measures.find(
        (m) => m.key === "evictionsPerSecond",
      );
      expect(quiet?.status).toBe("insufficient");
      // **The reason is pinned, not merely matched.** `a-total-mutant-proves-only-the-first-assertion`
      // and M23's lesson one measure over: three domain rules can null this rate, and a row asserting
      // only the colour passes under a mutant that swapped one for another.
      expect(quiet?.insufficientReason).toMatch(/never had a free layer to lose/);
      expect(quiet?.insufficientReason).toMatch(/peaked at 271 of 1024/);
      // The value is kept rather than blanked, exactly as the capacity rule keeps a tier-4 rate: the
      // record should show the structural zero it refused to score, not hide it.
      expect(quiet?.value).toBe(0);

      // Same length, same cadence, same counter — saturated. The bound is scored and it passes.
      const saturated = evaluateW4(
        cells(945, 942),
        churningAt(17.9, { samples: 20 }),
        PROTOTYPE_POOL,
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const scored = saturated.measures.find(
        (m) => m.key === "evictionsPerSecond",
      );
      expect(scored?.status).toBe("pass");
      expect(scored?.value).toBeCloseTo(17.9, 1);
      expect(scored?.insufficientReason).toBe(null);
    });

    it("scores a churning pool whose occupancy reads a layer light, because the counter is the proof", () => {
      // **The conjunct, and it is what makes this rule safe to score at all.** `poolHighWater` is a
      // *lower* bound: `?probe=` publishes `resident` and not `reserved`, so a full pool with a layer
      // in flight reads `layers - 1`. On `saturated` alone this row would be marked out of domain —
      // a real reading called absent, which is the objection `poolHighWater`'s own note raises
      // against promoting it to a domain rule.
      //
      // A counter that moved is *proof* the pool reached saturation, whatever occupancy was sampled
      // at. So the rule only converts readings where the counter provably never moved.
      const underRead = churningAt(17.9, { samples: 20 }).map((s) => ({
        ...s,
        resident: 1_023,
      }));
      const w4 = evaluateW4(
        cells(945, 942),
        underRead,
        { layers: 1_024, resident: 1_023 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(w4.evictionTail.saturated).toBe(false);
      expect(w4.evictionTail.evictionsObserved).toBeGreaterThan(0);
      const ev = w4.measures.find((m) => m.key === "evictionsPerSecond");
      expect(ev?.status).toBe("pass");
      expect(ev?.value).toBeCloseTo(17.9, 1);

      // ...and it still fails when it should. The conjunct buys a reading back into the domain; it
      // does not buy it a verdict. `reachable-is-not-discriminating`.
      const fast = evaluateW4(
        cells(945, 942),
        churningAt(24.2, { samples: 20 }).map((s) => ({ ...s, resident: 1_023 })),
        { layers: 1_024, resident: 1_023 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(
        fast.measures.find((m) => m.key === "evictionsPerSecond")?.status,
      ).toBe("fail");
    });

    it("leaves an unreadable timeline reporting that it is unreadable", () => {
      // A timeline too short to establish anything keeps its own message instead of being handed a
      // stronger finding. Two `n/a`s that read alike are how a domain rule swallows a run nobody
      // meant it to.
      //
      // **Both conjuncts refuse `null` on their own** — `saturated === false` and
      // `evictionsObserved === 0` are each written against the value and not against its
      // truthiness — so only a mutant that loosens *both* can reach this row. That redundancy is
      // deliberate and M34 is what proves it is redundancy rather than one live guard and one
      // decoration.
      const brief = creeping.slice(0, 3);
      const w4 = evaluateW4(
        cells(120, 120),
        brief,
        { layers: 1_024, resident: 118 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const ev = w4.measures.find((m) => m.key === "evictionsPerSecond");
      expect(ev?.status).toBe("insufficient");
      expect(ev?.insufficientReason).toMatch(/usable sample/);
      expect(ev?.insufficientReason).not.toMatch(/never had a free layer/);
    });

    it("thins the roster fold to the worlds that could bind, and says so", () => {
      // **This is the number the rider was raised about.** 44 quiet worlds and one that churns: the
      // fold's own denominator now reads 1 where it read 45, so "worst of 45 worlds" can no longer
      // be printed over a domain in which 44 readings cannot fail.
      const quiet = (slug: string) => ({
        slug,
        criterion: evaluateW4(
          cells(271, 271),
          creeping,
          { layers: 1_024, resident: 271 },
          FRESH_SESSION,
          HEALTHY_EXIT,
        ),
      });
      const roster = [
        ...Array.from({ length: 44 }, (_, i) => quiet(`quiet-${i}`)),
        {
          slug: "dominaria",
          criterion: evaluateW4(
            cells(945, 942),
            churningAt(17.9, { samples: 20 }),
            PROTOTYPE_POOL,
            FRESH_SESSION,
            HEALTHY_EXIT,
          ),
        },
      ];
      const folded = foldCriteria(roster)!;
      const ev = folded.measures.find((m) => m.key === "evictionsPerSecond")!;
      expect(ev.scoredPlanes).toBe(1);
      expect(ev.insufficientPlanes).toBe(44);
      expect(ev.worstPlane).toBe("dominaria");
      expect(ev.status).toBe("pass");
    });

    it("stops being quiet: the half goes N/A, not green, when nothing saturates", () => {
      // **The failure the rule exists to prevent, run forwards.** Retire the one world that
      // saturates — a roster change, a larger pool, a threshold that stops asking for enough — and
      // the eviction half used to fold 45 structural zeros into a comfortable GREEN. It now folds to
      // `insufficient`, and `checkControlRow` reads that as `N/A`, so the `no-seams` row's
      // `expect: 'GREEN'` on this measure FAILS. The gate reds instead of going quiet, which is the
      // whole of what this rider asked for.
      const roster = Array.from({ length: 45 }, (_, i) => ({
        slug: `quiet-${i}`,
        criterion: evaluateW4(
          cells(271, 271),
          creeping,
          { layers: 1_024, resident: 271 },
          FRESH_SESSION,
          HEALTHY_EXIT,
        ),
      }));
      const folded = foldCriteria(roster)!;
      const ev = folded.measures.find((m) => m.key === "evictionsPerSecond")!;
      expect(ev.status).toBe("insufficient");
      expect(ev.scoredPlanes).toBe(0);
      expect(ev.insufficientReason).toMatch(/every plane was out of domain/);

      const check = checkControlRow([folded], {
        criterion: "W4",
        measure: "evictionsPerSecond",
        expect: "GREEN",
      });
      expect(check.ok).toBe(false);
      expect(check.detail).toMatch(/went N\/A/);

      // Before this rule the same roster folded GREEN off a worst-of over 45 zeros — asserted here
      // rather than asserted in prose, because the whole finding is that the old shape *passed*.
      const asScoredBefore = foldCriteria(
        roster.map((entry) => ({
          ...entry,
          criterion: {
            ...entry.criterion,
            measures: entry.criterion.measures.map((m) =>
              m.key === "evictionsPerSecond"
                ? { ...m, status: "pass", pass: true, insufficientReason: null }
                : m,
            ),
          },
        })),
      )!;
      const before = asScoredBefore.measures.find(
        (m) => m.key === "evictionsPerSecond",
      )!;
      expect(before.status).toBe("pass");
      expect(before.scoredPlanes).toBe(45);
    });
  });

  /**
   * **`artCellsShowing` — the absolute no-starvation term** (board ruling `bd5c9aad`, N2).
   *
   * `artFraction` read **1.00** on a frame showing fourteen cells of art, because the adaptive
   * threshold had collapsed its denominator to fourteen: at `?layers=128` under reduced motion the
   * want set fell to 14 cells, all 14 resolved, and the ratio came out *better* than the healthy
   * baseline's 0.9968 (DEC-834). The ratio was not wrong. It was answering a question about a want
   * set the policy under test had chosen. See `a-ratio-is-blind-to-its-own-denominator`.
   */
  describe("the absolute no-starvation term", () => {
    /** `wanted` cells asking for art, `drawn` of them showing it, inside a frame of `onScreen`. */
    const frameOf = (onScreen: number, wanted: number, drawn: number) => [
      ...cells(wanted, drawn),
      ...Array.from({ length: onScreen - wanted }, () => ({
        frontFacing: true,
        onScreen: true,
        wantsArt: false,
        showingArt: false,
      })),
    ];

    it("reds DEC-834's collapsed want set, the frame artFraction scored 1.00", () => {
      // The witness, at its measured numbers: 14 cells wanted art out of ~2,000 on screen, all 14
      // got it. This is the row the term exists for and it must be red on it.
      const starved = evaluateW4(
        frameOf(2_000, 14, 14),
        settled(0, 128),
        { layers: 128, resident: 128 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );

      const fraction = starved.measures.find((m) => m.key === "artFraction");
      const absolute = starved.measures.find((m) => m.key === "artCellsShowing");
      // The fraction still reads a perfect score, and that is not a bug in the fraction.
      expect(fraction?.value).toBe(1);
      expect(fraction?.status).toBe("pass");
      // The absolute term is what sees it.
      expect(absolute?.value).toBe(14);
      expect(absolute?.bound).toBe(32);
      expect(absolute?.status).toBe("fail");
      expect(starved.status).toBe("fail");
    });

    it("keeps the domain four times clear of the floor, so an entering frame has room", () => {
      // **The defect the first acceptance tour found, and it was structural rather than unlucky.**
      // With the floor and the domain cut-off both at 64, the domain admits a frame at the instant
      // it reaches the bound — so the worst in-domain reading is pinned just above the bound however
      // healthy the build is. The roster offers nowhere to put a cut-off that avoids this: its
      // `presented` counts run 0, 1, 7, 15, 18, 26, 33, 61, 65, 66, 68, 69, 75, 77, 95 ... unbroken.
      // Measured with both at 64, the 45-world tour read 65 against 64 — a 1.5% margin on a correct
      // build, one cell of jitter from a red acceptance tour.
      //
      // The row is the worst frame that can *enter* the domain: presented exactly at the threshold,
      // at dominaria's pool-limited 0.68 art ratio — the lowest of any in-domain world, and lower
      // than a frame this size would really show, since nothing is pool-limited at 128 cells.
      const worstEntrant = evaluateW4(
        frameOf(128, 128, 87),
        settled(0),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const entering = worstEntrant.measures.find(
        (m) => m.key === "artCellsShowing",
      );
      expect(entering?.status).toBe("pass");
      // Not "it passes" — "it passes with room". At floor 64 this reads 1.36x, and a row that only
      // checked the colour would have gone green on the defect the tour found.
      expect(entering!.value! / entering!.bound).toBeGreaterThanOrEqual(2);
      // One cell below the domain, the same frame is not scored at all.
      expect(
        evaluateW4(
          frameOf(127, 127, 86),
          settled(0),
          { layers: 1_024, resident: 1_024 },
          FRESH_SESSION,
          HEALTHY_EXIT,
        ).measures.find((m) => m.key === "artCellsShowing")?.status,
      ).toBe("insufficient");
    });

    it("stays green on the healthy frames at both ends of the ladder", () => {
      // A term that reds a correct build is a tripwire, not a control. The two live readings it has
      // to clear: the shipped 1,024-layer baseline at ~942 cells of art, and the tier-4 rung at ~126
      // — the smallest shipped pool, where the floor is closest to binding on a healthy build.
      const baseline = evaluateW4(
        frameOf(2_000, 945, 942),
        churningAt(18.4),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const tier4 = evaluateW4(
        frameOf(2_000, 205, 126),
        settled(0, 128),
        { layers: 128, resident: 128 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );

      for (const w4 of [baseline, tier4]) {
        expect(w4.measures.find((m) => m.key === "artCellsShowing")?.status).toBe(
          "pass",
        );
      }
      // Named from every side so the margins are on the record rather than implied, and all four
      // are measured readings: 14 is DEC-834's witness, 127 the live `?layers=128` row, 146 the
      // worst in-domain world of the 45-world acceptance tour (forgotten-realms), 941 dominaria at
      // the shipped pool.
      expect(tier4.measures.find((m) => m.key === "artCellsShowing")!.value!).toBe(126);
      expect(32 / 14).toBeGreaterThan(2.2);
      expect(127 / 32).toBeGreaterThan(3.9);
      expect(146 / 32).toBeGreaterThan(4.5);
    });

    it("is out of domain on a frame too small to offer the floor, not red on it", () => {
      // The one-card world. A floor of "64 cells must be showing art" is the one shape of bound
      // segovia can never clear, and scoring it there would red a correct renderer for ever —
      // `a-bound-check-is-vacuous-when-the-bound-never-binds` in its mirror image.
      const oneCard = evaluateW4(
        frameOf(1, 1, 1),
        settled(0),
        { layers: 1_024, resident: 1 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const absolute = oneCard.measures.find((m) => m.key === "artCellsShowing");
      expect(absolute?.status).toBe("insufficient");
      expect(absolute?.insufficientReason).toMatch(/front-facing and on screen/);
      // ...and `artFraction`, which is defined at n = 1, still scores the world.
      expect(oneCard.measures.find((m) => m.key === "artFraction")?.status).toBe(
        "pass",
      );
    });

    it("takes its domain from the frame's geometry, never from the want set", () => {
      // **The whole of why this term works, as a single comparison.** Both frames show 14 cells of
      // art. They differ in how many cells are *on screen* — a fact about where the camera is, which
      // the art policy gets no vote on. A domain written off `wanting` instead would have gone
      // `insufficient` on the starved frame, because `wanting` is 14 there: the collapse this term
      // exists to catch would have switched the term off. Same defect, one level up.
      const starved = evaluateW4(
        frameOf(2_000, 14, 14),
        settled(0),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const genuinelySmall = evaluateW4(
        frameOf(14, 14, 14),
        settled(0),
        { layers: 1_024, resident: 14 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );

      expect(starved.showing).toBe(genuinelySmall.showing);
      expect(starved.presented).toBe(2_000);
      expect(genuinelySmall.presented).toBe(14);
      expect(
        starved.measures.find((m) => m.key === "artCellsShowing")?.status,
      ).toBe("fail");
      expect(
        genuinelySmall.measures.find((m) => m.key === "artCellsShowing")?.status,
      ).toBe("insufficient");
    });

    it("does not fire where the art stream never ran — that is a setup failure and says so", () => {
      // The no-admission cases already own their zeroes. Letting the absolute term red them too
      // would give one setup failure two red measures and make both W4 rows inert at once, which is
      // the defect `streamNeverRan` was landed to fix.
      const dead = evaluateW4(
        frameOf(2_000, 945, 0),
        settled(0),
        { layers: 1_024, resident: 0 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      const absolute = dead.measures.find((m) => m.key === "artCellsShowing");
      expect(dead.streamNeverRan).toBe(true);
      expect(absolute?.status).toBe("insufficient");
      expect(absolute?.insufficientReason).toMatch(/art stream never ran/);
    });
  });

  /**
   * **`poolHighWater` is the eviction rate's denominator, and these rows are dominaria's own.**
   *
   * The four recorded runs of the `baseline` row read `evictionsPerSecond` 0, 0, 0, 18.357 and were
   * reported identically apart from the number. They separate on occupancy and on nothing else, so
   * the fixtures here are the measured occupancies rather than invented ones: a pool that never
   * fills cannot evict, because `artPool.claimLayer` takes any free layer before it takes a victim.
   */
  it("reports the pool's high-water mark so a zero eviction rate has a denominator", () => {
    const unsaturated = [
      { t: 0, evictions: 0, resident: 512, layers: 1024 },
      { t: 1, evictions: 0, resident: 701, layers: 1024 },
      { t: 2, evictions: 0, resident: 698, layers: 1024 },
    ];
    expect(poolHighWater(unsaturated)).toEqual({
      resident: 701,
      layers: 1024,
      saturated: false,
    });
    // The same eviction rate, the other cause. `accept3` and `baseline` both read a rate; only one
    // of them was taken on a pool that could have produced it.
    expect(evictionRate(unsaturated)).toBe(0);

    const saturated = [
      { t: 0, evictions: 0, resident: 1010, layers: 1024 },
      { t: 1, evictions: 18, resident: 1024, layers: 1024 },
      { t: 2, evictions: 37, resident: 1024, layers: 1024 },
    ];
    expect(poolHighWater(saturated)?.saturated).toBe(true);
    expect(evictionRate(saturated)).toBeGreaterThan(5);
  });

  /**
   * An empty timeline is not an empty pool — the same distinction `streamDelta` keeps by returning
   * `null` rather than a zero-filled object. A `0/0` high-water would read as a pool that held
   * nothing, which is a measurement, when what happened is that nothing was measured.
   */
  it("returns null for a timeline that carries no occupancy, never a zero-filled reading", () => {
    expect(poolHighWater([])).toBeNull();
    // The pre-DEC-752 timeline shape: evictions only, no occupancy. It must not report 0/0.
    expect(poolHighWater([{ t: 0, evictions: 0 }])).toBeNull();
  });

  /**
   * **The bound is `>=`, and this row is why it may not be `>`.** `resident` reaching `layers` is
   * exactly the state in which `claimLayer` finds no free layer, so equality is saturation. A
   * strict comparison would report the one pool that *is* full as having room.
   */
  it("counts a pool at exactly its capacity as saturated", () => {
    const full = [{ t: 0, evictions: 4, resident: 128, layers: 128 }];
    expect(poolHighWater(full)?.saturated).toBe(true);
    // A zero-layer pool is a swatch-only world, which the criterion treats as a measurement — but
    // it has no capacity to saturate, so it must not report as full.
    const swatchOnly = [{ t: 0, evictions: 0, resident: 0, layers: 0 }];
    expect(poolHighWater(swatchOnly)?.saturated).toBe(false);
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
    const w4 = evaluateW4(
      cells,
      settled(0),
      PROTOTYPE_POOL,
      FRESH_SESSION,
      HEALTHY_EXIT,
    );

    expect(w4.wanting).toBe(90);
    expect(w4.showing).toBe(90);
    // The exclusion must actually be doing work, or this row is vacuous like the ones above it.
    expect(w4.wanting).toBeLessThan(cells.length);
    expect(w4.measures.find((m) => m.key === "artFraction")?.value).toBe(1);
    // The art half, not the criterion: 90 presented cells sit below `artCellsShowing`'s domain, so
    // W4's own status here is `insufficient`, and asserting it would turn this into a test of that
    // domain instead of the denominator exclusion the row is about.
    expect(w4.measures.find((m) => m.key === "artFraction")?.status).toBe("pass");
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
    const w4 = evaluateW4(
      cells,
      settled(0),
      PROTOTYPE_POOL,
      FRESH_SESSION,
      HEALTHY_EXIT,
    );

    expect(w4.wanting).toBe(90);
    expect(w4.showing).toBe(90);
    expect(w4.wanting).toBeLessThan(cells.length);
    expect(w4.measures.find((m) => m.key === "artFraction")?.value).toBe(1);
    // The art half, not the criterion: 90 presented cells sit below `artCellsShowing`'s domain, so
    // W4's own status here is `insufficient`, and asserting it would turn this into a test of that
    // domain instead of the denominator exclusion the row is about.
    expect(w4.measures.find((m) => m.key === "artFraction")?.status).toBe("pass");
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
      HEALTHY_EXIT,
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
      settled(0, 64),
      { layers: 64, resident: 64 },
      FRESH_SESSION,
      HEALTHY_EXIT,
    );
    const shipped = evaluateW4(
      visible(90),
      settled(0, 1),
      {
        layers: SMALLEST_SHIPPED_POOL_LAYERS,
        resident: 1,
      },
      FRESH_SESSION,
      HEALTHY_EXIT,
    );

    expect(harness.belowShippedPool).toBe(true);
    expect(shipped.belowShippedPool, "128 is tier 4, and tier 4 ships").toBe(
      false,
    );
    // The flag is provenance, not a verdict. At 64 layers the policy still works and `artFraction`
    // is still a true measurement of it — scoring it `insufficient` would call a real measurement
    // absent, which is the opposite error. Both rows must agree.
    //
    // **Asserted on `artFraction` rather than on the criterion, and that is not a weakening.** Since
    // ruling `bd5c9aad` both of these rows are out of the eviction half's domain — 64 and 128 are
    // both not 1,024 — so both criteria read `insufficient` and comparing *those* would pass however
    // the capacity flag behaved. The claim this row makes is about the half the flag could affect.
    const art = (w: { measures: readonly { key: string; status: string; value: number | null }[] }) =>
      w.measures.find((m) => m.key === "artFraction")!;
    expect(art(harness).status).toBe(art(shipped).status);
    expect(art(harness).status).toBe("pass");
    expect(art(harness).value).toBe(art(shipped).value);
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
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
      // Art resolved and then stopped, with the pool never the constraint: 945 cells want art into
      // 1,024 layers and 350 get it. `resident` is non-zero, so the stream demonstrably ran, and 37%
      // against a bar of 0.9 is a true reading of the policy failing.
      //
      // **The fixture moved off the prototype's 2,759-into-1,024 capture deliberately.** That one is
      // pool-starved, and since the reachable bar landed it passes this half by construction — so it
      // can no longer witness the difference between "the guard swallowed a real failure" and "the
      // guard behaved". A control has to be able to go the other way.
      const exhausted = evaluateW4(
        cells(945, 350),
        settled(925),
        {
          layers: 1_024,
          resident: 1_024,
        },
        FRESH_SESSION,
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
          HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
      // `?artThreshold=fixed24` is exactly this shape: it exhausts the byte budget while its demand
      // still fits the pool, so the reachable bar stays 0.9 and cannot forgive it.
      const ownSpend = evaluateW4(
        cells(945, 350),
        settled(925),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        EXHAUSTED_DURING_VISIT,
      );

      expect(ownSpend.budgetBoundAtEntry).toBe(false);
      expect(
        ownSpend.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("fail");
      // **And the exit-side domain must NOT rescue it.** The session did exhaust during the visit,
      // so the eviction half goes out of domain — but `artFraction` is entry-side and stays a
      // scored failure. An exit-side rule applied to both halves would excuse dominaria's real W4
      // failure, which is the whole reason the two halves take different sides.
      expect(ownSpend.budgetBoundAtExit).toBe(true);
      expect(
        ownSpend.measures.find((m) => m.key === "evictionsPerSecond")?.status,
      ).toBe("insufficient");
      expect(ownSpend.status).toBe("fail");
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
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
        HEALTHY_EXIT,
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
      //
      // **The messages are matched on the side they name, not on the field alone.** Since the exit
      // report arrived there are two reports of identical shape in adjacent positions, and a bare
      // `/swatchOnly/` would be satisfied by either one's complaint — so a call that read the exit
      // report where the entry one was meant would still pass this row. See
      // `a-symmetry-makes-two-sources-indistinguishable`.
      expect(() =>
        evaluateW4(
          cells(967, 0),
          settled(0),
          PROTOTYPE_POOL,
          // @ts-expect-error — the omission is the thing under test.
          {
            bytesOutstanding: 67_163_595,
            bytesReserved: 0,
            byteBudget: 67_108_864,
          },
          HEALTHY_EXIT,
        ),
      ).toThrow(/entry stream report's swatchOnly/);

      // The byte counts no longer decide anything, but they are what the disqualification message
      // quotes, and a setup failure reported as `undefined outstanding` names no cause at all.
      expect(() =>
        evaluateW4(
          cells(967, 0),
          settled(0),
          PROTOTYPE_POOL,
          // @ts-expect-error — the omission is the thing under test.
          { swatchOnly: true, byteBudget: 67_108_864 },
          HEALTHY_EXIT,
        ),
      ).toThrow(/entry stream report's bytesOutstanding/);

      expect(() =>
        // @ts-expect-error — a missing entry report entirely.
        evaluateW4(cells(967, 0), settled(0), PROTOTYPE_POOL),
      ).toThrow(/entry stream report's swatchOnly/);
    });
  });

  /**
   * **A budget exhausted DURING the visit is the eviction half's own domain** (DEC-752, board ruling
   * `exit_domain` on card `62f32092`).
   *
   * The defect this retires, measured on leg G: `?artThreshold=fixed24` entered its session clean,
   * fetched 71.6 MB against a 67.1 MB budget, and its eviction half read **0/s and PASSED** — on the
   * row whose entire purpose is to be red. `budgetBoundAtEntry` cannot see it, because at entry the
   * budget was untouched; that guard is entry-side by design and stays.
   *
   * The mechanism is the one that also explains the five recorded zeroes: `artPool.claimLayer` hands
   * back a free layer first and only evicts when it finds none, so a stream forbidden to fetch never
   * asks and the counter cannot move. **A pool forbidden to admit cannot evict.** That 0 is an
   * absent measurement wearing a passing verdict.
   *
   * The rows here are what keeps the rule from becoming a way to *lose* evictions instead.
   */
  describe("a budget exhausted during the visit is not an eviction reading", () => {
    it("retires the fixed24 row's false GREEN at 0 evictions per second", () => {
      const fixed24 = evaluateW4(
        cells(945, 350),
        settled(925),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        EXHAUSTED_DURING_VISIT,
      );

      // Entry-side sees nothing — this is exactly the gap.
      expect(fixed24.budgetBoundAtEntry).toBe(false);
      expect(fixed24.budgetBoundAtExit).toBe(true);
      const evictions = fixed24.measures.find(
        (m) => m.key === "evictionsPerSecond",
      );
      // The value is still 0. What changed is that 0 no longer reads as a pass.
      expect(evictions?.value).toBe(0);
      expect(evictions?.status).toBe("insufficient");
      expect(evictions?.insufficientReason).toMatch(/exhausted during this/);
    });

    it("leaves the baseline row's eviction reading inside the domain — and it is GREEN at 18.4/s now", () => {
      // **The row that proves the domain did not swallow the reading it was raised beside.**
      // dominaria on `baseline` reads `declinedBudget` 0 and `swatchOnly` false at exit — measured,
      // not assumed — so it is inside the domain and its ~18.4/s is scored.
      //
      // **What changed on 2026-09-17 is the verdict, not the reading** (board ruling on DEC-833 card
      // `bd5c9aad`, option (a)). This row used to assert `fail` against a bound of 5. That bound was
      // unreachable from the request loop: `evictions == requested` is a structural identity — one
      // writer, one caller, on the path that increments `requested` — so the criterion bounds
      // want-set turnover, and turnover on 6,271 cards spinning through a 1,024-layer pool is
      // 18.1–18.5/s at the floor. Meeting 5/s needed a 3.6× slower spin, a 72% roster cut or ~4,750
      // layers. The bound is now 21/s and this reading passes it, by ruling and not by drift.
      const baseline = evaluateW4(
        cells(945, 942),
        churningAt(18.4),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );

      expect(baseline.budgetBoundAtExit).toBe(false);
      expect(baseline.atEvictionPool).toBe(true);
      const evictions = baseline.measures.find(
        (m) => m.key === "evictionsPerSecond",
      );
      expect(evictions?.status).toBe("pass");
      expect(evictions!.value!).toBeCloseTo(18.4, 1);
      expect(evictions?.bound).toBe(21);
      // The margin is small and it is supposed to be: 18.1 × 1.15. Pinned from both sides so a
      // later edit cannot widen it without saying so.
      expect(evictions!.value!).toBeGreaterThan(21 / 1.2);
      expect(
        baseline.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("pass");
      expect(baseline.status).toBe("pass");
    });

    it("still reds the same row when turnover climbs past the new bound", () => {
      // **The bound has to be able to bind, and raising it is exactly when that stops being
      // obvious.** `a-bound-check-is-vacuous-when-the-bound-never-binds`: the previous bound was
      // unreachable in the failing direction, and a re-bound chosen to green the live reading could
      // as easily be unreachable in the other. So the limit is injected rather than argued.
      //
      // 24.2/s is what a 30% spin speedup would produce on the same roster — the shape of regression
      // the 1.15 margin exists to catch, since the identity means a stream that began re-asking for
      // resident cells would show up here at once and much larger.
      const faster = evaluateW4(
        cells(945, 942),
        churningAt(24.2),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );

      const evictions = faster.measures.find(
        (m) => m.key === "evictionsPerSecond",
      );
      expect(evictions?.status).toBe("fail");
      expect(evictions!.value!).toBeGreaterThan(21);
      // The art half is untouched at 99.7%, so the row's colour comes from the eviction half alone —
      // the live shape, where the churn is invisible in the frame.
      expect(faster.measures.find((m) => m.key === "artFraction")?.status).toBe(
        "pass",
      );
      expect(faster.status).toBe("fail");
    });

    it("scores the bound at the shipped 1,024-layer pool and nowhere else", () => {
      // Ruling `bd5c9aad` option (a) scopes the bound as well as setting it, and the scope is the
      // half that is easy to drop. At 128 layers the measured rate is 6.73/s — a third of the bound,
      // and worthless as a pass, because the pool gets there by refusing ~4,670 wants/s for
      // exhaustion and dropping `artFraction` to ~0.617. A green here would let the gate certify the
      // very starvation the other half of W4 forbids.
      const tier4 = evaluateW4(
        cells(205, 126),
        churningAt(6.73, { resident: 128 }),
        { layers: 128, resident: 128 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );

      const evictions = tier4.measures.find(
        (m) => m.key === "evictionsPerSecond",
      );
      expect(evictions?.status).toBe("insufficient");
      // **The number is still reported, and only the verdict is withheld** — the same shape as the
      // exit-domain row above, and for the same reason. 6.73/s is a true reading of a 128-layer
      // pool; what it is not is a reading of the bound's subject. Deleting it would lose the
      // evidence that the small pool churns *less*, which is the whole argument for the scope.
      expect(evictions!.value!).toBeCloseTo(6.73, 1);
      expect(evictions?.insufficientReason).toMatch(/1024-layer pool/);
      expect(evictions?.insufficientReason).toMatch(/128 layers/);
      expect(tier4.atEvictionPool).toBe(false);
      expect(tier4.evictionPoolLayers).toBe(1_024);
    });

    it("does not carry the exit domain over to artFraction", () => {
      // **The asymmetry, asserted.** Exit-side on both halves would excuse a world whose own demand
      // exhausted the budget — dominaria's real W4 failure — by calling it out of domain. A starved
      // frame is a true reading of a starved frame however it got that way; a rate of change of a
      // counter that was forbidden to move is not.
      const w4 = evaluateW4(
        cells(945, 100),
        settled(0),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION,
        EXHAUSTED_DURING_VISIT,
      );

      expect(w4.measures.find((m) => m.key === "artFraction")?.status).toBe(
        "fail",
      );
      expect(
        w4.measures.find((m) => m.key === "evictionsPerSecond")?.status,
      ).toBe("insufficient");
    });

    it("reads the exit report and not the entry one, on rows where they disagree", () => {
      // The two reports are adjacent positionals of identical shape, so a swap is a silent defect
      // rather than a type error. These rows put `swatchOnly` into open disagreement across the two
      // ends, in both directions, which is the only thing that can catch it.
      const exhaustedLate = evaluateW4(
        cells(945, 350),
        settled(0),
        { layers: 1_024, resident: 1_024 },
        FRESH_SESSION, // false
        EXHAUSTED_DURING_VISIT, // true
      );
      expect(exhaustedLate.budgetBoundAtEntry).toBe(false);
      expect(exhaustedLate.budgetBoundAtExit).toBe(true);

      // The other direction: entered spent, reclaimed during the visit, fetching again by exit.
      // `bytesOutstanding` falling back under the budget is DEC-812's reclaim, so this is a real
      // shape rather than a contrived one.
      const reclaimed = evaluateW4(
        cells(945, 350),
        settled(0),
        { layers: 1_024, resident: 1_024 },
        {
          swatchOnly: true,
          bytesOutstanding: 67_163_595,
          bytesReserved: 0,
          byteBudget: 67_108_864,
        },
        HEALTHY_EXIT,
      );
      expect(reclaimed.budgetBoundAtEntry).toBe(true);
      expect(reclaimed.budgetBoundAtExit).toBe(false);
      // Entry-side disqualifies both halves here, so the eviction half's own domain is not what
      // produced that — but `artFraction` is entry-driven and must say so.
      expect(
        reclaimed.measures.find((m) => m.key === "artFraction")?.status,
      ).toBe("insufficient");
    });

    it("refuses an exit report that omits a field rather than defaulting the guard off", () => {
      // Same argument as the entry report's, one position over: defaulted, `swatchOnly` would be
      // `undefined`, falsy, and every row would read "the stream was still allowed to fetch" — the
      // `fixed24` false GREEN restored. Matched on the side the message names.
      expect(() =>
        evaluateW4(
          cells(967, 0),
          settled(0),
          PROTOTYPE_POOL,
          FRESH_SESSION,
          // @ts-expect-error — the omission is the thing under test.
          { bytesOutstanding: 0, bytesReserved: 0, byteBudget: 67_108_864 },
        ),
      ).toThrow(/exit stream report's swatchOnly/);

      expect(() =>
        evaluateW4(
          cells(967, 0),
          settled(0),
          PROTOTYPE_POOL,
          FRESH_SESSION,
          // @ts-expect-error — the omission is the thing under test.
          { swatchOnly: false, byteBudget: 67_108_864 },
        ),
      ).toThrow(/exit stream report's bytesOutstanding/);

      expect(() =>
        // @ts-expect-error — a missing exit report entirely: the defaulting case itself.
        evaluateW4(cells(967, 0), settled(0), PROTOTYPE_POOL, FRESH_SESSION),
      ).toThrow(/exit stream report's swatchOnly/);
    });
  });

  /**
   * **`demandFitsCapacity` — the overshoot the reachable bar forgives, reported and not scored**
   * (DEC-752, ruling `demand_measure_scored` = `reported_only`).
   */
  describe("demand against capacity", () => {
    it("greens the tier-4 row on artFraction while reporting the overshoot that would red it", () => {
      // The row the split was raised for, at its measured numbers: the policy raised its threshold
      // 24 → 35.06 px, cut demand 945 → 205, and still admitted 205 into a 128-layer pool. 125 of
      // them draw art — 0.610 against a ceiling of 0.624.
      const tier4 = evaluateW4(
        cells(205, 125),
        settled(0),
        { layers: 128, resident: 128 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );

      const fraction = tier4.measures.find((m) => m.key === "artFraction");
      expect(fraction?.value).toBeCloseTo(0.6098, 4);
      expect(tier4.capacityCeiling).toBeCloseTo(0.6244, 4);
      expect(tier4.artFractionBar).toBeCloseTo(0.562, 3);
      // GREEN — and it was RED against the flat 0.9, which is the whole of what the ruling changed.
      expect(fraction?.status).toBe("pass");
      expect(fraction!.value!).toBeLessThan(0.9);

      // The overshoot: 1.60× capacity. Fails its own bound, and the row is green anyway.
      const demand = tier4.measures.find((m) => m.key === "demandFitsCapacity");
      expect(demand?.value).toBeCloseTo(205 / 128, 6);
      expect(demand?.status).toBe("fail");
      expect(demand?.scored).toBe(false);
      // **The scored halves, one by one, rather than the criterion's own status.** Since ruling
      // `bd5c9aad` the eviction half is out of domain at 128 layers, so the criterion here reads
      // `insufficient` — and `expect(tier4.status).toBe("pass")` would have started passing or
      // failing for a reason that has nothing to do with the unscored measure this row is about.
      expect(
        tier4.measures.find((m) => m.key === "artCellsShowing")?.status,
      ).toBe("pass");
      expect(
        tier4.measures.find((m) => m.key === "evictionsPerSecond")?.status,
      ).toBe("insufficient");
    });

    it("keeps an unscored measure out of the roster fold's verdict too", () => {
      // One predicate, three readers. A fold that counted it would turn every tier-4 tour red at the
      // aggregate while every per-world row printed green — a report contradicting itself, which is
      // the defect the W4 domain rule was landed to fix one criterion over.
      const overshooting = (slug: string) => ({
        slug,
        criterion: evaluateW4(
          cells(205, 125),
          settled(0),
          { layers: 128, resident: 128 },
          FRESH_SESSION,
          HEALTHY_EXIT,
        ),
      });
      const folded = foldCriteria([
        overshooting("alara"),
        overshooting("amonkhet"),
      ]);

      expect(folded?.status).toBe("pass");
      // ...and it is still *present* in the fold, carrying its worst-plane value, because
      // `reported_only` means reported.
      const demand = folded?.measures.find(
        (m) => m.key === "demandFitsCapacity",
      );
      expect(demand?.value).toBeCloseTo(205 / 128, 6);
      expect(demand?.status).toBe("fail");
      expect(demand?.scoredPlanes).toBe(2);
    });

    it("is null on §1.6's legal zero-layer world rather than dividing by zero", () => {
      const swatchOnly = evaluateW4(
        cells(900, 0),
        settled(0),
        { layers: 0, resident: 0 },
        FRESH_SESSION,
        HEALTHY_EXIT,
      );
      expect(
        swatchOnly.measures.find((m) => m.key === "demandFitsCapacity")?.value,
      ).toBeNull();
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
    // **W4's art control is `?artThreshold=fixed24&layers=128`, and the bare `fixed24` rows that
    // used to sit here are retired** (DEC-752 ask `f9e273fb`, board answer `replace_row`). The bare
    // seam engages, reads its policy back at 24 px, and moves no pixel: the adaptive quantile at a
    // 1,024-layer pool already sits at the 24 px floor and the capacity-derived budget no longer
    // starves it. Both things that made it a control stopped being true, for reasons that are
    // improvements, so it was retired rather than re-fitted to whatever it now reads.
    {
      row: "W4 · ?artThreshold=fixed24&layers=128",
      criterion: "W4",
      measure: "artFraction",
      expect: "RED",
    },
    // **The eviction half has no live RED row, and that is a stated cost of ruling `bd5c9aad`, not
    // an oversight.** The bound is want-set turnover at the shipped 1,024-layer pool; exceeding it
    // needs a faster spin or a bigger roster, and no query seam produces either. Every `?layers=N`
    // row is out of the bound's domain by the same ruling. So the half's falsifier is a unit row —
    // `still reds the same row when turnover climbs past the new bound` — and its live row is the
    // expected-GREEN baseline below. Recorded here so the gap is visible rather than inferred.
    {
      row: "W4 · ?artThreshold=fixed24&layers=128 (evictions)",
      criterion: "W4",
      measure: "evictionsPerSecond",
      expect: "N/A",
    },
    // The absolute no-starvation term's domain, asserted at the extreme that defines it: a frame
    // presenting one cell is far below the 128 the term needs before an absolute count means
    // anything, and that is domain rather than failure.
    {
      row: "W4 · one-card world (absolute art term)",
      criterion: "W4",
      measure: "artCellsShowing",
      expect: "N/A",
    },
    // **The absolute term's live RED (DEC-843), and this row is why the count above moved.** It used
    // to say the term's witness — a want set collapsed under reduced motion — was unreachable
    // because `?motion=0` is inert on the shell. True of that seam, and the matrix is not restricted
    // to query seams: `layers-128-reduced` emulates the OS preference before `goto`, exactly as
    // `worlds-evict-longrun.mjs` does, and reads 14 cells against the floor of 32 on a frame
    // presenting 1,388. Its read-back is asserted in both directions against the unseamed
    // `?layers=128` sibling — `a-control-that-agrees-is-not-a-control-that-took`.
    {
      row: "W4 · prefers-reduced-motion at ?layers=128",
      criterion: "W4",
      measure: "artCellsShowing",
      expect: "RED",
    },
    {
      row: "W4 · the unmodified build (absolute art term)",
      criterion: "W4",
      measure: "artCellsShowing",
      expect: "GREEN",
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

  it("has eight expected-RED rows, five expected-GREEN and four expected-N/A", () => {
    expect(MATRIX.filter((r) => r.expect === "RED")).toHaveLength(8);
    expect(MATRIX.filter((r) => r.expect === "GREEN")).toHaveLength(5);
    expect(MATRIX.filter((r) => r.expect === "N/A")).toHaveLength(4);
  });

  it("leaves W4's absolute art term a live RED row and a live GREEN partner", () => {
    // DEC-843 closed a gap this file had recorded as permanent. A count alone would not have said
    // which row moved, and an eighth RED could be any criterion's; this pins that the eighth is the
    // one measure that had no live falsifier, and that it still has its healthy partner — a RED row
    // on its own scores an always-red instrument exactly as well as a working one.
    // `negative-controls-distinguish-guard-from-rubble`.
    const cells = MATRIX.filter(
      (r) => "measure" in r && r.measure === "artCellsShowing",
    );
    expect(cells.filter((r) => r.expect === "RED")).toHaveLength(1);
    expect(cells.filter((r) => r.expect === "GREEN")).toHaveLength(1);
    expect(cells.filter((r) => r.expect === "N/A")).toHaveLength(1);
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
      "artCellsShowing",
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

  // The denominator of a folded verdict, at the level the matrix prints it (DEC-816). Both rows
  // below are GREEN and identical in value and bound; only the set they were folded over differs.
  // Before this they produced the *same* line — the shape the ring domain (R3) made load-bearing,
  // since it leaves W2's lightness half folding off 2 of 45 worlds while the report says "GREEN".
  //
  // The pair is what carries it: a detail that named the denominator only when the evidence was
  // thin would be a warning, and a reader would learn to read its absence as "fine".
  describe("prints the set a folded verdict was taken over", () => {
    // **Driven through the real `foldCriteria`, not a rebuilt copy of its output.** The fold and the
    // printer have to agree on a field name, and a test that hand-wrote `scoredPlanes` would go on
    // passing the day the fold stopped emitting it — the printer would silently fall back to saying
    // nothing, which is the exact regression these rows exist to catch. See
    // `a-test-double-that-agrees-with-the-bug` and `a-harness-that-copies-the-product-cannot-see-it-move`.
    const RING = W2_MIN_RING_SAMPLES;

    // Two rings that both clear the floor of 8 and are far apart in value, so "the fold took the
    // worst" is a reading rather than a coincidence of identical worlds. A roster of clones would
    // score the same whether the fold minimised, maximised or picked the first.
    const WIDE: [number, number, number][] = [
      [40, 40, 40],
      [210, 210, 210],
    ]; // lightnessIqr 68.08
    const NARROW: [number, number, number][] = [
      [110, 110, 110],
      [140, 140, 140],
    ]; // lightnessIqr 11.81 — GREEN, and the worse of the two

    /**
     * `scored` worlds whose ring clears the domain, plus `thin` worlds whose ring does not — so the
     * denominator under test is produced by the same guard the gate runs, not asserted. The last
     * scored world is the narrow one, so it is neither first nor the majority.
     */
    const roster = (scored: number, thin: number) => [
      ...Array.from({ length: scored }, (_, i) => ({
        slug: i === scored - 1 ? "narrowest" : `scored-${i + 1}`,
        criterion: evaluateW2(ringOf(RING, i === scored - 1 ? NARROW : WIDE)),
      })),
      ...Array.from({ length: thin }, (_, i) => ({
        slug: `thin-${i + 1}`,
        criterion: evaluateW2(ringOf(RING - 1, WIDE)),
      })),
    ];

    const row = {
      criterion: "W2",
      measure: "lightnessIqr",
      expect: "GREEN",
    } as const;

    it("folds to the worst world in domain, never the best", () => {
      // The denominator is only worth printing if the value beside it is the binding one. §3.1
      // forbids a mean for the same reason: 44 comfortable worlds must not carry a failing one.
      const folded = foldCriteria(roster(3, 0));
      const measure = folded?.measures.find((m) => m.key === "lightnessIqr");
      expect(measure?.worstPlane).toBe("narrowest");
      expect(measure?.value).toBeCloseTo(11.81, 1);
      // The control: the roster really does hold a better world, so `min` had something to reject.
      expect(
        foldCriteria([roster(3, 0)[0]!])?.measures.find(
          (m) => m.key === "lightnessIqr",
        )?.value,
      ).toBeCloseTo(68.08, 1);
    });

    it("names how many worlds were in domain, and how many were not", () => {
      const folded = foldCriteria(roster(2, 43));
      expect(folded).not.toBeNull();
      // The precondition: the fold really did drop the thin worlds, so the 2 below is the domain
      // doing the work and not an arithmetic coincidence of the fixture.
      const measure = folded?.measures.find((m) => m.key === "lightnessIqr");
      expect(measure?.scoredPlanes).toBe(2);
      expect(measure?.insufficientPlanes).toBe(43);

      const thin = checkControlRow([folded!], row);
      expect(thin.ok).toBe(true);
      expect(thin.detail).toContain("worst of 2 worlds in domain");
      expect(thin.detail).toContain("43 out of domain");
    });

    it("says it on a full-roster GREEN too, so silence never reads as reassurance", () => {
      const full = checkControlRow([foldCriteria(roster(45, 0))!], row);
      expect(full.ok).toBe(true);
      expect(full.detail).toContain("worst of 45 worlds in domain");
      expect(full.detail).not.toContain("out of domain");
    });

    it("leaves a per-world criterion alone rather than inventing a 1-of-1 fold", () => {
      // `evaluateW5` is measured once over a sweep, not folded over planes, so it carries no
      // `scoredPlanes` — and a denominator printed there would be a fiction the reader would trust.
      const unfolded = checkControlRow(
        [evaluateW5(w5Sweep(homeLabelCeiling(ROSTER_V3)), ROSTER_V3, W5_OPTS)],
        { criterion: "W5", measure: "homeLabels", expect: "GREEN" },
      );
      expect(unfolded.ok).toBe(true);
      expect(unfolded.detail).not.toContain("in domain");
    });
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
