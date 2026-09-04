/**
 * The Phase 2a harness: the star field, the effects, the bench harness, and the Phase 0 contract
 * panel.
 *
 * The camera here is a development orbit control, not the camera rig. PRD 5.7's tethered orbit,
 * the fly-to tween and the input hand-over are Phase 2b's, behind the navigation contract frozen
 * in Phase 0; this exists so the field can be looked at and benched on its own. Likewise the panel
 * below is Phase 0's contract self-test with the scene's own progress added — not PRD section 6's
 * HUD, which is Phase 4's.
 *
 * Phase 3 folded the field, the rig, the labels and the card tier into one scene
 * ({@link import('../scene/EternitiesScene').EternitiesScene}), which is what the app now renders.
 * This harness stayed behind for the two things that cannot run inside it: the bench flies the
 * scripted path of `bench/benchPath` and the GPU self-check freezes the field and reads pixels
 * back, and both of those drive the camera themselves, which they cannot do in a scene where the
 * rig is also flying it. `App` routes `?bench`, `?hold` and `?selfcheck` here; PRD 9.1.2's real
 * `/bench` route is Phase 6's, and that is where the two rejoin.
 */

import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { NoToneMapping, Vector3 } from 'three'

import {
  BenchRunner,
  benchHold,
  benchRequested,
  recordBenchCpu,
  type BenchResult,
} from '../bench/BenchRunner'
import { Effects } from '../scene/Effects'
import { sceneErrors, type SceneDataError } from '../scene/errors'
import type { PickResult } from '../scene/picking/scenePicker'
import { selfCheckRequested } from '../scene/selfCheck'
import { QUALITY_TIERS, type QualityTier } from '../scene/quality/adaptiveQuality'
import { StarScene, type StarSceneHandle } from '../scene/StarScene'
import { SKY_COLOUR } from '../scene/tuning'
import { useReducedMotion } from '../scene/useReducedMotion'
import { useSceneData } from '../scene/useSceneData'

export function Phase2aScene(): ReactElement {
  const data = useSceneData()
  const reducedMotion = useReducedMotion()
  const hold = benchHold()
  const bench = benchRequested() || hold !== null

  const [tier, setTier] = useState<{ tier: QualityTier; changes: number }>({
    tier: QUALITY_TIERS[0]!,
    changes: 0,
  })
  const [hover, setHover] = useState<PickResult>(null)
  const [selected, setSelected] = useState<PickResult>(null)
  const [toast, setToast] = useState<SceneDataError | null>(null)
  const [benchResult, setBenchResult] = useState<BenchResult | null>(null)
  const sceneRef = useRef<StarSceneHandle>(null)
  const focusPosition = useRef(new Vector3()).current
  const [focusText, setFocusText] = useState('')

  // PRD 7.4.1: the one non-blocking report per artefact. Phase 4 replaces this with the real toast.
  useEffect(() => sceneErrors.subscribe(setToast), [])

  const onQualityChange = useCallback((next: QualityTier) => {
    setTier((previous) => ({ tier: next, changes: previous.changes + 1 }))
  }, [])

  const onFrame = useCallback((_frameMs: number, cpuMs: number) => {
    recordBenchCpu(cpuMs)
  }, [])

  // PRD 8.5.7's CPU motion mirror, shown live. This is what Phase 2b's camera will tether to, and
  // reading it four times a second is a cheap standing check that it tracks the shader.
  useEffect(() => {
    if (selected?.kind !== 'star') {
      setFocusText('')
      return
    }
    const timer = window.setInterval(() => {
      if (sceneRef.current?.focusedStarPosition(focusPosition)) {
        setFocusText(
          `${focusPosition.x.toFixed(2)}, ${focusPosition.y.toFixed(2)}, ${focusPosition.z.toFixed(2)}`,
        )
      }
    }, 250)
    return () => {
      window.clearInterval(timer)
    }
  }, [selected, focusPosition])

  const planeName = (index: number): string =>
    data.planes?.planes.find((plane) => plane.index === index)?.displayName ?? `#${index}`

  return (
    <div className="app">
      <Canvas
        camera={{ position: [0, 150, 260], fov: 55, near: 0.1, far: 6000 }}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          // Only for the verification pass. Reading the canvas back with `toDataURL` after the
          // effect composer has presented gives an empty buffer otherwise, and preserving it on
          // every frame costs bandwidth nobody is paying for in production.
          preserveDrawingBuffer: selfCheckRequested(),
        }}
        // The scene is authored in linear light and the composer encodes on output; tone mapping
        // would only crush the star cores the bloom of PRD 5.3.20 exists to pick up.
        flat
        onCreated={({ gl }) => {
          gl.toneMapping = NoToneMapping
        }}
        // The adaptive-quality monitor takes the pixel ratio over from the first frame (PRD 8.5.11).
        dpr={QUALITY_TIERS[0]!.pixelRatioCap}
        style={{ background: SKY_COLOUR }}
      >
        <StarScene
          resources={data.resources}
          starsComplete={data.starsComplete}
          reducedMotion={reducedMotion}
          onHover={setHover}
          onSelect={setSelected}
          onQualityChange={onQualityChange}
          onFrame={onFrame}
          handleRef={sceneRef}
        />
        <Effects bloomScale={tier.tier.bloomScale} />
        {!bench && <OrbitControls makeDefault enableDamping dampingFactor={0.08} />}
        {bench && data.planes && data.resources && (
          <BenchRunner
            ready={data.starsComplete}
            context={{
              dataset: data.manifest?.dataset ?? 'unknown',
              stars: data.manifest?.counts.stars ?? 0,
              planes: data.planes.planes.length,
              positionMode: data.resources.positionMode,
              multiverseRadius: data.planes.multiverseRadius,
              table: data.resources.table,
            }}
            qualityTier={tier.tier.label}
            qualityChanges={tier.changes}
            hold={hold}
            onComplete={setBenchResult}
          />
        )}
      </Canvas>

      <div className="overlay" data-testid="phase0-status">
        <h1>Eternities — Phase 2a</h1>
        <p className="muted">
          Star field: one Points object, motion in the vertex shader (PRD 8.5.1-5). Drag to orbit,
          scroll to zoom, click a star or a plane.
        </p>
        <h2>Data contract</h2>
        {data.report.length === 0 ? (
          <p className="muted">decoding…</p>
        ) : (
          <ul className={data.ok ? 'ok' : 'bad'}>
            {data.report.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <h2>Scene</h2>
        <ul data-testid="scene-status">
          <li>
            drawable: {data.drawable} / {data.expected}
            {data.starsComplete ? ' (complete)' : ' (streaming)'}
          </li>
          <li>
            quality: {tier.tier.label} · pixel ratio ≤ {tier.tier.pixelRatioCap} · bloom{' '}
            {tier.tier.bloomScale} · {tier.changes} change{tier.changes === 1 ? '' : 's'}
          </li>
          <li>reduced motion: {String(reducedMotion)}</li>
          <li>
            hover:{' '}
            {hover === null
              ? '—'
              : hover.kind === 'star'
                ? `star ${hover.index} on ${planeName(hover.planeIndex)}`
                : `plane ${planeName(hover.index)}`}
          </li>
          <li>
            focus:{' '}
            {selected === null
              ? '—'
              : selected.kind === 'star'
                ? `star ${selected.index}${focusText ? ` at ${focusText}` : ''}`
                : `plane ${planeName(selected.index)}`}
          </li>
        </ul>
        {toast && (
          <p className="bad" data-testid="data-error">
            {toast.message}
          </p>
        )}
        {benchResult && (
          <p data-testid="bench-result" className={benchResult.meetsTarget ? 'ok' : 'bad'}>
            bench: {benchResult.fps} fps, p95 {benchResult.frameMsP95} ms, CPU p95{' '}
            {benchResult.cpuMsP95} ms
          </p>
        )}
      </div>
    </div>
  )
}
