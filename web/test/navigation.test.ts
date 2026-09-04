/**
 * The navigation contract's behavioural checks — run over **every** implementation of it.
 *
 * The demo caller in `src/navigation/demo.ts` proves the contract *type-checks* against a real
 * caller; this proves the state machine matches what `types.ts` promises.
 *
 * Since Phase 2b (DEC-588) the suite is parameterised. docs/navigation-contract.md §5 named the
 * acceptance test for the swap: "Phase 2b's implementation should pass the same suite against the
 * real rig." So it does — the same 27 checks run against the Phase 0 stub *and* against
 * `createSceneNavigation`, which flies an actual camera over fixture-scale's 83-plane roster. A
 * rule the rig quietly broke would fail here rather than in Phase 4's integration.
 */

import { describe, expect, it } from 'vitest'

import { levelOf, runNavigationDemo, type Focus, type NavigationApi } from '../src/navigation'
import { createNavigationStub } from '../src/navigation/stub'
import { createSceneNavigation } from '../src/navigation/scene'

import { loadFixturePlanes } from './fixtures'

interface Options {
  readonly instant?: boolean
  readonly reducedMotion?: boolean
  readonly initialFocus?: Focus
}

/**
 * `instant` means the same thing to both: collapse the implementation's own timings, but honour a
 * `durationMs` the caller named, so hand-over and supersede stay exercisable against a flight that
 * is genuinely in progress.
 */
const IMPLEMENTATIONS: ReadonlyArray<{ readonly name: string; readonly create: (options?: Options) => NavigationApi }> = [
  { name: 'stub', create: (options = {}) => createNavigationStub(options) },
  {
    name: 'scene rig',
    create: (options = {}) => createSceneNavigation(loadFixturePlanes('scale'), options).api,
  },
]

for (const { name: implementation, create } of IMPLEMENTATIONS) {
  describe(implementation, () => {
  describe('navigation demo caller', () => {
    it('walks the whole contract and ends at the multiverse', async () => {
      const log = await runNavigationDemo(create({ instant: true }))
      expect(log.finalFocus).toEqual({ kind: 'multiverse' })
      expect(log.events).toContain('focusParent-at-multiverse:null')
      expect(log.events).toContain('interrupted:cancelled')
      expect(log.events).toContain('superseded:superseded')
      expect(log.events).toContain('cancelled:cancelled')
      expect(log.events).toContain('attract-after-input:false')
      expect(log.events).toContain('reducedMotion:true')
      expect(log.events).toContain('level:multiverse')
      // The contract additions the deep-link cold start needs (PRD 6.7.1, 6.2.3, risk 9).
      expect(log.events).toContain('resolved:4242')
      expect(log.events).toContain('resolved-same-flight:true')
      expect(log.events).toContain('retargeted:ravnica')
      expect(log.events).toContain('unresolvable:failed')
      expect(log.events).toContain('dust-parent-anchor:12,0.5,-30')
      expect(log.events).toContain('focuschange:card:correction')
      expect(log.events.filter((e) => e.startsWith('anchorchange:'))).toHaveLength(1)
      expect(log.snapshots.length).toBeGreaterThan(0)
    })
  })

  describe('navigation stub', () => {
    it('updates focus synchronously at the start of a flight (PRD 6.7.1)', () => {
      const nav = create()
      nav.flyToPlane('ravnica', { durationMs: 5000 })
      expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'ravnica' })
      expect(nav.snapshot().flight).not.toBeNull()
      nav.dispose()
    })

    it('leaves focus at the target when input hands over (PRD 5.7.3)', async () => {
      const nav = create()
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
      const nav = create()
      const first = nav.flyToPlane('tarkir', { durationMs: 5000 })
      const second = nav.flyToPlane('theros', { durationMs: 5000 })
      expect((await first.done).status).toBe('superseded')
      expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'theros' })
      second.cancel('route')
      nav.dispose()
    })

    it('routes the Blind Eternities through the anchored path (PRD 5.3.4)', async () => {
      const nav = create({ instant: true })
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
      const nav = create({ instant: true })
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
      const nav = create({ instant: true })
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
      const nav = create({ instant: true })
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
      const nav = create()
      nav.setReducedMotion(true)
      const started = Date.now()
      await nav.flyToPlane('theros').done
      // 300 ms under reduced motion, not the 1200 ms default. Generous bound: this asserts the
      // reduced-motion branch was taken, not the timer's precision.
      expect(Date.now() - started).toBeLessThan(900)
      nav.dispose()
    })

    it('cancels anything in flight when disposed', async () => {
      const nav = create()
      const flight = nav.flyToPlane('eldraine', { durationMs: 5000 })
      nav.dispose()
      expect((await flight.done).status).toBe('cancelled')
    })
  })

  /**
   * Every method must survive being pulled off the object. React callers destructure constantly —
   * `const { flyToPlane } = useNavigation()` and `onPointerDown={nav.handOver}` are the natural
   * spellings — and the whole existing suite calls through `nav.`, which is why a `this`-dependent
   * implementation got this far. It also failed *selectively*: destructured `flyToPlane('ravnica')`
   * worked and only `'blind-eternities'` threw.
   */
  describe('navigation stub, called free-standing (no `this`)', () => {
    it('flies to the Blind Eternities through a destructured flyToPlane', async () => {
      const nav = create({ instant: true })
      const { flyToPlane } = nav
      await flyToPlane('blind-eternities').done
      expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'blind-eternities' })
      nav.dispose()
    })

    it('walks up through a destructured focusParent', async () => {
      const nav = create({ instant: true })
      await nav.flyToPlane('ravnica').done
      const { focusParent } = nav
      await focusParent()?.done
      expect(nav.snapshot().focus).toEqual({ kind: 'multiverse' })
      nav.dispose()
    })

    it('exits attract mode through a destructured handOver', () => {
      const nav = create({ instant: true })
      nav.enterAttract()
      const { handOver } = nav
      handOver('pointer')
      expect(nav.snapshot().attract).toBe(false)
      nav.dispose()
    })

    it('survives every method being detached at once, on every branch', async () => {
      // The blunt version of the same check, so a `this` reintroduced anywhere fails here.
      //
      // "Every branch", not "every method", and the distinction is load-bearing: the Phase 0 bug was
      // `this.flyToBlindEternities(...)` inside `flyToPlane`, which only the 'blind-eternities' slug
      // reaches. An earlier version of this test called `flyToPlane('dominaria')` alone and passed
      // with that bug in place. Both delegating branches — `flyToPlane`'s and `focusParent`'s — have
      // to run detached, or this test is false comfort.
      const nav = create({ instant: true })
      const {
        snapshot,
        subscribe,
        on,
        flyToMultiverse,
        flyToPlane,
        flyToBlindEternities,
        flyToCard,
        focusParent,
        resolveCard,
        failCardResolution,
        playIntro,
        enterAttract,
        exitAttract,
        setReducedMotion,
        handOver,
        dispose,
      } = nav

      const unsubscribes = [subscribe(() => {}), on('focuschange', () => {})]
      await playIntro({ kind: 'multiverse' }).done
      await flyToMultiverse().done
      await flyToPlane('dominaria').done
      // `flyToPlane`'s other branch: this slug is the one that delegates to `flyToBlindEternities`.
      await flyToPlane('blind-eternities').done
      expect(snapshot().focus).toEqual({ kind: 'plane', slug: 'blind-eternities' })
      await flyToBlindEternities([1, 2, 3]).done
      await flyToCard({ planeSlug: 'ravnica', oracleId: 'a' }).done
      resolveCard('a', { starIndex: 7 })
      failCardResolution('a')
      // `focusParent`'s two branches: a normal card walks up through `flyToPlane`, a Blind
      // Eternities card through `flyToBlindEternities`.
      await flyToCard({ planeSlug: 'ravnica', oracleId: 'b' }).done
      await focusParent()?.done
      expect(snapshot().focus).toEqual({ kind: 'plane', slug: 'ravnica' })
      await flyToCard({ planeSlug: 'blind-eternities', oracleId: 'c', anchor: [4, 5, 6] }).done
      await focusParent()?.done
      expect(snapshot().focus).toEqual({
        kind: 'plane',
        slug: 'blind-eternities',
        anchor: [4, 5, 6],
      })
      enterAttract()
      exitAttract('keyboard')
      setReducedMotion(true)
      handOver('pointer')
      expect(snapshot().reducedMotion).toBe(true)
      for (const unsubscribe of unsubscribes) unsubscribe()
      dispose()
    })
  })

  describe('re-anchoring the Blind Eternities (PRD 5.3.4)', () => {
    it('re-targets rather than dropping the anchor when a flight is still in the air', async () => {
      // `focus` is assigned at flight *start* (invariant 2), so a flight still heading at the Blind
      // Eternities reads as "already focused". Taking the anchor-only path there emitted
      // `anchorchange`, handed back a fake completed flight, and left the real flight aimed at the
      // un-anchored target: the UI believed it was flying at the clicked dust while the camera flew
      // to the multiverse centre.
      const nav = create()
      const anchors: number[][] = []
      nav.on('anchorchange', ({ anchor }) => anchors.push([...anchor]))

      const first = nav.flyToBlindEternities(undefined, { durationMs: 5000 })
      const second = nav.flyToBlindEternities([9, 9, 9], { durationMs: 5000 })

      expect((await first.done).status).toBe('superseded')
      expect(anchors).toHaveLength(0)

      const anchored = { kind: 'plane', slug: 'blind-eternities', anchor: [9, 9, 9] }
      expect(nav.snapshot().focus).toEqual(anchored)
      // The state that used to diverge: the flight's target and the focus must agree.
      expect(nav.snapshot().flight?.target).toEqual(anchored)
      expect(second.target).toEqual(anchored)
      second.cancel('route')
      nav.dispose()
    })

    it('still takes the anchor-only path once the flight has settled', async () => {
      const nav = create({ instant: true })
      const anchors: number[][] = []
      nav.on('anchorchange', ({ anchor }) => anchors.push([...anchor]))

      await nav.flyToBlindEternities([1, 1, 1]).done
      const flights: number[] = []
      nav.on('flightstart', ({ id }) => flights.push(id))
      await nav.flyToBlindEternities([2, 2, 2]).done

      // Settled there: a re-anchor is not a navigation, so no flight starts and no route changes.
      expect(anchors).toEqual([[2, 2, 2]])
      expect(flights).toHaveLength(0)
      nav.dispose()
    })

    it('re-targets when the pending flight is heading somewhere else entirely', async () => {
      const nav = create()
      const anchors: number[][] = []
      nav.on('anchorchange', ({ anchor }) => anchors.push([...anchor]))

      // Settle at the Blind Eternities first, so the divergence under test is purely "a flight to
      // somewhere else is in the air", not "we were never there".
      await nav.flyToBlindEternities([1, 1, 1], { durationMs: 1 }).done
      const away = nav.flyToPlane('ravnica', { durationMs: 5000 })
      const back = nav.flyToBlindEternities([3, 3, 3], { durationMs: 5000 })

      expect((await away.done).status).toBe('superseded')
      expect(anchors).toHaveLength(0)
      expect(back.target).toEqual({ kind: 'plane', slug: 'blind-eternities', anchor: [3, 3, 3] })
      back.cancel('route')
      nav.dispose()
    })
  })

  describe('resolving a card after sets.bin lands (PRD 6.7.1, 5.7)', () => {
    it('delivers starIndex into an in-flight fly-to without superseding it', async () => {
      // The cold-start deep-link path: `flyToCard` fires on the URL's oracle id, `sets.bin` lands a
      // second later. A second `flyToCard` would supersede and restart the camera, which is the
      // discontinuity PRD 5.7 and 7.3.6 exist to prevent.
      const nav = create()
      const ends: string[] = []
      const changes: string[] = []
      nav.on('flightend', ({ status }) => ends.push(status))
      nav.on('focuschange', ({ reason }) => changes.push(reason))

      const flight = nav.flyToCard(
        { planeSlug: 'innistrad', oracleId: 'deep-link' },
        { durationMs: 5000 },
      )
      expect(nav.snapshot().focus).toEqual({
        kind: 'card',
        planeSlug: 'innistrad',
        oracleId: 'deep-link',
      })

      nav.resolveCard('deep-link', { starIndex: 4242 })

      // No flight ended, none started, and the same flight is now aimed at the resolved card.
      expect(ends).toHaveLength(0)
      expect(nav.snapshot().flight?.id).toBe(flight.id)
      expect(flight.target).toEqual({
        kind: 'card',
        planeSlug: 'innistrad',
        oracleId: 'deep-link',
        starIndex: 4242,
      })
      expect(nav.snapshot().focus).toEqual(flight.target)
      expect(changes).toEqual(['programmatic', 'correction'])
      // And it is still the same flight to cancel, carrying the refined focus out with it.
      flight.cancel('route')
      const result = await flight.done
      expect(result.status).toBe('cancelled')
      expect(result.focus).toEqual(flight.target)
      nav.dispose()
    })

    it('rewrites the plane when the data moved the card (PRD 6.7.1)', async () => {
      const nav = create()
      const reasons: string[] = []
      nav.on('focuschange', ({ reason }) => reasons.push(reason))

      const flight = nav.flyToCard({ planeSlug: 'innistrad', oracleId: 'x' }, { durationMs: 5000 })
      nav.resolveCard('x', { starIndex: 7, planeSlug: 'ravnica' })

      // "The card wins and the URL is rewritten" — and `'correction'` is what tells the router to
      // use replaceState rather than pushing a history entry the user never navigated to.
      expect(nav.snapshot().focus).toEqual({
        kind: 'card',
        planeSlug: 'ravnica',
        oracleId: 'x',
        starIndex: 7,
      })
      expect(reasons.at(-1)).toBe('correction')
      expect((await Promise.race([flight.done, Promise.resolve('still flying')]))).toBe('still flying')
      flight.cancel('route')
      nav.dispose()
    })

    it('is a no-op once the user has moved on', async () => {
      const nav = create({ instant: true })
      await nav.flyToCard({ planeSlug: 'innistrad', oracleId: 'a' }).done
      await nav.flyToPlane('ravnica').done
      const before = nav.snapshot().focus
      nav.resolveCard('a', { starIndex: 1 })
      expect(nav.snapshot().focus).toEqual(before)
      nav.dispose()
    })

    it('fails the flight when the oracle id is not in the dataset (PRD risk 9)', async () => {
      // `starIndexOf` returns -1 for a bookmark that survived a data refresh which dropped the card.
      // That used to resolve `'completed'` at a focus that does not exist.
      const nav = create()
      const flight = nav.flyToCard({ planeSlug: 'innistrad', oracleId: 'gone' }, { durationMs: 5000 })

      nav.failCardResolution('gone')

      const result = await flight.done
      expect(result.status).toBe('failed')
      // The URL's plane slug is real even when its oracle id is not, so that is where we land.
      expect(result.focus).toEqual({ kind: 'plane', slug: 'innistrad' })
      expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'innistrad' })
      expect(nav.snapshot().flight).toBeNull()
      nav.dispose()
    })

    it("keeps a Blind Eternities card's anchor in the default fallback (PRD 5.3.4)", async () => {
      // `anchor: undefined` on the Blind Eternities *means* the multiverse centre (contract §1), so
      // a fallback that dropped the anchor would tell the router the camera had crossed the whole
      // multiverse while it in fact sat still, framing the dust around the card.
      const nav = create()
      const flight = nav.flyToCard(
        { planeSlug: 'blind-eternities', oracleId: 'gone', anchor: [12, 0.5, -30] },
        { durationMs: 5000 },
      )

      nav.failCardResolution('gone')

      const landed = { kind: 'plane', slug: 'blind-eternities', anchor: [12, 0.5, -30] }
      expect((await flight.done).focus).toEqual(landed)
      expect(nav.snapshot().focus).toEqual(landed)
      nav.dispose()
    })

    it('still corrects the focus when the flight has already settled (PRD 5.9)', () => {
      // Invariant 6 is scoped to flights still in the air, and this is why. Under reduced motion the
      // flight is 300 ms and `immediate` collapses it entirely, so `sets.bin` can land *after* the
      // flight resolved 'completed' at the card. There is then no flight to fail — but the focus is
      // still wrong, so the `'correction'` must fire regardless. That is what PRD risk 9's toast
      // hangs off, which is why it cannot hang off the 'failed' flight result.
      const nav = create({ instant: true })
      nav.flyToCard({ planeSlug: 'innistrad', oracleId: 'gone' })
      expect(nav.snapshot().flight).toBeNull()

      const reasons: string[] = []
      const ends: string[] = []
      nav.on('focuschange', ({ reason }) => reasons.push(reason))
      nav.on('flightend', ({ status }) => ends.push(status))

      nav.failCardResolution('gone')

      expect(reasons).toEqual(['correction'])
      expect(ends).toHaveLength(0)
      expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'innistrad' })
      nav.dispose()
    })
  })

  describe('Esc from a Blind Eternities card (PRD 6.2.3)', () => {
    it('returns to the dust around the card, not the multiverse centre', async () => {
      // `anchor: undefined` on the Blind Eternities *means* the multiverse centre, so dropping the
      // card's anchor on the way up teleported the user across the whole multiverse.
      const nav = create({ instant: true })
      await nav.flyToBlindEternities([40, 0, 10]).done
      await nav.flyToCard({
        planeSlug: 'blind-eternities',
        oracleId: 'x',
        starIndex: 7,
        anchor: [40, 0, 10],
      }).done
      expect(nav.snapshot().focus).toEqual({
        kind: 'card',
        planeSlug: 'blind-eternities',
        oracleId: 'x',
        starIndex: 7,
        anchor: [40, 0, 10],
      })

      await nav.focusParent()?.done
      expect(nav.snapshot().focus).toEqual({
        kind: 'plane',
        slug: 'blind-eternities',
        anchor: [40, 0, 10],
      })
      nav.dispose()
    })

    it('picks up the anchor that resolveCard delivered on the deep-link path', async () => {
      const nav = create({ instant: true })
      await nav.flyToCard({ planeSlug: 'blind-eternities', oracleId: 'x' }).done
      nav.resolveCard('x', { starIndex: 7, anchor: [12, 0.5, -30] })

      await nav.focusParent()?.done
      expect(nav.snapshot().focus).toEqual({
        kind: 'plane',
        slug: 'blind-eternities',
        anchor: [12, 0.5, -30],
      })
      nav.dispose()
    })

    it('still goes to the plane itself from a card on a normal plane', async () => {
      const nav = create({ instant: true })
      await nav.flyToCard({ planeSlug: 'ravnica', oracleId: 'x', starIndex: 1 }).done
      await nav.focusParent()?.done
      expect(nav.snapshot().focus).toEqual({ kind: 'plane', slug: 'ravnica' })
      nav.dispose()
    })
  })

  describe('snapshots published to subscribers', () => {
    it('never shows the old focus with no flight when one supersedes another', () => {
      // `start()` used to settle the superseded flight before assigning `focus`, so `settle`'s
      // notify published "old focus, no flight" — a state the real rig never has, and enough to
      // make a breadcrumb bound to the snapshot flicker.
      const nav = create()
      nav.flyToPlane('tarkir', { durationMs: 5000 })

      const seen: Array<{ focus: string; flying: boolean }> = []
      nav.subscribe((s) => seen.push({ focus: JSON.stringify(s.focus), flying: s.flight !== null }))
      const second = nav.flyToPlane('theros', { durationMs: 5000 })

      for (const s of seen) {
        if (!s.flying) expect(s.focus).not.toBe(JSON.stringify({ kind: 'plane', slug: 'tarkir' }))
      }
      second.cancel('route')
      nav.dispose()
    })
  })
  })
}
