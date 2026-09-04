/**
 * The Phase 2b harness: the navigation contract, driving a real camera over the real roster.
 *
 * This is what makes the phase's exit criterion checkable by a person rather than only by a test —
 * "multiverse and plane levels navigable end to end on fixture-scale" — and what PRD 9.3's
 * checkpoints 1, 2, 6 and 7 are captured from. The parts that are Phase 2b's own are the camera rig,
 * the labels, the plane-detail loading and the reduced-motion handling. The plane glows and the
 * click picking are placeholders that Phase 2a (DEC-587) replaces; the HUD, the router, the search
 * and the panels are Phase 4's (DEC-589), and this shows the two or three controls needed to fly
 * the camera and nothing more.
 */

import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import { CameraRigController } from '../camera/CameraRigController'
import {
  BLIND_ETERNITIES_SLUG,
  dataRoot,
  loadPlanes,
  type PlanesFile,
  type PlaneShardFile,
} from '../data'
import { PlaneLabels } from '../labels/PlaneLabels'
import { Projector } from '../labels/project'
import { createSceneNavigation, type SceneNavigation } from '../navigation/scene'
import type { NavigationSnapshot } from '../navigation/types'
import { createPlaneDetailLoader, type PlaneDetailLoader } from '../plane-detail/client'
import { HelloScene, SKY_COLOUR } from '../scene/HelloScene'

import { CameraReadout } from './CameraReadout'
import { pickPlane } from './pick'
import { PlaneProxies } from './PlaneProxies'

const FOV = 55

/** PRD 5.9: the OS preference is the default; PRD 6.10.1's toggle is Phase 4's. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => {
      setReduced(query.matches)
    }
    query.addEventListener('change', onChange)
    return () => {
      query.removeEventListener('change', onChange)
    }
  }, [])
  return reduced
}

export function Phase2bScene(): ReactElement {
  const [planes, setPlanes] = useState<PlanesFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<NavigationSnapshot | null>(null)
  const [detail, setDetail] = useState<{ slug: string; cards: number; shards: number } | null>(null)
  const reducedMotion = usePrefersReducedMotion()

  const sceneRef = useRef<SceneNavigation | null>(null)
  const loaderRef = useRef<PlaneDetailLoader | null>(null)
  const projector = useMemo(() => new Projector(), [])

  useEffect(() => {
    let cancelled = false
    loadPlanes()
      .then((file) => {
        if (!cancelled) setPlanes(file)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The scene is built once `planes.json` lands, and lives for the session.
  const reducedMotionAtBuild = useRef(reducedMotion)
  const scene = useMemo(() => {
    if (!planes) return null
    // The frame loop is R3F's: `CameraRigController` calls `rig.update(delta)` from `useFrame`, so
    // the camera shares the renderer's clock rather than running a second one beside it.
    const built = createSceneNavigation(planes, {
      drive: 'manual',
      reducedMotion: reducedMotionAtBuild.current,
    })
    sceneRef.current = built
    return built
    // Keyed on `planes` alone on purpose. `reducedMotion` is read once for the initial state and
    // applied thereafter through `setReducedMotion` in the effect below: rebuilding the scene when
    // the OS preference flips would throw the camera's position, its focus and its history away.
  }, [planes])

  useEffect(() => () => sceneRef.current?.api.dispose(), [])

  useEffect(() => {
    if (!scene) return
    const unsubscribe = scene.api.subscribe(setSnapshot)
    setSnapshot(scene.api.snapshot())
    // PRD 6.8.2: the intro plays once per session, into the target. With no router yet (Phase 4)
    // the target is the home view.
    scene.api.playIntro({ kind: 'multiverse' }, { reason: 'intro' })
    return unsubscribe
  }, [scene])

  useEffect(() => {
    scene?.api.setReducedMotion(reducedMotion)
  }, [scene, reducedMotion])

  // PRD 8.7.6 / amendment A1: plane detail is requested the moment a plane becomes focus, and
  // parsed in a worker so a multi-megabyte Blind Eternities shard never blocks the fly-to.
  useEffect(() => {
    if (!planes) return
    const loader = createPlaneDetailLoader({ root: dataRoot() })
    loaderRef.current = loader
    return () => {
      loader.dispose()
      loaderRef.current = null
    }
  }, [planes])

  const focus = snapshot?.focus
  const focusedSlug =
    focus === undefined
      ? null
      : focus.kind === 'plane'
        ? focus.slug
        : focus.kind === 'card'
          ? focus.planeSlug
          : null

  useEffect(() => {
    const loader = loaderRef.current
    if (!loader || !planes || focusedSlug === null) return
    const plane = planes.planes.find((p) => p.slug === focusedSlug)
    if (!plane) return
    let cards = 0
    setDetail({ slug: plane.slug, cards: 0, shards: 0 })
    let shards = 0
    loader.load(plane.slug, plane.shardCount, {
      onShard: (file: PlaneShardFile) => {
        cards += file.cards.length
        shards += 1
        setDetail({ slug: plane.slug, cards, shards })
      },
      onError: (message) => {
        // PRD 7.4.1's single non-blocking report. Phase 4 owns the toast.
        console.warn(`plane detail: ${message}`)
      },
    })
    return () => {
      loader.cancel()
    }
  }, [focusedSlug, planes])

  const onClick = useCallback(
    (x: number, y: number) => {
      const built = sceneRef.current
      if (!built) return
      projector.update({
        position: built.rig.position,
        target: built.rig.lookAt,
        fov: (FOV * Math.PI) / 180,
        near: 0.1,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })
      const plane = pickPlane(x, y, built.rig, projector)
      // PRD 5.7.2: clicking a plane sets the new focus and triggers a fly-to.
      if (plane) built.api.flyToPlane(plane.slug, { reason: 'user' })
    },
    [projector],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const built = sceneRef.current
      if (!built) return
      if (event.key === 'Escape') {
        // PRD 6.1.3: Esc sets focus to the parent, and does nothing at multiverse level.
        built.api.focusParent({ reason: 'history' })
      } else if (event.key === 'a' || event.key === 'A') {
        // PRD 5.3.22's 45 s idle timer belongs to Phase 4 (navigation contract §6); this is how
        // the drift gets reviewed before that lands.
        const state = built.api.snapshot()
        if (state.attract) built.api.exitAttract('keyboard')
        else built.api.enterAttract()
      } else if (event.key === 'b' || event.key === 'B') {
        built.api.flyToBlindEternities(undefined, { reason: 'user' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div className="app">
      <Canvas
        camera={{ position: [0, 90, 260], fov: FOV, near: 0.1, far: 8000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: SKY_COLOUR }}
      >
        <HelloScene />
        {scene && (
          <>
            <PlaneProxies rig={scene.rig} focusedSlug={focusedSlug} />
            <CameraRigController rig={scene.rig} nav={scene.api} onClick={onClick} />
          </>
        )}
      </Canvas>

      {scene && planes && (
        <PlaneLabels
          planes={planes}
          rig={scene.rig}
          focusedPlaneSlug={focusedSlug}
          level={snapshot?.level ?? 'multiverse'}
          fov={FOV}
        />
      )}

      <div className="overlay" data-testid="phase2b-status">
        <h1>Eternities — Phase 2b</h1>
        <p className="muted">
          Drag to orbit · scroll to zoom · click a plane to fly · Esc to go back · <kbd>b</kbd> the
          Blind Eternities · <kbd>a</kbd> attract mode
        </p>
        {error !== null && <p className="bad">planes.json failed: {error}</p>}
        {snapshot && (
          <ul>
            <li>
              focus: {snapshot.focus.kind}
              {focusedSlug !== null ? ` (${focusedSlug})` : ''} · level {snapshot.level}
            </li>
            <li>
              flight: {snapshot.flight ? `#${snapshot.flight.id}` : 'idle'} · attract{' '}
              {String(snapshot.attract)} · reduced motion {String(snapshot.reducedMotion)}
            </li>
            {scene && <CameraReadout rig={scene.rig} />}
            <li>
              detail:{' '}
              {detail === null
                ? '—'
                : `${detail.slug} ${detail.cards} cards over ${detail.shards} shard(s)` +
                  (detail.slug === BLIND_ETERNITIES_SLUG ? ' (sharded, worker-parsed)' : '')}
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
