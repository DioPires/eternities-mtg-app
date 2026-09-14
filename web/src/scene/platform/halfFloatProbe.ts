/**
 * Does this driver rasterise a `HALF_FLOAT` vertex attribute where the numbers say it should?
 *
 * PRD risk 6 named "a GPU or driver that mishandles half-float attributes" and shipped a *manual*
 * mitigation for it: `?positions=float32`, a query parameter (`../starfield/starGeometry`). Review
 * §3.7 lists that under the "All" row — "float16 is a manual switch" — because a mitigation nobody
 * can reach is not a mitigation. The user on the broken driver sees a field of stars in the wrong
 * places and has no reason to suspect a URL parameter exists.
 *
 * So the app asks the GPU instead. Four points are uploaded as IEEE binary16 bit patterns, drawn
 * into a 16x16 target, and read back: if they land on the four texels the arithmetic predicts, the
 * driver handles the format and the field's positions stay 16-bit. If they do not, the position
 * buffer is built as float32 and the app pays two bytes a star rather than drawing a wrong picture.
 *
 * **It tests the attribute path, not the format's existence.** `HALF_FLOAT` is core in WebGL2, so
 * `getExtension` has nothing to say about it and a capability *query* would answer yes on the very
 * driver this exists to catch. What breaks in practice is the conversion in the vertex fetch — the
 * D3D11 path that has to emulate the format, the ANGLE translation that repacks the buffer — and
 * only drawing with it will say.
 *
 * **Why four points and not one.** A single point cannot distinguish "the format works" from "the
 * driver decoded every component as zero and the point landed at the origin, which is where the
 * one point was". Four points at four signed corners fail differently from each other under sign
 * errors, byte-swaps and truncation to zero, and the centre texel is asserted *empty* so a driver
 * that fills the target cannot pass by painting it.
 *
 * **Cost: 68 ms on an M5 Pro through ANGLE Metal, not the ~1 ms review §3.5 estimates.** One
 * program, one buffer, one 16x16 target and a `readPixels` of 1 KiB — and that last one is a
 * synchronous full-pipeline flush on a context that has never drawn, which is where essentially all
 * of it goes. The size of the target is irrelevant to it. There is no cheaper way to ask: the
 * question is "does the driver rasterise this format correctly", and only a draw and a readback can
 * answer it.
 *
 * So the cost is *placed* rather than optimised away. `useSceneData` fires the probe one frame into
 * the load, while `manifest.json` and `planes.json` are in flight and the main thread is idle, and
 * `bootPositionMode` caches the answer for the call that actually needs it. Asked at the natural
 * call site — inside `resolvePositionMode`, as the geometry is built — the same 68 ms would sit
 * squarely between `planes.json` landing and the first star being drawable.
 */

/**
 * IEEE binary16 bit patterns for the three values the probe draws with.
 *
 * Written as constants rather than run through an encoder because the encoder would be the second
 * implementation of the thing under test: if a `numberToFloat16` had the same sign or exponent bug
 * the probe is looking for, probe and encoder would agree and the check would pass. These are the
 * patterns from the standard — sign bit, five exponent bits biased by 15, ten mantissa bits — and
 * `test/platform.test.ts` checks them against `float16ToNumber`, which is the *decoder* the data
 * path already trusts.
 */
const HALF_ZERO = 0x0000
/** 0.5 = +1.0 x 2^-1: exponent 14 (biased), zero mantissa. */
const HALF_POS_HALF = 0x3800
/** -0.5: the same with the sign bit set. */
const HALF_NEG_HALF = 0xb800

/** The probe's render target, in texels. Small enough to read back for nothing. */
const PROBE_SIZE = 16

/**
 * How wide the probe draws its points, in pixels.
 *
 * **Three, not one, and the first draft's one-pixel points are why.** A clip-space +-0.5 in a
 * 16-texel viewport lands at window coordinate 4.0 or 12.0 — a pixel *corner*, not a centre — so a
 * one-pixel square straddles four pixels with every centre exactly on its boundary, and which of
 * them the rasteriser fills is a tie-break the GL spec does not pin down. Measured: this probe
 * reported **failure on a perfectly healthy M5 Pro through ANGLE Metal**, which would have silently
 * moved every user on every platform onto the float32 path — the exact opposite of what it is for.
 *
 * Three pixels makes the covered block unambiguous: a 3x3 square centred on a corner covers the
 * texel on each side of that corner outright, whatever the tie-break. The probe reads a texel that
 * is *solidly interior* to the block rather than one on its edge, so no rasterisation convention
 * can change the answer.
 *
 * The alternative — moving the points to pixel centres at +-0.4375 — also works and was rejected:
 * it makes the bit patterns less obviously readable as "plus and minus a half", and it would still
 * be one pixel of margin against a driver that rounds the other way.
 */
const PROBE_POINT_PX = 3

/**
 * Where a clip-space +-0.5 lands in a {@link PROBE_SIZE} viewport, as a texel index.
 *
 * `(0.5 * 0.5 + 0.5) * 16 = 12` and its mirror at 4 — both pixel corners, which is why
 * {@link PROBE_POINT_PX} exists. The probe samples one texel in from each, so it is reading the
 * interior of the covered block: 4 and 11.
 */
const NEAR = Math.floor((-0.5 * 0.5 + 0.5) * PROBE_SIZE)
const FAR = Math.floor((0.5 * 0.5 + 0.5) * PROBE_SIZE) - 1
/**
 * A texel no point covers, asserted empty so a target full of ones cannot pass.
 *
 * The nearest covered texel is `NEAR + 1` at most and `FAR - 1` at least, so the centre of a
 * 16-texel target is clear of both blocks by several pixels.
 */
const EMPTY = PROBE_SIZE / 2

const VERTEX_SOURCE = `#version 300 es
in vec3 aProbePosition;
uniform float uPointSize;
void main() {
  gl_Position = vec4(aProbePosition, 1.0);
  gl_PointSize = uPointSize;
}
`

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
out vec4 fragColour;
void main() {
  fragColour = vec4(1.0);
}
`

export interface HalfFloatProbeResult {
  /** Whether the four points landed where the arithmetic says they should. */
  readonly ok: boolean
  /** How long the probe took, in milliseconds, for the bench JSON. */
  readonly durationMs: number
  /**
   * Why the probe answered as it did, in one short phrase.
   *
   * A failed probe silently costs every user two bytes a star, so it has to be able to say whether
   * it found a broken driver or merely failed to set itself up — those are very different
   * conclusions and only one of them is about the GPU.
   */
  readonly detail: string
}

/**
 * Draw four half-float points and read them back. Never throws: a probe that cannot run answers
 * `ok: false`, which selects the float32 path, which is correct everywhere.
 */
export function probeHalfFloatAttributes(gl: WebGL2RenderingContext): HalfFloatProbeResult {
  const started = performance.now()
  const finish = (ok: boolean, detail: string): HalfFloatProbeResult => ({
    ok,
    durationMs: performance.now() - started,
    detail,
  })

  let vertex: WebGLShader | null = null
  let fragment: WebGLShader | null = null
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let vao: WebGLVertexArrayObject | null = null
  let texture: WebGLTexture | null = null
  let framebuffer: WebGLFramebuffer | null = null

  try {
    vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
    fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE)
    if (!vertex || !fragment) return finish(false, 'probe shaders did not compile')

    program = gl.createProgram()
    if (!program) return finish(false, 'no program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return finish(false, 'probe program did not link')
    }

    // Four points at the corners of a centred square: (-.5,-.5), (.5,-.5), (-.5,.5), (.5,.5), z 0.
    // Three components, like the attribute this is standing in for.
    const positions = new Uint16Array([
      HALF_NEG_HALF, HALF_NEG_HALF, HALF_ZERO,
      HALF_POS_HALF, HALF_NEG_HALF, HALF_ZERO,
      HALF_NEG_HALF, HALF_POS_HALF, HALF_ZERO,
      HALF_POS_HALF, HALF_POS_HALF, HALF_ZERO,
    ])

    // A vertex array of its own, so nothing this binds survives into three's cached state. The
    // `resetState` in the caller covers the rest.
    vao = gl.createVertexArray()
    gl.bindVertexArray(vao)

    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

    const location = gl.getAttribLocation(program, 'aProbePosition')
    if (location < 0) return finish(false, 'probe attribute was optimised away')
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 3, gl.HALF_FLOAT, false, 0, 0)

    texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // RGBA8 deliberately: the probe is about the *attribute* format, and asking for a float colour
    // target here would make it fail on a GPU with no `EXT_color_buffer_float` for the wrong reason.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      PROBE_SIZE,
      PROBE_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      return finish(false, 'probe framebuffer incomplete')
    }

    gl.viewport(0, 0, PROBE_SIZE, PROBE_SIZE)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    // A uniform rather than a literal in the shader, so `ALIASED_POINT_SIZE_RANGE` could clamp it
    // without the source and the readback disagreeing about where the block is. Every platform in
    // scope reports a maximum of at least 64, so three is never clamped in practice.
    gl.uniform1f(gl.getUniformLocation(program, 'uPointSize'), PROBE_POINT_PX)
    gl.drawArrays(gl.POINTS, 0, 4)

    const pixels = new Uint8Array(PROBE_SIZE * PROBE_SIZE * 4)
    gl.readPixels(0, 0, PROBE_SIZE, PROBE_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    const lit = (x: number, y: number): boolean => pixels[(y * PROBE_SIZE + x) * 4]! > 127
    const corners: ReadonlyArray<readonly [number, number]> = [
      [NEAR, NEAR],
      [FAR, NEAR],
      [NEAR, FAR],
      [FAR, FAR],
    ]
    const missing = corners.filter(([x, y]) => !lit(x, y))
    if (missing.length > 0) {
      return finish(false, `${missing.length} of 4 half-float points missed their texel`)
    }
    if (lit(EMPTY, EMPTY)) return finish(false, 'the probe target came back filled')
    return finish(true, 'four half-float points landed on their texels')
  } catch (error) {
    return finish(false, `probe threw: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    // Order matters only in that the framebuffer must not be current when it is deleted.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
    if (framebuffer) gl.deleteFramebuffer(framebuffer)
    if (texture) gl.deleteTexture(texture)
    if (buffer) gl.deleteBuffer(buffer)
    if (vao) gl.deleteVertexArray(vao)
    if (program) gl.deleteProgram(program)
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
  }
}

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader | null {
  const shader = gl.createShader(kind)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/** The bit patterns and texel indices, for `test/platform.test.ts`. Not used by the probe itself. */
export const HALF_FLOAT_PROBE_INTERNALS = {
  HALF_ZERO,
  HALF_POS_HALF,
  HALF_NEG_HALF,
  PROBE_SIZE,
  PROBE_POINT_PX,
  NEAR,
  FAR,
  EMPTY,
} as const
