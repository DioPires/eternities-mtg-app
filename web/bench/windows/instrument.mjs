/**
 * The in-page half of the Windows measurement kit (review §9 items 2, 3 and 4).
 *
 * Everything here runs **inside the page**, wrapping WebGL entry points on the prototypes before
 * the app ever creates a context. That is a deliberate choice over the CDP-based counting the
 * review itself used for §2.2: prototype wrapping is engine-portable, so the same battery runs on
 * Chrome, Brave, Edge and Firefox, and the same source can be pasted into a devtools console on a
 * browser no driver can automate (see `console-probe.js`, which this file generates).
 *
 * `installGpuProbe` is exported as a *function* and injected by its source text, so it must be
 * entirely self-contained: no imports, no references to anything in this module's scope, no
 * optional chaining on the wrapped natives. It is stringified by `Function.prototype.toString`.
 *
 * What it publishes on `window.__eternitiesGpuProbe`:
 *
 *   - `snapshot()` — a plain object, so a driver reads it through `evaluate` and never has to
 *     compile a predicate in the page. PRD 7.6.1's CSP is `script-src 'self'` with no
 *     `unsafe-eval`, which is why `page.waitForFunction` is unusable against a real build
 *     (`scripts/visual-gate.mjs:528`) and why every read here crosses as data.
 *   - `pointSizeProbe()` — review §9's point-size probe, run on its own context.
 *   - `gpuFromExistingCanvas()` / `describeContext()` — the driver strings off a context that
 *     already exists. Only the console path needs these: pasted into devtools, the `getContext`
 *     wrap happens after the app's context is created, so nothing the wrapper sees ever arrives.
 *
 * **Bytes are estimates and labelled as such.** Allocation *counts* are exact — they are call
 * counts. The byte totals are computed from the arguments of each call against a table of
 * bytes-per-pixel, which cannot see driver padding, compression, or the sizes of the overloads that
 * pass a DOM source instead of explicit dimensions. Read the counts as measurement and the bytes as
 * arithmetic; §9's `< 1 MB/s` pass criterion is coarse enough that the distinction does not change
 * a verdict.
 */

/**
 * Install the probe. Idempotent: a second call is a no-op, so a preload script and a pasted console
 * snippet cannot double-wrap the same context and count every allocation twice.
 */
export function installGpuProbe() {
  if (window.__eternitiesGpuProbe) return

  // ---------------------------------------------------------------------------------------------
  // Bytes per pixel, by internal format / format+type. Only the formats three.js and the app
  // actually ask for; anything unknown contributes 4 and is counted in `unknownFormats` so a
  // silently-wrong total is visible rather than plausible.
  // ---------------------------------------------------------------------------------------------
  const BPP = {
    6407: 3, // RGB
    6408: 4, // RGBA
    6403: 1, // RED
    33319: 2, // RG
    32849: 3, // RGB8
    32856: 4, // RGBA8
    35905: 4, // SRGB8_ALPHA8
    34842: 8, // RGBA16F
    34836: 16, // RGBA32F
    34843: 6, // RGB16F
    34837: 12, // RGB32F
    33327: 4, // RG16F
    33325: 2, // R16F
    33326: 4, // R32F
    35898: 4, // R11F_G11F_B10F
    33189: 2, // DEPTH_COMPONENT16
    33190: 4, // DEPTH_COMPONENT24
    36012: 4, // DEPTH_COMPONENT32F
    34041: 4, // DEPTH24_STENCIL8
    36013: 8, // DEPTH32F_STENCIL8
  }
  // Pixel `type` widths, for the texImage2D overloads that carry format+type instead of a sized
  // internal format. Multiplied by the channel count of `format`.
  const TYPE_BYTES = { 5121: 1, 5123: 2, 5125: 4, 5126: 4, 5131: 2, 33635: 2, 32819: 2, 32820: 2 }
  const CHANNELS = { 6407: 3, 6408: 4, 6403: 1, 33319: 2, 6402: 1, 34041: 2 }

  const state = {
    createTexture: 0,
    deleteTexture: 0,
    texImage: 0,
    texStorage: 0,
    textureBytes: 0,
    createFramebuffer: 0,
    deleteFramebuffer: 0,
    createRenderbuffer: 0,
    deleteRenderbuffer: 0,
    renderbufferStorage: 0,
    renderbufferBytes: 0,
    bufferData: 0,
    bufferBytes: 0,
    unknownFormats: [],
    contexts: 0,
    /** Per-program records, keyed by an id we assign at `createProgram`. */
    programs: [],
    linkProgramCalls: 0,
    /** Time spent inside the synchronous link-status / info-log reads three.js does at first use. */
    programSyncMs: 0,
    parallelShaderCompile: null,
    firstDrawAtMs: null,
    firstFrameMs: null,
  }

  const note = (format) => {
    if (state.unknownFormats.indexOf(format) === -1 && state.unknownFormats.length < 16) {
      state.unknownFormats.push(format)
    }
  }

  function bytesFor(internalformat, width, height, depth) {
    let bpp = BPP[internalformat]
    if (bpp === undefined) {
      note(internalformat)
      bpp = 4
    }
    return bpp * (width || 0) * (height || 0) * (depth || 1)
  }

  function bytesForFormatType(format, type, width, height) {
    const channels = CHANNELS[format]
    const width_ = TYPE_BYTES[type]
    if (channels === undefined || width_ === undefined) {
      note(format)
      return 4 * (width || 0) * (height || 0)
    }
    return channels * width_ * (width || 0) * (height || 0)
  }

  /** `levels > 1` allocates the mip chain too; the tail of a full chain adds a third. */
  const withMips = (bytes, levels) => (levels > 1 ? Math.round(bytes * 1.3333) : bytes)

  // ---------------------------------------------------------------------------------------------
  // Shader programs (review §9 item 3, amendment A4).
  //
  // three.js caches programs by parameter hash (`three.module.js:21192`), so the interesting number
  // is per *program*, not per material: the review's tours measured 13 `linkProgram` calls, 15 on
  // Firefox. Three timings are kept for each, because on ANGLE D3D11 they are three different
  // things:
  //
  //   - `linkMs`   — the synchronous cost of `linkProgram` itself. On ANGLE this is usually cheap:
  //                  the D3D shader compile is deferred.
  //   - `syncMs`   — time inside `getProgramParameter(LINK_STATUS)` / `getProgramInfoLog`, which is
  //                  where the driver is forced to finish. This is the stall DEC-645 found three.js
  //                  triggering from `onFirstUse`, and on FXC it is the number that matters.
  //   - `firstDrawMs` — the first draw call issued with the program current. If a driver defers
  //                  further still, the cost lands here.
  //
  // `SHADER_NAME` is read out of the source because three.js emits `#define SHADER_NAME <name>`,
  // which turns 13 anonymous programs into a named list. For the app's raw `ShaderMaterial`s that
  // name is empty and the row reads `(unnamed)`; `sourceHash` is what makes those rows attributable
  // later — see `hashSource`.
  // ---------------------------------------------------------------------------------------------
  let nextProgramId = 1
  const programs = new WeakMap()
  const shaders = new WeakMap()

  /**
   * A stable content hash of one shader's source: FNV-1a, 32 bits, as hex.
   *
   * The point is attribution across machines. `id` is assignment order, and the order is *not*
   * deterministic — the same page linked 14 programs on one run and 18 on another, so id 7 in the
   * JSON the owner posts back is not id 7 here. `vertexChars`/`fragmentChars` collide freely. The
   * source text does not: it comes from the same bundle, so a hash computed on an Iris Xe matches
   * the hash of the same program computed here. That is what lets a naming scheme landed later be
   * applied *retroactively* to data already returned, instead of costing a second trip to laptops we
   * do not own. Collision resistance is irrelevant here — there are ~15 programs.
   */
  function hashSource(source) {
    let hash = 0x811c9dc5
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i)
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }

  function recordFor(program) {
    if (!program) return null
    let record = programs.get(program)
    if (!record) {
      record = {
        id: nextProgramId++,
        name: null,
        linkMs: null,
        syncMs: 0,
        firstDrawMs: null,
        vertexChars: 0,
        fragmentChars: 0,
        vertexHash: null,
        fragmentHash: null,
      }
      programs.set(program, record)
      state.programs.push(record)
    }
    return record
  }

  // Same-line separators only. three.js emits `#define SHADER_NAME <name>`, but for a raw
  // `ShaderMaterial` the name is empty — and a `\s+` there crosses the newline and captures the
  // first token of the next line, which is how a program comes to be called `uniform` or `#define`.
  const nameFrom = (source) => {
    const match = /#define[ \t]+SHADER_NAME[ \t]+(\S+)/.exec(source || '')
    return match ? match[1] : null
  }

  function wrap(proto, isGl2) {
    if (!proto || proto.__eternitiesWrapped) return
    proto.__eternitiesWrapped = true

    const original = {}
    const patch = (name, replacement) => {
      if (typeof proto[name] !== 'function') return
      original[name] = proto[name]
      proto[name] = replacement(original[name])
    }

    patch('createTexture', (base) => function (...args) {
      state.createTexture += 1
      return base.apply(this, args)
    })
    patch('deleteTexture', (base) => function (...args) {
      state.deleteTexture += 1
      return base.apply(this, args)
    })
    patch('createFramebuffer', (base) => function (...args) {
      state.createFramebuffer += 1
      return base.apply(this, args)
    })
    patch('deleteFramebuffer', (base) => function (...args) {
      state.deleteFramebuffer += 1
      return base.apply(this, args)
    })
    patch('createRenderbuffer', (base) => function (...args) {
      state.createRenderbuffer += 1
      return base.apply(this, args)
    })
    patch('deleteRenderbuffer', (base) => function (...args) {
      state.deleteRenderbuffer += 1
      return base.apply(this, args)
    })

    // texImage2D(target, level, internalformat, width, height, border, format, type, pixels) — the
    // 9-argument form carries its own dimensions. The 6-argument form
    // texImage2D(target, level, internalformat, format, type, source) takes them from `source`.
    patch('texImage2D', (base) => function (...args) {
      state.texImage += 1
      if (args.length >= 9) {
        state.textureBytes += bytesForFormatType(args[6], args[7], args[3], args[4])
      } else if (args.length >= 6) {
        const source = args[5]
        const w = source && (source.width || source.videoWidth)
        const h = source && (source.height || source.videoHeight)
        state.textureBytes += bytesForFormatType(args[3], args[4], w, h)
      }
      return base.apply(this, args)
    })
    patch('texImage3D', (base) => function (...args) {
      state.texImage += 1
      if (args.length >= 10) {
        state.textureBytes += bytesForFormatType(args[7], args[8], args[3], args[4]) * (args[5] || 1)
      }
      return base.apply(this, args)
    })
    if (isGl2) {
      // texStorage2D(target, levels, internalformat, width, height) — the clean case: a sized
      // internal format and explicit dimensions, so this total is the trustworthy one.
      patch('texStorage2D', (base) => function (...args) {
        state.texStorage += 1
        state.textureBytes += withMips(bytesFor(args[2], args[3], args[4], 1), args[1])
        return base.apply(this, args)
      })
      patch('texStorage3D', (base) => function (...args) {
        state.texStorage += 1
        state.textureBytes += withMips(bytesFor(args[2], args[3], args[4], args[5]), args[1])
        return base.apply(this, args)
      })
      patch('renderbufferStorageMultisample', (base) => function (...args) {
        state.renderbufferStorage += 1
        state.renderbufferBytes += bytesFor(args[2], args[3], args[4], 1) * Math.max(1, args[1] || 1)
        return base.apply(this, args)
      })
    }
    patch('renderbufferStorage', (base) => function (...args) {
      state.renderbufferStorage += 1
      state.renderbufferBytes += bytesFor(args[1], args[2], args[3], 1)
      return base.apply(this, args)
    })
    patch('bufferData', (base) => function (...args) {
      state.bufferData += 1
      const source = args[1]
      if (typeof source === 'number') state.bufferBytes += source
      else if (source && typeof source.byteLength === 'number') state.bufferBytes += source.byteLength
      return base.apply(this, args)
    })

    patch('shaderSource', (base) => function (...args) {
      shaders.set(args[0], args[1])
      return base.apply(this, args)
    })
    patch('attachShader', (base) => function (...args) {
      const record = recordFor(args[0])
      const source = shaders.get(args[1])
      if (record && typeof source === 'string') {
        // Vertex or fragment is told apart by the source, not by the shader type enum, which would
        // cost another native call: only a fragment shader declares a precision for floats in the
        // header three.js emits, and only a vertex shader has `gl_Position`.
        if (source.indexOf('gl_Position') !== -1) {
          record.vertexChars = source.length
          record.vertexHash = hashSource(source)
        } else {
          record.fragmentChars = source.length
          record.fragmentHash = hashSource(source)
        }
        if (!record.name) record.name = nameFrom(source)
      }
      return base.apply(this, args)
    })
    patch('linkProgram', (base) => function (...args) {
      const record = recordFor(args[0])
      state.linkProgramCalls += 1
      const started = performance.now()
      const result = base.apply(this, args)
      if (record) record.linkMs = Math.round((performance.now() - started) * 100) / 100
      return result
    })
    patch('getProgramParameter', (base) => function (...args) {
      // 35714 is LINK_STATUS — the read that forces a deferred compile to finish.
      if (args[1] !== 35714) return base.apply(this, args)
      const record = recordFor(args[0])
      const started = performance.now()
      const result = base.apply(this, args)
      const elapsed = performance.now() - started
      state.programSyncMs += elapsed
      if (record) record.syncMs = Math.round((record.syncMs + elapsed) * 100) / 100
      return result
    })
    patch('getProgramInfoLog', (base) => function (...args) {
      const record = recordFor(args[0])
      const started = performance.now()
      const result = base.apply(this, args)
      const elapsed = performance.now() - started
      state.programSyncMs += elapsed
      if (record) record.syncMs = Math.round((record.syncMs + elapsed) * 100) / 100
      return result
    })

    let current = null
    patch('useProgram', (base) => function (...args) {
      current = args[0]
      return base.apply(this, args)
    })
    const timeFirstDraw = (base) => function (...args) {
      // Time to first frame (§9), gated on the first draw call of any kind. The gate is the whole
      // point: two unconditional rAFs fire on the second frame the *document* paints, which is the
      // blank page, hundreds of milliseconds before `stars.bin` has even been fetched. The earliest
      // moment anything of the app's could be on screen is the frame that presents the first draw,
      // so the timestamp is taken in the rAF *after* the draw that opened this gate.
      if (state.firstDrawAtMs === null) {
        state.firstDrawAtMs = Math.round(performance.now())
        requestAnimationFrame(() => {
          if (state.firstFrameMs === null) state.firstFrameMs = Math.round(performance.now())
        })
      }
      const record = current ? programs.get(current) : null
      if (!record || record.firstDrawMs !== null) return base.apply(this, args)
      const started = performance.now()
      const result = base.apply(this, args)
      record.firstDrawMs = Math.round((performance.now() - started) * 100) / 100
      return result
    }
    patch('drawArrays', timeFirstDraw)
    patch('drawElements', timeFirstDraw)
    if (isGl2) {
      patch('drawArraysInstanced', timeFirstDraw)
      patch('drawElementsInstanced', timeFirstDraw)
    }
  }

  wrap(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype, false)
  wrap(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype, true)

  // ---------------------------------------------------------------------------------------------
  // Context creation: count them, and record the driver strings off the first real one. Wrapping
  // `getContext` is also how the probe learns whether the page got WebGL2 at all.
  // ---------------------------------------------------------------------------------------------
  let gpu = null
  const nativeGetContext = HTMLCanvasElement.prototype.getContext

  /** The driver strings and limits off one context. Shared by the wrapper and the console path. */
  function describeContext(context, kind) {
    try {
      const info = context.getExtension('WEBGL_debug_renderer_info')
      return {
        kind,
        vendor: info ? context.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
        renderer: info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
        glVendor: context.getParameter(context.VENDOR),
        glRenderer: context.getParameter(context.RENDERER),
        version: context.getParameter(context.VERSION),
        maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
        aliasedPointSizeRange: Array.from(
          context.getParameter(context.ALIASED_POINT_SIZE_RANGE) || [],
        ),
      }
    } catch {
      return { kind, vendor: null, renderer: null, error: 'driver strings unavailable' }
    }
  }

  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const context = nativeGetContext.call(this, kind, ...rest)
    if (context && (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl')) {
      state.contexts += 1
      if (!gpu) {
        gpu = describeContext(context, kind)
        try {
          // KHR_parallel_shader_compile is the extension that lets an engine link without
          // stalling. Whether ANGLE offers it here is half the answer to §9's compile question.
          state.parallelShaderCompile = context.getExtension('KHR_parallel_shader_compile') !== null
        } catch {
          state.parallelShaderCompile = null
        }
      }
    }
    return context
  }

  /**
   * The driver strings off a context that already exists — the console path's only way to get them.
   *
   * `gpu` is filled by the `getContext` wrapper, which can only see contexts created *after* the
   * wrap. Pasted into a devtools console the wrap happens last, so `gpu` would be `null` forever
   * while the snippet's banner claimed otherwise. `getContext` on a canvas that already has a
   * context returns **that** context rather than creating one, so the strings are readable after
   * all; `nativeGetContext` is used so this cannot disturb the allocation counters. Matters most on
   * Firefox, which is the only engine with no driven path and the one likeliest on Windows to fall
   * back to a software renderer.
   */
  function gpuFromExistingCanvas() {
    if (gpu) return gpu
    const canvases = document.querySelectorAll('canvas')
    for (const canvas of canvases) {
      for (const kind of ['webgl2', 'webgl']) {
        let context = null
        try {
          context = nativeGetContext.call(canvas, kind)
        } catch {
          context = null
        }
        if (context) return describeContext(context, kind)
      }
    }
    return null
  }

  const navigationStart = performance.timeOrigin || 0

  /**
   * Review §9's point-size probe, on a context of its own so the app's canvas is untouched.
   *
   * ANGLE's D3D11 backend has no native point sprites larger than a pixel and emulates them; a
   * driver may also clamp. Both failures look identical from the app — stars quietly stop growing —
   * so this asks the rasteriser directly: draw one point at each requested size, read the pixels
   * back, and report the diameter that actually covered the framebuffer. `ALIASED_POINT_SIZE_RANGE`
   * is what the driver *claims*; `measuredPx` is what it did.
   */
  function pointSizeProbe(sizes) {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const gl = nativeGetContext.call(canvas, 'webgl2', { antialias: false, preserveDrawingBuffer: true })
    if (!gl) return { error: 'no webgl2 context for the point-size probe' }

    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`point-size probe shader: ${gl.getShaderInfoLog(shader)}`)
      }
      return shader
    }
    // GLSL ES 3.0, to match the star shader (DEC-622).
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
uniform float uSize;
void main() {
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = uSize;
}`))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }`))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return { error: `point-size probe link: ${gl.getProgramInfoLog(program)}` }
    }
    gl.useProgram(program)
    const uSize = gl.getUniformLocation(program, 'uSize')

    const pixels = new Uint8Array(128 * 128 * 4)
    const results = sizes.map((requested) => {
      gl.viewport(0, 0, 128, 128)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(uSize, requested)
      gl.drawArrays(gl.POINTS, 0, 1)
      gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let covered = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8) covered += 1
      return {
        requestedPx: Math.round(requested * 100) / 100,
        coveredPixels: covered,
        // A square sprite, so the side of the covered area is the diameter the driver used.
        measuredPx: Math.round(Math.sqrt(covered) * 100) / 100,
        clamped: covered > 0 && Math.sqrt(covered) < requested - 1.5,
      }
    })
    const range = Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [])
    // Free the probe's context rather than leaving a second GPU context alive for the whole run.
    const lose = gl.getExtension('WEBGL_lose_context')
    if (lose) lose.loseContext()
    return { aliasedPointSizeRange: range, sizes: results }
  }

  window.__eternitiesGpuProbe = {
    snapshot() {
      return {
        atMs: Math.round(performance.now()),
        timeOrigin: navigationStart,
        gpu,
        contexts: state.contexts,
        // Both are gated on the first real draw call. `firstDrawAtMs` is when the app first asked
        // the GPU to draw; `firstFrameMs` is the rAF that presented it. See `timeFirstDraw`.
        firstDrawAtMs: state.firstDrawAtMs,
        firstFrameMs: state.firstFrameMs,
        parallelShaderCompile: state.parallelShaderCompile,
        textures: {
          created: state.createTexture,
          deleted: state.deleteTexture,
          live: state.createTexture - state.deleteTexture,
          texImageCalls: state.texImage,
          texStorageCalls: state.texStorage,
          estimatedBytes: state.textureBytes,
        },
        framebuffers: {
          created: state.createFramebuffer,
          deleted: state.deleteFramebuffer,
          renderbuffersCreated: state.createRenderbuffer,
          renderbuffersDeleted: state.deleteRenderbuffer,
          renderbufferStorageCalls: state.renderbufferStorage,
          estimatedRenderbufferBytes: state.renderbufferBytes,
        },
        buffers: { calls: state.bufferData, estimatedBytes: state.bufferBytes },
        programs: {
          linkProgramCalls: state.linkProgramCalls,
          syncMsTotal: Math.round(state.programSyncMs * 100) / 100,
          // A copy, so a caller cannot mutate the live records between snapshots. `sourceHash` is
          // the only field here that identifies the *same* program across two machines.
          each: state.programs.map((record) => ({
            ...record,
            sourceHash: `${record.vertexHash ?? '-'}.${record.fragmentHash ?? '-'}`,
          })),
        },
        unknownFormats: state.unknownFormats.slice(),
      }
    },
    pointSizeProbe,
    describeContext,
    gpuFromExistingCanvas,
  }
}

/**
 * The source of {@link installGpuProbe} as an immediately-invoked expression.
 *
 * Used two ways: a driver hands it to `evaluateOnNewDocument` so the wrapping precedes the app's
 * first context, and `console-probe.js` is this text plus a reporting tail, for a browser no driver
 * on this machine can automate (Firefox stable, Brave with shields on).
 */
export const INSTRUMENT_SOURCE = `(${installGpuProbe.toString()})()`
