/**
 * The owned post chain: main pass, bloom source, mip blur, one composite (DEC-703, review §3.5).
 *
 * This replaces `@react-three/postprocessing`'s `EffectComposer` + `SelectiveBloom` + `Vignette`,
 * and with them review findings R3 and R4:
 *
 *  - **R3** — `resolutionScale` was inert. `BloomEffect.setSize` hands the mipmap blur pass the
 *    *full* drawing buffer whatever the scale says (`postprocessing/build/index.js:3896-3899`), so
 *    the ladder's second rung moved a constructor option and not one pixel of the frame's cost.
 *    Here the tier's `bloomScale` sizes {@link PostChain.bloomSourceSize}, which is the target the
 *    objects are drawn into — there is one number and the frame pays it.
 *  - **R4** — the `SelectiveBloom` selection was inert, and its depth pass and mask pass were pure
 *    cost. Selection is now `BLOOM_LAYER` (see `./bloomLayer`): the field opts in, cards and
 *    planets do not, and both passes are gone rather than fixed.
 *
 * And DEC-698's note N2: the old chain leaked ~9 textures / ~33 MB on every tier change, because a
 * rebuild disposed about half of what it had allocated. Every target here is created in
 * {@link PostChain.configure} and destroyed in `disposeTargets`, which is the one method both the
 * resize path and {@link PostChain.dispose} call. There is no second list to keep in step.
 *
 * **Target count and cost.** Eight targets at the top of the ladder (a scene buffer, a bloom source
 * and six blur levels) against the old chain's ~20, and the bloom chain starts at half the drawing
 * buffer rather than at all of it. At 1920x1080 and dpr 1.5 that is ~59 MB of render targets where
 * review §2.2 measured ~150 MB, and — because the field is drawn a second time at half resolution instead
 * of the whole scene being drawn a third time at full resolution for a mask nobody read — fewer
 * bytes per frame as well. The bandwidth claim is what `scripts/bench.mjs` and §9's kit measure;
 * the allocation claim is what `scripts/alloc-probe.mjs` measures.
 *
 * **Frame order.** `render` is the only thing that binds a framebuffer during a frame, and it runs
 * its passes in a fixed order with no allocation. The caller (`./PostEffects.tsx`) drives it from
 * the last frame subscriber, after the scene's own per-frame work, which is the first piece of
 * review §3.5's "frame loop owner" to land — the rest arrives with Wave 3.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  ClampToEdgeWrapping,
  Color,
  LinearFilter,
  Mesh,
  NoBlending,
  NormalBlending,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

import { BLOOM_INTENSITY } from '../tuning'

import { BLOOM_LAYER } from './bloomLayer'
import type { PostCapabilities } from './capabilities'
import {
  POST_COMPOSITE_FRAGMENT_SHADER,
  POST_DOWNSAMPLE_FRAGMENT_SHADER,
  POST_PREFILTER_FRAGMENT_SHADER,
  POST_UPSAMPLE_FRAGMENT_SHADER,
  POST_VERTEX_SHADER,
} from './postShaders'
import { BLOOM_UPSAMPLE_RADIUS, TONEMAP_STRENGTH } from './postTuning'

/** See `POST_VERTEX_SHADER`: one triangle that covers clip space, so there is no index buffer. */
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0])

/** Below two levels there is nothing to blur — the chain would be the thresholded source alone. */
const MIN_LEVELS = 2

/** Scratch for the clear-colour save and restore in {@link PostChain.render}. */
const clearColourScratch = new Color()
const BLACK = new Color(0x000000)

export interface TargetSize {
  readonly width: number
  readonly height: number
}

export class PostChain {
  private readonly renderer: WebGLRenderer
  private readonly capabilities: PostCapabilities

  /** One triangle, one camera, three materials swapped onto it. Allocated once. */
  private readonly quadScene = new Scene()
  private readonly quadCamera = new Camera()
  private readonly quad: Mesh
  /** PRD 5.3.20's threshold, source into level 0. See `POST_PREFILTER_FRAGMENT_SHADER`. */
  private readonly prefilterMaterial: ShaderMaterial
  private readonly downsampleMaterial: ShaderMaterial
  private readonly upsampleMaterial: ShaderMaterial
  private readonly compositeMaterial: ShaderMaterial

  /** The main pass's colour and depth, at the full drawing buffer. */
  private sceneTarget: WebGLRenderTarget | null = null

  /**
   * The bloom source: the target the field draws itself into, at the tier's `bloomScale`.
   *
   * Un-thresholded, and exactly the picture the main pass drew minus everything that did not opt
   * into `BLOOM_LAYER`. Nothing samples it but the threshold pass.
   */
  private sourceTarget: WebGLRenderTarget | null = null

  /**
   * The blur chain, finest level first. Level 0 is the thresholded source at the source's own
   * resolution; each level after it is a halving.
   *
   * The chain runs down the list and then back up it, mixing each level into the one below, so
   * level 0 ends the frame holding the finished bloom and the composite samples it. That is
   * `MipmapBlurPass`'s arrangement minus its second set of upsampling targets: mixing in place
   * needs no extra memory and never binds a target as both input and output.
   *
   * Level 0 has to exist as a *separate* target from the source, and the reason is in
   * `POST_PREFILTER_FRAGMENT_SHADER` — the mix needs a sharp, thresholded level to dilute its
   * coarse levels against, and the source is not thresholded.
   */
  private levels: WebGLRenderTarget[] = []

  private width = 0
  private height = 0
  private bloomScale = 0
  private levelCount = 0

  constructor(renderer: WebGLRenderer, capabilities: PostCapabilities) {
    this.renderer = renderer
    this.capabilities = capabilities

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(FULLSCREEN_TRIANGLE, 3))
    geometry.boundingSphere = null

    this.prefilterMaterial = new ShaderMaterial({
      name: 'post.prefilter',
      uniforms: { uInput: { value: null }, uTexelSize: { value: new Vector2() } },
      vertexShader: POST_VERTEX_SHADER,
      fragmentShader: POST_PREFILTER_FRAGMENT_SHADER,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    })

    this.downsampleMaterial = new ShaderMaterial({
      name: 'post.downsample',
      uniforms: { uInput: { value: null }, uTexelSize: { value: new Vector2() } },
      vertexShader: POST_VERTEX_SHADER,
      fragmentShader: POST_DOWNSAMPLE_FRAGMENT_SHADER,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    })

    this.upsampleMaterial = new ShaderMaterial({
      name: 'post.upsample',
      uniforms: {
        uInput: { value: null },
        uTexelSize: { value: new Vector2() },
        uRadius: { value: BLOOM_UPSAMPLE_RADIUS },
      },
      vertexShader: POST_VERTEX_SHADER,
      fragmentShader: POST_UPSAMPLE_FRAGMENT_SHADER,
      // `mix(destination, tent, radius)`, done by the blend equation: the shader writes the tent
      // with `radius` as its alpha, and normal blending is exactly that mix.
      transparent: true,
      blending: NormalBlending,
      depthTest: false,
      depthWrite: false,
    })

    this.compositeMaterial = new ShaderMaterial({
      name: 'post.composite',
      uniforms: {
        uScene: { value: null },
        uBloom: { value: null },
        uBloomIntensity: { value: BLOOM_INTENSITY },
        uTonemapStrength: { value: TONEMAP_STRENGTH },
      },
      vertexShader: POST_VERTEX_SHADER,
      fragmentShader: POST_COMPOSITE_FRAGMENT_SHADER,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    })

    this.quad = new Mesh(geometry, this.downsampleMaterial)
    this.quad.frustumCulled = false
    this.quad.matrixAutoUpdate = false
    this.quadScene.add(this.quad)
  }

  /** The drawing buffer the main pass renders at, or `null` before the first `configure`. */
  get sceneSize(): TargetSize | null {
    const target = this.sceneTarget
    return target ? { width: target.width, height: target.height } : null
  }

  /**
   * The bloom source's size — what the ladder's second rung asked for *and* what the frame pays.
   *
   * The `?probe=1` seam reports this. Where `Effects.BloomProbe` had to report two sizes because
   * the one the rung set was not the one the chain ran at (R3), there is now one.
   */
  get bloomSourceSize(): TargetSize | null {
    const target = this.sourceTarget
    return target ? { width: target.width, height: target.height } : null
  }

  /** How many mip levels the blur is running, after the clamp in {@link configure}. */
  get bloomLevels(): number {
    return this.levels.length
  }

  /** Whether the chain got the float targets it asked for. See `./capabilities`. */
  get floatTargets(): boolean {
    return this.capabilities.floatTargets
  }

  /**
   * PRD 6.10.1's bloom setting: how much of the finished bloom the composite mixes back in.
   *
   * A uniform write, deliberately not part of {@link configure}. The ladder's rung changes what the
   * chain *costs* and has to rebuild targets; this changes what it *looks like* and must not. That
   * distinction is the whole of why the setting was expensive before — the old chain took intensity
   * as a constructor option, so a click on a radio button rebuilt an effect and its render targets.
   */
  set bloomIntensity(value: number) {
    this.compositeMaterial.uniforms['uBloomIntensity']!.value = value
  }

  get bloomIntensity(): number {
    return this.compositeMaterial.uniforms['uBloomIntensity']!.value as number
  }

  /**
   * Size the chain to a drawing buffer and a ladder rung. Idempotent: identical arguments are a
   * no-op, so this is safe to call every frame and is in fact called that way.
   *
   * Anything that moves rebuilds *everything*, after disposing everything. A resize and a tier
   * change are the same operation as far as the targets are concerned, and giving them one path is
   * what makes note N2's leak unrepeatable rather than fixed in the two places it was noticed.
   */
  configure(width: number, height: number, bloomScale: number, levels: number): void {
    if (
      width === this.width &&
      height === this.height &&
      bloomScale === this.bloomScale &&
      levels === this.levelCount &&
      this.sceneTarget !== null &&
      this.sourceTarget !== null
    ) {
      return
    }

    this.disposeTargets()
    this.width = width
    this.height = height
    this.bloomScale = bloomScale
    this.levelCount = levels

    this.sceneTarget = this.createTarget(width, height, 'post.scene', true)

    let levelWidth = Math.max(1, Math.round(width * bloomScale))
    let levelHeight = Math.max(1, Math.round(height * bloomScale))
    this.sourceTarget = this.createTarget(levelWidth, levelHeight, 'post.bloom.source', false)
    // A level narrower than two texels cannot be halved again, and a 1x1 tap is a blur of one
    // pixel over the whole screen. Stop there rather than allocating levels that do nothing —
    // which is also what keeps a 640x360 CI viewport at dpr 2 from asking for eleven halvings.
    const smallest = Math.max(1, Math.min(levelWidth, levelHeight))
    const affordable = Math.max(MIN_LEVELS, Math.min(levels, 1 + Math.floor(Math.log2(smallest))))

    for (let i = 0; i < affordable; i += 1) {
      this.levels.push(this.createTarget(levelWidth, levelHeight, `post.bloom.${i}`, false))
      levelWidth = Math.max(1, Math.floor(levelWidth / 2))
      levelHeight = Math.max(1, Math.floor(levelHeight / 2))
    }
  }

  /**
   * One frame: main pass, bloom source, blur down, blur up, composite to the canvas.
   *
   * The camera's layer mask, the scene's background and the renderer's clear colour are saved and
   * restored around the source pass, in the same shape and for the same reason as
   * `../picking/idPicker`'s read: the pass runs inside someone else's frame and must not leave a
   * camera looking at the wrong layer or a scene without its sky if it throws.
   */
  render(scene: Scene, camera: Camera): void {
    const sceneTarget = this.sceneTarget
    const source = this.sourceTarget
    const bloom = this.levels[0]
    if (!sceneTarget || !source || !bloom) return

    const renderer = this.renderer
    const previousTarget = renderer.getRenderTarget()
    const previousAutoClear = renderer.autoClear
    const previousMask = camera.layers.mask
    const previousBackground = scene.background
    const previousAlpha = renderer.getClearAlpha()
    const previousClear = renderer.getClearColor(clearColourScratch)

    try {
      // Both object passes clear their own target: three's background handling does it from
      // `scene.background` for the first, and the explicit clear does it for the second.
      renderer.autoClear = true
      renderer.setRenderTarget(sceneTarget)
      renderer.render(scene, camera)

      // PRD 5.3.20's selection, and R4's fix: the field's objects are on `BLOOM_LAYER` and the
      // cards are not, so this pass *is* the selection. The sky is dropped because a near-black
      // opaque fill is still a fill, and it would put a floor under the threshold in every texel
      // of the source rather than leaving it empty.
      scene.background = null
      camera.layers.set(BLOOM_LAYER)
      renderer.setClearColor(BLACK, 0)
      renderer.setRenderTarget(source)
      renderer.clear(true, false, false)
      renderer.render(scene, camera)
    } finally {
      camera.layers.mask = previousMask
      scene.background = previousBackground
      renderer.setClearColor(previousClear, previousAlpha)
    }

    // The fullscreen passes cover their whole target, and the upsample deliberately blends into
    // what is already there, so nothing below may clear.
    renderer.autoClear = false

    // PRD 5.3.20's threshold, at the source's resolution: source -> level 0.
    this.setPassInput(this.prefilterMaterial, source)
    this.drawQuad(this.prefilterMaterial, bloom)

    for (let i = 1; i < this.levels.length; i += 1) {
      this.setPassInput(this.downsampleMaterial, this.levels[i - 1]!)
      this.drawQuad(this.downsampleMaterial, this.levels[i]!)
    }

    for (let i = this.levels.length - 1; i >= 1; i -= 1) {
      this.setPassInput(this.upsampleMaterial, this.levels[i]!)
      this.drawQuad(this.upsampleMaterial, this.levels[i - 1]!)
    }

    this.compositeMaterial.uniforms['uScene']!.value = sceneTarget.texture
    this.compositeMaterial.uniforms['uBloom']!.value = bloom.texture
    this.drawQuad(this.compositeMaterial, null)

    renderer.autoClear = previousAutoClear
    renderer.setRenderTarget(previousTarget)
  }

  dispose(): void {
    this.disposeTargets()
    this.prefilterMaterial.dispose()
    this.downsampleMaterial.dispose()
    this.upsampleMaterial.dispose()
    this.compositeMaterial.dispose()
    this.quad.geometry.dispose()
    this.quadScene.remove(this.quad)
  }

  /** The input texture and its texel size, which is what the tap offsets are measured in. */
  private setPassInput(material: ShaderMaterial, input: WebGLRenderTarget): void {
    material.uniforms['uInput']!.value = input.texture
    ;(material.uniforms['uTexelSize']!.value as Vector2).set(1 / input.width, 1 / input.height)
  }

  private drawQuad(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  private createTarget(
    width: number,
    height: number,
    name: string,
    depth: boolean,
  ): WebGLRenderTarget {
    const target = new WebGLRenderTarget(width, height, {
      type: this.capabilities.targetType,
      depthBuffer: depth,
      stencilBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      generateMipmaps: false,
    })
    // Named so that a WebGL trace and `scripts/alloc-probe.mjs` can tell these apart from the
    // atlas and the id buffer — the old chain's targets were all unnamed.
    target.texture.name = name
    return target
  }

  /**
   * Free every GPU object this chain allocated, and forget it.
   *
   * `WebGLRenderTarget.dispose` releases the framebuffer, its colour texture and its depth buffer,
   * so this is the whole of the chain's GPU footprint — which is the point of note N2. The old
   * chain's leak was not a missing `dispose` call but a *partial* one: `EffectComposer.removePass`
   * dropped an effect without disposing it, and the effect owned targets the composer had never
   * heard of.
   */
  private disposeTargets(): void {
    this.sceneTarget?.dispose()
    this.sceneTarget = null
    this.sourceTarget?.dispose()
    this.sourceTarget = null
    for (const level of this.levels) level.dispose()
    this.levels = []
  }
}
