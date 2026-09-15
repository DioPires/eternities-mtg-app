/**
 * §1.2 step 5 — the surface-following tether (spec §1.9).
 *
 * §1.9's claim is a *feel* claim — "the tether reads as footed into ground" is owner-judged (§3.1)
 * — so the rows here are about the three places where the geometry can be wrong in ways no capture
 * set would attribute to this file.
 *
 *  - **The far field produces coincident samples, and that is the design.** "When the camera is far
 *    the anchor relaxes onto the exit and the surface runs collapse to nothing — the far-field
 *    behaviour you want, at no special case." 48 of the 144 samples are then identical and their
 *    tangent is the zero vector. *Not* a `NaN` — `Vector3.normalize()` is `divideScalar(length() ||
 *    1)`, so three never emits one here, and a row asserting "no NaN" measures a property three
 *    already guarantees and cannot tell the zero-tangent guard from its absence (DEC-773 F6). What
 *    the guard actually decides is the ribbon's **orientation**: without it those 48 samples fall
 *    through to the `(0, 1, 0)` fallback side vector, which is a world axis and not square to the
 *    eye, so the far field is drawn as a twisted strip. That is what is asserted below.
 *  - **The width is CSS px, at every depth *and* everywhere in the frame.** The ribbon spans a
 *    world's surface and 200 units of empty space in one strip, so a constant *world-space*
 *    half-width is invisible at one end and a bar at the other. The prototype sized against the
 *    drawing buffer, which is a half-width ribbon on every retina display and is identical to a
 *    correct one at the dpr 1 the gate runs at. And `fovScale` inverts a projection whose
 *    denominator is *view-space depth*, so sizing against the radial distance inflates the ribbon
 *    off-axis (DEC-773 F7) — which is invisible to any row that divides by that same radial
 *    distance to get its pixels. These rows project through the camera's own matrices instead.
 *  - **The surface run is a great circle.** `lerp().normalize()` looks equivalent and bunches
 *    samples at the two ends, which over a 24-sample run is a visibly uneven ribbon.
 */

import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3, Vector4, type ShaderMaterial } from 'three'

import { RENDER_ORDER_TETHER } from '../src/scene/worlds/passOrder'
import {
  TETHER_ANCHOR_FLARE,
  TETHER_HALF_WIDTH_PX,
  TETHER_SAMPLES,
  TETHER_SPAN_SAMPLES,
  TETHER_SURFACE_SAMPLES,
  TetherPass,
  anchorSlide,
  slerpDirection,
  type TetherEnd,
} from '../src/scene/worlds/tether'
import { SHADER_NAME_WORLD_TETHER, SHADER_NAME_WORLD_TETHER_PAD } from '../src/scene/shaderNames'

const CSS_WIDTH = 1920
const CSS_HEIGHT = 1080

/**
 * A world point in CSS pixels, from the camera's **own** matrices (DEC-773 F7).
 *
 * The rows below used to divide the strip's world-space width by the *radial* distance and call the
 * result pixels, which is the same substitution the shipped `ribbonise` was making — so the test
 * agreed with the defect by construction and read 2.1 px at every sample while the ribbon was 33%
 * wide at the frame edge. Projecting the written vertices through `projectionMatrix` is the only
 * spelling that cannot share an error with the code it measures.
 */
function pixelsOf(view: PerspectiveCamera, point: Vector3): [number, number] {
  const clip = new Vector4(point.x, point.y, point.z, 1)
    .applyMatrix4(view.matrixWorldInverse)
    .applyMatrix4(view.projectionMatrix)
  return [(clip.x / clip.w) * (CSS_WIDTH / 2), (clip.y / clip.w) * (CSS_HEIGHT / 2)]
}

function camera(position: Vector3, target: Vector3): PerspectiveCamera {
  const view = new PerspectiveCamera(55, 1920 / CSS_HEIGHT, 0.1, 5000)
  view.position.copy(position)
  view.lookAt(target)
  view.updateMatrixWorld(true)
  view.updateProjectionMatrix()
  return view
}

function end(centre: Vector3, radius: number): TetherEnd {
  return { centre, radius, anchor: new Vector3(0, 1, 0), exit: new Vector3(0, 1, 0) }
}

/** Dominaria (r 9.97) and Rabiah (r 1.09), 220 units apart — the prototype's `tether-far` pair. */
const A_CENTRE = new Vector3(0, 0, 0)
const B_CENTRE = new Vector3(220, 0, 0)
const A_RADIUS = 9.97
const B_RADIUS = 1.09

function pass(): { tether: TetherPass; a: TetherEnd; b: TetherEnd } {
  const tether = new TetherPass()
  const a = end(A_CENTRE.clone(), A_RADIUS)
  const b = end(B_CENTRE.clone(), B_RADIUS)
  tether.setEnds([a, b])
  return { tether, a, b }
}

function positions(tether: TetherPass): Float32Array {
  return tether.ribbon.geometry.getAttribute('position').array as Float32Array
}

describe('§1.9s geometry', () => {
  it('is 24 + 96 + 24 samples, drawn as a strip and not as line segments', () => {
    expect(TETHER_SURFACE_SAMPLES).toBe(24)
    expect(TETHER_SPAN_SAMPLES).toBe(96)
    expect(TETHER_SAMPLES).toBe(144)

    const { tether } = pass()
    // Two vertices per sample — the strip's two edges — and six indices per segment.
    expect(tether.ribbon.geometry.getAttribute('position').count).toBe(TETHER_SAMPLES * 2)
    expect(tether.ribbon.geometry.getIndex()!.count).toBe((TETHER_SAMPLES - 1) * 6)
    expect(TETHER_HALF_WIDTH_PX).toBe(2.1)
    expect(TETHER_ANCHOR_FLARE).toBe(2.0)
    tether.dispose()
  })

  it('names both programs and draws in step 5, before the atmosphere', () => {
    const { tether } = pass()
    expect((tether.ribbon.material as ShaderMaterial).name).toBe(SHADER_NAME_WORLD_TETHER)
    expect((tether.pads[0].material as ShaderMaterial).name).toBe(SHADER_NAME_WORLD_TETHER_PAD)
    expect(tether.ribbon.renderOrder).toBe(RENDER_ORDER_TETHER)
    expect((tether.ribbon.material as ShaderMaterial).depthWrite).toBe(false)
    tether.dispose()
  })

  it('composites what its shaders write, on the ribbon and on BOTH pads', () => {
    // DEC-773 F1's arithmetic, applied here as tuning rather than as a spec correction: §1.9 names
    // no falloff, so the double-apply was not a deviation — but `ends`, the travelling `flow` and
    // the pads' `ring`/`core` were each being squared by `blendFunc(SRC_ALPHA, ONE)` and neither
    // shader said so. Both pads, not just `pads[0]`: `padMaterial` is called twice.
    const { tether } = pass()
    expect((tether.ribbon.material as ShaderMaterial).premultipliedAlpha).toBe(true)
    for (const pad of tether.pads) {
      expect((pad.material as ShaderMaterial).premultipliedAlpha).toBe(true)
    }
    // The two are separate materials, so a single shared instance would make the loop above vacuous.
    expect(tether.pads[0].material).not.toBe(tether.pads[1].material)
    tether.dispose()
  })

  it('is hidden until both ends are named, and hides again on null', () => {
    const tether = new TetherPass()
    expect(tether.active).toBe(false)
    expect(tether.ribbon.visible).toBe(false)
    expect(tether.pads.every((pad) => pad.visible)).toBe(false)

    tether.setEnds([end(A_CENTRE.clone(), A_RADIUS), end(B_CENTRE.clone(), B_RADIUS)])
    expect(tether.active).toBe(true)
    expect(tether.ribbon.visible).toBe(true)

    tether.setEnds(null)
    expect(tether.ribbon.visible).toBe(false)
    expect(tether.pads.every((pad) => pad.visible)).toBe(false)
    tether.dispose()
  })
})

describe('the far field collapses the surface runs, and must not take the ribbon with it', () => {
  it('relaxes the anchor onto the exit beyond 8 radii and holds it inside 2.5', () => {
    expect(anchorSlide(20)).toBe(0)
    expect(anchorSlide(8)).toBe(0)
    expect(anchorSlide(2.5)).toBe(1)
    expect(anchorSlide(0.5)).toBe(1)
    // Monotone in between, so the anchor slides rather than snapping.
    expect(anchorSlide(5)).toBeGreaterThan(0)
    expect(anchorSlide(5)).toBeLessThan(1)
    expect(anchorSlide(4)).toBeGreaterThan(anchorSlide(6))
  })

  it('keeps every collapsed sample square to the eye, which is what the zero-tangent guard buys', () => {
    // **The row the guard is actually pinned by (DEC-773 F6).** Far out, both surface runs collapse
    // to a point: 24 samples at each end are identical and `next − previous` is the zero vector.
    // Removing the guard does *not* produce a `NaN` — three's `normalize()` divides by
    // `length() || 1` — so the old "emits no NaN" row passed with the guard deleted. What removing
    // it produces is a zero tangent, a zero cross product, and therefore the `(0, 1, 0)` fallback
    // side vector on all 48 samples: a world axis, which is square to the eye at exactly one camera
    // pose and is a twisted strip at every other.
    const { tether, a, b } = pass()
    const view = camera(new Vector3(110, 400, 900), new Vector3(110, 0, 0))

    const radii = view.position.distanceTo(a.centre) / a.radius
    expect(radii).toBeGreaterThan(8)
    expect(anchorSlide(radii)).toBe(0)

    // **Forced to exact coincidence, not merely run for a while.** The relax is an exponential
    // approach — `1 − exp(−8·dt)` — so thirty frames leaves the anchor 0.035 rad off the exit, and
    // at 0.035 rad consecutive samples are ~1e-2 apart and the zero-tangent branch is never
    // reached. A row written that way asserts "no NaN" about a case that cannot produce one. One
    // frame to derive the exits, then the anchors are set onto them exactly — which is the state
    // the relax converges to and the state §1.9's far field is *defined* as.
    tether.update(view, CSS_HEIGHT, 0, 1 / 60)
    a.anchor.copy(a.exit)
    b.anchor.copy(b.exit)
    tether.update(view, CSS_HEIGHT, 1 / 60, 1 / 60)
    expect(a.anchor.angleTo(a.exit)).toBe(0)
    expect(b.anchor.angleTo(b.exit)).toBe(0)

    const array = positions(tether)
    expect(array).toHaveLength(TETHER_SAMPLES * 2 * 3)
    expect([...array].every((value) => Number.isFinite(value))).toBe(true)

    // And the samples really are coincident, so the guard really was the thing that answered.
    // Compared at the strip's **centres** — the curve points — because the two written vertices are
    // `point ± side` and `side` is 0.1 world units wide here: comparing raw vertices would measure
    // the ribbon's own width and report a "gap" of exactly that on a perfectly collapsed run.
    const centre = (i: number): [number, number, number] => [
      (array[i * 6]! + array[i * 6 + 3]!) / 2,
      (array[i * 6 + 1]! + array[i * 6 + 4]!) / 2,
      (array[i * 6 + 2]! + array[i * 6 + 5]!) / 2,
    ]
    //
    // The tolerance is **float32 storage precision, derived**, not a round small number. The curve
    // points are `Vector3`s in float64 and are bit-identical here — which is what makes
    // `dir.lengthSq() > 1e-12` fail and the last-good-tangent branch answer — but the attribute
    // they are written into is a `Float32Array`, whose spacing at a coordinate of ~10 is `10·2^-23`
    // = 1.2e-6. Measured residual: 2.4e-7. A `1e-9` bound fails on a perfectly collapsed run.
    const eps = A_RADIUS * 1.008 * 2 ** -23 * 4
    const first = centre(0)
    for (let i = 1; i < TETHER_SURFACE_SAMPLES; i += 1) {
      const point = centre(i)
      expect(
        Math.hypot(point[0] - first[0], point[1] - first[1], point[2] - first[2]),
        `surface-run sample ${i} is not coincident, so the zero-tangent branch was never reached`,
      ).toBeLessThan(eps)
    }
    // And the run really did collapse — a ribbon still spanning the surface would clear `eps` by
    // orders of magnitude, so the bound above has to be shown to be tight rather than merely met.
    expect(eps).toBeLessThan(A_RADIUS * 1e-5)

    // --- what the guard decides ---------------------------------------------------------------
    //
    // Every sample's half-offset is `±side`, and `side = normalise(tangent × view)` is perpendicular
    // to the view direction **by construction** — that is what makes the strip face the camera.
    // Carrying the last live tangent through a collapsed run keeps that true; the `(0, 1, 0)`
    // fallback does not, and the fallback is exactly where a removed guard lands.
    const sideUnit = (i: number): Vector3 =>
      new Vector3(
        array[i * 6 + 3]! - array[i * 6]!,
        array[i * 6 + 4]! - array[i * 6 + 1]!,
        array[i * 6 + 5]! - array[i * 6 + 2]!,
      ).normalize()
    const viewUnit = (i: number): Vector3 => {
      const [cx, cy, cz] = centre(i)
      return view.position.clone().sub(new Vector3(cx, cy, cz)).normalize()
    }

    const collapsed = [
      ...Array.from({ length: TETHER_SURFACE_SAMPLES }, (_, i) => i),
      ...Array.from(
        { length: TETHER_SURFACE_SAMPLES },
        (_, i) => TETHER_SURFACE_SAMPLES + TETHER_SPAN_SAMPLES + i,
      ),
    ]
    expect(collapsed).toHaveLength(48)
    for (const i of collapsed) {
      expect(
        Math.abs(sideUnit(i).dot(viewUnit(i))),
        `collapsed sample ${i} is not square to the eye`,
      ).toBeLessThan(1e-6)
    }

    // **The negative control.** The assertion above is only discriminating if the fallback fails it
    // at this pose — at a pose where the camera happens to sit in the world's own equatorial plane,
    // `(0, 1, 0)` is perpendicular to the view and a removed guard would score green.
    const fallback = new Vector3(0, 1, 0)
    for (const i of [0, TETHER_SAMPLES - 1]) {
      expect(Math.abs(fallback.dot(viewUnit(i)))).toBeGreaterThan(0.3)
    }

    // And the far end's collapsed run carries the **last live tangent** rather than any perpendicular
    // that happens to be square to the eye: its side vector is the one the last span sample wrote.
    const lastLive = TETHER_SURFACE_SAMPLES + TETHER_SPAN_SAMPLES - 1
    expect(sideUnit(TETHER_SAMPLES - 1).angleTo(sideUnit(lastLive))).toBeLessThan(1e-3)
    tether.dispose()
  })

  it('converges the anchor onto the exit rather than snapping it there', () => {
    // The companion to the row above: the far field is *reached*, not merely representable. The
    // smoothing is `1 − exp(−k·dt)`, which is frame-rate independent — a per-frame constant would
    // make the anchor travel at one speed on a 60 Hz panel and another on a 144 Hz one.
    const { tether, a } = pass()
    const view = camera(new Vector3(110, 400, 900), new Vector3(110, 0, 0))
    const angles: number[] = []
    for (let frame = 0; frame < 240; frame += 1) {
      tether.update(view, CSS_HEIGHT, frame / 60, 1 / 60)
      if (frame % 60 === 0) angles.push(a.anchor.angleTo(a.exit))
    }
    expect(a.anchor.angleTo(a.exit)).toBeLessThan(1e-6)
    // Monotone decreasing, so it is an approach and not an oscillation.
    for (let i = 1; i < angles.length; i += 1) expect(angles[i]!).toBeLessThan(angles[i - 1]!)
    tether.dispose()
  })

  it('slides the anchor onto the reticles surface point when the camera is close', () => {
    const { tether, a } = pass()
    // Looking at the world from +z, but offset so the centre ray hits well off the sub-point — the
    // anchor must move to where the reticle is, not stay on the exit toward the other world.
    const view = camera(new Vector3(6, 6, 20), new Vector3(2, 3, 0))
    for (let frame = 0; frame < 120; frame += 1) tether.update(view, CSS_HEIGHT, frame / 60, 1 / 60)

    const radii = view.position.distanceTo(a.centre) / a.radius
    expect(radii).toBeLessThan(2.5)
    expect(anchorSlide(radii)).toBe(1)
    // The exit points at Rabiah, which is +x. The anchor is now somewhere else entirely.
    expect(a.exit.angleTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6)
    expect(a.anchor.angleTo(a.exit)).toBeGreaterThan(0.3)
    expect(a.anchor.length()).toBeCloseTo(1, 9)
    tether.dispose()
  })
})

/** Sample `i`'s half-width in CSS px and its centre's screen position, measured not derived. */
function measureAt(
  tether: TetherPass,
  view: PerspectiveCamera,
  i: number,
): { halfWidthPx: number; screen: [number, number]; viewDepth: number; radial: number } {
  const array = positions(tether)
  const left = new Vector3(array[i * 6], array[i * 6 + 1], array[i * 6 + 2])
  const right = new Vector3(array[i * 6 + 3], array[i * 6 + 4], array[i * 6 + 5])
  const centre = left.clone().add(right).multiplyScalar(0.5)
  const [lx, ly] = pixelsOf(view, left)
  const [rx, ry] = pixelsOf(view, right)
  const forward = new Vector3(0, 0, -1).applyQuaternion(view.quaternion)
  return {
    halfWidthPx: Math.hypot(rx - lx, ry - ly) / 2,
    screen: pixelsOf(view, centre),
    viewDepth: centre.clone().sub(view.position).dot(forward),
    radial: centre.distanceTo(view.position),
  }
}

describe('the ribbon holds a constant CSS width at every depth and everywhere in the frame', () => {
  it('measures 2.1 CSS px at every in-frame sample, on the axis and at the edge', () => {
    // The near end of the strip is on a world's surface and the far end is 220 units away, so a
    // constant world-space width is one failure mode: invisible at one end, a bar at the other.
    // **Off-axis is the other one, and it is the one that shipped (DEC-773 F7):** `fovScale` inverts
    // a projection whose denominator is view-space depth, and the radial distance the code used is
    // `depth / cos θ`. The half-width then grows toward the frame edge while every sample still
    // divides out to 2.1 under the same substitution — which is why this row projects.
    const { tether } = pass()
    // **Two poses, because one cannot carry both claims.** Broadside puts the span across the
    // frame's whole width at a nearly constant depth (the off-axis half of the sweep); oblique runs
    // it away from the eye and keeps it near the axis (the depth half). A row with only the second
    // is the row that shipped, and it could not see F7.
    const rows: ReturnType<typeof measureAt>[] = []
    for (const [eye, at] of [
      [new Vector3(110, 40, 150), new Vector3(110, 0, 0)],
      [new Vector3(0, 40, 60), new Vector3(110, 0, 0)],
    ] as const) {
      const view = camera(eye.clone(), at.clone())
      for (let frame = 0; frame < 30; frame += 1) tether.update(view, CSS_HEIGHT, frame / 60, 1 / 60)
      // The middle of the span, away from the two flares at the ends.
      for (let i = 30; i < 115; i += 1) {
        const row = measureAt(tether, view, i)
        if (row.viewDepth <= 0) continue
        if (Math.abs(row.screen[0]) > CSS_WIDTH / 2 || Math.abs(row.screen[1]) > CSS_HEIGHT / 2) {
          continue
        }
        rows.push(row)
      }
    }

    // The two things that have to vary, or "constant at every depth / everywhere in frame" is a
    // claim about one sample. The second bound is stated **as the defect's own size**: the shipped
    // spelling divided by `radial` where the projection wants `viewDepth`, so its error factor at a
    // sample is exactly `radial / viewDepth`. Requiring the sweep to reach 1.20 says the poses below
    // include ones where the old code was at least 20% wide — which is what makes the 2.1 readings
    // a refutation of it rather than a re-measurement near the axis, where it was always right.
    expect(rows.length).toBeGreaterThan(10)
    const depths = rows.map((row) => row.viewDepth)
    expect(Math.max(...depths) / Math.min(...depths)).toBeGreaterThan(1.5)
    const inflation = rows.map((row) => row.radial / row.viewDepth)
    expect(Math.max(...inflation), `worst pre-fix inflation swept`).toBeGreaterThan(1.2)

    for (const row of rows) {
      expect(
        row.halfWidthPx,
        `sample at (${row.screen[0].toFixed(0)}, ${row.screen[1].toFixed(0)}) px, ` +
          `view depth ${row.viewDepth.toFixed(1)}`,
      ).toBeCloseTo(TETHER_HALF_WIDTH_PX, 4)
    }
    tether.dispose()
  })

  it('flares to x2 at the two anchors, which is what makes it read over card art', () => {
    const { tether } = pass()
    const view = camera(new Vector3(0, 40, 60), new Vector3(110, 0, 0))
    for (let frame = 0; frame < 30; frame += 1) tether.update(view, CSS_HEIGHT, frame / 60, 1 / 60)

    expect(measureAt(tether, view, 0).halfWidthPx).toBeCloseTo(
      TETHER_HALF_WIDTH_PX * TETHER_ANCHOR_FLARE,
      4,
    )
    expect(measureAt(tether, view, TETHER_SAMPLES - 1).halfWidthPx).toBeCloseTo(
      TETHER_HALF_WIDTH_PX * TETHER_ANCHOR_FLARE,
      4,
    )
    expect(measureAt(tether, view, 72).halfWidthPx).toBeCloseTo(TETHER_HALF_WIDTH_PX, 4)
    tether.dispose()
  })

  it('halves nothing on a retina display, because the width is CSS and not device px', () => {
    // The prototype's defect, pinned. It sized the ribbon against the drawing buffer's height, which
    // is `CSS_HEIGHT * dpr` — so on a 2x display the same call produced a 1.05 CSS-px ribbon.
    // §3.1's gate runs at dpr 1 exclusively, where the two arguments are identical, so no gate row
    // can discriminate them and the assertion has to be made here.
    const { tether } = pass()
    const view = camera(new Vector3(0, 40, 60), new Vector3(110, 0, 0))

    const halfWidthAt = (height: number) => {
      for (let frame = 0; frame < 30; frame += 1) tether.update(view, height, frame / 60, 1 / 60)
      const array = positions(tether)
      const left = new Vector3(array[72 * 6], array[72 * 6 + 1], array[72 * 6 + 2])
      const right = new Vector3(array[72 * 6 + 3], array[72 * 6 + 4], array[72 * 6 + 5])
      return left.distanceTo(right) / 2
    }

    // Halving the height argument doubles the world-space width, which is exactly how passing the
    // device-pixel height would halve the ribbon on screen.
    expect(halfWidthAt(CSS_HEIGHT / 2) / halfWidthAt(CSS_HEIGHT)).toBeCloseTo(2, 6)
    tether.dispose()
  })
})

describe('the surface run is a great circle, not a normalised chord', () => {
  it('spaces its samples evenly in angle, which lerp-and-normalise does not', () => {
    const from = new Vector3(0, 1, 0)
    const to = new Vector3(1, 0, 0)
    const out = new Vector3()

    const slerped: number[] = []
    const lerped: number[] = []
    let previousSlerp = from.clone()
    let previousLerp = from.clone()
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8
      slerpDirection(out, from, to, t)
      slerped.push(previousSlerp.angleTo(out))
      previousSlerp = out.clone()

      const chord = from.clone().lerp(to, t).normalize()
      lerped.push(previousLerp.angleTo(chord))
      previousLerp = chord
    }

    // Equal steps along the arc, to machine precision.
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(spread(slerped)).toBeLessThan(1e-9)
    // The chord's are not: the ends crowd and the middle thins, by more than 30% here.
    expect(spread(lerped) / (Math.PI / 2 / 8)).toBeGreaterThan(0.3)
  })

  it('answers coincident and antipodal directions without a NaN', () => {
    const out = new Vector3()
    const up = new Vector3(0, 1, 0)
    // Coincident is the far-field case §1.9 relies on, so it is reached every frame at distance.
    slerpDirection(out, up, up.clone(), 0.5)
    expect(out.length()).toBeCloseTo(1, 9)
    // Antipodal has no unique great circle; any unit answer beats a NaN.
    slerpDirection(out, up, new Vector3(0, -1, 0), 0.5)
    expect(out.length()).toBeCloseTo(1, 9)
  })
})

describe('the anchor pads sit on the ground and face out of it', () => {
  it('places each pad on its own anchor, lifted just clear of the surface', () => {
    const { tether, a } = pass()
    const view = camera(new Vector3(6, 6, 20), new Vector3(2, 3, 0))
    for (let frame = 0; frame < 120; frame += 1) tether.update(view, CSS_HEIGHT, frame / 60, 1 / 60)

    const pad = tether.pads[0]
    const offset = pad.position.clone().sub(a.centre)
    expect(offset.length() / a.radius).toBeCloseTo(1.012, 6)
    expect(offset.clone().normalize().angleTo(a.anchor)).toBeLessThan(1e-6)

    // The pad's own +z must point out of the ground, or it is drawn edge-on into the surface.
    const outward = new Vector3(0, 0, 1).applyQuaternion(pad.getWorldQuaternion(new Quaternion()))
    expect(outward.angleTo(a.anchor)).toBeLessThan(1e-5)
    tether.dispose()
  })
})
