/**
 * The Phase 0 hello-scene: the near-black sky and the three-layer parallax background starfield
 * of PRD 5.3.18, and nothing else. It is what proves the whole chain works — Vercel preview,
 * the real CSP, WebGL2 — before Phase 2a starts on the star renderer.
 *
 * Deliberately small: no plane data, no picking, no bloom. PRD 8.7.1 says the sky and the
 * background starfield render on the first frame, so this is the first frame.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactElement } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  type Points as ThreePoints,
} from 'three'

/** PRD 5.3.18: near-black, never pure black. */
export const SKY_COLOUR = '#05060a'

/** PRD 5.3.13: the whole multiverse rotates about its vertical axis, 20-minute period. */
const MULTIVERSE_PERIOD_S = 20 * 60

interface LayerSpec {
  readonly count: number
  readonly radius: number
  readonly size: number
  readonly opacity: number
  /** Relative rotation rate, so the three layers read as distinct depths. */
  readonly parallax: number
  readonly tint: string
}

const LAYERS: readonly LayerSpec[] = [
  { count: 2600, radius: 900, size: 1.7, opacity: 0.85, parallax: 1.0, tint: '#cfd8ff' },
  { count: 1800, radius: 1400, size: 1.3, opacity: 0.55, parallax: 0.55, tint: '#aab6e8' },
  { count: 1200, radius: 2000, size: 1.0, opacity: 0.32, parallax: 0.28, tint: '#8f9ac4' },
]

/**
 * Deterministic scatter, so the background is identical for every user of a build — the same
 * promise PRD 5.3.1 makes about plane placement. No `Math.random`.
 */
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function shellPositions(count: number, radius: number, seed: number): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    // Uniform on a sphere: acos keeps the poles from bunching.
    const u = seededUnit(seed + i * 3)
    const v = seededUnit(seed + i * 3 + 1)
    const jitter = 0.85 + 0.3 * seededUnit(seed + i * 3 + 2)
    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)
    const r = radius * jitter
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.cos(phi)
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  return positions
}

function BackgroundLayer({ spec, seed }: { spec: LayerSpec; seed: number }): ReactElement {
  const ref = useRef<ThreePoints>(null)

  // Geometry is built once and reused; PRD 7.3.2 forbids per-frame allocation.
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(shellPositions(spec.count, spec.radius, seed), 3))
    return g
  }, [spec.count, spec.radius, seed])

  const colour = useMemo(() => new Color(spec.tint), [spec.tint])

  useFrame((_, delta) => {
    // PRD 5.3.17: delta-time based, so it looks identical at 30, 60 and 120 fps.
    if (ref.current) {
      ref.current.rotation.y += ((2 * Math.PI) / MULTIVERSE_PERIOD_S) * spec.parallax * delta
    }
  })

  return (
    <points ref={ref} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={spec.size}
        sizeAttenuation={false}
        color={colour}
        transparent
        opacity={spec.opacity}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  )
}

export function HelloScene(): ReactElement {
  return (
    <>
      <color attach="background" args={[SKY_COLOUR]} />
      {LAYERS.map((spec, i) => (
        <BackgroundLayer key={spec.radius} spec={spec} seed={(i + 1) * 1013} />
      ))}
    </>
  )
}
