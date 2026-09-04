/**
 * Phase 0's app: the hello-scene, plus a small panel that proves both fixtures decode in the
 * browser and the navigation stub answers a real caller. Phase 4 replaces all of this.
 */

import { Canvas } from '@react-three/fiber'
import { useEffect, useState, type ReactElement } from 'react'

import {
  BLIND_ETERNITIES_SLUG,
  dataRoot,
  loadManifest,
  loadPlaneShard,
  loadPlanes,
  loadSearch,
  loadSets,
  streamStars,
  type Manifest,
} from './data'
import { createNavigationStub, levelOf, type NavigationSnapshot } from './navigation'
import { HelloScene, SKY_COLOUR } from './scene/HelloScene'

interface DecodeReport {
  readonly lines: string[]
  readonly ok: boolean
}

async function decodeEverything(): Promise<DecodeReport> {
  const lines: string[] = []
  try {
    const root = dataRoot()
    lines.push(`data directory ${root}`)

    const manifest: Manifest = await loadManifest()
    lines.push(
      `manifest: ${manifest.dataset}, contract v${manifest.contractVersion}, ` +
        `${manifest.counts.stars} stars, ${manifest.counts.planes} planes`,
    )

    const planes = await loadPlanes()
    lines.push(`planes.json: ${planes.planes.length} rows, R = ${planes.multiverseRadius}`)

    let lastProgress = 0
    const stars = await streamStars((reader) => {
      lastProgress = reader.completeRecords
    })
    lines.push(
      `stars.bin: streamed ${stars.count} records (last draw range ${lastProgress}), ` +
        `star 0 at ${stars.x(0).toFixed(4)}, ${stars.y(0).toFixed(4)}, ${stars.z(0).toFixed(4)}`,
    )

    const [search, sets] = await Promise.all([loadSearch(), loadSets()])
    lines.push(`search.json: ${search.cardNames.length} names, ${search.sets.length} sets`)
    const oracleId = sets.oracleId(0)
    lines.push(
      `sets.bin: star 0 is ${oracleId}, resolves back to index ${sets.starIndexOf(oracleId)}, ` +
        `${sets.setIdsOf(0).length} set id(s)`,
    )

    const blind = planes.planes.find((p) => p.slug === BLIND_ETERNITIES_SLUG)
    if (blind) {
      const shard = await loadPlaneShard(blind.slug, blind.shardCount - 1)
      lines.push(
        `plane shard ${blind.slug}.${shard.shard}: ${shard.cards.length} cards ` +
          `(of ${blind.shardCount} shards)`,
      )
    }
    return { lines, ok: true }
  } catch (error) {
    lines.push(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return { lines, ok: false }
  }
}

export function App(): ReactElement {
  const [report, setReport] = useState<DecodeReport | null>(null)
  const [nav, setNav] = useState<NavigationSnapshot | null>(null)

  useEffect(() => {
    void decodeEverything().then(setReport)
  }, [])

  useEffect(() => {
    const stub = createNavigationStub()
    const unsubscribe = stub.subscribe(setNav)
    setNav(stub.snapshot())
    void stub.flyToPlane('dominaria', { reason: 'user', immediate: true }).done
    return () => {
      unsubscribe()
      stub.dispose()
    }
  }, [])

  return (
    <div className="app">
      <Canvas
        camera={{ position: [0, 40, 140], fov: 55, near: 0.1, far: 4000 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: SKY_COLOUR }}
      >
        <HelloScene />
      </Canvas>

      <div className="overlay" data-testid="phase0-status">
        <h1>Eternities — Phase 0</h1>
        <p className="muted">
          Hello-scene: sky and the three-layer parallax background starfield (PRD 5.3.18).
        </p>
        <h2>Data contract</h2>
        {report === null ? (
          <p className="muted">decoding…</p>
        ) : (
          <ul className={report.ok ? 'ok' : 'bad'}>
            {report.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <h2>Navigation contract</h2>
        {nav === null ? (
          <p className="muted">…</p>
        ) : (
          <ul>
            <li>
              focus: {nav.focus.kind}
              {nav.focus.kind === 'plane' ? ` (${nav.focus.slug})` : ''} · level {levelOf(nav.focus)}
            </li>
            <li>flight: {nav.flight ? `#${nav.flight.id}` : 'idle'}</li>
            <li>
              attract: {String(nav.attract)} · reduced motion: {String(nav.reducedMotion)}
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
