/**
 * The navigation contract's behavioural checks.
 *
 * The demo caller in `src/navigation/demo.ts` proves the contract *type-checks* against a real
 * caller; this proves the stub's state machine matches what `types.ts` promises, so Phase 4 can
 * trust it and Phase 2b has a specification to implement against.
 */

import { describe, expect, it } from 'vitest'

import { createNavigationStub, levelOf, runNavigationDemo } from '../src/navigation'

describe('navigation demo caller', () => {
  it('walks the whole contract and ends at the multiverse', async () => {
    const log = await runNavigationDemo()
    expect(log.finalFocus).toEqual({ kind: 'multiverse' })
    expect(log.events).toContain('focusParent-at-multiverse:null')
    expect(log.events).toContain('interrupted:cancelled')
    expect(log.events).toContain('superseded:superseded')
    expect(log.events).toContain('cancelled:cancelled')
    expect(log.events).toContain('attract-after-input:false')
    expect(log.events).toContain('reducedMotion:true')
    expect(log.events).toContain('level:multiverse')
    expect(log.events.filter((e) => e.startsWith('anchorchange:'))).toHaveLength(1)
    expect(log.snapshots.length).toBeGreaterThan(0)
  })
})

describe('navigation stub', () => {
  it('updates focus synchronously at the start of a flight (PRD 6.7.1)', () => {
    const nav = createNavigationStub()
    nav.flyToPlane('ravnica', { durationMs: 5000 })
    expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'ravnica' })
    expect(nav.snapshot().flight).not.toBeNull()
    nav.dispose()
  })

  it('leaves focus at the target when input hands over (PRD 5.7.3)', async () => {
    const nav = createNavigationStub()
    const flight = nav.flyToPlane('kaldheim', { durationMs: 5000 })
    nav.handOver('pointer')
    const result = await flight.done
    expect(result.status).toBe('cancelled')
    // Hand-over returns control; it does not undo the navigation.
    expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'kaldheim' })
    expect(nav.snapshot().flight).toBeNull()
    nav.dispose()
  })

  it('supersedes the flight in progress', async () => {
    const nav = createNavigationStub()
    const first = nav.flyToPlane('tarkir', { durationMs: 5000 })
    const second = nav.flyToPlane('theros', { durationMs: 5000 })
    expect((await first.done).status).toBe('superseded')
    expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'theros' })
    second.cancel('route')
    nav.dispose()
  })

  it('routes the Blind Eternities through the anchored path (PRD 5.3.4)', async () => {
    const nav = createNavigationStub({ instant: true })
    const anchors: number[][] = []
    nav.on('anchorchange', ({ anchor }) => anchors.push([...anchor]))

    await nav.flyToPlane('blind-eternities').done
    expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'blind-eternities' })
    expect(anchors).toHaveLength(0)

    // Re-anchoring while already focused changes no route.
    await nav.flyToBlindEternities([1, 2, 3]).done
    expect(anchors).toEqual([[1, 2, 3]])
    expect(nav.snapshot().focus).toEqual({
      kind: 'plane',
      slug: 'blind-eternities',
      anchor: [1, 2, 3],
    })
    nav.dispose()
  })

  it('walks Esc up the hierarchy and stops at the multiverse (PRD 6.1.3)', async () => {
    const nav = createNavigationStub({ instant: true })
    await nav.flyToCard({ planeSlug: 'innistrad', oracleId: 'a', starIndex: 1 }).done
    expect(levelOf(nav.snapshot().focus)).toBe('card')

    await nav.focusParent()?.done
    expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'innistrad' })

    await nav.focusParent()?.done
    expect(nav.snapshot().focus).toEqual({ kind: 'multiverse' })
    expect(nav.focusParent()).toBeNull()
    nav.dispose()
  })

  it('plays the intro once per session (PRD 6.8.2)', async () => {
    const nav = createNavigationStub({ instant: true })
    const starts: string[] = []
    nav.on('flightstart', ({ reason }) => starts.push(reason))

    await nav.playIntro({ kind: 'plane', slug: 'ixalan' }).done
    expect(nav.snapshot().introPlayed).toBe(true)
    await nav.playIntro({ kind: 'multiverse' }).done
    // The second intro is a resolved no-op, and does not move focus.
    expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'ixalan' })
    expect(starts.filter((r) => r === 'intro')).toHaveLength(1)
    nav.dispose()
  })

  it('exits attract mode on any input and never changes the route (PRD 5.3.23)', async () => {
    const nav = createNavigationStub({ instant: true })
    await nav.flyToPlane('zendikar').done
    const before = nav.snapshot().focus

    nav.enterAttract()
    expect(nav.snapshot().attract).toBe(true)
    nav.handOver('wheel')
    expect(nav.snapshot().attract).toBe(false)
    expect(nav.snapshot().focus).toEqual(before)
    nav.dispose()
  })

  it('honours reduced motion by shortening flights (PRD 5.9)', async () => {
    const nav = createNavigationStub()
    nav.setReducedMotion(true)
    const started = Date.now()
    await nav.flyToPlane('theros').done
    // 300 ms under reduced motion, not the 1200 ms default. Generous bound: this asserts the
    // reduced-motion branch was taken, not the timer's precision.
    expect(Date.now() - started).toBeLessThan(900)
    nav.dispose()
  })

  it('cancels anything in flight when disposed', async () => {
    const nav = createNavigationStub()
    const flight = nav.flyToPlane('eldraine', { durationMs: 5000 })
    nav.dispose()
    expect((await flight.done).status).toBe('cancelled')
  })
})
