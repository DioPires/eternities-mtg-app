/**
 * The one claim in Phase 2a that cannot be checked without a GPU: that the CPU motion mirror of
 * PRD 8.5.7 agrees with the vertex shader of PRD 8.5.3.
 *
 * The two are written from the same constants and the same lattice hash, but "written from" is not
 * "agrees with", and the failure mode is quiet — Phase 2b's camera would frame a spot next to the
 * star it flew to, and nothing would throw.
 *
 * The check closes the loop through the id buffer, which is the only place the shader's own idea
 * of where a star is becomes readable:
 *
 *   1. take a star index;
 *   2. compute its world position on the CPU with `starWorldPosition`;
 *   3. project that with the camera to a device pixel;
 *   4. ask the id-buffer picker what is under that pixel.
 *
 * If the picker returns the same index, the CPU mirror and the vertex shader put the star in the
 * same place, to within the pick window. If it returns a different star or a miss, they do not.
 *
 * Nothing runs unless `?selfcheck=1` asks for it. `scripts/verify-browser.mjs` is the caller.
 */

import { Vector3, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'

import type { IdPicker } from './picking/idPicker'
import { starWorldPosition } from './starfield/motion'
import type { StarGeometry } from './starfield/starGeometry'
import type { PlaneTable } from './starfield/planeTable'

export interface SelfCheckResult {
  readonly checked: number
  readonly agreed: number
  readonly offScreen: number
  /**
   * Stars where the picker returned a *different* star that the mirror also places on the same
   * pixel. Inside a galaxy's core several stars share a pixel and the id pass depth-sorts them, so
   * this is the id buffer working correctly, not the mirror being wrong — and the mirror still had
   * to be right about the other star for it to land there.
   */
  readonly occluded: number
  /** Stars the picker put somewhere the mirror does not. These are real disagreements. */
  readonly missed: readonly {
    readonly index: number
    readonly picked: number
    readonly planeRow: number
    readonly x: number
    readonly y: number
    /** Where the mirror puts whatever the picker returned, if it is on screen. */
    readonly pickedAt: readonly [number, number] | null
  }[]
  /** The drawing buffer the check measured against, for diagnosing a stretched canvas. */
  readonly buffer: readonly [number, number]
  /**
   * Length of a PNG round-trip of the renderer's own canvas. A sky-only frame compresses to a
   * fraction of what a frame with thousands of additive points does, so this is the "did anything
   * actually draw" smoke check — taken here rather than from a DOM query, because the renderer
   * knows which canvas is its own.
   */
  readonly canvasBytes: number
  /**
   * Mean and worst distance, in device pixels, between the queried pixel and where the mirror puts
   * whatever the picker returned. This is what stops the tolerance below from hiding a systematic
   * offset: individual samples can land on a neighbour, but the *average* displacement can only
   * stay near zero if the mirror and the shader agree.
   */
  readonly meanOffsetPx: number
  readonly maxOffsetPx: number
  readonly positionMode: string
  readonly ok: boolean
}

declare global {
  interface Window {
    __eternitiesSelfCheck?: SelfCheckResult
  }
}

export function selfCheckRequested(
  search = typeof location === 'undefined' ? '' : location.search,
): boolean {
  const value = new URLSearchParams(search).get('selfcheck')
  return value !== null && value !== '0'
}

const world = new Vector3()
const projected = new Vector3()

/**
 * How close two stars' projected pixels must be to count as sharing one: half the pick window.
 * The picker reads an 11-pixel window and every star sprite in it is at least 7 pixels across, so
 * a star this close genuinely covers the queried pixel and legitimately wins the depth test.
 */
const COINCIDENT_PX = 6

/** Where the CPU mirror says a star is, in device pixels. `null` when it is off screen. */
function mirrorPixel(
  index: number,
  table: PlaneTable,
  geometry: StarGeometry,
  camera: PerspectiveCamera,
  motion: number,
  width: number,
  height: number,
  out: Vector3,
): { x: number; y: number; z: number } | null {
  geometry.localPosition(index, out)
  starWorldPosition(
    table.raw,
    geometry.planeRowOf(index),
    out.x,
    out.y,
    out.z,
    table.time,
    table.multiverseAngle,
    motion,
    out,
  )
  out.project(camera)
  if (Math.abs(out.x) > 1 || Math.abs(out.y) > 1 || out.z > 1) return null
  return { x: ((out.x + 1) / 2) * width, y: ((1 - out.y) / 2) * height, z: out.z }
}

/**
 * Run the check over a spread of star indices. Slow by design — one render pass and one readback
 * per star — so it is a diagnostic, never something the frame loop does.
 */
export async function runSelfCheck(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  picker: IdPicker,
  table: PlaneTable,
  geometry: StarGeometry,
  reducedMotion: boolean,
  sampleCount = 24,
): Promise<SelfCheckResult> {
  const total = geometry.drawCount
  const missed: SelfCheckResult['missed'][number][] = []
  let agreed = 0
  let offScreen = 0
  let occluded = 0
  let checked = 0
  let offsetTotal = 0
  let offsetMax = 0

  const motion = reducedMotion ? 0 : 1

  // Taken before any pick pass runs, so it is a plain composed frame of the scene rather than
  // whatever the canvas held after two dozen render-target round trips.
  await new Promise((frame) => requestAnimationFrame(() => frame(null)))
  const canvasBytes = renderer.domElement.toDataURL('image/png').length

  for (let sample = 0; sample < sampleCount; sample += 1) {
    // Spread across the file, so dust (the curl-noise branch) and disc stars are both covered.
    const index = Math.floor((sample / sampleCount) * total)
    if (index >= total) continue
    if (!geometry.passesFilter(index)) continue
    // The plane has to have faded in, or the pick pass discards it (PRD 5.8.3's rule, reused).
    if ((table.planes[geometry.planeRowOf(index)]?.fade ?? 0) <= 0.5) continue

    // One pick per animation frame, which is how PRD 8.5.6 says the app picks ("throttled to the
    // frame") and therefore the only regime worth asserting about. Waiting *before* reading the
    // mirror matters: the frame that just ran advanced the clock the shader draws with, and a
    // position computed against the previous frame's clock would be a stale comparison.
    await new Promise((frame) => requestAnimationFrame(() => frame(null)))

    // Re-read every sample: the adaptive-quality monitor can change the pixel ratio between
    // frames (PRD 8.5.11), which resizes the drawing buffer under a cached value.
    const width = renderer.domElement.width
    const height = renderer.domElement.height

    const pixel = mirrorPixel(index, table, geometry, camera, motion, width, height, world)
    if (pixel === null) {
      offScreen += 1
      continue
    }

    checked += 1
    const picked = await picker.pick(renderer, scene, camera, pixel.x, pixel.y)
    if (picked === index) {
      agreed += 1
      continue
    }
    // A different star came back. That is correct if the mirror also puts *that* star on this
    // pixel — inside a galaxy core several stars share one, and the id pass depth-sorts them.
    const other =
      picked >= 0
        ? mirrorPixel(picked, table, geometry, camera, motion, width, height, projected)
        : null
    if (other !== null) {
      const offset = Math.hypot(other.x - pixel.x, other.y - pixel.y)
      offsetTotal += offset
      offsetMax = Math.max(offsetMax, offset)
      if (offset <= COINCIDENT_PX) {
        occluded += 1
        continue
      }
    }
    missed.push({
      index,
      picked,
      planeRow: geometry.planeRowOf(index),
      x: Math.round(pixel.x * 10) / 10,
      y: Math.round(pixel.y * 10) / 10,
      pickedAt:
        other === null ? null : [Math.round(other.x * 10) / 10, Math.round(other.y * 10) / 10],
    })
  }

  return {
    checked,
    agreed,
    offScreen,
    occluded,
    missed,
    meanOffsetPx: occluded > 0 ? Math.round((offsetTotal / occluded) * 100) / 100 : 0,
    maxOffsetPx: Math.round(offsetMax * 100) / 100,
    buffer: [renderer.domElement.width, renderer.domElement.height],
    canvasBytes,
    positionMode: geometry.positionMode,
    ok: checked > 0 && missed.length === 0,
  }
}
