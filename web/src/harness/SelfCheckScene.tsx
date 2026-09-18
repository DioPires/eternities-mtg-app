/**
 * The host for the GPU self-check (PRD 8.5.7), and nothing else.
 *
 * The self-check is the only GLSL-versus-CPU parity check in the tree, and §9's Windows protocol
 * runs it, so it outlived the Phase 2a harness it used to live inside. What it needs is a still
 * field over a *fixed* camera: it freezes the motion clock and reads pixels back, which it cannot
 * do in a scene where the rig or the bench is flying the camera. `App` routes `?selfcheck` here.
 *
 * **The camera is fixed because nothing attaches a rig, not because a prop says so.** Its numbers
 * are load-bearing — `scene/selfCheck.ts` derives its star-depth band from `[0, 150, 260]` at `fov`
 * 55 with a 6000 far plane — and all four now come from one place: the renderer's own constants and
 * `SELF_CHECK_FAR`, which `createServices` passes when the URL asks for this route. This component
 * never calls `setNavigation`, so the `rig` phase has no subscriber and the camera stays where the
 * renderer put it. Do not tune them.
 *
 * The status panel is not decoration: `scripts/verify-browser.mjs` reads `phase0-status` and
 * `phase0-scene-state` for the a11y and CSP gate, which has no other home until T3 ports it to
 * `e2e/`. It goes when that script does (review §6.1 group C).
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Vector3 } from 'three'

import { useReducedMotion } from '../app/hooks'
import { useSceneHost } from '../app/services'
import { sceneErrors, type SceneDataError } from '../scene/errors'
import { motionOverride } from '../scene/motionOverride'
import type { PickResult } from '../scene/picking/scenePicker'
import { QUALITY_TIERS, type QualityTier } from '../scene/quality/adaptiveQuality'
import { useSceneData } from '../scene/useSceneData'

export function SelfCheckScene(): ReactElement {
  const data = useSceneData()
  const host = useSceneHost()
  // PRD 5.9's one resolution, with `?motion=` over it — §9's Windows protocol holds the field
  // still to read pixels back against the CPU mirror. See `../scene/motionOverride`.
  const resolved = useReducedMotion()
  const reducedMotion = motionOverride() ?? resolved

  const canvasSlot = useRef<HTMLDivElement>(null)
  const [tier, setTier] = useState<{ tier: QualityTier; changes: number }>(() => ({
    tier: QUALITY_TIERS[0]!,
    changes: 0,
  }))
  const [hover, setHover] = useState<PickResult>(null)
  const [selected, setSelected] = useState<PickResult>(null)
  const [toast, setToast] = useState<SceneDataError | null>(null)
  const focusPosition = useRef(new Vector3()).current
  const [focusText, setFocusText] = useState('')

  // PRD 7.4.1: the one non-blocking report per artefact.
  useEffect(() => sceneErrors.subscribe(setToast), [])

  useEffect(() => {
    const slot = canvasSlot.current
    if (!slot) return
    host.mount(slot)
    return () => {
      host.unmount()
    }
  }, [host])

  useEffect(() => {
    host.setResources(data.resources)
  }, [host, data.resources])

  useEffect(() => {
    host.setStarsComplete(data.starsComplete)
  }, [host, data.starsComplete])

  useEffect(() => {
    host.setReducedMotion(reducedMotion)
  }, [host, reducedMotion])

  useEffect(() => host.hovered.add(setHover), [host])
  useEffect(() => host.selected.add(setSelected), [host])
  useEffect(
    () => host.quality.add(({ tier: next, changes }) => setTier({ tier: next, changes })),
    [host],
  )

  // PRD 8.5.7's CPU motion mirror, shown live — the same quantity the self-check compares against
  // the shader, so a reader can see it track before the check reports.
  useEffect(() => {
    if (selected?.kind !== 'star') {
      setFocusText('')
      return
    }
    const timer = window.setInterval(() => {
      if (host.sceneFrame.focusedStarPosition(focusPosition)) {
        setFocusText(
          `${focusPosition.x.toFixed(2)}, ${focusPosition.y.toFixed(2)}, ${focusPosition.z.toFixed(2)}`,
        )
      }
    }, 250)
    return () => {
      window.clearInterval(timer)
    }
  }, [selected, focusPosition, host])

  const planeName = (index: number): string =>
    data.planes?.planes.find((plane) => plane.index === index)?.displayName ?? `#${index}`

  return (
    <div className="app">
      <div className="canvas-slot" ref={canvasSlot} />

      <div className="scene-status" data-testid="phase0-status">
        <h1>Eternities — GPU self-check</h1>
        <p className="muted">
          Star field: one Points object, motion in the vertex shader (PRD 8.5.1-5). The check
          freezes the clock and compares the rasterised positions against the CPU mirror.
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
        {/* Not `scene-status`: that reads like the panel, and the panel is the `.scene-status`
            element two levels up. This is the Scene section's list inside it. */}
        <ul data-testid="phase0-scene-state">
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
      </div>
    </div>
  )
}
