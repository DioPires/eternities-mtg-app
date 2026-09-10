/**
 * `material.name` for every material the app builds, so a GPU program can be traced to the code
 * that made it.
 *
 * three.js writes the name straight into the shader header: `getParameters` passes
 * `shaderName: material.name` (`three.module.js:20782`) and the prefix builder emits
 * `#define SHADER_NAME <name>` (`:19908`, `:19923`, `:19942`, `:20140`). There is **no fallback to
 * the built-in shader id** — a material with no name emits that define with an empty value, whether
 * it is a raw `ShaderMaterial` or a stock `PointsMaterial`. Every profiler downstream then shows an
 * anonymous program: `chrome://gpu`, a vendor capture, the Windows measurement kit in
 * `bench/windows/`.
 *
 * That is the problem this file exists to solve (DEC-700). The kit's first tour linked 14 programs
 * of which 9 were anonymous, and one of them cost 91 ms in a synchronous link-status read on Brave.
 * The point of measuring per-program compile cost on ANGLE D3D11/FXC is to find *which* shader is
 * expensive; an unattributable outlier is a number nobody can act on. The programs that did come
 * back named were `postprocessing`'s, which sets the same field.
 *
 * **Names must be a single identifier-shaped token.** Two independent reasons, both silent when
 * broken:
 *
 *   - `#define SHADER_NAME Star field` makes readers disagree. The kit's `nameFrom` regex captures
 *     `(\S+)` and would report `Star`; a reader taking the rest of the line would report
 *     `Star field`. One program, two names, depending on who asked.
 *   - The value is preprocessor replacement text. Keeping it to one identifier keeps it
 *     uninteresting to every GLSL preprocessor, including FXC's — the platform these names are
 *     being added to investigate.
 *
 * `SHADER_NAMES` and `test/shader-names.test.ts` enforce both, plus uniqueness: a name used twice
 * would merge two source sites into one row and read as the program cache doing its job.
 *
 * **Naming cannot change what gets compiled.** `getProgramCacheKey` (`:20978`) keys on the interned
 * vertex and fragment source ids — from `WebGLShaderCache`, which interns the *material's* source,
 * not the prefixed source — the material's `defines`, the parameter and boolean lists for non-raw
 * materials, and `customProgramCacheKey`. `shaderName` is in none of them. So these names cannot
 * split one program into two or merge two into one, and the review's A4 program count is
 * unaffected; measured before and after, 14 `linkProgram` calls either way.
 *
 * Two materials sharing source *and* defines still share one program, which carries whichever name
 * linked first. The uniqueness check does not catch such a pair, so name both the same thing
 * deliberately — `SHADER_NAME_CARD_FACE` is the one case, used by both card faces.
 */

/** The star field's additive glow points — `starfield/starFieldObjects.ts`. */
export const SHADER_NAME_STAR_FIELD = 'StarField'

/** The same star geometry drawn to the id buffer under `ID_PASS` — its own program. */
export const SHADER_NAME_STAR_FIELD_PICK = 'StarFieldPick'

/** The per-plane nebula/glow quads — `starfield/starFieldObjects.ts`. */
export const SHADER_NAME_PLANE_GLOW = 'PlaneGlow'

/** Instanced card thumbnails sampling the atlas — `cards/thumbnailTier.ts`. */
export const SHADER_NAME_THUMBNAIL_TIER = 'ThumbnailTier'

/** The thumbnail quads drawn to the id buffer under `ID_PASS` — its own program. */
export const SHADER_NAME_THUMBNAIL_TIER_PICK = 'ThumbnailTierPick'

/** The focused card's two faces — `cards/focusedCard.ts`; one program, two materials. */
export const SHADER_NAME_CARD_FACE = 'FocusedCardFace'

/**
 * The focused card's extruded edge — a built-in `MeshBasicMaterial`.
 *
 * three.js takes `shaderName` from `material.name` for built-ins exactly as it does for a raw
 * `ShaderMaterial`, so a stock `MeshBasicMaterial` is anonymous too. Naming these is why the
 * program list has no `(unnamed)` rows left rather than merely fewer.
 */
export const SHADER_NAME_CARD_EDGE = 'FocusedCardEdge'

/** The focused card's orbiting printing planets — `cards/focusedCard.ts`. */
export const SHADER_NAME_CARD_PLANET = 'FocusedCardPlanet'

/** The planets drawn to the id buffer through the shared id shaders — `cards/focusedCard.ts`. */
export const SHADER_NAME_CARD_PLANET_PICK = 'FocusedCardPlanetPick'

/** The atlas' blit quad — a built-in `MeshBasicMaterial`, `cards/atlas.ts`. */
export const SHADER_NAME_ATLAS_BLIT = 'AtlasBlit'

/** The three background star shells — a built-in `PointsMaterial`, `background.ts`. */
export const SHADER_NAME_BACKGROUND_LAYER = 'BackgroundLayer'

/**
 * Every name above, for the test that enforces the rules in this file's header.
 *
 * Deliberately a hand-written list rather than a re-export of the module namespace: the point is to
 * fail when a name is added that breaks a rule, and a namespace object would only ever contain
 * whatever was written.
 */
export const SHADER_NAMES = [
  SHADER_NAME_STAR_FIELD,
  SHADER_NAME_STAR_FIELD_PICK,
  SHADER_NAME_PLANE_GLOW,
  SHADER_NAME_THUMBNAIL_TIER,
  SHADER_NAME_THUMBNAIL_TIER_PICK,
  SHADER_NAME_CARD_FACE,
  SHADER_NAME_CARD_EDGE,
  SHADER_NAME_CARD_PLANET,
  SHADER_NAME_CARD_PLANET_PICK,
  SHADER_NAME_ATLAS_BLIT,
  SHADER_NAME_BACKGROUND_LAYER,
] as const
