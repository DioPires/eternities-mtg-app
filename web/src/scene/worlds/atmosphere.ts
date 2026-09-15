/**
 * §1.2 step 8 — the atmosphere rim (spec §1.7).
 *
 * > *"The rim is an additive `BackSide` sphere at 1.055× radius with a fresnel falloff
 * > (`pow(1 - |n·v|, 2.6)`), tinted by the plane's `nebulaTint`, `depthWrite: false`. Every world
 * > that is drawn at all gets one; **it is what replaces full-scene bloom**."*
 *
 * That last clause is why this is not decoration. §1.1 deletes the bloom source, the mip chain and
 * half the composite, and it is explicit that the deletion *"is not an optimisation that can be
 * deferred"*: review §4.2 costs concept B assuming there is no post chain, and review §4.1 finds the
 * shipped 0.28-threshold bloom is what makes stars read as out-of-focus bokeh. So the glow budget
 * for the entire scene is this shell — *"one additive back-face sphere per visible world"* — and
 * §1.1's normative line is that **the worlds path must not add a full-scene post pass; any glow is
 * in-shader**.
 *
 * **Worlds only, never moons.** §1.7 says *"every world that is drawn at all"*, and §1.8's moons are
 * *"present, unlit"* — a rim is light. A near-black sphere with a bright halo is a dim glow with
 * extra steps, which is precisely the thing §1.8 retires (*"Today they are dim glows that PRD 5.3.8
 * obliges the app to label, which is how the home view ends up as 82 labels over 30 real objects"*).
 *
 * **`BackSide`, and it is load-bearing.** The shell is drawn from the inside, so its fragments are
 * the *far* hemisphere of the air and the near hemisphere never occludes the world. Drawn
 * `FrontSide` the same fresnel lights the half of the shell between the eye and the globe, and the
 * mosaic is then seen through a bright wash — with the silhouette still looking exactly right.
 */

import {
  AdditiveBlending,
  BackSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type IUniform,
} from 'three'

import type { PlaneRecord } from '../../data/types'
import { SHADER_NAME_WORLD_ATMOSPHERE, SHADER_NAME_WORLD_ATMOSPHERE_CHEAP } from '../shaderNames'

import { RENDER_ORDER_ATMOSPHERE } from './passOrder'
import {
  ATMOSPHERE_FRAGMENT_SHADER,
  ATMOSPHERE_VERTEX_SHADER,
  RIM_RADIUS_SCALE,
} from './atmosphereShaders'
import { worldRadius } from './surfaceLaw'
import type { WorldFrame } from './worldSurface'

/**
 * Sphere tessellation — 48 × 28.
 *
 * The rim's brightness is a function of `|n·v|` near the silhouette, where it changes fastest, so a
 * coarse sphere shows the falloff as facets along exactly the edge the whole shell exists to draw.
 * The prototype's figures, and the shell is one draw for the roster, so the cost is 45 × 2,688
 * triangles once — against a mip chain per frame, which is what it replaces.
 */
const RIM_SEGMENTS_WIDTH = 48
const RIM_SEGMENTS_HEIGHT = 28

/** §1.12's tier-4 rung: *"cheap rim (one tap, no dither)"*. See `atmosphereShaders.ts`. */
export type RimQuality = 'full' | 'cheap'

export interface AtmosphereOptions {
  /** The worlds with cells — the set §3.1 calls `worldsWithCards`. Moons and dust are not here. */
  readonly worlds: readonly PlaneRecord[]
  readonly quality?: RimQuality
}

/** Whether a world is drawn at all this frame — §1.7's *"every world that is drawn at all"*. */
export type IsDrawn = (plane: PlaneRecord) => boolean

const matrix = new Matrix4()
const identity = new Quaternion()
const scale = new Vector3()
const centre = new Vector3()

export class AtmospherePass {
  readonly mesh: InstancedMesh

  private readonly worlds: readonly PlaneRecord[]
  private readonly tint: InstancedBufferAttribute
  private quality: RimQuality
  private drawn = 0

  constructor(options: AtmosphereOptions) {
    this.worlds = options.worlds
    this.quality = options.quality ?? 'full'
    const capacity = this.worlds.length

    const geometry = new SphereGeometry(1, RIM_SEGMENTS_WIDTH, RIM_SEGMENTS_HEIGHT)
    this.tint = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.tint.setUsage(DynamicDrawUsage)
    geometry.setAttribute('iTint', this.tint)

    this.mesh = new InstancedMesh(geometry, this.buildMaterial(), Math.max(capacity, 1))
    this.mesh.name = 'worlds-atmosphere'
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    // §1.2: 8 is last, "because an atmosphere must not depth-reject the tether passing in front of
    // it". See `passOrder.ts` for why three's own back-to-front sort does not deliver this.
    this.mesh.renderOrder = RENDER_ORDER_ATMOSPHERE
  }

  /** How many shells the last {@link update} left in the draw. */
  get drawnCount(): number {
    return this.drawn
  }

  get rimQuality(): RimQuality {
    return this.quality
  }

  /**
   * §1.12's tier-4 rung.
   *
   * Rebuilds the material rather than toggling a define in place, because the two spellings are two
   * **programs** with two names (`shaderNames.ts`), and a `ShaderMaterial` whose `defines` change
   * after first compile needs `needsUpdate` anyway. One knob, one writer — DEC-739's ladder
   * invariant, which is why this is a method on the pass and not a field the caller sets.
   */
  setRimQuality(quality: RimQuality): void {
    if (quality === this.quality) return
    this.quality = quality
    const previous = this.mesh.material as ShaderMaterial
    this.mesh.material = this.buildMaterial()
    previous.dispose()
  }

  update(frame: WorldFrame, isDrawn: IsDrawn): void {
    const tints = this.tint.array as Float32Array
    let at = 0
    for (const plane of this.worlds) {
      if (!isDrawn(plane)) continue
      // This frame's centre, not `plane.home` (DEC-804). §1.7's shell sits on its world's limb; a
      // shell at the t=0 home while the world tracks the multiverse is a rim detached from the
      // globe it belongs to, which reads as bloom rather than as a placement error.
      frame.centreOf(plane, centre)
      // §1.3's law, not `plane.radius` — the same refusal `buildWorldSource` makes, and for the same
      // reason: the shipped field is also written by the retiring galaxy path. A shell sized from a
      // stale radius is a halo that does not sit on its world's limb, which reads as bloom.
      scale.setScalar(worldRadius(plane.cardCount) * RIM_RADIUS_SCALE)
      this.mesh.setMatrixAt(at, matrix.compose(centre, identity, scale))
      tints[at * 3] = plane.nebulaTint[0]
      tints[at * 3 + 1] = plane.nebulaTint[1]
      tints[at * 3 + 2] = plane.nebulaTint[2]
      at += 1
    }

    this.drawn = at
    this.mesh.count = at
    if (at === 0) return
    this.mesh.instanceMatrix.needsUpdate = true
    this.tint.needsUpdate = true
    // `IUniform.value` is `any`; naming the shape keeps `.copy` a Vector3 call. Same spelling as
    // `WorldSurface`'s own `uLight` write.
    const uniforms = (this.mesh.material as ShaderMaterial).uniforms as unknown as {
      uLight: { value: Vector3 }
    }
    uniforms.uLight.value.copy(frame.lightDirection)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
    this.mesh.dispose()
  }

  /**
   * The two rungs, as two constructions rather than one with a ternary name.
   *
   * `shader-names.test.ts` parses these sites and requires `name:` to be a bare `SHADER_NAME_*`
   * identifier — a computed name would pass "is there a name" while escaping the whitespace and
   * uniqueness rules, so the parser refuses it on purpose (DEC-700, DEC-731). Written the same way
   * `starFieldObjects.ts` writes `PlaneGlow` and `PlaneGlowCheap`: one shared literal, two calls.
   */
  private buildMaterial(): ShaderMaterial {
    const shared = {
      uniforms: { uLight: { value: new Vector3(0, 0, 1) } } as { [uniform: string]: IUniform },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      transparent: true,
      blending: AdditiveBlending,
      // **`premultipliedAlpha`, and it is the difference between §1.7's 2.6 and a shipped 5.2**
      // (DEC-773 F1). three's default is `false`, which makes `AdditiveBlending`
      // `blendFuncSeparate(SRC_ALPHA, ONE, ONE, ONE)` — the composited result is `rgb × a`, not
      // `rgb`. The fragment shader puts `intensity * lit` into **both** channels, so a shell written
      // to §1.7's `pow(1 - |n·v|, 2.6)` composites at the square of it and `RIM_NIGHT_FLOOR` 0.55
      // delivers 0.3025. `true` is `blendFunc(ONE, ONE)`: the rgb the shader wrote is what lands.
      //
      // The alternative — moving the falloff into alpha alone, the spelling `starfield/shaders.ts`
      // uses — clamps at 1, and the full rim's core lobe peaks at `intensity` 1.45 exactly on the
      // limb. That spelling is correct for a shell whose peak is under 1 and quietly discards the
      // headroom here, so the two are not interchangeable and this one is the ruling (DEC-775).
      premultipliedAlpha: true,
      // §1.7. An additive glow that wrote depth would occlude the world it surrounds — and every
      // world behind it — with a shell that is almost entirely transparent.
      depthWrite: false,
      depthTest: true,
      side: BackSide,
    } as const

    if (this.quality === 'cheap') {
      return new ShaderMaterial({
        name: SHADER_NAME_WORLD_ATMOSPHERE_CHEAP,
        defines: { CHEAP_RIM: '' },
        ...shared,
      })
    }
    return new ShaderMaterial({
      name: SHADER_NAME_WORLD_ATMOSPHERE,
      ...shared,
    })
  }
}
