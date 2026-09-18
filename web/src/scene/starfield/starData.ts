/**
 * The star **data** layer, built without reference to the galaxy's objects (DEC-852).
 *
 * `PlaneTable` and `StarGeometry` are the two things the worlds build actually runs on: §1.10's
 * printing ring reads the buffer every tick (`localPosition`, `planeRowOf`, `hueClassOf`), §1.3's
 * world spin comes off the table (`sceneHost.ts` → `setSpinAngles`), the probe's `multiverseAngle`
 * — W5's whole sweep parameter — is a table field, and PRD 8.5.6's pick resolves against both.
 *
 * They were already their own files. What they were not was their own *construction*: they were
 * built in `useSceneData` in the same four statements as `createStarField` and the nebula lookup,
 * so "build the star data" and "build the galaxy" were one act. Worlds spec §3.2 deletes the second
 * of those; this separates them first, so that deletion is two lines and two imports in
 * `useSceneData` rather than an untangling under a cutover commit that is already atomic with a
 * dataset switch.
 *
 * **Nothing here imports `starFieldObjects` or `nebulaTexture`, and that is the whole point.** The
 * galaxy is layered on top of this by its caller, never mixed into it.
 */

import type { PlanesFile } from '../../data/types'
import { resolvePositionMode, type PositionMode } from '../platform/positionMode'

import { PlaneTable } from './planeTable'
import { StarGeometry } from './starGeometry'

export interface StarData {
  readonly table: PlaneTable
  readonly geometry: StarGeometry
  readonly positionMode: PositionMode
  /** Both buffers, in the order `useSceneData`'s disposer used to release them. */
  dispose: () => void
}

/**
 * PRD 8.7.2: the roster is enough to draw with, so this happens the moment `planes.json` lands and
 * the stars arrive into it. Zero-card planes are complete at this point (PRD 5.3.6), which is what
 * `revealEmptyPlanes` records.
 */
export function createStarData(planes: PlanesFile, starCount: number): StarData {
  const positionMode = resolvePositionMode()
  const table = new PlaneTable(planes.planes, planes.multiverseRadius)
  const geometry = new StarGeometry(starCount, positionMode)
  table.revealEmptyPlanes()
  return {
    table,
    geometry,
    positionMode,
    dispose: () => {
      geometry.dispose()
      table.dispose()
    },
  }
}
