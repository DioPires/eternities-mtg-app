/**
 * Reading the committed fixture datasets from disk, so the camera and label tests run against the
 * same 82-plane roster the browser gets (implementation plan, Phase 0: "bench numbers mean
 * something from the first shader commit").
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeStars, type Stars } from '../src/data/decode'
import type { PlanesFile } from '../src/data/types'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')

interface DatasetRegistry {
  readonly active: string
  readonly fixtures: Readonly<Record<string, string>>
}

export type FixtureName = 'scale' | 'small'

function hashOf(name: FixtureName): string {
  const registry = JSON.parse(
    readFileSync(resolve(webRoot, 'datasets.json'), 'utf8'),
  ) as DatasetRegistry
  const hash = registry.fixtures[name]
  if (!hash) throw new Error(`web/datasets.json has no fixture named ${name}`)
  return hash
}

export function fixturePath(name: FixtureName, file: string): string {
  return resolve(webRoot, 'public', 'data', hashOf(name), file)
}

export function loadFixturePlanes(name: FixtureName = 'scale'): PlanesFile {
  return JSON.parse(readFileSync(fixturePath(name, 'planes.json'), 'utf8')) as PlanesFile
}

export function loadFixtureStars(name: FixtureName = 'scale'): Stars {
  const bytes = readFileSync(fixturePath(name, 'stars.bin'))
  return decodeStars(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
