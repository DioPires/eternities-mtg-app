/**
 * The swatch gate's predicate, against every dataset this repo actually ships (§2.2; DEC-794).
 *
 * `useSceneData` decides whether to fetch `swatches.bin` before it has any way to find out
 * empirically, so the decision rests entirely on {@link publishesSwatches} being right about a
 * dataset it has only read the manifest of. That is a claim about the *emitter*, and a claim about
 * an emitter cannot be checked against a fixture this file wrote itself — so every row below reads
 * a committed `manifest.json` and checks its answer against the bytes on disk beside it.
 *
 * The predicate this replaced (`rowCells` on some plane, §2.4) passes a test written this way too,
 * on the datasets it was written against. What it fails is the *cross-check* — and DEC-796 has
 * since taken the corpus half of that cross-check away, deliberately: the fixtures were the
 * datasets on which "has geometry" and "publishes swatches" came apart, and giving them swatches is
 * exactly what lets CI's build compose a worlds roster at all (DEC-788, DEC-793). So no committed
 * dataset separates the two predicates any more, and the per-dataset rows below no longer catch a
 * gate that answers from `contractVersion` instead of `files`. The last two rows carry that weight
 * now, by striking a real manifest's swatch entry rather than by waiting for a dataset that
 * disagrees to be checked out.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SWATCHES_FILE, isWorldPlane, publishesSwatches } from '../src/data/types'
import type { Manifest, PlaneRecord, PlanesFile } from '../src/data/types'

const DATA = resolve(__dirname, '../public/data')

interface Dataset {
  readonly hash: string
  readonly manifest: Manifest
  readonly planes: readonly PlaneRecord[]
  /** The file is either beside the manifest or it is not; nothing here asks the network. */
  readonly onDisk: boolean
}

function readJson<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(resolve(...parts), 'utf8')) as T
}

const datasets: readonly Dataset[] = readdirSync(DATA)
  .filter((entry) => existsSync(resolve(DATA, entry, 'manifest.json')))
  .map((hash) => ({
    hash,
    manifest: readJson<Manifest>(DATA, hash, 'manifest.json'),
    planes: readJson<PlanesFile>(DATA, hash, 'planes.json').planes,
    onDisk: existsSync(resolve(DATA, hash, SWATCHES_FILE)),
  }))

describe('publishesSwatches', () => {
  // Guards every row below: with no datasets checked out, `it.each` over an empty array is a
  // green suite that asserted nothing at all.
  it('has the four committed datasets to read', () => {
    expect(datasets.map((dataset) => dataset.manifest.dataset).sort()).toEqual([
      'fixture-scale',
      'fixture-small',
      'production',
      'production',
    ])
  })

  it.each(datasets)(
    '$manifest.dataset ($hash, contract v$manifest.contractVersion): the manifest agrees with the bytes',
    ({ manifest, onDisk, hash }) => {
      expect(
        publishesSwatches(manifest),
        onDisk
          ? `${hash} has a ${SWATCHES_FILE} on disk that its manifest does not list — the gate ` +
              'will skip the fetch and no world will ever compose on this dataset'
          : `${hash} lists a ${SWATCHES_FILE} its own directory does not contain — the gate will ` +
              'fetch a file that cannot be served',
      ).toBe(onDisk)

      // The other half of what the runtime asks: what the manifest lists, the loader can name.
      const listed = manifest.files.filter((file) => file.path === SWATCHES_FILE)
      expect(listed.length).toBe(onDisk ? 1 : 0)
    },
  )

  it('is not the `rowCells` test in disguise — struck of its swatch entry, every dataset separates', () => {
    // This row was written against a corpus where the two fixtures carried §2.4 geometry and
    // published no swatches, so the corpus itself separated the two predicates and the check was a
    // filter over it. DEC-796 took that separation away on purpose: a fixture with no `swatches.bin`
    // can never compose a worlds roster, so CI's `ETERNITIES_DATASET=scale` build left every worlds
    // surface skipping (DEC-788, DEC-793), and both fixtures now invent a swatch per card. Today no
    // committed dataset disagrees — v3 publishes swatches and carries geometry, v2 has neither.
    //
    // The property is worth more than the corpus that happened to demonstrate it, so it is rebuilt
    // here from the real manifests rather than pinned to them: strike the swatch entry and a
    // dataset becomes exactly the shape DEC-788 found — §2.4 geometry, no `swatches.bin` — on which
    // a correct predicate must say "no" while `rowCells` still says "yes". That binds per dataset
    // instead of relying on one being checked out, and it is what the corpus can no longer do:
    // measured on this tree, replacing the predicate with `contractVersion >= 3` leaves every
    // per-dataset row above green, where before DEC-796 it turned both fixture rows red.
    const publishing = datasets.filter(
      (dataset) => publishesSwatches(dataset.manifest) && dataset.planes.some(isWorldPlane),
    )

    // Without this the loop below is an assertion-free green — the mistake the first row guards
    // against, one level down.
    expect(
      publishing.map((dataset) => dataset.manifest.dataset).sort(),
      'no checked-out dataset has both halves, so striking one cannot separate the predicates',
    ).toEqual(['fixture-scale', 'fixture-small', 'production'])

    for (const dataset of publishing) {
      const struck = {
        ...dataset.manifest,
        files: dataset.manifest.files.filter((file) => file.path !== SWATCHES_FILE),
      }

      // Geometry is untouched by the strike, so `rowCells` cannot tell the two manifests apart...
      expect(dataset.planes.some(isWorldPlane), `${dataset.hash} lost its geometry`).toBe(true)
      // ...and the predicate under test must, or it is reading something other than the file list.
      expect(
        publishesSwatches(struck),
        `${dataset.hash}: struck of its ${SWATCHES_FILE} entry and the gate still says it ` +
          'publishes one — the answer is coming from somewhere other than `files`',
      ).toBe(false)
    }
  })

  it('reads the file list and nothing else', () => {
    const production = datasets.find((dataset) => publishesSwatches(dataset.manifest))!

    // A constant cannot testify to its own provenance: strike the entry and the answer has to move.
    expect(publishesSwatches({ files: [] })).toBe(false)
    expect(
      publishesSwatches({
        ...production.manifest,
        files: production.manifest.files.filter((file) => file.path !== SWATCHES_FILE),
      }),
    ).toBe(false)

    // The two fields a future reader will reach for instead, and why neither works. `counts` has no
    // swatch entry at all, and `swatchRecordBytes` is 8 on *every* v3 dataset — including the two
    // that publish no swatch file — so a predicate reading either answers the same on all three.
    // `files` is the only field in the manifest that separates them.
    expect(Object.keys(production.manifest.counts)).not.toContain('swatches')
    const v3 = datasets.filter((dataset) => dataset.manifest.contractVersion === 3)
    expect(v3.length).toBeGreaterThan(1)
    for (const dataset of v3) {
      const recordBytes = (dataset.manifest as { readonly swatchRecordBytes?: number })
        .swatchRecordBytes
      expect(recordBytes, `${dataset.hash} — see SWATCH_RECORD_BYTES`).toBe(8)
    }
  })
})
