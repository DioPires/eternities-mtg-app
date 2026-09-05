/**
 * The navigation contract's behavioural checks — run over **every** implementation of it.
 *
 * The demo caller in `src/navigation/demo.ts` proves the contract *type-checks* against a real
 * caller; this proves the state machine matches what `types.ts` promises.
 *
 * Since Phase 2b (DEC-588) the suite is parameterised. docs/navigation-contract.md §5 named the
 * acceptance test for the swap: "Phase 2b's implementation should pass the same suite against the
 * real rig." So it does — the same 27 checks run against the Phase 0 stub *and* against
 * `createSceneNavigation`, which flies an actual camera over fixture-scale's Appendix A roster. A
 * rule the rig quietly broke would fail here rather than in Phase 4's integration.
 */

import { describe, expect, it } from 'vitest'

import { distance, set, vec } from '../src/camera/vec'
import { BLIND_ETERNITIES_SLUG } from '../src/data/types'
import { levelOf, runNavigationDemo, type Focus, type NavigationApi } from '../src/navigation'
import { createNavigationStub } from '../src/navigation/stub'
import { createSceneNavigation, type StarSource } from '../src/navigation/scene'

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

/**
 * Checks the stub cannot hold an opinion about, because they are about where the camera actually
 * is. Run against `createSceneNavigation` only, with `drive: 'manual'` so the frames are ours.
 */
describe('the scene transport', () => {
  const scenePlanes = loadFixturePlanes('scale')

  const run = (scene: { update: (dt: number) => void }, seconds: number): void => {
    for (let i = 0; i < 60 * seconds; i += 1) scene.update(1 / 60)
  }

  it('re-tethers to the focus when attract mode exits (PRD 5.7.1, 5.3.23)', () => {
    const scene = createSceneNavigation(scenePlanes, { drive: 'manual', attractSeed: 3 })
    expect(scene.api.snapshot().focus).toEqual({ kind: 'multiverse' })

    scene.api.enterAttract()
    run(scene, 20)
    // The tour really is somewhere else by now: it flies to planes, and it is mid-leg here.
    expect(scene.rig.currentTether.kind).toBe('plane')

    const before = vec(scene.rig.position.x, scene.rig.position.y, scene.rig.position.z)
    const distanceBefore = distance(before, vec())
    scene.api.handOver('pointer')

    expect(scene.api.snapshot().attract).toBe(false)
    // PRD 5.7.1: "the camera is always tethered to a focus". Attract mode never changed focus, so
    // the focus is still the multiverse — and before DEC-606 the camera was left on the tour's
    // plane instead, then drove itself ~81 units to *that* plane's `maxDistance` with no input.
    expect(scene.api.snapshot().focus).toEqual({ kind: 'multiverse' })
    expect(scene.rig.currentTether.kind).toBe('multiverse')
    expect(scene.rig.currentTether.planeIndex).toBe(-1)
    // PRD 5.3.23: "returns control without a jump". `rebaseTo` re-derives the pose *from* the world
    // position, so the camera has not moved at all rather than moved a little.
    expect(distance(before, scene.rig.position)).toBeLessThan(1e-9)
    expect(scene.rig.distanceToTether).toBeCloseTo(distanceBefore, 9)

    // And it stays put: the multiverse's own limits already contain it, so nothing pulls it away.
    // All that is left is the hand-over's inertia bleeding off over a couple of seconds.
    run(scene, 20)
    expect(scene.rig.currentTether.kind).toBe('multiverse')
    expect(distance(before, scene.rig.position)).toBeLessThan(
      scene.rig.framing.multiverseRadius * 0.1,
    )
    scene.api.dispose()
  })

  /**
   * Phase 3's Blind Eternities fix, which shipped without a guard.
   *
   * A dust card clicked in the scene arrives with a `starIndex` and — depending on how the focus was
   * built — with no `anchor`. The card tether used to reach for the anchor first on this plane, find
   * none, return `null`, and drop the whole flight back to `planeTether`: the dust's own plane-level
   * tether, ~25 units out instead of ~2.2, with the card a tenth of the size it should be. The star
   * position is available the whole time, and it is also the more accurate of the two.
   */
  describe('a Blind Eternities card focused from the scene (PRD 6.2.3, 5.3.4)', () => {
    const dustRow = scenePlanes.planes.findIndex((p) => p.slug === BLIND_ETERNITIES_SLUG)
    /** A `stars.bin` that can place exactly one star, on the dust row. */
    const stars: StarSource = {
      starLocal: (index, out) => {
        if (index !== 11) return null
        set(out, 40, 0, 10)
        return dustRow
      },
    }

    /** Fly to a dust card and drive frames until the flight settles. */
    const settle = (target: {
      planeSlug: string
      oracleId: string
      starIndex?: number
      anchor?: readonly [number, number, number]
    }): ReturnType<typeof createSceneNavigation> => {
      const scene = createSceneNavigation(scenePlanes, { drive: 'manual', stars })
      scene.api.flyToCard(target)
      let frames = 0
      while (scene.api.snapshot().flight !== null && frames < 120 * 10) {
        scene.update(1 / 120)
        frames += 1
      }
      return scene
    }

    it('tethers to the card from its starIndex alone, with no anchor', () => {
      expect(dustRow).toBeGreaterThanOrEqual(0)
      const scene = settle({
        planeSlug: BLIND_ETERNITIES_SLUG,
        oracleId: 'x',
        starIndex: 11,
      })
      expect(scene.rig.currentTether.kind).toBe('card')
      expect(levelOf(scene.api.snapshot().focus)).toBe('card')
      expect(scene.rig.currentTether.planeIndex).toBe(dustRow)
      // The star's own local position, not the plane centre: this is what the anchor-only branch
      // could not supply and what the fall-back to `planeTether` threw away.
      expect(scene.rig.currentTether.local.x).toBeCloseTo(40, 9)
      expect(scene.rig.currentTether.local.z).toBeCloseTo(10, 9)
      // ~2.2 units out, not the dust plane's ~25. One number for "the card fills the frame".
      expect(scene.rig.currentTether.frameDistance).toBeLessThan(4)
      scene.api.dispose()
    })

    it('prefers the star position to a stale anchor when it has both', () => {
      const scene = settle({
        planeSlug: BLIND_ETERNITIES_SLUG,
        oracleId: 'x',
        starIndex: 11,
        // `worldToPlaneLocal` cannot invert PRD 8.6.3's curl, so an anchor round-tripped through it
        // lands a little off the dust it points at. The star position is exact.
        anchor: [0, 0, 0],
      })
      expect(scene.rig.currentTether.kind).toBe('card')
      expect(scene.rig.currentTether.local.x).toBeCloseTo(40, 9)
      scene.api.dispose()
    })

    it('still falls back to the anchor when stars.bin cannot place the star yet (PRD 6.7.1)', () => {
      const scene = settle({
        planeSlug: BLIND_ETERNITIES_SLUG,
        oracleId: 'x',
        // Not 11: this star index is one `starLocal` cannot resolve, which is the cold-start state.
        starIndex: 12,
        anchor: [40, 0, 10],
      })
      expect(scene.rig.currentTether.kind).toBe('card')
      scene.api.dispose()
    })
  })

  it('scales the two-stage card fly-to with distance under the 3.5 s cap (PRD 6.2.3, 5.7.3)', () => {
    // The duration is not on the API — PRD 5.7.3 makes it the scene's, not the caller's — so it is
    // measured the way a user experiences it: drive frames until the flight settles.
    const flightMs = (from: Focus | null): number => {
      const scene = createSceneNavigation(scenePlanes, {
        drive: 'manual',
        ...(from && { initialFocus: from }),
      })
      scene.api.flyToCard({ planeSlug: 'innistrad', oracleId: 'a' })
      let frames = 0
      while (scene.api.snapshot().flight !== null && frames < 120 * 10) {
        scene.update(1 / 120)
        frames += 1
      }
      scene.api.dispose()
      return (frames / 120) * 1000
    }

    // Both of these are two-stage: neither start is inside Innistrad (PRD 6.2.3, not 6.2.4).
    const fromKaldheim = flightMs({ kind: 'plane', slug: 'kaldheim' })
    const fromHome = flightMs(null)

    // PRD 6.2.3's 3.5 s is a *cap* on the combined flight. Before DEC-606 both of these took it in
    // full, because the scene returned the cap unconditionally for every two-stage fly-to.
    expect(fromKaldheim).toBeLessThan(3400)
    expect(fromKaldheim).toBeGreaterThan(1200) // still two legs and a hold, not one hop
    // PRD 5.7.3: further is slower, and the cap still binds at the far end.
    expect(fromHome).toBeGreaterThan(fromKaldheim)
    expect(fromHome).toBeLessThan(3600) // 3.5 s plus the frame it settles on

    // PRD 6.2.4: from inside the plane it is one stage, and the cap has nothing to do with it.
    expect(flightMs({ kind: 'plane', slug: 'innistrad' })).toBeLessThan(1400)
  })
})
