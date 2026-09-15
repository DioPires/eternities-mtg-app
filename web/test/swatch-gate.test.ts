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
 *
 * The second suite below does the same one level up, for the **conjunction** the gate actually is
 * (`shouldLoadSwatches`) rather than for either half — see its own docblock for why that is a
 * separate claim and why nothing in this repo could falsify it until DEC-807.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  SWATCHES_FILE,
  isWorldPlane,
  publishesSwatches,
  shouldLoadSwatches,
} from '../src/data/types'
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
    // Filtered on the predicate under test **alone**. Adding `some(isWorldPlane)` here — as this
    // row originally did — makes the geometry assertion in the loop a restatement of its own
    // filter, so the strike could stop separating anything and the row would still be green.
    const publishing = datasets.filter((dataset) => publishesSwatches(dataset.manifest))

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

      // The strike has to leave the *other* predicate saying yes, or it separates nothing: this
      // dataset carries §2.4 geometry, `planes.json` is untouched by the strike, so a `rowCells`
      // gate answers "worlds" on both manifests...
      expect(
        dataset.planes.some(isWorldPlane),
        `${dataset.hash} publishes ${SWATCHES_FILE} but carries no rowCells, so striking its ` +
          'swatch entry does not produce the shape DEC-788 found and this row separates nothing',
      ).toBe(true)
      // ...and the predicate under test must, or it is reading something other than the file list.
      expect(
        publishesSwatches(struck),
        `${dataset.hash}: struck of its ${SWATCHES_FILE} entry and the gate still says it ` +
          'publishes one — the answer is coming from somewhere other than `files`',
      ).toBe(false)
    }
  })

  it('reads the file list and nothing else', () => {
    // Pinned on the dataset's own name, not on "the first one that publishes": `readdirSync` sorts
    // by content hash, so `36e442ae` (fixture-scale) comes first and the plain `find` bound *that*
    // from DEC-796 onwards while still being called `production`.
    const production = datasets.find(
      (dataset) => dataset.manifest.dataset === 'production' && publishesSwatches(dataset.manifest),
    )!

    // A constant cannot testify to its own provenance: strike the entry and the answer has to move.
    expect(publishesSwatches({ files: [] })).toBe(false)
    expect(
      publishesSwatches({
        ...production.manifest,
        files: production.manifest.files.filter((file) => file.path !== SWATCHES_FILE),
      }),
    ).toBe(false)

    // The two fields a future reader will reach for instead, and why neither is the question.
    // `counts` has no swatch entry at all, so a predicate reading it cannot answer even wrongly.
    // `swatchRecordBytes` is 8 on every v3 dataset and absent on v2 — which, since DEC-796 gave
    // both fixtures a swatch column, is *exactly* the split `files` produces today. So it now
    // agrees with the right answer on every checked-out dataset while still being the wrong
    // question: it states the record width this contract version encodes at, not that this dataset
    // wrote the file, and the first dataset to declare the format without publishing the column
    // would part the two again. (Before DEC-796 the disagreement was visible in the corpus: it read
    // 8 on the two fixtures that shipped no swatch file.) `files` is the dataset's own statement of
    // what it wrote, and that is why the predicate reads it.
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

/**
 * The gate's **conjunction**, which is a different claim from either half (DEC-805 F1, DEC-807).
 *
 * `publishesSwatches` is exercised to death above and `isWorldPlane` by §2.4's own tests, and until
 * DEC-807 the decision that ANDs them was spelled inline in `useSceneData` where nothing could
 * reach it. The only input that falsifies an AND of two true things is one on which a half is
 * false, and DEC-796 removed the last such dataset from the corpus on purpose — so dropping either
 * conjunct was invisible to the entire suite, unit and e2e alike (measured: restoring the
 * `rowCells`-only gate fails `e2e/routes.spec.ts` on main and passes on this branch).
 *
 * So each half is taken away here, from real artefacts, one at a time:
 *
 * - **no file** — a real manifest struck of its swatch entry, its own `planes.json` untouched. This
 *   is the shape DEC-788 found in the wild, and it is what the fixtures were before DEC-796.
 * - **nothing to read it** — the v2 `production` dataset's real `planes.json`, which carries
 *   `rowCells` on none of its 88 planes, against a manifest that does publish a swatch column.
 *
 * Both halves are struck from committed artefacts rather than from a literal written here, for the
 * reason the file's header gives: this is a claim about datasets the emitter produces.
 */
describe('shouldLoadSwatches', () => {
  const composable = datasets.filter(
    (dataset) => publishesSwatches(dataset.manifest) && dataset.planes.some(isWorldPlane),
  )
  const galaxy = datasets.find((dataset) => dataset.manifest.contractVersion === 2)

  // Guards both rows below against an empty `it.each` and an absent `galaxy`, the same way the
  // first row of the suite guards the per-dataset ones.
  it('has the datasets both rows below strike at', () => {
    expect(composable.map((dataset) => dataset.manifest.dataset).sort()).toEqual([
      'fixture-scale',
      'fixture-small',
      'production',
    ])
    expect(galaxy?.manifest.dataset, 'no v2 dataset is checked out to take the geometry away').toBe(
      'production',
    )
    expect(
      galaxy?.planes.some(isWorldPlane),
      'the v2 dataset grew §2.4 geometry — it can no longer stand in for "nothing reads swatches"',
    ).toBe(false)
  })

  it.each(composable)(
    '$manifest.dataset ($hash): fetches, and stops fetching when either half is taken away',
    ({ manifest, planes, hash }) => {
      // Not a restatement of the filter above: that spells the two halves inline, this asks the
      // function, and the two agreeing is the point. An `||` in place of the `&&` survives this
      // line and dies on both strikes below.
      expect(
        shouldLoadSwatches(manifest, planes),
        `${hash} publishes ${SWATCHES_FILE} and carries rowCells, and the gate declines to fetch ` +
          'it — no world composes on this dataset at all',
      ).toBe(true)

      expect(
        shouldLoadSwatches(
          { ...manifest, files: manifest.files.filter((file) => file.path !== SWATCHES_FILE) },
          planes,
        ),
        `${hash} struck of its ${SWATCHES_FILE} entry and the gate still fetches — the "did the ` +
          'dataset publish it" half is gone and every page load asks for a file that is not there',
      ).toBe(false)

      expect(
        shouldLoadSwatches(manifest, galaxy!.planes),
        `${hash}'s manifest against a roster with no rowCells and the gate still fetches — the ` +
          '"would anything read it" half is gone and the transfer is spent on nothing',
      ).toBe(false)
    },
  )
})
