/**
 * PRD 8.5.6's GPU id-buffer picking.
 *
 * "A second pass renders ids as colour into a small scissored render target around the pointer;
 * one pixel read per pointer move, throttled to the frame. This is exact and agrees with
 * shader-side positions, which a CPU raycaster would not."
 *
 * Two decisions worth stating:
 *
 *  - The sub-window comes from `camera.setViewOffset` and a tiny render target, not from a
 *    full-size target plus a scissor. The projection is identical either way — that is what
 *    `setViewOffset` is for — but the target is 11×11 pixels instead of 1920×1080, so the pass
 *    costs a few hundred fragments and 484 bytes of readback rather than 8 MB of VRAM.
 *  - The readback is `readRenderTargetPixelsAsync`, which fences and resolves a frame or two later
 *    instead of stalling the pipeline the way a synchronous `readPixels` does. Picking one frame
 *    behind the pointer is invisible; a 3 ms bubble in a 16.7 ms budget (PRD 7.2) is not.
 *
 * Exactness is the point of the whole approach: the pick pass runs the *same vertex shader* as the
 * draw pass, with `ID_PASS` defined, so what it hits is where the star actually is on screen.
 */

import {
  Color,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
  WebGLRenderTarget,
  type Camera,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three'

/** Objects rendered in the pick pass live here and nowhere else. */
export const PICK_LAYER = 1

/**
 * Side of the pick window, in device pixels. Odd, so there is a true centre pixel; wide enough
 * that a one-pixel star at multiverse level is still reachable with an ordinary pointer.
 */
const PICK_SIZE = 11

const CENTRE = (PICK_SIZE - 1) / 2

/** Ring-ordered pixel indices: centre first, then outward, so the nearest hit wins. */
const SCAN_ORDER = ((): Int32Array => {
  const order: number[] = []
  for (let y = 0; y < PICK_SIZE; y += 1) {
    for (let x = 0; x < PICK_SIZE; x += 1) order.push(y * PICK_SIZE + x)
  }
  order.sort((a, b) => {
    const distance = (i: number): number =>
      ((i % PICK_SIZE) - CENTRE) ** 2 + (Math.floor(i / PICK_SIZE) - CENTRE) ** 2
    return distance(a) - distance(b)
  })
  return Int32Array.from(order)
})()

export class IdPicker {
  private readonly target: WebGLRenderTarget
  private readonly pixels = new Uint8Array(PICK_SIZE * PICK_SIZE * 4)
  private busy = false

  constructor() {
    this.target = new WebGLRenderTarget(PICK_SIZE, PICK_SIZE, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    })
  }

  /** True while a read is outstanding. The caller skips a frame rather than queueing up reads. */
  get pending(): boolean {
    return this.busy
  }

  /**
   * Render the pick layer around a pointer position and read back what is under it.
   *
   * `x` and `y` are in device (drawing-buffer) pixels with a top-left origin, which is what a
   * pointer event gives once multiplied by the pixel ratio.
   *
   * Resolves to the id the shader wrote minus one — that is, the star index — or `-1` for a miss.
   * Resolves `-1` immediately if a read is already in flight.
   */
  async pick(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    x: number,
    y: number,
  ): Promise<number> {
    if (this.busy) return -1
    this.busy = true

    const width = renderer.domElement.width
    const height = renderer.domElement.height
    const offsetX = Math.round(x) - CENTRE
    const offsetY = Math.round(y) - CENTRE

    const previousTarget = renderer.getRenderTarget()
    const previousMask = camera.layers.mask
    const previousBackground = scene.background
    const previousAlpha = renderer.getClearAlpha()
    const previousClear = renderer.getClearColor(clearColourScratch)
    // Nothing in the scene sets a view offset today, but a future stereo or tiled-render mode
    // would, and silently dropping it here would be a very quiet bug.
    const previousView = camera.view === null ? null : { ...camera.view }

    let read: Promise<unknown> | null = null
    try {
      // The sky would otherwise land in the buffer as an opaque colour and decode as a star id.
      scene.background = null
      renderer.setClearColor(0x000000, 0)
      camera.layers.set(PICK_LAYER)
      camera.setViewOffset(width, height, offsetX, offsetY, PICK_SIZE, PICK_SIZE)
      renderer.setRenderTarget(this.target)
      renderer.clear(true, true, false)
      renderer.render(scene, camera)
      // Started, deliberately not awaited yet. `readRenderTargetPixelsAsync` issues its
      // `readPixels` into a pixel buffer synchronously and only *then* waits on a fence, so the
      // pixels are already captured when this returns. Awaiting here instead would hold the
      // renderer on the pick target, the camera on the pick layer and the scene without its sky
      // for however many animation frames the fence takes — and the frame loop renders during
      // those. That is a scene rendered wrong for two frames and a pick pass fighting the effect
      // composer over the bound framebuffer.
      read = renderer.readRenderTargetPixelsAsync(
        this.target,
        0,
        0,
        PICK_SIZE,
        PICK_SIZE,
        this.pixels,
      )
    } finally {
      if (previousView === null) {
        camera.clearViewOffset()
      } else {
        camera.view = previousView
        camera.updateProjectionMatrix()
      }
      camera.layers.mask = previousMask
      scene.background = previousBackground
      renderer.setClearColor(previousClear, previousAlpha)
      renderer.setRenderTarget(previousTarget)
    }

    try {
      await read
    } finally {
      this.busy = false
    }
    return decodeNearest(this.pixels)
  }

  dispose(): void {
    this.target.dispose()
  }
}

/** Centre-out scan, so the star under the pointer beats one merely near it. */
function decodeNearest(pixels: Uint8Array): number {
  for (let i = 0; i < SCAN_ORDER.length; i += 1) {
    const pixel = SCAN_ORDER[i]! * 4
    if (pixels[pixel + 3] === 0) continue
    const id = pixels[pixel]! + pixels[pixel + 1]! * 256 + pixels[pixel + 2]! * 65536
    if (id > 0) return id - 1
  }
  return -1
}

/** `getClearColor` writes into a target; one reused instance keeps the pick path allocation-free. */
const clearColourScratch = new Color()

/** Narrow the camera type at the one place that needs the view offset. */
export function isPerspective(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true
}
