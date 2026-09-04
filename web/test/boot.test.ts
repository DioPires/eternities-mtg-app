/**
 * The cold start's one user-visible branch that no other suite covers: PRD 6.7.1's malformed deep
 * link. `route.test.ts` proves `parseRoute` *produces* the warnings; this proves `boot` still has
 * them by the time it wants to show one.
 *
 * That distinction is the whole point of testing the real `boot()` rather than `describeWarnings`
 * in isolation. The original bug was not in either function — it was in the order they were called
 * in, and only a test that runs the actual sequence can see it: `router.replace` canonicalises the
 * URL, so a snapshot taken afterwards re-parses a route that no longer has anything wrong with it.
 *
 * Runs under Node against the Phase 0 navigation stub and a fake history, like `router.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `boot` kicks off the dataset load, which would fetch. Nothing here waits on an artefact.
vi.mock('../src/app/dataset', () => ({
  startDatasetLoad: () => Promise.resolve(),
}))

import { boot } from '../src/app/boot'
import { createNavigationStub, type NavigationApi } from '../src/navigation'
import { Router, type RouterHost } from '../src/router/router'
import { useStore } from '../src/store/store'

const GOOD_ORACLE = '0dd3d4b4-1a1f-4a9b-9b1e-84f7c9c00001'

/** The two reads and two writes the router uses, over a single-entry stack. */
function fakeHistory(initial: string): RouterHost {
  let url = initial
  const split = (): [string, string] => {
    const index = url.indexOf('?')
    return index < 0 ? [url, ''] : [url.slice(0, index), url.slice(index)]
  }
  return {
    path: () => split()[0],
    search: () => split()[1],
    push: (next) => {
      url = next
    },
    replace: (next) => {
      url = next
    },
    onPopState: () => () => undefined,
  }
}

let nav: NavigationApi
let dispose: (() => void) | null = null

beforeEach(() => {
  useStore.setState({ toasts: [] })
  nav = createNavigationStub()
})

afterEach(() => {
  dispose?.()
  dispose = null
})

/** Boots at `url` and returns the messages the user would see. */
function bootAt(url: string): string[] {
  const router = new Router(fakeHistory(url))
  dispose = boot(nav, router)
  return useStore.getState().toasts.map((toast) => toast.message)
}

describe('boot — the malformed deep link (PRD 6.7.1)', () => {
  it('warns on a route it could not parse at all', () => {
    expect(bootAt('/wat')).toEqual(['That link does not exist. Showing the multiverse.'])
  })

  it('warns on a malformed plane slug', () => {
    expect(bootAt('/plane/NOT_A_SLUG')).toEqual([
      'That plane link is malformed. Showing the multiverse.',
    ])
  })

  it('warns on a malformed oracle id, and keeps the plane it could parse', () => {
    expect(bootAt('/plane/dominaria/card/not-a-uuid')).toEqual([
      'That card link is malformed. Showing its plane.',
    ])
  })

  it('says nothing for a route that parsed cleanly', () => {
    expect(bootAt(`/plane/dominaria/card/${GOOD_ORACLE}`)).toEqual([])
    expect(useStore.getState().toasts).toHaveLength(0)
  })

  it('says nothing at the multiverse root', () => {
    expect(bootAt('/')).toEqual([])
  })

  /**
   * The regression itself. Every warning kind implies a rewrite, so a snapshot read after the
   * canonicalising `replace` is empty by construction — which is exactly how the toast went dead.
   */
  it('reads the warnings from the pre-canonicalisation route, not from the rewritten URL', () => {
    const host = fakeHistory('/plane/NOT_A_SLUG')
    const router = new Router(host)
    dispose = boot(nav, router)
    // The URL has been canonicalised — there is no longer anything in it to warn about...
    expect(router.snapshot().url).toBe('/')
    expect(router.snapshot().warnings).toEqual([])
    // ...and the toast fired anyway.
    expect(useStore.getState().toasts).toHaveLength(1)
  })
})
