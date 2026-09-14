/**
 * §1.2 step 3 — the Blind Eternities belt (spec §1.8).
 *
 * > *"The Blind Eternities — 4,980 cards and 17.4% of everything on the 87-plane roster, **4,204 and
 * > 14.70%** on v3, the largest population after Dominaria on both — stops pretending to have a
 * > shape and becomes a belt around the whole system at **1.12 × `multiverseRadius`**."*
 *
 * **The positions are shipped, not generated here, and that is the whole design of this file.**
 * §1.8's arc law — one arc per set in chronological order, each set's share of 360° with a 6% gap at
 * each end, ±6% radial and ±3.5% vertical jitter from a deterministic hash — is implemented **once**,
 * in `pipeline/src/eternities/fixtures/layout.py:belt_position`, and lands in `stars.bin` as the dust
 * plane's records (§2.1: *"belt position for dust, normalised the same way"*). The prototype computed
 * them client-side because it had no v3 dataset; a production renderer that kept doing so would be a
 * second implementation of one law, which is precisely the failure `starfield/motion.ts` and its
 * vertex twin exist to warn about — and here it would be worse, because the pipeline **asserts** the
 * law (`test_pipeline_invariants.py`: *"the dust plane's stars lie in the belt's radial and vertical
 * bounds"*) and a client-side copy would be asserted by nothing.
 *
 * Verified on `c9468f1125bcddff`: all **4,204 of 4,204** dust cards fall inside their own set's arc
 * under the cumulative chronological order of `plane.sets`, radial extent `1.0528–1.1874` and
 * vertical `±0.0392` against the law's `1.12·(1±0.06)` and `1.12·0.035`. `worlds-belt.test.ts`
 * re-runs that check against the shipped artefact, so the ordering this file relies on is a
 * measurement rather than an assumption.
 *
 * **What is left for the client is the colour**, which is not in the contract: a year ramp across
 * the sets, so the belt reads as chronology rather than as debris.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type IUniform,
} from 'three'

import type { Stars } from '../../data/decode'
import type { PlaneRecord, PlaneSetRef } from '../../data/types'
import { SHADER_NAME_WORLD_BELT } from '../shaderNames'

import { BELT_FRAGMENT_SHADER, BELT_POINT_SIZE_PX, BELT_VERTEX_SHADER } from './beltShaders'

/** HSL hue at the cold end of §1.8's ramp. */
const HUE_COLD = 0.62
/** HSL hue at the warm end. Zero is red, so the ramp runs blue → red as the years run forward. */
const HUE_WARM = 0.0

/** The ramp's saturation, and its lightness at the two ends — warm reads slightly brighter. */
const RAMP_SATURATION = 0.55
const RAMP_LIGHTNESS_COLD = 0.42
const RAMP_LIGHTNESS_WARM = 0.52

/**
 * The year span the ramp is stretched over, **derived from the roster** (§3.1's discipline).
 *
 * §1.8 writes it as *"cold at 1993 to warm at 2026"*, and those are the multiverse's own endpoints —
 * not the belt's, which start at **1997** on v3 because the Blind Eternities holds no Alpha-era set.
 * Stretching the ramp over the belt's own range would make Portal the coldest thing in the scene and
 * would re-colour the entire belt on the day a 1994 reprint set joined it. Derived over every
 * plane's sets, today's answer is exactly the pair §1.8 states, and it stays right when 2027 lands.
 *
 * Falls back to the stated pair when the roster carries no sets at all, which is a fixture, not a
 * dataset — a zero-width span would otherwise make every point the same hue with no error anywhere.
 */
export function multiverseYearSpan(planes: readonly PlaneRecord[]): [number, number] {
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const plane of planes) {
    for (const set of plane.sets) {
      if (set.year < first) first = set.year
      if (set.year > last) last = set.year
    }
  }
  return Number.isFinite(first) && Number.isFinite(last) && last > first ? [first, last] : [1993, 2026]
}

/** §1.8's year ramp: HSL hue {@link HUE_COLD} → {@link HUE_WARM}, cold at `first`, warm at `last`. */
export function yearColour(year: number, first: number, last: number, out: Color): Color {
  const t = last > first ? Math.min(1, Math.max(0, (year - first) / (last - first))) : 0.5
  return out.setHSL(
    HUE_COLD + (HUE_WARM - HUE_COLD) * t,
    RAMP_SATURATION,
    RAMP_LIGHTNESS_COLD + (RAMP_LIGHTNESS_WARM - RAMP_LIGHTNESS_COLD) * t,
  )
}

/**
 * The set each of the dust plane's cards belongs to, as an index into `plane.sets`.
 *
 * `plane.sets` is chronological (PRD 5.4.2, and `PlaneSetRef`'s own doc comment) and the pipeline
 * lays each set's cards contiguously along its own arc, so the cumulative `cardCount` **is** the
 * boundary table. Returns `-1` past the last set's share, which is the honest answer when the sums
 * disagree with `cardCount` rather than a silent clamp onto the final set — a clamp would paint
 * every orphaned card with 2026's red and read as a legitimately recent arc.
 */
export function setOfCard(sets: readonly PlaneSetRef[], card: number): number {
  let cumulative = 0
  for (let index = 0; index < sets.length; index += 1) {
    cumulative += sets[index]!.cardCount
    if (card < cumulative) return index
  }
  return -1
}

export interface BeltOptions {
  /** The dust plane — `kind === 'dust'`. */
  readonly plane: PlaneRecord
  /** The decoded `stars.bin`; the belt reads `plane.starOffset .. + starCount`. */
  readonly stars: Stars
  /** The whole roster, for {@link multiverseYearSpan}. */
  readonly planes: readonly PlaneRecord[]
  /** `PlanesFile.multiverseRadius`. The belt's local frame is world units over this (§2.1). */
  readonly multiverseRadius: number
  /** CSS-to-device pixel ratio, so {@link BELT_POINT_SIZE_PX} is CSS px. Defaults to 1. */
  readonly pixelRatio?: number
}

/**
 * Build the belt.
 *
 * > **Normative — `sizeAttenuation: false`, size 2 px (§1.8, trap 3 of §1.13).** *"The belt sits at
 * > 1.12 R and Dominaria's `home` is 108.8 units out, so a fly-in puts belt points a few units from
 * > the eye. With attenuation on they become ~70 px squares, which looks exactly like 'the cells are
 * > drawn in the wrong place' and sent the prototype hunting the wrong bug for an afternoon."*
 *
 * Opaque and depth-tested, which is **not** what the prototype did (it drew the belt additively with
 * `depthWrite: false`). §1.2 is explicit — *"Steps 2–4 are opaque and depth-tested. Steps 5, 6, 8
 * are transparent"* — and the belt is step 3. Additive dust that does not write depth is invisible
 * against the backdrop's bright regions and draws *through* the worlds it passes behind, which is
 * the specific thing a belt at 1.12 R is always doing from somewhere.
 */
export function buildBelt(options: BeltOptions): Points {
  const { plane, stars, multiverseRadius } = options
  const count = plane.starCount
  if (plane.starOffset < 0 || plane.starOffset + count > stars.count) {
    throw new Error(
      `${plane.slug}: belt stars ${plane.starOffset}..${plane.starOffset + count} outside ` +
        `stars.bin (${stars.count})`,
    )
  }

  const positions = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const [first, last] = multiverseYearSpan(options.planes)
  const scratch = new Color()
  // One colour per SET, not per card: the ramp is a function of the set's year, so computing it
  // 4,204 times would be 4,204 `setHSL` calls to produce 50 distinct answers.
  const perSet = plane.sets.map((set) => {
    yearColour(set.year, first, last, scratch)
    return [scratch.r, scratch.g, scratch.b] as const
  })
  // A card past the last set's share (see `setOfCard`) is drawn at the cold end rather than dropped:
  // the position is real — the pipeline emitted it — so hiding it would under-count the belt while
  // the arcs still looked complete.
  //
  // **Counted, because it is the shape `setOfCard`'s own doc comment refuses (DEC-773's note).**
  // Painting an orphan with `perSet[0]` *is* a silent clamp, just onto the first set rather than the
  // last, and it reads as a legitimately old arc. Today it never happens — 4,204 of 4,204 cards fall
  // inside their own set's arc — and the whole point is to find out on the day it stops being true,
  // rather than to look at a belt whose colours have quietly stopped meaning years.
  const orphan = perSet[0] ?? ([0.2, 0.3, 0.6] as const)
  let orphans = 0

  for (let card = 0; card < count; card += 1) {
    const star = plane.starOffset + card
    // The dust plane's local frame is multiverse coordinates over `multiverseRadius` (§2.1, PRD
    // 8.3), so this is the same scale the galaxy's own vertex path applies through `PT_RADIUS`.
    positions[card * 3] = stars.x(star) * multiverseRadius
    positions[card * 3 + 1] = stars.y(star) * multiverseRadius
    positions[card * 3 + 2] = stars.z(star) * multiverseRadius

    const set = setOfCard(plane.sets, card)
    const resolved = set >= 0 ? perSet[set] : undefined
    if (!resolved) orphans += 1
    const colour = resolved ?? orphan
    colours[card * 3] = colour[0]
    colours[card * 3 + 1] = colour[1]
    colours[card * 3 + 2] = colour[2]
  }

  if (orphans > 0) {
    console.warn(
      `${plane.slug}: ${orphans} of ${count} belt cards fall past the last set's share of ` +
        `plane.sets (${plane.sets.length} sets, ${plane.sets.reduce((sum, set) => sum + set.cardCount, 0)} cards); ` +
        `each is drawn with the FIRST set's colour, so the year ramp is wrong for them`,
    )
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aColour', new BufferAttribute(colours, 3))
  geometry.computeBoundingSphere()

  const uniforms: { [uniform: string]: IUniform } = {
    uSizePx: { value: beltPointSize(options.pixelRatio ?? 1) },
  }
  const points = new Points(
    geometry,
    new ShaderMaterial({
      name: SHADER_NAME_WORLD_BELT,
      uniforms,
      vertexShader: BELT_VERTEX_SHADER,
      fragmentShader: BELT_FRAGMENT_SHADER,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    }),
  )
  points.name = 'worlds-belt'
  return points
}

/**
 * {@link BELT_POINT_SIZE_PX} in **device** px, which is what `gl_PointSize` is in.
 *
 * Floored at **1**, not at 0 (DEC-773's note): `gl_PointSize` 0 is a belt that is not drawn, and no
 * display reports fewer than one device pixel per CSS pixel — so a ratio under 1 is a bad reading
 * and the safe response to one is a belt that is slightly too large, not one that has disappeared in
 * a way that reads as "the dust plane failed to load".
 *
 * One writer for both the build and the per-frame re-resolve, so the floor cannot hold on one path
 * and not the other.
 */
function beltPointSize(pixelRatio: number): number {
  return BELT_POINT_SIZE_PX * Math.max(pixelRatio, 1)
}

/** Re-resolve {@link BELT_POINT_SIZE_PX} against a new device pixel ratio. See `beltShaders.ts`. */
export function setBeltPixelRatio(points: Points, pixelRatio: number): void {
  const material = points.material as ShaderMaterial
  material.uniforms.uSizePx!.value = beltPointSize(pixelRatio)
}

/** Free the belt's buffers. The geometry and the material are both this pass's own. */
export function disposeBelt(points: Points): void {
  points.geometry.dispose()
  ;(points.material as ShaderMaterial).dispose()
}
