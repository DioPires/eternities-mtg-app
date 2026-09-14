/**
 * The cell sheet's material (spec §1.4) — the one program a world's surface draws with.
 *
 * The GLSL is in `./cellShaders`; this file is the three.js binding and the render state. Both are
 * jsdom-constructible: nothing here touches a GL context, so the uniform surface and the state below
 * are testable without a GPU.
 */

import { type DataArrayTexture, type IUniform, ShaderMaterial, Vector3 } from 'three'

import { CELL_FRAGMENT_SHADER, CELL_VERTEX_SHADER } from './cellShaders'
import { SHADER_NAME_WORLD_CELL } from '../shaderNames'

/**
 * The uniforms a world's sheet binds. One object per world — `uRadius` differs on every one.
 *
 * The index signature is what three's `ShaderMaterial` requires of a uniforms object; the four named
 * entries are what this material actually has, and they are the reason to declare the type at all.
 */
export interface CellUniforms {
  readonly uRadius: { value: number }
  readonly uArt: { value: DataArrayTexture | null }
  readonly uLight: { value: Vector3 }
  readonly uAmbient: { value: Vector3 }
  /**
   * §1.5's crossover mix — 0 at the band's floor, 1 at its ceiling (DEC-750).
   *
   * `crossoverState` has returned this since R1 and nothing consumed it, so a world crossing the
   * band's floor popped its whole sheet on in one frame — the pop the band exists to stop. See the
   * fragment shader: it is a **dissolve**, not an opacity, precisely so this material keeps the
   * render state its header argues for.
   */
  readonly uSheetMix: { value: number }
  readonly [uniform: string]: IUniform
}

/**
 * Build the sheet's material.
 *
 * > **Normative — back-face culling stays on (§1.4, DEC-694).** `buildCellIndices` winds every
 * > sub-quad clockwise precisely so that the front-facing cells survive the cull, and both of that
 * > rule's failure modes lie: with the globe hidden the far hemisphere fills the silhouette and
 * > reads as a complete mosaic, and with the globe drawn it reads as a depth fight between two
 * > shells at 1.004x. Setting `side: DoubleSide` here would hide an inverted winding just as
 * > effectively as "tidying" the index order would cause one — it is the *pair* that has to stay
 * > honest, so the cull is part of the contract, not a default this file happens to inherit.
 *
 * @param art the pool texture, or `null` until §1.6 allocates it — a swatch-only world is legal
 */
export function createCellMaterial(radius: number, art: DataArrayTexture | null): ShaderMaterial {
  const uniforms: CellUniforms = {
    uRadius: { value: radius },
    uArt: { value: art },
    uLight: { value: new Vector3(0, 0, 1) },
    uAmbient: { value: new Vector3(0, 0, 0) },
    // 1, not 0. A sheet that has never been ticked is fully drawn rather than fully dissolved: the
    // opposite default makes a world invisible on the first frame after composition and on any frame
    // a caller forgets to update, which reads as "the sheet did not build" — a failure with a
    // completely different diagnosis.
    uSheetMix: { value: 1 },
  }

  return new ShaderMaterial({
    // `shaderNames.ts` has the why: three writes this into the shader header, and a material
    // without one links a program no profile can attribute.
    name: SHADER_NAME_WORLD_CELL,
    uniforms,
    vertexShader: CELL_VERTEX_SHADER,
    fragmentShader: CELL_FRAGMENT_SHADER,
    // Cells are opaque masonry, not glows: they sort by depth and they write it. This is the
    // opposite of the star field, and the sheet is drawn in a different pass for that reason (§1.2).
    transparent: false,
    depthWrite: true,
    depthTest: true,
  })
}
