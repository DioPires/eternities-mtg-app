/**
 * The per-plane parameter table of PRD 8.5.2: one row of a float `DataTexture` per plane, holding
 * everything the vertex shader needs to place and move that plane's stars.
 *
 * Why a texture and not uniforms: 88 planes × 24 floats is 2,112 floats, well past the uniform
 * array limits the PRD's weakest supported GPU has to offer, and the whole table uploads in one
 * call per frame.
 *
 * What the CPU updates per frame is deliberately tiny (PRD 8.5.3): the accumulated spin angle per
 * plane, the global multiverse angle, and two easings. Star positions are never touched — that is
 * the vertex shader's job, and the single exception is `starWorldPosition` in `./motion`, the
 * mirror for the focused star (PRD 8.5.7).
 *
 * The row layout itself lives in `./motion`, because the CPU mirror and the shader must share one
 * definition of it.
 */

import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three'

import type { PlaneRecord } from '../../data/types'
import {
  DUST_FOCUS_EASE_S,
  EMPTY_GLOW_RADIUS_SCALE,
  MULTIVERSE_PERIOD_S,
  NEBULA_RADIUS_SCALE,
  PLANE_FADE_S,
} from '../tuning'
import {
  FLOATS_PER_PLANE,
  PLANE_TEXELS,
  PT_DRIFT_AMPLITUDE,
  PT_DRIFT_PHASE,
  PT_DRIFT_VELOCITY,
  PT_FADE,
  PT_FOCUS,
  PT_GLOW_OPACITY,
  PT_GLOW_RADIUS,
  PT_HOME,
  PT_KIND,
  PT_RADIUS,
  PT_SHEAR_AMPLITUDE,
  PT_SHEAR_PHASE,
  PT_SHEAR_VELOCITY,
  PT_SPIN_ANGLE,
  PT_TILT,
  PT_TINT,
  PlaneKindCode,
  TAU,
} from './motion'

const KIND_CODES: Record<PlaneRecord['kind'], PlaneKindCode> = {
  spiral: PlaneKindCode.Spiral,
  irregular: PlaneKindCode.Irregular,
  empty: PlaneKindCode.Empty,
  dust: PlaneKindCode.Dust,
}

/**
 * A plane's live state, mirrored on the CPU so picking (PRD 8.5.6) and the camera tether can ask
 * where a plane is without reading anything back from the GPU.
 */
export interface PlaneState {
  readonly record: PlaneRecord
  readonly kind: PlaneKindCode
  /** 0 until the plane's stars have arrived, then eases to 1 over {@link PLANE_FADE_S}. */
  fade: number
  /** Accumulated spin angle in radians, so easing the spin to a stop stays continuous. */
  spinAngle: number
  /**
   * PRD 5.6.6: a focused plane eases its rotation to a stop over 1 s and back over 1 s. Scaling
   * the angular velocity rather than the angle is what makes that continuous; Phase 3 drives it.
   */
  spinScale: number
}

export class PlaneTable {
  readonly texture: DataTexture
  readonly planes: readonly PlaneState[]
  readonly multiverseRadius: number
  /** Seconds since the scene started. The shader's `uTime`, kept here so both advance together. */
  time = 0

  private readonly data: Float32Array<ArrayBuffer>
  private multiverseAngleValue = 0
  private dustFocusTarget = 0

  constructor(planes: readonly PlaneRecord[], multiverseRadius: number) {
    this.multiverseRadius = multiverseRadius
    // `index` is the star record's `planeIndex`, so it is the texture row — not the array
    // position. Size by the largest index in case the roster is ever sparse.
    const rows = planes.reduce((max, plane) => Math.max(max, plane.index + 1), 0)
    this.data = new Float32Array(rows * FLOATS_PER_PLANE)
    this.texture = new DataTexture(this.data, PLANE_TEXELS, rows, RGBAFormat, FloatType)
    this.texture.minFilter = NearestFilter
    this.texture.magFilter = NearestFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true

    const states: PlaneState[] = []
    for (const record of planes) {
      const kind = KIND_CODES[record.kind]
      states[record.index] = { record, kind, fade: 0, spinAngle: 0, spinScale: 1 }
      this.writeStatic(record, kind)
    }
    // A hole would be a contract bug, not something to paper over with a default row (PRD 7.7.2).
    for (let row = 0; row < rows; row += 1) {
      if (states[row] === undefined) throw new Error(`planes.json has no plane at index ${row}`)
    }
    this.planes = states
  }

  get rows(): number {
    return this.planes.length
  }

  get multiverseAngle(): number {
    return this.multiverseAngleValue
  }

  /** The raw table, for the CPU motion mirror and the pickers. Row-major, {@link PLANE_TEXELS}. */
  get raw(): Float32Array {
    return this.data
  }

  private writeStatic(record: PlaneRecord, kind: PlaneKindCode): void {
    const base = record.index * FLOATS_PER_PLANE
    const d = this.data
    d[base + PT_HOME] = record.home[0]
    d[base + PT_HOME + 1] = record.home[1]
    d[base + PT_HOME + 2] = record.home[2]
    d[base + PT_RADIUS] = record.radius

    d[base + PT_TILT] = record.tilt[0]
    d[base + PT_TILT + 1] = record.tilt[1]
    d[base + PT_TILT + 2] = record.tilt[2]
    d[base + PT_TILT + 3] = record.tilt[3]

    // Periods become angular velocities here so the shader never divides, and a zero period (the
    // Blind Eternities row, which has no spin, drift or shear of its own) never divides by zero.
    d[base + PT_DRIFT_AMPLITUDE] = record.driftAmplitude
    d[base + PT_DRIFT_VELOCITY] = record.driftPeriodS > 0 ? TAU / record.driftPeriodS : 0
    d[base + PT_DRIFT_PHASE] = record.driftPhase
    d[base + PT_SPIN_ANGLE] = 0

    d[base + PT_SHEAR_AMPLITUDE] = record.shearAmplitude
    d[base + PT_SHEAR_VELOCITY] = record.shearPeriodS > 0 ? TAU / record.shearPeriodS : 0
    d[base + PT_SHEAR_PHASE] = record.shearPhase
    d[base + PT_KIND] = kind

    d[base + PT_FADE] = 0
    d[base + PT_FOCUS] = 0
    // PRD 5.3.19's nebula for a plane with cards, PRD 5.3.6's dim elliptical glow for one without.
    // The dust row spans the whole multiverse and so gets no glow quad at all.
    d[base + PT_GLOW_RADIUS] =
      kind === PlaneKindCode.Dust
        ? 0
        : record.radius *
          (kind === PlaneKindCode.Empty ? EMPTY_GLOW_RADIUS_SCALE : NEBULA_RADIUS_SCALE)
    d[base + PT_GLOW_OPACITY] = kind === PlaneKindCode.Empty ? 1 : 0

    d[base + PT_TINT] = record.nebulaTint[0]
    d[base + PT_TINT + 1] = record.nebulaTint[1]
    d[base + PT_TINT + 2] = record.nebulaTint[2]
  }

  /**
   * PRD 6.8.1: this plane's stars have all arrived, so start its fade-in. Idempotent, because the
   * streaming loader re-checks the completed set on every chunk.
   */
  revealPlane(index: number): void {
    const state = this.planes[index]
    if (state && state.fade === 0) state.fade = Number.EPSILON
  }

  /** PRD 5.3.6 / 8.7.2: zero-card planes have no stars to wait for; they appear with the roster. */
  revealEmptyPlanes(): void {
    for (const state of this.planes) {
      if (state.kind === PlaneKindCode.Empty) this.revealPlane(state.record.index)
    }
  }

  /** PRD 5.3.4: brighten the dust while the Blind Eternities is the focus. Eased, never snapped. */
  setDustFocused(focused: boolean): void {
    this.dustFocusTarget = focused ? 1 : 0
  }

  /** PRD 5.6.6, for Phase 3: 0 stops a plane's spin, 1 runs it. The caller owns the easing. */
  setSpinScale(index: number, scale: number): void {
    const state = this.planes[index]
    if (state) state.spinScale = scale
  }

  /**
   * The entire per-frame CPU cost of the star field's motion: one angle integration per plane and
   * two easings, into a preallocated array. No allocation (PRD 7.3.2).
   *
   * `motion` is 0 under reduced motion (PRD 5.9). It freezes every angle where it stands rather
   * than resetting it, so toggling the setting mid-session never makes the field jump.
   */
  advance(deltaSeconds: number, motion: number): void {
    const d = this.data
    this.time += deltaSeconds
    this.multiverseAngleValue =
      (this.multiverseAngleValue + (TAU / MULTIVERSE_PERIOD_S) * motion * deltaSeconds) % TAU

    const fadeStep = deltaSeconds / PLANE_FADE_S
    const focusStep = deltaSeconds / DUST_FOCUS_EASE_S

    for (let row = 0; row < this.planes.length; row += 1) {
      const state = this.planes[row]!
      const base = row * FLOATS_PER_PLANE
      const period = state.record.spinPeriodS
      if (period > 0) {
        const velocity = (TAU / period) * state.record.spinDirection * state.spinScale * motion
        state.spinAngle = (state.spinAngle + velocity * deltaSeconds) % TAU
        d[base + PT_SPIN_ANGLE] = state.spinAngle
      }
      if (state.fade > 0 && state.fade < 1) {
        state.fade = Math.min(1, state.fade + fadeStep)
        // Smoothstep, so a plane that arrives mid-flight eases in instead of ramping (PRD 7.3.4).
        d[base + PT_FADE] = state.fade * state.fade * (3 - 2 * state.fade)
      }
      if (state.kind === PlaneKindCode.Dust) {
        const current = d[base + PT_FOCUS]!
        d[base + PT_FOCUS] =
          current < this.dustFocusTarget
            ? Math.min(this.dustFocusTarget, current + focusStep)
            : Math.max(this.dustFocusTarget, current - focusStep)
      }
    }
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }
}
