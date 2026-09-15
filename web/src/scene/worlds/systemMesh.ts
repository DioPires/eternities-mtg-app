/**
 * §1.2 step 2 — the system: undetailed worlds and dark moons, one `InstancedMesh` (spec §1.8).
 *
 * > **Normative — there is one partition and it is §1.5's crossover, not "the focused world"
 * > (§1.2).** *"A world appears in step 2 or step 4, except inside the crossover band where it
 * > appears in both and the two cross-fade."* So this pass draws **every plane below the band's
 * > ceiling**, which includes every plane inside the band, plus every empty plane always — a moon
 * > has no cell sheet to cross over to. Step 2's instance count is therefore **not**
 * > `worlds − sheetsDrawn`: a world inside the band is in both counts, and a renderer that subtracts
 * > is one instance short through every approach (§1.5).
 *
 * The Blind Eternities is excluded: it is step 3, and `belt.ts` draws it.
 *
 * **What is per-instance and what is per-frame.** A plane's radius, its equirect layer and §1.8's
 * stretched palette tint are fixed at compose time — they are statistics of the dataset. Its
 * orientation and its tint *mix* are per frame: the first because the world turns (`spin.ts`), the
 * second because the mix is a function of on-screen radius (§1.5's `tintMix`). The instance buffers
 * are rewritten every frame regardless, because the orientation is in them.
 *
 * **Compacted, not masked.** The drawn set changes as worlds cross the band, and the instances that
 * draw are written to the front of the buffers with `mesh.count` set behind them. A masked instance
 * scaled to zero still runs its vertex shader 1,280 times and still costs a degenerate triangle per
 * face; a compacted one costs nothing, and `drawnCount` is then a number the probe can report
 * instead of a number a reader has to trust.
 */

import {
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type DataArrayTexture,
  type IUniform,
} from 'three'

import type { PlaneRecord } from '../../data/types'
import { SHADER_NAME_WORLD_SYSTEM } from '../shaderNames'

import { tintMix, worldRadiusPx } from './lod'
import { multiverseMeanPalette, paletteTint } from './paletteTint'
import { planeOrientation, type SpinAngleSource } from './spin'
import { worldRadius } from './surfaceLaw'
import {
  MOON_COLOUR,
  MOON_LAYER,
  SYSTEM_FRAGMENT_SHADER,
  SYSTEM_VERTEX_SHADER,
} from './systemShaders'
import type { WorldFrame } from './worldSurface'

/**
 * Icosphere subdivisions — 1,280 triangles.
 *
 * Not tuned for the home view, where a world is a few pixels and two triangles would do. It is tuned
 * for the **top of §1.5's band**: a world still draws here while its cell sheet fades in, and at
 * Dominaria's 8 px median cell height the globe itself is hundreds of pixels across. A coarse sphere
 * there shows its silhouette as a polygon directly behind a mosaic that is round, which reads as the
 * sheet floating off the world. The prototype's value, kept for the same reason it picked it.
 */
const ICOSPHERE_DETAIL = 4

/** One plane's fixed half of the instance: everything that is a statistic of the dataset. */
interface SystemEntry {
  readonly plane: PlaneRecord
  /** §1.3's law, floor included — `worldRadius(0)` is §1.8's 0.55 moon radius, so this is one call. */
  readonly radius: number
  /** The world's layer in the equirect array, or {@link MOON_LAYER}. */
  readonly layer: number
  /** §1.8's stretched deviation tint, or the flat moon colour. Linear RGB. */
  readonly tint: readonly [number, number, number]
}

export interface SystemPassOptions {
  /** The whole roster. Dust is filtered out here, not by the caller — it is step 3's. */
  readonly planes: readonly PlaneRecord[]
  /** The baked far-LOD array (§1.5), or `null` when no world composed. */
  readonly equirect: DataArrayTexture | null
  /**
   * A plane's layer in {@link SystemPassOptions.equirect}, or a negative number for "no layer".
   *
   * Supplied rather than derived, because the layer index is the **roster position among worlds
   * with cards**, which `attachWorlds` assigns when it composes them. Recomputing it here would be a
   * second implementation of that ordering, and the two would agree until the day a plane with cards
   * failed to compose.
   */
  readonly layerOf: (plane: PlaneRecord) => number
}

/** Whether a plane draws in this pass this frame — §1.5's crossover, asked per entry. */
export type DrawsSystem = (plane: PlaneRecord) => boolean

const matrix = new Matrix4()
const orientation = new Quaternion()
const scale = new Vector3()
const centre = new Vector3()

export class SystemPass {
  readonly mesh: InstancedMesh

  private readonly entries: readonly SystemEntry[]
  private readonly layer: InstancedBufferAttribute
  private readonly tint: InstancedBufferAttribute
  private readonly mix: InstancedBufferAttribute
  private drawn = 0

  constructor(options: SystemPassOptions) {
    // Card-weighted over the WHOLE roster including the belt — see `multiverseMeanPalette`. Taken
    // before the dust is filtered out below, which is the one place that ordering matters.
    const reference = multiverseMeanPalette(options.planes)

    this.entries = options.planes
      .filter((plane) => plane.kind !== 'dust')
      .map((plane) => {
        const layer = plane.cardCount > 0 ? options.layerOf(plane) : MOON_LAYER
        return {
          plane,
          radius: worldRadius(plane.cardCount),
          layer,
          // A moon takes the flat colour with **no palette tint** (§1.8). The test is the layer, not
          // the card count: a plane with cards whose layer never arrived has no equirect to sample
          // and would otherwise read layer -1 in the shader while carrying a world's tint — a
          // coloured ball with no mosaic, which reads as a world that failed to load. `layerOf` is
          // `layerByPlane.get(...) ?? -1` at the one call site, so that state is reachable, and
          // `worlds-system.test.ts` now carries the fixture for it (DEC-775).
          tint: layer < 0 ? MOON_COLOUR : paletteTint(plane, reference),
        }
      })

    const capacity = this.entries.length
    const geometry = new IcosahedronGeometry(1, ICOSPHERE_DETAIL)
    this.layer = instanced(new Float32Array(capacity), 1)
    this.tint = instanced(new Float32Array(capacity * 3), 3)
    this.mix = instanced(new Float32Array(capacity), 1)
    geometry.setAttribute('iLayer', this.layer)
    geometry.setAttribute('iTint', this.tint)
    geometry.setAttribute('iTintMix', this.mix)

    const uniforms: { [uniform: string]: IUniform } = {
      uEquirect: { value: options.equirect },
      uLight: { value: new Vector3(0, 0, 1) },
    }
    const material = new ShaderMaterial({
      name: SHADER_NAME_WORLD_SYSTEM,
      uniforms,
      vertexShader: SYSTEM_VERTEX_SHADER,
      fragmentShader: SYSTEM_FRAGMENT_SHADER,
      // §1.2: "steps 2-4 are opaque and depth-tested". The cross-fade with the sheet is the sheet's
      // dissolve (§1.5, `cellShaders`), precisely so that neither pass has to leave this queue.
      transparent: false,
      depthWrite: true,
      depthTest: true,
    })

    this.mesh = new InstancedMesh(geometry, material, Math.max(capacity, 1))
    this.mesh.name = 'worlds-system'
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    // Every instance sits at its own `home`, spread over the multiverse; three's bound would be
    // computed from the unit icosphere and cull the whole draw the moment the origin left the
    // frustum. The cell sheet has the same problem and solves it the same way (`cellSheet.ts`).
    this.mesh.frustumCulled = false
  }

  /** How many instances the last {@link update} left in the draw. §1.2's step-2 count. */
  get drawnCount(): number {
    return this.drawn
  }

  /** The planes this pass would draw at the given crossover state, in roster order. For the tests. */
  get planes(): readonly PlaneRecord[] {
    return this.entries.map((entry) => entry.plane)
  }

  /**
   * Rewrite the instance buffers for this frame.
   *
   * @param drawsSystem §1.5's crossover for a plane that *has* a sheet. A plane with no sheet — an
   *   empty one — never reaches this: a moon is below the band by construction and asking a
   *   predicate about it invites the caller to answer from a surface that does not exist.
   */
  update(frame: WorldFrame, spinAngleOf: SpinAngleSource, drawsSystem: DrawsSystem): void {
    const { camera, viewport, fovRadians } = frame
    const layers = this.layer.array as Float32Array
    const tints = this.tint.array as Float32Array
    const mixes = this.mix.array as Float32Array

    let at = 0
    for (const entry of this.entries) {
      if (entry.layer >= 0 && !drawsSystem(entry.plane)) continue

      // Where the plane is this frame, not `plane.home` (DEC-804). The sheet and this instance
      // cross-fade into each other across §1.5's band, so a step-2 instance left at the t=0 home
      // while the step-4 sheet tracks the multiverse draws both representations of one world at
      // two places at once — and inside the band both are visible.
      frame.centreOf(entry.plane, centre)
      planeOrientation(entry.plane, spinAngleOf, orientation)
      scale.setScalar(entry.radius)
      this.mesh.setMatrixAt(at, matrix.compose(centre, orientation, scale))

      layers[at] = entry.layer
      tints[at * 3] = entry.tint[0]
      tints[at * 3 + 1] = entry.tint[1]
      tints[at * 3 + 2] = entry.tint[2]
      // §1.5 owns this factor; §1.8 owns `entry.tint`, the colour it mixes toward. A moon has no
      // equirect sample to mix *from*, so it takes the tint whole and the mix is 1.
      mixes[at] =
        entry.layer < 0
          ? 1
          : tintMix(
              worldRadiusPx(
                entry.radius,
                camera.position.distanceTo(centre),
                viewport.height,
                fovRadians,
              ),
            )

      at += 1
    }

    this.drawn = at
    this.mesh.count = at
    if (at === 0) return
    this.mesh.instanceMatrix.needsUpdate = true
    this.layer.needsUpdate = true
    this.tint.needsUpdate = true
    this.mix.needsUpdate = true
    // Cast to the uniform's real shape: `IUniform.value` is `any`, so an untyped read would let
    // `.copy` be called on whatever the object happened to hold. Same spelling as `WorldSurface`'s
    // own `uLight` write, for the same reason.
    const uniforms = (this.mesh.material as ShaderMaterial).uniforms as unknown as {
      uLight: { value: Vector3 }
    }
    uniforms.uLight.value.copy(frame.lightDirection)
  }

  // No `setEquirect`. It existed and had no caller anywhere in `src/` or `test/` (DEC-773's note):
  // `attachWorlds.setData` tears the whole pass down and builds a new one against the new array,
  // because the entry table is derived from the roster and a roster change invalidates it. A setter
  // that can only ever be called with the array the constructor already took is a second way to
  // establish one fact, and the day someone reaches for it they will not tear the entries down.

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
    this.mesh.dispose()
  }
}

function instanced(array: Float32Array, itemSize: number): InstancedBufferAttribute {
  const attribute = new InstancedBufferAttribute(array, itemSize)
  attribute.setUsage(DynamicDrawUsage)
  return attribute
}

/**
 * The equirect lookup, on the CPU — the twin of `SYSTEM_FRAGMENT_SHADER`'s three lines.
 *
 * Exported for the tests rather than for the render path, and that is the point: the mapping from a
 * direction to a texel is the one place §1.5's east-west mirror can hide, and a GLSL-only
 * implementation can only be checked by capturing a frame. `worlds-system.test.ts` runs this against
 * `bakeEquirectLayer`'s own inverse over the roster, which is a statement about the shipped bake and
 * not about a model of it.
 *
 * @returns `[u, v]` in `[0, 1]`, `v = 0` at the north pole
 */
export function equirectUv(nx: number, ny: number, nz: number): [number, number] {
  const lon = Math.atan2(nx, nz)
  const theta = Math.acos(ny < -1 ? -1 : ny > 1 ? 1 : ny)
  return [(lon + Math.PI) / (2 * Math.PI), theta / Math.PI]
}
