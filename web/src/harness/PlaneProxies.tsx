/**
 * Plane glows — a **placeholder**, and deliberately a thin one.
 *
 * PRD 8.7.2 says plane glows and labels appear as soon as `planes.json` lands, before `stars.bin`
 * has streamed. That much is genuinely Phase 2b's: the camera has to have something to fly to and
 * the labels something to hang off, and both are needed for PRD 9.3's checkpoints 1, 2 and 7.
 *
 * Everything past that glow is Phase 2a's (DEC-587): the single-`Points` star renderer, the
 * per-plane `DataTexture`, the in-shader motion of PRD 8.5.3, the dust, selective bloom. When that
 * lands this component is deleted, not extended — it exists so that Phase 2b could be built and
 * reviewed against the real Appendix A roster while 2a was being written in parallel, and it holds
 * no requirement of its own.
 *
 * It does share one thing with the real renderer, on purpose: positions come from `SceneMotion`,
 * the same CPU mirror the camera tether uses (PRD 8.5.7). So the glow a user clicks and the point
 * the camera flies to are the same point, drift and multiverse rotation included.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactElement } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Points as ThreePoints,
} from 'three'

import type { CameraRig } from '../camera/rig'
import { vec } from '../camera/vec'
import { BLIND_ETERNITIES_SLUG } from '../data/types'

export interface PlaneProxiesProps {
  readonly rig: CameraRig
  readonly focusedSlug: string | null
}

export function PlaneProxies({ rig, focusedSlug }: PlaneProxiesProps): ReactElement {
  const points = useRef<ThreePoints>(null)
  const planes = rig.motion.planes

  const { geometry, positions, colours, sizes } = useMemo(() => {
    // The dust row has no centre to draw; PRD 5.3.4 makes it a scatter, which is 2a's.
    const drawn = planes.filter((p) => p.slug !== BLIND_ETERNITIES_SLUG)
    const positions = new Float32Array(drawn.length * 3)
    const colours = new Float32Array(drawn.length * 3)
    const sizes = new Float32Array(drawn.length)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('color', new BufferAttribute(colours, 3))
    return { geometry, positions, colours, sizes, drawn }
  }, [planes])

  const drawn = useMemo(
    () => planes.filter((p) => p.slug !== BLIND_ETERNITIES_SLUG),
    [planes],
  )

  const scratch = useMemo(() => vec(), [])

  useFrame(() => {
    for (let i = 0; i < drawn.length; i += 1) {
      const plane = drawn[i]!
      rig.motion.planePosition(scratch, plane)
      positions[i * 3] = scratch.x
      positions[i * 3 + 1] = scratch.y
      positions[i * 3 + 2] = scratch.z
      // PRD 5.3.5's nebula tint, brightened while focused (PRD 6.1.4's hover raise is Phase 4's).
      const gain = plane.slug === focusedSlug ? 1.6 : plane.cardCount === 0 ? 0.35 : 1
      colours[i * 3] = Math.min(1, plane.nebulaTint[0] * gain)
      colours[i * 3 + 1] = Math.min(1, plane.nebulaTint[1] * gain)
      colours[i * 3 + 2] = Math.min(1, plane.nebulaTint[2] * gain)
      sizes[i] = plane.radius
    }
    const geo = points.current?.geometry
    if (geo) {
      geo.getAttribute('position').needsUpdate = true
      geo.getAttribute('color').needsUpdate = true
    }
  })

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={5}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  )
}
