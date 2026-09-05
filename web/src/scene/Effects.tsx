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
import { Object3D } from 'three'

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
   *
   * **What it costs, recorded (DEC-638/N7).** `SelectiveBloomEffect` renders the scene a second
   * time each frame to build its mask, and the star field — 28,587 instanced points on the
   * production roster — is in that second pass. Card level measures p95 18.3–18.4 ms against PRD
   * 7.2's 16.7 ms target; the 33 ms ceiling is met with room, and 60 fps is held. This is the
   * plausible contributor, and it is not cheap to remove: the alternatives are a luminance-only
   * global bloom, which is the washed-out card PRD 9.3 names, or a hand-written two-camera mask
   * pass. Neither belongs in a fix leg. Left as a known miss against the target.
   */
  readonly bloomSelection?: readonly Object3D[]
}

/**
 * What `SelectiveBloom`'s `lights` prop gets, because this scene has no lights at all.
 *
 * The prop exists so that a *lit* selected object is not black in the bloom's mask pass: the
 * wrapper enables the selection layer on each light it is given. Every material here is a shader of
 * its own or `MeshBasicMaterial`, so there is nothing to light and nothing to enable — but the
 * wrapper warns `SelectiveBloom requires lights to work.` on every mount when the array is empty,
 * and a console line that is false is worse than no line.
 *
 * One detached `Object3D`, never added to the scene and never rendered. Enabling a layer on it is
 * the whole of what the wrapper does with it. Module-level so its identity is stable — the wrapper
 * keys an effect on the array.
 */
const NO_LIGHTS: Object3D[] = [new Object3D()]

export function Effects({ bloomScale, bloomSelection }: EffectsProps): ReactElement {
  const bloom =
    bloomSelection && bloomSelection.length > 0 ? (
      <SelectiveBloom
        // Keyed on the selection as well: `SelectiveBloomEffect` takes its selection at
        // construction, and the field's objects are built once `planes.json` lands.
        key={`selective-bloom-${bloomScale}-${bloomSelection.length}`}
        selection={bloomSelection as Object3D[]}
        lights={NO_LIGHTS}
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
