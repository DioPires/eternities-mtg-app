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

import { Bloom, EffectComposer, SelectiveBloom, Vignette } from '@react-three/postprocessing'
import { type ReactElement } from 'react'
import type { Object3D } from 'three'

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
  /**
   * Restrict the bloom to these objects (PRD 5.3.20's "selective", the object half of it).
   *
   * PRD 8.5.5 reads "selective" as a luminance threshold, and for a scene that is only stars that
   * is the whole of it: nothing but a star core is above the threshold. The card tier breaks that
   * reading. A Magic card's frame is near-white, so in linear light it is far above a threshold
   * tuned for star cores, and a focused card blooms into a white rectangle — which is exactly the
   * failure PRD 9.3 names: "bloom never washes out a label or the focused card".
   *
   * So when the card tier is in the scene, the *field* is what blooms and the cards are not. Left
   * undefined the bloom is global, which is what Phase 2a's harness — and the bench baseline
   * measured against it — has always had.
   */
  readonly bloomSelection?: readonly Object3D[]
}

export function Effects({ bloomScale, bloomSelection }: EffectsProps): ReactElement {
  const bloom =
    bloomSelection && bloomSelection.length > 0 ? (
      <SelectiveBloom
        // Keyed on the selection as well: `SelectiveBloomEffect` takes its selection at
        // construction, and the field's objects are built once `planes.json` lands.
        key={`selective-bloom-${bloomScale}-${bloomSelection.length}`}
        selection={bloomSelection as Object3D[]}
        intensity={BLOOM_INTENSITY}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
        resolutionScale={bloomScale}
        mipmapBlur
      />
    ) : (
      <Bloom
        key={`bloom-${bloomScale}`}
        intensity={BLOOM_INTENSITY}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
        resolutionScale={bloomScale}
        mipmapBlur
      />
    )

  return (
    <EffectComposer
      // The star field is additive sprites; multisampling would cost real time and change nothing.
      multisampling={0}
      // Nothing here needs surface normals, and the pass is not free. (Off is the default; saying
      // so keeps a later effect from switching it on without anyone noticing the cost.)
      enableNormalPass={false}
    >
      {bloom}
      <Vignette offset={VIGNETTE_OFFSET} darkness={VIGNETTE_DARKNESS} />
    </EffectComposer>
  )
}
