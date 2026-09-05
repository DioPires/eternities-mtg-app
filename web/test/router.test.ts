/**
 * The URL ↔ navigation binding, driven against the Phase 0 stub and a fake history.
 *
 * This is the suite that matters most in Phase 4. History semantics are where a shell quietly goes
 * wrong — a `pushState` loop, a correction that lands in the back stack, a duplicate entry from the
 * deferred second stage of PRD 6.8.2 — and none of those show up as a type error or a crash. They
 * show up as a back button that does the wrong thing three clicks later.
 *
 * Every case names the requirement it pins.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { createNavigationStub, type NavigationApi } from '../src/navigation'
import { createRouterBinding, navigateTo } from '../src/router/binding'
import { Router, type RouterHost } from '../src/router/router'

const ORACLE = '0dd3d4b4-1a1f-4a9b-9b1e-84f7c9c00001'
const OTHER_ORACLE = '0dd3d4b4-1a1f-4a9b-9b1e-84f7c9c00002'

interface FakeHistory extends RouterHost {
  readonly entries: string[]
  readonly writes: Array<{ kind: 'push' | 'replace'; url: string }>
  back(): void
  forward(): void
}

/** A history stack with the two operations the router uses, and back/forward to drive popstate. */
function fakeHistory(initial: string): FakeHistory {
  const entries = [initial]
  const writes: Array<{ kind: 'push' | 'replace'; url: string }> = []
  let at = 0
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const split = (): [string, string] => {
    const url = entries[at] ?? '/'
    const index = url.indexOf('?')
    return index < 0 ? [url, ''] : [url.slice(0, index), url.slice(index)]
  }
  return {
    entries,
    writes,
    path: () => split()[0],
    search: () => split()[1],
    push: (url) => {
      writes.push({ kind: 'push', url })
      entries.splice(at + 1)
      entries.push(url)
      at = entries.length - 1
    },
    replace: (url) => {
      writes.push({ kind: 'replace', url })
      entries[at] = url
    },
    onPopState: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    back: () => {
      if (at > 0) at -= 1
      emit()
    },
    forward: () => {
      if (at < entries.length - 1) at += 1
      emit()
    },
  }
}

interface Harness {
  readonly nav: NavigationApi
  readonly router: Router
  readonly history: FakeHistory
  readonly dispose: () => void
}

function harness(initial = '/'): Harness {
  const history = fakeHistory(initial)
  const router = new Router(history)
  // `instant` collapses the stub's own timings so nothing waits on a timer; an explicit
  // `durationMs` is still honoured, which is how the mid-flight cases below stay exercisable.
  const nav = createNavigationStub({ instant: true, initialFocus: router.snapshot().focus })
  const unbind = createRouterBinding(nav, router)
  return {
    nav,
    router,
    history,
    dispose: () => {
      unbind()
      nav.dispose()
    },
  }
}

describe('focus change → URL (PRD 6.2.2, 6.7.1)', () => {
  let h: Harness
  beforeEach(() => {
    h = harness('/')
  })

  it('pushes a history entry for a focus change that changes the route', () => {
    nav_flyTo(h, 'dominaria')
    expect(h.history.writes).toEqual([{ kind: 'push', url: '/plane/dominaria' }])
    expect(h.router.snapshot().focus).toEqual({ kind: 'plane', slug: 'dominaria' })
  })

  it('does not push a duplicate entry when the focus re-issues the URL it already has', () => {
    nav_flyTo(h, 'dominaria')
    h.history.writes.length = 0
    // PRD 6.8.2's deferred second stage: `flyToCard` for a focus the URL already names, with an
    // ordinary reason. Navigation contract §3a makes suppressing this the router's job.
    nav_flyTo(h, 'dominaria')
    expect(h.history.writes).toEqual([])
  })

  it('keeps the active filters when the focus changes', () => {
    h.history.replace('/?c=W,U')
    nav_flyTo(h, 'kaldheim')
    expect(h.history.writes.at(-1)).toEqual({ kind: 'push', url: '/plane/kaldheim?c=W,U' })
  })

  it('pushes for each level of a multiverse → plane → card journey, so back is Esc', () => {
    nav_flyTo(h, 'ravnica')
    h.nav.flyToCard({ planeSlug: 'ravnica', oracleId: ORACLE }, { reason: 'user' })
    expect(h.history.writes.map((write) => write.url)).toEqual([
      '/plane/ravnica',
      `/plane/ravnica/card/${ORACLE}`,
    ])
  })
})

describe("'correction' is a replaceState (navigation contract §3a)", () => {
  it('rewrites the URL in place when the card moved plane (PRD 6.7.1)', () => {
    const h = harness(`/plane/ravnica/card/${ORACLE}`)
    h.nav.flyToCard({ planeSlug: 'ravnica', oracleId: ORACLE }, { reason: 'deep-link' })
    h.history.writes.length = 0

    h.nav.resolveCard(ORACLE, { starIndex: 12, planeSlug: 'dominaria' })

    expect(h.history.writes).toEqual([
      { kind: 'replace', url: `/plane/dominaria/card/${ORACLE}` },
    ])
    // The dead id never enters the back stack.
    expect(h.history.entries).toEqual([`/plane/dominaria/card/${ORACLE}`])
    h.dispose()
  })

  it('rewrites, not pushes, when the card does not exist at all (PRD risk 9)', () => {
    const h = harness(`/plane/ravnica/card/${ORACLE}`)
    h.nav.flyToCard({ planeSlug: 'ravnica', oracleId: ORACLE }, { reason: 'deep-link' })
    h.history.writes.length = 0

    h.nav.failCardResolution(ORACLE, { kind: 'multiverse' })

    expect(h.history.writes).toEqual([{ kind: 'replace', url: '/' }])
    expect(h.history.entries).toEqual(['/'])
    h.dispose()
  })

  it('writes nothing when resolveCard only adds a star index — the URL is unchanged', () => {
    const h = harness(`/plane/ravnica/card/${ORACLE}`)
    h.nav.flyToCard({ planeSlug: 'ravnica', oracleId: ORACLE }, { reason: 'deep-link' })
    h.history.writes.length = 0

    h.nav.resolveCard(ORACLE, { starIndex: 12 })

    // A `'correction'` still fires — the focus gained a star index — but the path is identical,
    // so `Router.replace` drops the write rather than churning the address bar.
    expect(h.history.writes).toEqual([])
    h.dispose()
  })
})

describe('popstate → navigation (PRD 6.2.2)', () => {
  it('back behaves like Esc', () => {
    const h = harness('/')
    nav_flyTo(h, 'ravnica')
    h.nav.flyToCard({ planeSlug: 'ravnica', oracleId: ORACLE }, { reason: 'user' })
    h.history.writes.length = 0

    h.history.back()
    expect(h.nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'ravnica' })

    h.history.back()
    expect(h.nav.snapshot().focus).toEqual({ kind: 'multiverse' })
    // Replaying history must not itself write history.
    expect(h.history.writes).toEqual([])
    h.dispose()
  })

  it('forward replays the fly-to', () => {
    const h = harness('/')
    nav_flyTo(h, 'ravnica')
    h.history.back()
    expect(h.nav.snapshot().focus).toEqual({ kind: 'multiverse' })

    h.history.forward()
    expect(h.nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'ravnica' })
    h.dispose()
  })

  it('does not loop: a popstate the scene already agrees with flies nowhere', () => {
    const h = harness('/plane/ravnica')
    h.history.writes.length = 0
    h.history.back() // already at the only entry
    expect(h.history.writes).toEqual([])
    h.dispose()
  })
})

describe('filters are a replaceState, not a push (PRD 6.1.3 + 6.6.6)', () => {
  it('keeps back behaving like Esc rather than undoing a chip', () => {
    const h = harness('/plane/ravnica')
    h.history.writes.length = 0
    h.router.setFilters({ colours: ['W'], types: [], rarities: [], sets: [] })
    h.router.setFilters({ colours: ['W'], types: ['creature'], rarities: [], sets: [] })

    expect(h.history.writes.every((write) => write.kind === 'replace')).toBe(true)
    expect(h.history.entries).toEqual(['/plane/ravnica?c=W&t=creature'])
    h.dispose()
  })
})

describe('navigateTo dispatch', () => {
  it('routes an anchored Blind Eternities focus through flyToBlindEternities', () => {
    const h = harness('/')
    const anchor = [3, 4, 5] as const
    navigateTo(h.nav, { kind: 'plane', slug: 'blind-eternities', anchor }, 'user')
    expect(h.nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'blind-eternities', anchor })
    h.dispose()
  })

  it('carries starIndex through to flyToCard', () => {
    const h = harness('/')
    navigateTo(
      h.nav,
      { kind: 'card', planeSlug: 'ravnica', oracleId: OTHER_ORACLE, starIndex: 7 },
      'search',
    )
    expect(h.nav.snapshot().focus).toMatchObject({ oracleId: OTHER_ORACLE, starIndex: 7 })
    h.dispose()
  })
})

function nav_flyTo(h: Harness, slug: string): void {
  h.nav.flyToPlane(slug, { reason: 'user' })
}
