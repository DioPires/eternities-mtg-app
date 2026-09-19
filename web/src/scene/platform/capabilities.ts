/**
 * What this GPU can actually do, asked **once per renderer, at boot** (review §3.5, §3.7).
 *
 * Before this module the app asked the driver almost nothing and assumed the rest. Review §3.7's
 * "All" row lists the three assumptions by name: "RGBA16F composer buffers assume
 * `EXT_color_buffer_float` with no detection; `ALIASED_POINT_SIZE_RANGE` never queried; float16 is
 * a manual switch." Each of those is a picture that is silently wrong — a black frame, a sprite the
 * driver clamped to a size the shader never heard about, a field of stars in the wrong places — on
 * hardware nobody on the team owns. DEC-739 replaces all three with a question.
 *
 * **Never branch on `RENDERER` or `VENDOR` strings.** Review §3.7: Brave's default shields hand out
 * generic vendor and renderer strings and randomise the extension *list*, so a string match is
 * wrong on a browser that is in scope, and it is a guess about capability on every other. Every
 * field below comes from a `getParameter`, a `getExtension`, or — where neither can answer honestly
 * — from drawing something and reading it back (`./halfFloatProbe`). `getExtension` is still
 * truthful under Brave's shields; only `getSupportedExtensions` is hashed.
 *
 * **Queried once.** Everything here is a property of the GL context, and two of the questions cost
 * real work: the half-float probe compiles a program and reads a target back, and it used to be
 * asked twice because `detectPostCapabilities` had two callers (`StarScene` and `PostEffects`),
 * each memoising for itself. {@link detectPlatformCapabilities} caches per renderer, so the boot
 * cost is paid once however many callers ask.
 */

import { HalfFloatType, UnsignedByteType, type TextureDataType, type WebGLRenderer } from 'three'

import type { PositionMode } from './positionMode'

import { probeHalfFloatAttributes, type HalfFloatProbeResult } from './halfFloatProbe'

/**
 * The subset the post chain needs, kept as its own type so `post/postChain` depends on four fields
 * rather than on the whole platform (DEC-703 built it that way and the dependency is still right).
 */
export interface PostCapabilities {
  /** True when render targets may be RGBA16F. */
  readonly floatTargets: boolean
  /** The `type` every target in the chain is allocated with. */
  readonly targetType: TextureDataType
  /**
   * The best quality tier the ladder may sit at on this GPU, as an index into `QUALITY_TIERS`.
   *
   * Index, not quality: `0` is the top of the ladder and no cap, which is the answer whenever float
   * targets are available. Without them the bloom source is quantised to eight bits, and the honest
   * thing is to sit two rungs down rather than to claim `full` for a picture that is not.
   *
   * The monitor's own name for this bound is `minTier` — the lowest *index* it may climb to — and
   * `qualityOptionsFor` in `../quality/adaptiveQuality` is where the two meet. A `?quality=` pin
   * still wins over it: a pin is PRD 9.1.4's explicit override and has to be able to name any tier.
   */
  readonly minTierIndex: number
}

export interface PlatformCapabilities extends PostCapabilities {
  /**
   * Whether the context is WebGL2 at all.
   *
   * three will hand back a WebGL1 context on nothing in scope, but the star shader is GLSL ES 3.0
   * (`texelFetch`, `gl_VertexID`, `uint`) and would not compile on one. `App` already routes a
   * context-creation failure to `ui/WebGLFallback`; this is the narrower case where a context
   * exists and cannot run the scene, and it is reported rather than acted on because there is
   * nothing to fall back *to* — the field has no WebGL1 spelling.
   */
  readonly webgl2: boolean
  /**
   * `MAX_TEXTURE_SIZE`, and whether it clears the 4096 the thumbnail atlas is built at.
   *
   * PRD 8.5.8 fixes the atlas at 4096x4096. The floor is universal on desktop — the WebGL2 spec's
   * own minimum is 2048, and every driver in scope reports at least 8192 — but a software
   * rasteriser or a locked-down driver can sit at the spec floor, and an atlas allocation that
   * fails there takes every thumbnail with it. Reported here so `atlas.ts` and the bench can say
   * which of the two pictures they measured rather than discovering it as a GL error.
   */
  readonly maxTextureSize: number
  readonly atlasAffordable: boolean
  /**
   * `ALIASED_POINT_SIZE_RANGE`, as `[min, max]` device pixels.
   *
   * Review §3.7 measured three different answers on three platforms — ANGLE D3D11 reports 1024,
   * ANGLE Metal on this M5 Pro reports 511, and Firefox on Apple's native GL reports **64** — and
   * `gl_PointSize` is silently clamped to it. The app's own ceiling is `STAR_MAX_PX` x dpr = 22 x
   * dpr, so at dpr 2 it asks for 44 and every platform in scope can give it; at dpr 4 on a Firefox
   * Mac it would ask for 88 against a limit of 64 and the largest mythics would all be drawn the
   * same size with nothing anywhere saying so.
   *
   * So the field clamps `uMaxPixels` and the pick floor to this rather than trusting the constant,
   * and the number goes into the bench JSON — which is the point of measuring it at all, because
   * the only machines where it can bind are ones the team does not own.
   */
  readonly pointSizeRange: readonly [number, number]
  /**
   * `MAX_ARRAY_TEXTURE_LAYERS`, and whether it clears PRD 5.6.8's 72 printings.
   *
   * Not consumed yet: the `TEXTURE_2D_ARRAY` of printing art that would need it belongs to the
   * worlds implementation (W4.4), and concept B replaces the 72 spheres with a flat ring in any
   * case. It is queried now because this is the module that asks the driver questions and because
   * W4.4 should find the answer already in the bench JSON rather than discover the limit in a
   * failed allocation. The WebGL2 minimum is 256, so this clears on everything in scope.
   */
  readonly maxArrayTextureLayers: number
  readonly arrayLayersAffordable: boolean
  /**
   * `KHR_parallel_shader_compile`, which lets `./programWarmup` link the whole program set at boot
   * without blocking. Absent, the warm-up still runs and still moves the stalls off the first
   * draw — it just does not overlap them. See `./programWarmup`.
   */
  readonly parallelShaderCompile: boolean
  /**
   * Which position format the star buffer is built in, decided by drawing rather than by a URL
   * (`./halfFloatProbe`). `?positions=` still overrides it; see `resolvePositionMode`.
   */
  readonly positionMode: PositionMode
  readonly halfFloatProbe: HalfFloatProbeResult
}

/** Without `EXT_color_buffer_float` the ladder cannot claim its top rungs. See {@link PostCapabilities}. */
const CAPPED_TIER_INDEX = 2

/** PRD 8.5.8's atlas edge. */
const REQUIRED_TEXTURE_SIZE = 4096

/** PRD 5.6.8's 72 printings, which is what a printing texture array would need a layer each for. */
const REQUIRED_ARRAY_LAYERS = 72

/**
 * One answer per renderer, for the life of the renderer.
 *
 * A `WeakMap` rather than a field on the renderer: the key is someone else's object and this module
 * has no business writing to it. Entries die with the renderer.
 */
const cache = new WeakMap<WebGLRenderer, PlatformCapabilities>()

/**
 * The half-float probe's answer, once per **page** rather than once per renderer.
 *
 * The probe is the one question here whose answer is needed before there is a renderer to ask.
 * `useSceneData` builds the `StarGeometry` the moment `planes.json` lands, and that is where the
 * position format is chosen; the renderer lives inside `<Canvas>` and the loader has no reference
 * to it. So {@link bootPositionMode} runs the probe on a throwaway 16x16 context, and
 * {@link detectPlatformCapabilities} reuses whatever answer is already in hand rather than drawing
 * four more points.
 *
 * Two contexts, one driver: the probe measures how ANGLE or the native GL handles a `HALF_FLOAT`
 * vertex fetch, which is a property of the translation layer and not of the context that asked. A
 * page where the two disagreed would be a page where the format is unreliable, which is the case
 * this selects float32 for in any event.
 */
let probeOnce: HalfFloatProbeResult | null = null

/**
 * The position format the star buffer should be built in, decided at boot by drawing.
 *
 * Costs one 16x16 WebGL2 context and about a millisecond, the first time it is called; every call
 * after that returns the cached answer. Safe to call before any renderer exists — which is the
 * whole reason it is separate from {@link detectPlatformCapabilities}.
 */
export function bootPositionMode(): PositionMode {
  return runHalfFloatProbe().ok ? 'float16' : 'float32'
}

function runHalfFloatProbe(): HalfFloatProbeResult {
  if (probeOnce) return probeOnce
  probeOnce = probeOnThrowawayContext()
  return probeOnce
}

function probeOnThrowawayContext(): HalfFloatProbeResult {
  try {
    if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') {
      return { ok: false, durationMs: 0, detail: 'no document to probe on' }
    }
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    // `failIfMajorPerformanceCaveat` is deliberately *not* set: a software rasteriser is a machine
    // the app still has to draw something on, and its answer about half-float attributes is the
    // answer that machine needs.
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false })
    if (!gl) return { ok: false, durationMs: 0, detail: 'no WebGL2 context for the probe' }
    const result = probeHalfFloatAttributes(gl)
    // Hand the context back rather than leaving it to the GC: browsers cap live WebGL contexts
    // (Chrome at 16) and losing one of those to a probe is a real cost on a page that also wants
    // a renderer.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return result
  } catch (error) {
    return {
      ok: false,
      durationMs: 0,
      detail: `probe setup threw: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** Forget the cached probe, for tests that drive it both ways. Nothing in the app calls it. */
export function resetHalfFloatProbeForTests(): void {
  probeOnce = null
}

/**
 * Ask the GPU everything, once. Subsequent calls with the same renderer return the same object.
 *
 * Nothing here throws. A context that has been lost answers `false` to every extension and `0` to
 * every parameter, which selects the most conservative path everywhere — which is the answer we
 * want in that case anyway.
 */
export function detectPlatformCapabilities(renderer: WebGLRenderer): PlatformCapabilities {
  const cached = cache.get(renderer)
  if (cached) return cached
  const detected = detect(renderer)
  cache.set(renderer, detected)
  return detected
}

function detect(renderer: WebGLRenderer): PlatformCapabilities {
  // `WebGLRenderer.extensions.has` caches, and returns false rather than throwing on a context
  // that has been lost.
  const floatTargets = renderer.extensions.has('EXT_color_buffer_float')
  const parallelShaderCompile = renderer.extensions.has('KHR_parallel_shader_compile')

  const gl = renderer.getContext()
  const webgl2 = isWebGL2(gl)

  const maxTextureSize = numberParameter(gl, gl.MAX_TEXTURE_SIZE, 0)
  const pointSizeRange = pointRange(gl)
  const maxArrayTextureLayers = webgl2
    ? numberParameter(gl, (gl as WebGL2RenderingContext).MAX_ARRAY_TEXTURE_LAYERS, 0)
    : 0

  // Whatever the boot probe already answered, or a fresh run if nothing has asked yet. Deliberately
  // *not* run on this renderer's own context: the probe draws, and drawing on the scene's context
  // during a capability query would leave three's cached GL state describing a program and a
  // framebuffer that are no longer bound.
  const halfFloatProbe = webgl2
    ? runHalfFloatProbe()
    : { ok: false, durationMs: 0, detail: 'not a WebGL2 context' }

  return {
    webgl2,
    floatTargets,
    targetType: floatTargets ? HalfFloatType : UnsignedByteType,
    minTierIndex: floatTargets ? 0 : CAPPED_TIER_INDEX,
    maxTextureSize,
    atlasAffordable: maxTextureSize >= REQUIRED_TEXTURE_SIZE,
    pointSizeRange,
    maxArrayTextureLayers,
    arrayLayersAffordable: maxArrayTextureLayers >= REQUIRED_ARRAY_LAYERS,
    parallelShaderCompile,
    positionMode: halfFloatProbe.ok ? 'float16' : 'float32',
    halfFloatProbe,
  }
}

function isWebGL2(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  // `instanceof` rather than a version-string parse, and guarded because `WebGL2RenderingContext`
  // is undefined in jsdom and in a browser with WebGL2 disabled.
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
}

function numberParameter(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  name: number,
  fallback: number,
): number {
  try {
    const value: unknown = gl.getParameter(name)
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

/**
 * `ALIASED_POINT_SIZE_RANGE` as a plain pair, defaulting to `[1, 1]` when the driver will not say.
 *
 * `[1, 1]` and not `[1, Infinity]`: an unanswerable question about a *limit* has to resolve to the
 * limit being tight, or the clamp this feeds would be a no-op on exactly the contexts that could
 * not answer. One pixel is the GL minimum every conformant implementation must support, so it is
 * the only safe floor — and `PICK_MIN_PX` then clamps down to it rather than asking for seven and
 * getting whatever the driver felt like.
 */
function pointRange(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): readonly [number, number] {
  try {
    const value: unknown = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)
    if (value instanceof Float32Array && value.length >= 2) {
      const min = value[0]!
      const max = value[1]!
      if (Number.isFinite(min) && Number.isFinite(max) && max >= min && max >= 1) {
        return [Math.max(1, min), max]
      }
    }
  } catch {
    // fall through
  }
  return [1, 1]
}

/**
 * The platform's answers, flattened for `bench/` and the `?probe=1` seam.
 *
 * Review §3.5 asks for `ALIASED_POINT_SIZE_RANGE` specifically to be "logged into bench JSON", and
 * the reason generalises: every field here describes a machine the team cannot see, so a bench run
 * from a Windows laptop is only readable if it says which GPU answers it was measured under. Plain
 * JSON values, no nesting, so a run's row can be read in a spreadsheet.
 */
export function capabilitiesForBench(capabilities: PlatformCapabilities): Record<string, unknown> {
  return {
    webgl2: capabilities.webgl2,
    floatTargets: capabilities.floatTargets,
    minTierIndex: capabilities.minTierIndex,
    maxTextureSize: capabilities.maxTextureSize,
    atlasAffordable: capabilities.atlasAffordable,
    pointSizeMin: capabilities.pointSizeRange[0],
    pointSizeMax: capabilities.pointSizeRange[1],
    maxArrayTextureLayers: capabilities.maxArrayTextureLayers,
    arrayLayersAffordable: capabilities.arrayLayersAffordable,
    parallelShaderCompile: capabilities.parallelShaderCompile,
    positionMode: capabilities.positionMode,
    halfFloatProbeOk: capabilities.halfFloatProbe.ok,
    halfFloatProbeMs: Number(capabilities.halfFloatProbe.durationMs.toFixed(3)),
    halfFloatProbeDetail: capabilities.halfFloatProbe.detail,
  }
}
