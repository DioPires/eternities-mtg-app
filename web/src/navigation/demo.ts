/**
 * The demo caller.
 *
 * Its whole job is to type-check: it exercises every method, event and focus shape of the
 * navigation contract exactly as Phase 4 will, so a breaking change to `types.ts` fails
 * `pnpm typecheck` instead of failing a person. It is also runnable — `pnpm test` runs it
 * against the stub — so a change that type-checks but breaks the state machine fails too.
 *
 * Each block cites the PRD requirement it stands in for.
 */

import { createNavigationStub } from './stub'
import {
  levelOf,
  type Focus,
  type NavigationApi,
  type NavigationSnapshot,
  type Vec3,
} from './types'

export interface DemoLog {
  readonly events: string[]
  readonly snapshots: NavigationSnapshot[]
  readonly finalFocus: Focus
}

/**
 * Walks the whole contract. `nav` defaults to the Phase 0 stub; pass Phase 2b's real
 * implementation to run the same script against the scene.
 */
export async function runNavigationDemo(nav: NavigationApi = createNavigationStub({ instant: true })): Promise<DemoLog> {
  const events: string[] = []
  const snapshots: NavigationSnapshot[] = []
  const unsubscribes = [
    nav.subscribe((snapshot) => snapshots.push(snapshot)),
    nav.on('focuschange', ({ focus, reason }) => events.push(`focuschange:${focus.kind}:${reason}`)),
    nav.on('flightstart', ({ id, reason }) => events.push(`flightstart:${id}:${reason}`)),
    nav.on('flightend', ({ id, status }) => events.push(`flightend:${id}:${status}`)),
    nav.on('handover', ({ cause, camera }) =>
      events.push(`handover:${cause}:${camera.distance.toFixed(0)}`),
    ),
    nav.on('attractenter', () => events.push('attractenter')),
    nav.on('attractexit', ({ cause }) => events.push(`attractexit:${cause}`)),
    nav.on('anchorchange', ({ anchor }) => events.push(`anchorchange:${anchor.join(',')}`)),
  ]

  // PRD 6.8.2 / 6.7.3: a deep link plays the intro into its target, not into the home position.
  const deepLinkTarget: Focus = { kind: 'plane', slug: 'ravnica' }
  await nav.playIntro(deepLinkTarget, { reason: 'deep-link' }).done
  // Once per session: the second call is a resolved no-op.
  await nav.playIntro({ kind: 'multiverse' }).done

  // PRD 5.7.2 / 6.3.1: click a plane, then the breadcrumb back out.
  await nav.flyToPlane('dominaria', { reason: 'user' }).done
  await nav.flyToMultiverse({ reason: 'breadcrumb' }).done

  // PRD 5.3.4: the Blind Eternities carries an anchor, and re-anchoring changes no route.
  const anchor: Vec3 = [12, 0.5, -30]
  await nav.flyToBlindEternities(anchor, { reason: 'user' }).done
  await nav.flyToBlindEternities([40, 0, 10], { reason: 'user' }).done

  // PRD 6.2.3: two-stage fly-to from outside the card's plane, capped at 3.5 s.
  await nav.flyToCard(
    { planeSlug: 'innistrad', oracleId: '00000000-0000-4000-8000-000000000004' },
    { reason: 'search' },
  ).done

  // PRD 6.2.4: single-stage inside the same plane, this time with the star index resolved.
  await nav.flyToCard(
    { planeSlug: 'innistrad', oracleId: '00000000-0000-4000-8000-000000000005', starIndex: 42 },
    { reason: 'random' },
  ).done

  // PRD 6.1.3: Esc walks up card to plane to multiverse, then does nothing.
  await nav.focusParent({ reason: 'history' })?.done
  await nav.focusParent({ reason: 'history' })?.done
  const atRoot = nav.focusParent({ reason: 'history' })
  events.push(`focusParent-at-multiverse:${atRoot === null ? 'null' : 'flight'}`)

  // PRD 5.7.3: input cancels a fly-to and hands control over without a jump.
  const interrupted = nav.flyToPlane('kaldheim', { reason: 'user', durationMs: 5000 })
  nav.handOver('pointer')
  events.push(`interrupted:${(await interrupted.done).status}`)

  // A newer fly-to supersedes the one in flight.
  const superseded = nav.flyToPlane('tarkir', { durationMs: 5000 })
  const winner = nav.flyToPlane('theros', { durationMs: 5000 })
  events.push(`superseded:${(await superseded.done).status}`)
  winner.cancel('route')
  events.push(`cancelled:${(await winner.done).status}`)

  // PRD 5.3.22-23: attract mode enters after idle and any input cancels it.
  nav.enterAttract()
  nav.handOver('wheel')
  events.push(`attract-after-input:${nav.snapshot().attract}`)

  // PRD 5.9 / 6.10.1: reduced motion shortens every fly-to.
  nav.setReducedMotion(true)
  await nav.flyToMultiverse({ reason: 'user' }).done
  events.push(`reducedMotion:${nav.snapshot().reducedMotion}`)

  const finalFocus = nav.snapshot().focus
  events.push(`level:${levelOf(finalFocus)}`)

  for (const unsubscribe of unsubscribes) unsubscribe()
  nav.dispose()

  return { events, snapshots, finalFocus }
}
