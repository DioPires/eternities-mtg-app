/**
 * §1.2 step 5 — the surface-following tether (spec §1.9).
 *
 * > *"The claim is that the tether stops being a line between two dots and becomes a thing anchored
 * > to ground. Each end has two directions: the **anchor**, wherever the reticle points when the
 * > camera is close, and the **exit**, the sub-point facing the other world. The curve is a
 * > great-circle run across the surface from anchor to exit, a Bézier through space to the far
 * > world's exit, then its surface run in reverse. When the camera is far the anchor relaxes onto the
 * > exit and the surface runs collapse to nothing — the far-field behaviour you want, at no special
 * > case."*
 *
 * > *"Geometry: 24 samples per surface run, 96 across the span, 144 total. Drawn as a **camera-facing
 * > ribbon of constant CSS-pixel width** (2.1 px half-width, flaring ×2.0 at the two anchors), not as
 * > `LineSegments`: line width is the one primitive parameter WebGL is allowed to ignore, and at
 * > constant width the tether is invisible over a surface of card art — the flare and the two glowing
 * > anchor pads are what make it read as footed into ground rather than laid across a photograph."*
 *
 * **CSS pixels, and that is a correction to the prototype.** The prototype sized its ribbon against
 * the *drawing buffer's* height, so on a 2× display it drew a 1.05 CSS-px ribbon — half the intended
 * width, and invisible over art, which is the one place §1.9 says it has to read. §1.9 says CSS and
 * every other threshold in this spec is CSS (§1.5's 4/8 px band, §1.6's 24 px, §1.11's 24 px floor),
 * so {@link TETHER_HALF_WIDTH_PX} is resolved against the CSS viewport. §3.1's gate runs at dpr 1,
 * where the two are equal — so this is a defect no gate row can catch, and only a retina eye can.
 *
 * **Premultiplied alpha, on the ribbon and on both pads — and here it is a tuning change, not a
 * correction to a spec deviation (DEC-773 F1, DEC-775).** three's `AdditiveBlending` at its default
 * `premultipliedAlpha: false` is `blendFunc(SRC_ALPHA, ONE)`, so the composited result is `rgb × a`.
 * Both shaders in `tetherShaders.ts` put the *same* factors into both channels — `ends` and the
 * travelling `flow` on the ribbon, `ring`/`core` on the pads — so every one of them was being applied
 * twice. §1.7 makes that a **deviation** for the rim, because §1.7 names an exponent; §1.9 names no
 * falloff at all, so the only thing the double-apply broke here was that the shaders did not say what
 * they drew. Both are premultiplied now and the rgb each writes is what lands, which costs:
 *
 * | quantity | before (`rgb × a`) | after (`rgb`) |
 * |---|---|---|
 * | ribbon, pulse crest | 0.920 | 1.150 |
 * | ribbon, pulse trough | 0.229 | 0.520 |
 * | ribbon, crest ÷ trough | 4.02 | 2.21 |
 * | pad, ring peak | 0.595 | 0.850 |
 *
 * So the ribbon reads brighter with a gentler pulse and the pads read brighter with a wider ring —
 * both in the direction §1.9 argues for (*"invisible over a surface of card art"*, *"footed into
 * ground"*), and neither is a number §1.9 states. Recorded rather than retuned back: a shader that
 * composites what it writes is the property worth keeping, and the constants above are one edit away
 * if the owner-judged capture says otherwise.
 *
 * **What decides the two ends is not in this file, and not in §1.9.** The section specifies the
 * geometry of a tether between two worlds and says nothing about *which* two, or when one is shown;
 * §4's staffing table gives the product surfaces (§1.10–§1.12) to leg R3 and §1.9's geometry to R2.
 * So this ships as an imperative pair — {@link TetherPass.setEnds} — with nothing in the product
 * calling it yet. Flagged on DEC-750's hand-back rather than invented here: a tether that appears on
 * a rule R2 made up is harder to remove than one that has no rule at all.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  Sphere as SphereType,
  Ray,
  Vector3,
  type IUniform,
  type PerspectiveCamera,
} from 'three'

import { SHADER_NAME_WORLD_TETHER, SHADER_NAME_WORLD_TETHER_PAD } from '../shaderNames'

import { RENDER_ORDER_TETHER } from './passOrder'
import {
  TETHER_FRAGMENT_SHADER,
  TETHER_PAD_FRAGMENT_SHADER,
  TETHER_PAD_VERTEX_SHADER,
  TETHER_VERTEX_SHADER,
} from './tetherShaders'

/** §1.9: *"24 samples per surface run, 96 across the span, 144 total"*. */
export const TETHER_SURFACE_SAMPLES = 24
export const TETHER_SPAN_SAMPLES = 96
export const TETHER_SAMPLES = TETHER_SURFACE_SAMPLES * 2 + TETHER_SPAN_SAMPLES

/** §1.9: *"2.1 px half-width, flaring ×2.0 at the two anchors"*. **CSS** px — see the header. */
export const TETHER_HALF_WIDTH_PX = 2.1
export const TETHER_ANCHOR_FLARE = 2.0

/** How much of each end of the ribbon the flare covers, as a fraction of the whole curve. */
const FLARE_REACH = 0.14

/**
 * §1.9's *"when the camera is far the anchor relaxes onto the exit"*, as the two distances it
 * relaxes between, in units of the world's own radius.
 *
 * Outside {@link ANCHOR_RELAX_RADII} the world is a dot and an anchor on it is meaningless, so the
 * tether leaves from the sub-point; inside {@link ANCHOR_HOLD_RADII} the anchor is wherever the
 * reticle is. The surface runs then *"collapse to nothing"* on their own — a great-circle run from
 * the exit to the exit is a point — which is why §1.9 can claim the far-field behaviour costs no
 * special case. There is no branch here for it either.
 */
const ANCHOR_RELAX_RADII = 8
const ANCHOR_HOLD_RADII = 2.5

/** How far the curve lifts off the surface, so it does not z-fight the sheet it runs across. */
const SURFACE_LIFT = 1.008
const EXIT_LIFT = 1.01
/** The Bézier control points' reach along each exit, as a fraction of the span. */
const SPAN_LIFT = 0.28
/** The anchor pad's radius as a fraction of the world's, and its own lift off the surface. */
const PAD_SCALE = 0.11
const PAD_LIFT = 1.012

/** One end of the tether: a world, plus the two directions §1.9 gives every end. */
export interface TetherEnd {
  readonly centre: Vector3
  readonly radius: number
  /** Where the reticle points, as a unit direction out of `centre`. */
  readonly anchor: Vector3
  /** The sub-point facing the other world. */
  readonly exit: Vector3
}

/**
 * Spherical linear interpolation between two unit directions — the great-circle run of §1.9.
 *
 * Not `Vector3.lerp().normalize()`, which is the spelling that looks equivalent: a normalised linear
 * blend runs along the **chord** and re-projects, so its speed along the arc is wrong everywhere
 * except the midpoint — samples bunch at the two ends and thin out in the middle. Over a 24-sample
 * run across a world's surface that is a visibly uneven ribbon, and it is worst at exactly the
 * quarter-turn separations a tether between neighbours produces.
 */
export function slerpDirection(out: Vector3, a: Vector3, b: Vector3, t: number): Vector3 {
  const dot = Math.min(1, Math.max(-1, a.dot(b)))
  const theta = Math.acos(dot)
  // Antipodal and coincident are both degenerate, and both end up here. Coincident is the far-field
  // case §1.9 relies on (anchor relaxed onto exit) and must not produce a NaN; antipodal has no
  // unique great circle, and `b` is as good an answer as any other.
  if (theta < 1e-4 || theta > Math.PI - 1e-4) return out.copy(b)
  const sin = Math.sin(theta)
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * theta) / sin)
    .addScaledVector(b, Math.sin(t * theta) / sin)
    .normalize()
}

/**
 * How far the anchor has slid from the sub-point toward the reticle — 0 far out, 1 close in.
 *
 * @param radii the camera's distance from the world's centre, in that world's own radii
 */
export function anchorSlide(radii: number): number {
  const t = (ANCHOR_RELAX_RADII - radii) / (ANCHOR_RELAX_RADII - ANCHOR_HOLD_RADII)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

const scratchDir = new Vector3()
const scratchTangent = new Vector3()
const scratchSide = new Vector3()
const scratchView = new Vector3()
const scratchOffset = new Vector3()
const cameraRight = new Vector3()
const cameraUp = new Vector3()
const cameraForward = new Vector3()
const controlA = new Vector3()
const controlB = new Vector3()
const exitPointA = new Vector3()
const exitPointB = new Vector3()
const padLook = new Vector3()
const ray = new Ray()
const sphere: SphereType = new Sphere()
const hit = new Vector3()
const wanted = new Vector3()

/**
 * The ribbon and its two anchor pads.
 *
 * The curve is rebuilt on the CPU every frame because both of the things that shape it move every
 * frame: the camera (the ribbon faces it, and the anchors slide with it) and the worlds (which spin
 * under their own anchors). 144 samples × 2 vertices is 288 positions — the same order as one
 * medium world's cell count, once for the whole scene.
 */
export class TetherPass {
  readonly ribbon: Mesh
  readonly pads: readonly [Mesh, Mesh]

  private readonly positions: BufferAttribute
  private readonly points: Vector3[] = []
  private readonly time: { value: number }
  private ends: readonly [TetherEnd, TetherEnd] | null = null

  constructor(colour: readonly [number, number, number] = [1.0, 0.78, 0.42]) {
    const positions = new Float32Array(TETHER_SAMPLES * 2 * 3)
    const along = new Float32Array(TETHER_SAMPLES * 2)
    const index: number[] = []
    for (let i = 0; i < TETHER_SAMPLES; i += 1) {
      const t = i / (TETHER_SAMPLES - 1)
      along[i * 2] = t
      along[i * 2 + 1] = t
      if (i + 1 < TETHER_SAMPLES) {
        const a = i * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
      this.points.push(new Vector3())
    }

    const geometry = new BufferGeometry()
    this.positions = new BufferAttribute(positions, 3)
    this.positions.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', this.positions)
    geometry.setAttribute('aAlong', new BufferAttribute(along, 1))
    geometry.setIndex(index)

    this.time = { value: 0 }
    const uniforms: { [uniform: string]: IUniform } = {
      uColour: { value: new Vector3(colour[0], colour[1], colour[2]) },
      uTime: this.time,
    }
    this.ribbon = new Mesh(
      geometry,
      new ShaderMaterial({
        name: SHADER_NAME_WORLD_TETHER,
        uniforms,
        vertexShader: TETHER_VERTEX_SHADER,
        fragmentShader: TETHER_FRAGMENT_SHADER,
        transparent: true,
        blending: AdditiveBlending,
        // Premultiplied — see the header. The rgb the fragment shader writes is what is added.
        premultipliedAlpha: true,
        depthWrite: false,
        // The ribbon is one quad strip with no consistent winding — it twists as it turns to face
        // the camera — so a cull would drop whichever half happened to face away this frame.
        side: DoubleSide,
      }),
    )
    // The vertices are rewritten every frame from a curve spanning the multiverse; three's bound is
    // computed once from whatever was in the buffer at construction, which is the origin.
    this.ribbon.frustumCulled = false
    this.ribbon.renderOrder = RENDER_ORDER_TETHER
    this.ribbon.visible = false
    this.ribbon.name = 'worlds-tether'

    const padGeometry = new PlaneGeometry(1, 1)
    this.pads = [
      new Mesh(padGeometry, padMaterial(colour)),
      new Mesh(padGeometry, padMaterial(colour)),
    ]
    for (const pad of this.pads) {
      pad.frustumCulled = false
      pad.renderOrder = RENDER_ORDER_TETHER
      pad.visible = false
      pad.name = 'worlds-tether-pad'
    }
  }

  /** The two worlds the tether runs between, or `null` to hide it. */
  setEnds(ends: readonly [TetherEnd, TetherEnd] | null): void {
    this.ends = ends
    const visible = ends !== null
    this.ribbon.visible = visible
    for (const pad of this.pads) pad.visible = visible
  }

  get active(): boolean {
    return this.ends !== null
  }

  /**
   * Re-derive each end's anchor from the camera, then rebuild the ribbon.
   *
   * @param viewportHeightPx **CSS** px — see the file header
   */
  update(
    camera: PerspectiveCamera,
    viewportHeightPx: number,
    elapsedSeconds: number,
    deltaSeconds: number,
  ): void {
    const ends = this.ends
    if (!ends) return
    this.time.value = elapsedSeconds

    const [a, b] = ends
    // The exits are re-derived every frame: they are "the sub-point facing the other world", and
    // both worlds drift and turn under them.
    a.exit.copy(b.centre).sub(a.centre).normalize()
    b.exit.copy(a.centre).sub(b.centre).normalize()
    advanceAnchor(camera, a, deltaSeconds)
    advanceAnchor(camera, b, deltaSeconds)

    exitPointA.copy(a.centre).addScaledVector(a.exit, a.radius * EXIT_LIFT)
    exitPointB.copy(b.centre).addScaledVector(b.exit, b.radius * EXIT_LIFT)
    // `lift` along each exit is what makes the free span leave the ground perpendicular instead of
    // shooting off tangentially — half of what "footed into ground" means at this scale.
    const lift = exitPointA.distanceTo(exitPointB) * SPAN_LIFT
    controlA.copy(exitPointA).addScaledVector(a.exit, lift)
    controlB.copy(exitPointB).addScaledVector(b.exit, lift)

    // `t * t` rather than `t`: the run accelerates away from the anchor, so samples crowd where the
    // curve bends hardest — at the pad — and thin out along the straight part near the exit.
    for (let i = 0; i < TETHER_SURFACE_SAMPLES; i += 1) {
      const t = i / TETHER_SURFACE_SAMPLES
      slerpDirection(scratchDir, a.anchor, a.exit, t * t)
      this.points[i]!.copy(a.centre).addScaledVector(scratchDir, a.radius * SURFACE_LIFT)
    }
    for (let i = 0; i < TETHER_SPAN_SAMPLES; i += 1) {
      const t = i / (TETHER_SPAN_SAMPLES - 1)
      const u = 1 - t
      const w0 = u * u * u
      const w1 = 3 * u * u * t
      const w2 = 3 * u * t * t
      const w3 = t * t * t
      this.points[TETHER_SURFACE_SAMPLES + i]!.set(
        w0 * exitPointA.x + w1 * controlA.x + w2 * controlB.x + w3 * exitPointB.x,
        w0 * exitPointA.y + w1 * controlA.y + w2 * controlB.y + w3 * exitPointB.y,
        w0 * exitPointA.z + w1 * controlA.z + w2 * controlB.z + w3 * exitPointB.z,
      )
    }
    for (let i = 0; i < TETHER_SURFACE_SAMPLES; i += 1) {
      const t = 1 - i / TETHER_SURFACE_SAMPLES
      slerpDirection(scratchDir, b.anchor, b.exit, t * t)
      this.points[TETHER_SURFACE_SAMPLES + TETHER_SPAN_SAMPLES + i]!
        .copy(b.centre)
        .addScaledVector(scratchDir, b.radius * SURFACE_LIFT)
    }

    this.ribbonise(camera, viewportHeightPx)
    this.placePad(this.pads[0], a)
    this.placePad(this.pads[1], b)
  }

  dispose(): void {
    this.ribbon.geometry.dispose()
    ;(this.ribbon.material as ShaderMaterial).dispose()
    this.pads[0].geometry.dispose()
    for (const pad of this.pads) (pad.material as ShaderMaterial).dispose()
  }

  /**
   * Expand the 144-point curve into a camera-facing strip of constant CSS width.
   *
   * **The scale is the projection's own derivative, not `halfWidthPx · r / fovScale` (DEC-773 F7).**
   * `fovScale = h / (2·tan(fov/2))` inverts a perspective divide whose denominator is the
   * **view-space depth**; the shipped spelling divided by the *radial* distance `|camera − point|`,
   * which is `depth / cos θ`, so the ribbon grew by `1/cos θ` off-axis. Measured at 1920×1080 fov 55:
   * 2.100 px on the axis and **2.799 px** near the horizontal frame edge, against §1.9's *"constant
   * CSS-pixel width"*.
   *
   * Substituting the depth fixes that one measurement exactly and is still not the law, because the
   * side vector is perpendicular to the **view ray** and not to the image plane: off-axis it has a
   * component along the camera's forward axis, and moving a vertex toward the eye moves it on screen
   * too. So the scale here is `|dπ(ŝ)|`, the screen-space length of a unit step along `ŝ` — for a
   * projection `π(p) = fovScale · (p_r, p_u) / p_f`,
   *
   * ```
   * dπ(ŝ) = (fovScale / d) · ( ŝ_r − (p_r/d)·ŝ_f ,  ŝ_u − (p_u/d)·ŝ_f )
   * ```
   *
   * in the camera's own right/up/forward basis. On the axis the two right-hand terms vanish and this
   * collapses to `fovScale / d` — the one-line fix, and exact for a side vector that lies in the
   * image plane. It is **not** exact for one that does not, and half-width px at 1920×1080 fov 55,
   * measured by projecting the written vertices back through the camera's own matrices:
   *
   * | side vector | on axis | horizontal edge | near the corner |
   * |---|---|---|---|
   * | `r` (shipped before this) | 2.102 | 2.772 | 3.533 |
   * | `d` alone | 2.100 | 2.100 | 2.497 |
   * | `\|dπ(ŝ)\|` (here) | 2.100 | 2.100 | 2.100 |
   *
   * `ŝ ⊥ (point − camera)` by construction, so `dπ(ŝ)` cannot be zero for a unit `ŝ` — the clamp
   * below is against float underflow, not against a real case.
   *
   * **Coincident samples are the normal case, not an edge case.** §1.9's far field collapses both
   * surface runs to a point, so 24 of the 144 samples at each end are identical and `next − previous`
   * is the zero vector. `Vector3.normalize()` is `divideScalar(length() || 1)`, so that yields a zero
   * vector rather than a `NaN` (DEC-773 F6) — the guard is not there to stop a `NaN`, and three's
   * bounding sphere is never at risk. What the guard buys is the **ribbon**: a zero tangent crosses
   * to a zero side vector, that falls through to the `(0, 1, 0)` fallback below, and world `+Y` is
   * not perpendicular to the view. The 48 collapsed samples would then be drawn edge-on by however
   * much the camera is off the world's own `+Y`, at a width that is no longer 2.1 px. Carrying the
   * last live tangent keeps every sample's side vector square to the eye, which is what makes §1.9's
   * far field *"cost no special case"*.
   */
  private ribbonise(camera: PerspectiveCamera, viewportHeightPx: number): void {
    const fovScale = viewportHeightPx / (2 * Math.tan((camera.fov * Math.PI) / 360))
    const array = this.positions.array as Float32Array
    scratchTangent.set(0, 0, 1)

    // The camera's own basis, from its world matrix: three looks down its **-z**, so forward is the
    // negated third column. Read once — it is constant over the 144 samples.
    const e = camera.matrixWorld.elements
    cameraRight.set(e[0] ?? 1, e[1] ?? 0, e[2] ?? 0).normalize()
    cameraUp.set(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0).normalize()
    cameraForward.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1)).normalize()

    for (let i = 0; i < TETHER_SAMPLES; i += 1) {
      const point = this.points[i]!
      const next = this.points[Math.min(TETHER_SAMPLES - 1, i + 1)]!
      const previous = this.points[Math.max(0, i - 1)]!
      scratchDir.copy(next).sub(previous)
      if (scratchDir.lengthSq() > 1e-12) scratchTangent.copy(scratchDir).normalize()

      // `scratchOffset` is the point in the camera's frame; `scratchView` is the unit direction back
      // toward the eye, which is what the ribbon turns to face.
      scratchOffset.copy(point).sub(camera.position)
      const depth = Math.max(1e-3, scratchOffset.dot(cameraForward))
      scratchView.copy(scratchOffset).multiplyScalar(-1).normalize()
      scratchSide.crossVectors(scratchTangent, scratchView)
      // The tangent and the view are parallel when the curve runs straight at the eye, and the
      // ribbon has no width to give there; any perpendicular will do for one sample.
      if (scratchSide.lengthSq() < 1e-12) scratchSide.set(0, 1, 0)
      scratchSide.normalize()

      // `|dπ(ŝ)|` in px per world unit — see the doc comment above.
      const offsetRight = scratchOffset.dot(cameraRight) / depth
      const offsetUp = scratchOffset.dot(cameraUp) / depth
      const sideForward = scratchSide.dot(cameraForward)
      const screenPerUnit =
        (fovScale / depth) *
        Math.hypot(
          scratchSide.dot(cameraRight) - offsetRight * sideForward,
          scratchSide.dot(cameraUp) - offsetUp * sideForward,
        )

      const t = i / (TETHER_SAMPLES - 1)
      const flare =
        1 + (TETHER_ANCHOR_FLARE - 1) * Math.max(0, 1 - Math.min(t, 1 - t) / FLARE_REACH)
      scratchSide.multiplyScalar(
        (TETHER_HALF_WIDTH_PX * flare) / Math.max(screenPerUnit, 1e-9),
      )

      array[i * 6] = point.x - scratchSide.x
      array[i * 6 + 1] = point.y - scratchSide.y
      array[i * 6 + 2] = point.z - scratchSide.z
      array[i * 6 + 3] = point.x + scratchSide.x
      array[i * 6 + 4] = point.y + scratchSide.y
      array[i * 6 + 5] = point.z + scratchSide.z
    }
    this.positions.needsUpdate = true
  }

  private placePad(pad: Mesh, end: TetherEnd): void {
    pad.position.copy(end.centre).addScaledVector(end.anchor, end.radius * PAD_LIFT)
    padLook.copy(pad.position).addScaledVector(end.anchor, 1)
    pad.lookAt(padLook)
    pad.scale.setScalar(end.radius * PAD_SCALE)
    pad.updateMatrixWorld()
  }
}

/**
 * Slide one end's anchor toward the reticle's surface point, or relax it onto the exit.
 *
 * The reticle is the camera's own centre ray, so this is "wherever you are looking" without the
 * pointer being involved — §1.9's wording, and the behaviour the prototype's `tether-surface`
 * capture shows. A ray that misses the sphere relaxes to the exit, which is the same answer the far
 * field gives and needs no separate branch.
 *
 * The lerp toward `wanted` is per-frame rather than instantaneous so the anchor does not snap across
 * the surface when the reticle crosses the limb, where the hit point jumps.
 */
function advanceAnchor(camera: PerspectiveCamera, end: TetherEnd, deltaSeconds: number): void {
  const radii = end.radius > 0 ? camera.position.distanceTo(end.centre) / end.radius : 0
  const slide = anchorSlide(radii)
  if (slide > 0 && reticlePoint(camera, end, wanted)) {
    wanted.lerp(end.exit, 1 - slide).normalize()
  } else {
    wanted.copy(end.exit)
  }
  // Frame-rate independent smoothing: the same `1 - exp(-k·dt)` shape the camera rig uses, so the
  // anchor's travel is the same on a 60 Hz panel and a 144 Hz one.
  end.anchor.lerp(wanted, 1 - Math.exp(-8 * Math.max(deltaSeconds, 0))).normalize()
}

function reticlePoint(camera: PerspectiveCamera, end: TetherEnd, out: Vector3): boolean {
  ray.origin.copy(camera.position)
  // three's camera looks down its own -z, so the forward direction is the negated third basis
  // column of its world matrix.
  const e = camera.matrixWorld.elements
  ray.direction.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1)).normalize()
  sphere.set(end.centre, end.radius)
  if (ray.intersectSphere(sphere, hit) === null) return false
  out.copy(hit).sub(end.centre).normalize()
  return true
}

function padMaterial(colour: readonly [number, number, number]): ShaderMaterial {
  const uniforms: { [uniform: string]: IUniform } = {
    uColour: { value: new Vector3(colour[0], colour[1], colour[2]) },
  }
  return new ShaderMaterial({
    name: SHADER_NAME_WORLD_TETHER_PAD,
    uniforms,
    vertexShader: TETHER_PAD_VERTEX_SHADER,
    fragmentShader: TETHER_PAD_FRAGMENT_SHADER,
    transparent: true,
    blending: AdditiveBlending,
    // Premultiplied — see the header. The ring's own profile composites, not its square.
    premultipliedAlpha: true,
    depthWrite: false,
    side: DoubleSide,
  })
}
