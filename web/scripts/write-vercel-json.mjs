#!/usr/bin/env node
/**
 * Generates `web/vercel.json` from `security-headers.mjs`, so the deployed policy and the policy
 * the dev server sends can never disagree (PRD 7.6.1, implementation-plan.md §2 Phase 0).
 *
 *   node scripts/write-vercel-json.mjs           # write
 *   node scripts/write-vercel-json.mjs --check   # fail if the committed file has drifted (CI)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { vercelConfig } from '../security-headers.mjs'

const target = resolve(fileURLToPath(new URL('..', import.meta.url)), 'vercel.json')
const expected = `${JSON.stringify(vercelConfig(), null, 2)}\n`

if (process.argv.includes('--check')) {
  let actual = ''
  try {
    actual = readFileSync(target, 'utf8')
  } catch {
    console.error('web/vercel.json is missing — run `node scripts/write-vercel-json.mjs`')
    process.exit(1)
  }
  if (actual !== expected) {
    console.error(
      'web/vercel.json has drifted from web/security-headers.mjs.\n' +
        'Run `node scripts/write-vercel-json.mjs` and commit the result.',
    )
    process.exit(1)
  }
  console.log('vercel.json matches security-headers.mjs')
} else {
  writeFileSync(target, expected)
  console.log(`wrote ${target}`)
}
