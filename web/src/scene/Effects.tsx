/**
 * PRD 5.3.20-21: selective bloom and a subtle vignette. No film grain, no chromatic aberration.
 *
 * "Selective" is the luminance threshold, exactly as PRD 8.5.5 specifies: the star shader already
 * multiplies a star's colour by its brightness, so a card dimmed to 10% by a filter (PRD 5.8.1)
 * falls under the threshold and drops out of the bloom without any per-object bookkeeping. Labels
 * and the HUD are DOM, outside the canvas, and can never bloom whatever the threshold is.
 *
 * The bloom's resolution is the second rung of PRD 8.5.11's degradation ladder. Changing it
 * remounts the effect, which is the honest way to change a constructor option — and at a two
 * second cooldown between tier changes, a remount is not something a user can provoke often.
 */

import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { type ReactElement } from 'react'

import {
  BLOOM_INTENSITY,
  BLOOM_SMOOTHING,
  BLOOM_THRESHOLD,
  VIGNETTE_DARKNESS,
  VIGNETTE_OFFSET,
} from './tuning'

export interface EffectsProps {
  /** From the adaptive-quality tier. PRD 8.5.5's default is a half-resolution blur. */
  readonly bloomScale: number
}

export function Effects({ bloomScale }: EffectsProps): ReactElement {
  return (
    <EffectComposer
      // The star field is additive sprites; multisampling would cost real time and change nothing.
      multisampling={0}
      // Nothing here needs surface normals, and the pass is not free. (Off is the default; saying
      // so keeps a later effect from switching it on without anyone noticing the cost.)
      enableNormalPass={false}
    >
      <Bloom
        key={`bloom-${bloomScale}`}
        intensity={BLOOM_INTENSITY}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
        resolutionScale={bloomScale}
        mipmapBlur
      />
      <Vignette offset={VIGNETTE_OFFSET} darkness={VIGNETTE_DARKNESS} />
    </EffectComposer>
  )
}
