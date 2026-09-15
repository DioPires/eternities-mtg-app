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
 * on the datasets it was written against. What it fails is the *cross-check*: three of the four
 * datasets here disagree with it, and the last row below is what keeps that disagreement on the
 * record rather than leaving the fix looking like a matter of taste.
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

  it('is not the `rowCells` test in disguise — the two halves come apart on both fixtures', () => {
    const disagreed = datasets.filter(
      (dataset) => dataset.planes.some(isWorldPlane) !== publishesSwatches(dataset.manifest),
    )

    // Both fixtures carry §2.4 geometry and publish no swatches, and that is by design: a swatch is
    // computed from real Scryfall art and a synthetic roster has no printings to compute one from
    // (`pipeline/src/eternities/pipeline/assemble.py`). If this row ever goes red because the
    // fixtures gained swatch files, the gate is no longer under test on any checked-out dataset —
    // which is the state DEC-794 was found in, and it is worth failing loudly rather than drifting
    // into.
    expect(
      disagreed.map((dataset) => dataset.manifest.dataset).sort(),
      'no committed dataset separates "has rowCells" from "published swatches" any more, so ' +
        'nothing here can tell the two predicates apart',
    ).toEqual(['fixture-scale', 'fixture-small'])

    for (const dataset of disagreed) {
      expect(dataset.planes.filter(isWorldPlane).length).toBeGreaterThan(0)
      expect(publishesSwatches(dataset.manifest)).toBe(false)
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
