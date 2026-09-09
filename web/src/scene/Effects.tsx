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
 *
 * **Why this component is memoised (DEC-692 R1).** `@react-three/postprocessing` treats a render as
 * a reason to rebuild: `SelectiveBloom` lists its `...props` rest object in the `useMemo` that
 * constructs `SelectiveBloomEffect`, and a rest object is fresh every render, so an effect with
 * ~20 render targets — about 150 MB of them at 1.5× on 1080p — is constructed from scratch and the
 * old one dropped without disposal (`EffectComposer.removePass` does not dispose). `EffectComposer`
 * itself then keys its pass list on `children`, which is a new element on every render of this
 * component, so the `EffectPass` is removed and re-added too.
 *
 * R3F pushes the children of `<Canvas>` into its own reconciler from a layout effect with no
 * dependency array, so *any* render of the component that owns the canvas reaches here. Every prop
 * below is referentially stable across such a render (a number, a `useMemo` array, a ref), so
 * `memo` is what turns that into a bail-out: the effect is constructed once per tier and per
 * selection change, which is what the ladder actually asks for. Measured against the live site's
 * ~308 MB/s of allocation churn — see `SceneStats` in `EternitiesScene.tsx` for the other half.
 */

import { EffectComposerContext } from '@react-three/postprocessing'
import { Bloom, EffectComposer, SelectiveBloom, Vignette } from '@react-three/postprocessing'
import { useThree } from '@react-three/fiber'
import {
  memo,
  useContext,
  useEffect,
  type ComponentProps,
  type MutableRefObject,
  type ReactElement,
} from 'react'
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
   * PRD 6.10.1's bloom setting, resolved to an intensity by `BLOOM_INTENSITY_STEPS`.
   *
   * A *setting*, not a tier: the ladder owns `bloomScale` (how many pixels the blur costs) and the
   * user owns this (how much of it is mixed back in). Defaults to the tuned value so the bench and
   * the Phase 2a harness, which have no settings surface, keep the intensity their baselines were
   * measured at.
   *
   * Changing it re-renders this component, and the `SelectiveBloom` wrapper reconstructs its effect
   * on any render it does see (review §2.2, R1) — so a click on the setting drops one set of bloom
   * render targets for the collector. That is a click, not a frame, and the wrapper is on its way
   * out (review §3.5); it is not a reason to leave the control dead.
   *
   * Since DEC-692 R1 this component is memoised, so the *only* renders the wrapper sees are a tier
   * change, a selection change, and a click on this setting. The cost above is unchanged — it was
   * always per-reconstruction — but it is no longer paid on an unrelated render of the canvas owner.
   */
  readonly bloomIntensity?: number
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
   * **What it costs, recorded (DEC-638/N7, corrected in Phase 6 — DEC-667 N6).**
   * `SelectiveBloomEffect` renders the scene a second time each frame to build its mask, and the
   * star field — 28,587 instanced points on the production roster — is in that second pass.
   *
   * **This is no longer recorded as a known miss against PRD 7.2's target.** The old
   * "p95 18.3–18.4 ms against a 16.7 ms target" came from `verify-browser.mjs`'s card-level sample
   * on a **60 Hz vsync**: that run reports p50 16.6 ms at 60.1 fps, so its p50 *is* the refresh
   * interval and its p95 is one vsync plus jitter. A frame-*interval* percentile on a vsync-locked
   * run measures the display, not the work — it cannot read below 16.7 ms however cheap the frame
   * is, so it could never have shown this pass meeting the target.
   *
   * Measured where the work is visible instead — `bench/baseline-2026-09-05.json`'s `card`
   * segment, 1920×1080, dpr 1.5, production roster, this effect active, a real card and its
   * printings focused:
   *
   *   - **uncapped: p50 1.2 ms, p95 2.8 ms** at 668 fps — what the frame actually costs;
   *   - vsync (120 Hz): p50 8.3 ms, p95 9.7 ms at 120 fps — inside the 16.7 ms target, and the run
   *     as a whole reports `meetsTarget: true`.
   *
   * The two figures were never inconsistent; they answer different questions. 18.4 ms is a 60 Hz
   * frame interval, 2.8 ms is the work inside it. The second pass is real but small.
   *
   * The design note stands, because the alternatives are unchanged and still not cheap: a
   * luminance-only global bloom, which is the washed-out card PRD 9.3 names, or a hand-written
   * two-camera mask pass.
   */
  readonly bloomSelection?: readonly Object3D[]
  /**
   * The live bloom effect, for the `?probe=1` seam only.
   *
   * PRD 9.1.4's forced-degradation check has to show that the *render target* shrank, not that the
   * `resolutionScale` prop was passed — `resolution.width` is a number the composer computed, and
   * a bug that dropped the prop on the floor would leave it unmoved. Nothing in the render path
   * reads this.
   */
  readonly bloomRef?: MutableRefObject<BloomProbe | null>
}

/**
 * Just enough of the bloom effect for {@link EffectsProps.bloomRef}.
 *
 * Two sizes, because they are not the same size and the difference is the whole of defect R3.
 * `resolution` is what the ladder *asked* for — `resolutionScale` applied to the drawing buffer —
 * and with `mipmapBlur` on it drives only `BloomEffect.renderTarget`, which nothing samples
 * (`postprocessing/build/index.js:3676`: the `map` uniform is the mipmap pass's texture when
 * `mipmapBlur` is set). `mipmapBlurPass` is the chain the frame actually runs, and
 * `BloomEffect.setSize` sizes it at the *full* drawing buffer whatever the scale says
 * (`index.js:3896-3899`). Reporting both is what stops `e2e/quality.spec.ts` from reading the
 * unused number and calling the rung covered.
 */
export interface BloomProbe {
  /** What the ladder asked for. Inert while `mipmapBlur` is on — see above. */
  readonly resolution: { readonly width: number; readonly height: number }
  /** The chain the composite samples. Its top level is half of what `setSize` was given. */
  readonly mipmapBlurPass: {
    readonly texture: { readonly image: { readonly width: number; readonly height: number } }
  }
}

/**
 * Both wrappers hand back an effect whose `resolution` is what we want, but neither ref type says
 * so: `Bloom`'s is `LegacyRef<typeof BloomEffect>` — the class, not an instance — and
 * `SelectiveBloom`'s is the narrower `SelectiveBloomEffect`. Casting to each component's own ref
 * type keeps the lie local and named rather than spreading `BloomEffect` through the probe.
 */
type BloomRef = ComponentProps<typeof Bloom>['ref']
type SelectiveBloomRef = ComponentProps<typeof SelectiveBloom>['ref']

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

/**
 * Resize the composer's own buffers when the pixel ratio moves (DEC-692 R2).
 *
 * `EffectComposer`'s wrapper sizes the composer from an effect keyed on R3F's `size`, which is the
 * canvas in *CSS* pixels and does not change when the ladder changes the pixel ratio. The composer
 * sizes its input and output buffers — the ones the scene is rendered into — from the *drawing*
 * buffer, so without this the first rung resizes the canvas and leaves the scene buffer at the
 * ratio that was in force when the composer mounted. That is the mismatch review §2.2 measured
 * from the other direction: a 1× scene buffer upscaled into a 1.5× canvas.
 *
 * `setSize()` with no arguments re-reads the renderer's current size and drawing buffer, so it is
 * exactly "resize to whatever is in force now". It runs once per tier change, inside a two-second
 * cooldown, and never on a plain re-render.
 *
 * A leaf rather than an effect in {@link Effects}: this has to re-render when `viewport.dpr` moves,
 * and `Effects` must not, or the memo above buys nothing.
 */
function ComposerSize(): null {
  const dpr = useThree((state) => state.viewport.dpr)
  const size = useThree((state) => state.size)
  const context = useContext(EffectComposerContext)
  const composer = context?.composer ?? null

  useEffect(() => {
    if (!composer) return
    // The same CSS size the wrapper's own effect passes; `setSize` re-reads the *drawing* buffer
    // itself, which is the part that has moved.
    composer.setSize(size.width, size.height)
  }, [composer, dpr, size.width, size.height])

  return null
}

export const Effects = memo(function Effects({
  bloomScale,
  bloomSelection,
  bloomRef,
  bloomIntensity = BLOOM_INTENSITY,
}: EffectsProps): ReactElement {
  const bloom =
    bloomSelection && bloomSelection.length > 0 ? (
      <SelectiveBloom
        // Keyed on the selection as well: `SelectiveBloomEffect` takes its selection at
        // construction, and the field's objects are built once `planes.json` lands.
        key={`selective-bloom-${bloomScale}-${bloomSelection.length}`}
        ref={bloomRef as unknown as SelectiveBloomRef}
        selection={bloomSelection as Object3D[]}
        lights={NO_LIGHTS}
        intensity={bloomIntensity}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
        resolutionScale={bloomScale}
        mipmapBlur
      />
    ) : (
      <Bloom
        key={`bloom-${bloomScale}`}
        ref={bloomRef as unknown as BloomRef}
        intensity={bloomIntensity}
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
      <ComposerSize />
    </EffectComposer>
  )
})
