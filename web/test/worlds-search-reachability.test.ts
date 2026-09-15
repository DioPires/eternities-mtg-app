/**
 * §1.11's conformance basis, pinned (DEC-751).
 *
 * > **R3 pins that as a test — every world slug in the roster is a reachable search hit — and the
 * > pin is a release requirement, not a nicety**, because it is the only part of this section that
 * > is a conformance argument.
 *
 * **Why this is load-bearing and not a smoke test.** §1.11's 24 CSS px pick floor is a *proxy*
 * floor, not a target floor: floored proxies overlap, the nearer disk takes the pixels, and §1.11
 * records as residual exposure that 19 of the 33 worlds the floor lifts fall under 24 px of
 * effective diameter at some azimuth, with 2 worlds pushed *below* 24 px that cleared it as drawn.
 * So the product does **not** conform to WCAG 2.5.8 by hitting a 24 px target. It conforms through
 * the criterion's **Equivalent** exception — every plane is reachable by name through a full-size
 * control that meets 2.5.8 on its own — and that exception is a claim about *this* index. If a
 * world drops out of the search path, the pick floor does not become the conformance story; the
 * product simply stops conforming, and nothing on screen changes.
 *
 * Run against the shipped `search.json` through the shipped `search()`, not against a fixture: a
 * synthetic three-plane index (which is what `search.test.ts` builds, correctly, for the ranking
 * rules) cannot answer a question about the roster.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildSearchIndex, search, RESULTS_PER_GROUP } from '../src/search'
import type { SearchFile } from '../src/data/types'
import { worldPlanesOf } from '../src/scene/worlds/worldSource'
import type { PlanesFile } from '../src/data/types'

const DATA = resolve(__dirname, '../public/data')

function datasetDir(role: string): string {
  const roles = JSON.parse(readFileSync(resolve(__dirname, '../datasets.json'), 'utf8')) as Record<
    string,
    string
  >
  return resolve(DATA, roles[role]!)
}

const ROOT = datasetDir('worlds')
const PLANES = JSON.parse(readFileSync(resolve(ROOT, 'planes.json'), 'utf8')) as PlanesFile
const SEARCH = JSON.parse(readFileSync(resolve(ROOT, 'search.json'), 'utf8')) as SearchFile
const INDEX = buildSearchIndex(SEARCH)
const WORLDS = worldPlanesOf(PLANES.planes)

/** The display name `search.json` carries for a slug — what a person would actually type. */
function nameOf(slug: string): string {
  const plane = SEARCH.planes.find((p) => p.slug === slug)
  if (!plane) throw new Error(`${slug} is not in search.json at all`)
  return plane.name
}

describe('§1.11 every world is reachable by name (WCAG 2.5.8 Equivalent)', () => {
  it('measures the roster it claims to, on a v3 dataset', () => {
    // Fails loudly rather than vacuously passing over an empty roster — "none found" and "I could
    // not look" must not print the same.
    expect(WORLDS.length).toBe(45)
    expect(SEARCH.planes.length).toBeGreaterThanOrEqual(WORLDS.length)
  })

  it('indexes every world as a plane hit carrying its own slug', () => {
    const indexed = new Set(SEARCH.planes.map((plane) => plane.slug))
    const missing = WORLDS.filter((world) => !indexed.has(world.slug)).map((w) => w.slug)
    // Listed, not counted: a release-blocking failure should name the worlds that fell out.
    expect(missing).toEqual([])
  })

  it('returns each world for its own name, as a plane, at the top of its group', () => {
    const unreachable: string[] = []
    const notFirst: string[] = []

    for (const world of WORLDS) {
      const hits = search(INDEX, nameOf(world.slug))
      const planes = hits.planes
      const at = planes.findIndex((hit) => hit.slug === world.slug)
      if (at < 0) {
        unreachable.push(world.slug)
        continue
      }
      // Reachable is the conformance claim; first is the usability one. A world that ranks below
      // eight others for its own exact name is reachable only by scrolling a listbox, so it is
      // worth separating the two rather than asserting only the weaker of them.
      if (at !== 0) notFirst.push(`${world.slug}@${at}`)
      expect(planes[at]!.kind).toBe('plane')
    }

    expect(unreachable).toEqual([])
    expect(notFirst).toEqual([])
  })

  it('is not satisfied by the group budget alone', () => {
    // The guard on the guard. `searchPlanes` returns at most RESULTS_PER_GROUP hits, so if the
    // roster were small enough to fit in one group every query would return every world and the
    // test above would pass without the *matching* doing anything. 45 > 8, so a world appearing
    // for its own name is a statement about the match rather than about the budget.
    expect(WORLDS.length).toBeGreaterThan(RESULTS_PER_GROUP)

    // And the negative control: a query that matches no world must not return one. Without this,
    // an index that returned all 45 planes for every input would score the suite above green.
    const nonsense = search(INDEX, 'zzzzqqqxvw')
    expect(nonsense.planes).toEqual([])
  })

  it('reaches the worlds whose pick target §1.11 records as short', () => {
    // The two worlds the floor itself pushes *below* 24 px of effective diameter (§1.11's residual
    // exposure). They are the cases where the Equivalent exception is doing the real work, so they
    // are named here rather than left to the sweep above — if the roster is ever trimmed, a
    // failure on these two should read as the conformance regression it is.
    for (const slug of ['eldraine', 'kamigawa']) {
      const world = WORLDS.find((w) => w.slug === slug)
      expect(world, `${slug} left the roster`).toBeDefined()
      const hits = search(INDEX, nameOf(slug))
      expect(hits.planes.map((hit) => hit.slug)).toContain(slug)
    }
  })
})
