/**
 * The tick order, pinned (DEC-740, review §3.5).
 *
 * The defect this is written against is specific, so the bar is too: before this leg the frame's
 * order was the mount order of five `useFrame` subscribers, and reordering the JSX siblings in
 * `EternitiesScene` silently reordered the frame. Every ordering assertion below therefore
 * subscribes in an order that is *wrong* — reversed, or interleaved — and asserts the run order is
 * `TICK_PHASES` anyway. A test that subscribed in the right order would pass against a loop that
 * ignored phases entirely.
 */

import { describe, expect, it, vi } from 'vitest'

import { FrameLoop, TICK_PHASES, type TickPhase } from '../src/scene/renderer/frameLoop'

/**
 * A loop with a hand-cranked clock: no rAF, no `performance.now()`, no timing flake.
 *
 * `startNow` is deliberately **not** zero. The first draft of this helper returned 0, and the
 * consequence was a live mutant: `FrameLoop.start()` latches `lastNow = now()` so the first frame's
 * delta is measured from the start rather than from the epoch, and with a clock reading 0 that latch
 * writes the value the field already held. Deleting the latch entirely left all fourteen tests
 * green while the comment in the timing test claimed to pin it. A clock that agrees with the
 * uninitialised state cannot see an initialisation bug.
 */
const START_NOW = 1000

function manualLoop(): {
  loop: FrameLoop
  /** Run the frame the loop has scheduled, at `now` ms. Returns false if nothing was scheduled. */
  step: (now: number) => boolean
  cancelled: () => number
} {
  let pending: ((now: number) => void) | null = null
  let cancels = 0
  const loop = new FrameLoop({
    requestFrame: (callback) => {
      pending = callback
      return 1
    },
    cancelFrame: () => {
      cancels += 1
      pending = null
    },
    now: () => START_NOW,
  })
  return {
    loop,
    step: (now) => {
      const callback = pending
      if (!callback) return false
      pending = null
      callback(now)
      return true
    },
    cancelled: () => cancels,
  }
}

/** Subscribe one recording step per phase, in the given order. */
function record(loop: FrameLoop, phases: readonly TickPhase[], log: string[]): void {
  for (const phase of phases) loop.subscribe(phase, () => log.push(phase))
}

describe('FrameLoop phase order', () => {
  it('runs phases in TICK_PHASES order when subscribed in reverse', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    // The mutant this kills: a loop that runs steps in subscription order. It would log the
    // reversed list, which is `TICK_PHASES` reversed and never equal to it (the list has 10
    // distinct entries, so it is not a palindrome).
    record(loop, [...TICK_PHASES].reverse(), log)

    loop.tick(16)

    expect(log).toEqual([...TICK_PHASES])
  })

  it('runs phases in TICK_PHASES order when subscribed interleaved', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    // Evens then odds: neither subscription order nor its reverse is the answer, so a loop that
    // got the sort direction backwards fails here too.
    const evens = TICK_PHASES.filter((_, i) => i % 2 === 0)
    const odds = TICK_PHASES.filter((_, i) => i % 2 === 1)
    record(loop, [...evens, ...odds], log)

    loop.tick(16)

    expect(log).toEqual([...TICK_PHASES])
  })

  it('keeps subscription order within one phase', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    loop.subscribe('uniforms', () => log.push('first'))
    loop.subscribe('uniforms', () => log.push('second'))
    loop.subscribe('uniforms', () => log.push('third'))

    loop.tick(16)

    expect(log).toEqual(['first', 'second', 'third'])
  })

  /**
   * The issue's "label-lag statement", as an assertion rather than a sentence.
   *
   * Stated against the *camera write*, not against the phase name: the reason labels may not run
   * before `rig` is that `rig` is where `camera.updateMatrixWorld()` happens, and a label placed
   * from a stale matrix is PRD 5.3.8's defect. So the step in `rig` publishes a matrix version and
   * the step in `labels` reads it — a phase rename cannot make this pass by accident.
   */
  it('places labels against the matrices the rig wrote this frame, not last frame', () => {
    const { loop } = manualLoop()
    let matrixVersion = 0
    const seenByLabels: number[] = []

    loop.subscribe('labels', () => seenByLabels.push(matrixVersion))
    loop.subscribe('rig', ({ frame }) => {
      matrixVersion = frame
    })

    loop.tick(16)
    loop.tick(32)
    loop.tick(48)

    // Frame N's labels see frame N's matrices. A labels-before-rig loop logs [0, 1, 2] — the
    // one-frame lag — and a loop that never ran `rig` logs [0, 0, 0].
    expect(seenByLabels).toEqual([1, 2, 3])
  })

  it('runs draw after every phase that mutates the scene, and before labels and quality', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    record(loop, [...TICK_PHASES].reverse(), log)

    loop.tick(16)

    const at = (phase: TickPhase): number => log.indexOf(phase)
    // The four post sub-steps live inside `draw`; what this pins is that nothing that moves an
    // object runs after it, which is the invariant that made `PostEffects` a priority-1 subscriber.
    for (const phase of ['input', 'planeTable', 'motionSync', 'rig', 'uniforms', 'cards'] as const) {
      expect(at(phase)).toBeLessThan(at('draw'))
    }
    expect(at('draw')).toBeLessThan(at('labels'))
    expect(at('labels')).toBeLessThan(at('quality'))
  })

  it('advances the plane table and syncs motion before the rig reads its mirror', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    record(loop, ['rig', 'motionSync', 'planeTable'], log)

    loop.tick(16)

    // The departure from the issue's written order, asserted so it cannot be undone by accident.
    // See the `TICK_PHASES` header: rig-first tethers frame N's camera to frame N-1's planes.
    expect(log).toEqual(['planeTable', 'motionSync', 'rig'])
  })
})

describe('FrameLoop subscription lifetime', () => {
  it('takes a mid-tick unsubscribe on the next tick, not the current one', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    let drop = (): void => {}
    loop.subscribe('input', () => {
      log.push('input')
      drop()
    })
    drop = loop.subscribe('quality', () => log.push('quality'))

    loop.tick(16)
    // The current tick completes with the list it started with: iterating an array that a step
    // spliced underneath it is the bug this shape exists to rule out.
    expect(log).toEqual(['input', 'quality'])

    loop.tick(32)
    expect(log).toEqual(['input', 'quality', 'input'])
  })

  it('takes a mid-tick subscribe on the next tick', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    let added = false
    loop.subscribe('input', () => {
      log.push('input')
      if (added) return
      added = true
      loop.subscribe('quality', () => log.push('quality'))
    })

    loop.tick(16)
    expect(log).toEqual(['input'])

    loop.tick(32)
    expect(log).toEqual(['input', 'input', 'quality'])
  })

  it('stops running an unsubscribed step', () => {
    const { loop } = manualLoop()
    const log: string[] = []
    const drop = loop.subscribe('draw', () => log.push('draw'))

    loop.tick(16)
    drop()
    loop.tick(32)

    expect(log).toEqual(['draw'])
  })
})

describe('FrameLoop timing', () => {
  it('reports delta in seconds and counts frames from one', () => {
    const { loop } = manualLoop()
    const deltas: number[] = []
    const frames: number[] = []
    loop.subscribe('input', ({ delta, frame }) => {
      deltas.push(delta)
      frames.push(frame)
    })

    loop.start()
    loop.tick(START_NOW + 16)
    loop.tick(START_NOW + 32)

    // The first tick is measured from the moment `start()` latched the clock, not from the field's
    // initial 0. Drop the latch and this first delta becomes 1.016 — which is what a real page
    // sees as a ~1.7e9 s first frame, since `performance.now()` is not the epoch but
    // `document.timeline`'s origin is far from zero by the time a scene mounts.
    expect(deltas).toEqual([0.016, 0.016])
    expect(frames).toEqual([1, 2])
  })

  it('never reports a negative delta', () => {
    const { loop } = manualLoop()
    const deltas: number[] = []
    loop.subscribe('input', ({ delta }) => deltas.push(delta))

    loop.tick(32)
    // A timestamp that goes backwards — which `document.timeline` can do across a tab restore —
    // must not run the springs in reverse.
    loop.tick(16)

    expect(deltas).toEqual([0.032, 0])
  })

  it('hands every step in a tick the same timing object values', () => {
    const { loop } = manualLoop()
    const seen: number[] = []
    record(loop, TICK_PHASES, [])
    for (const phase of TICK_PHASES) loop.subscribe(phase, ({ now }) => seen.push(now))

    loop.tick(48)

    expect(seen).toEqual(TICK_PHASES.map(() => 48))
  })
})

describe('FrameLoop scheduling', () => {
  it('schedules the next frame before running steps, so a throwing step costs one frame', () => {
    const { loop, step } = manualLoop()
    const log: string[] = []
    loop.subscribe('input', ({ frame }) => {
      if (frame === 1) throw new Error('boom')
      log.push(`ran ${frame}`)
    })

    loop.start()
    expect(() => step(16)).toThrow('boom')
    // The loop survived: the rAF for the next frame was already booked when the step threw.
    expect(step(32)).toBe(true)
    expect(log).toEqual(['ran 2'])
  })

  it('start is idempotent and stop cancels the pending frame', () => {
    const { loop, step, cancelled } = manualLoop()
    const spy = vi.fn()
    loop.subscribe('input', spy)

    loop.start()
    loop.start()
    expect(loop.running).toBe(true)

    loop.stop()
    expect(cancelled()).toBe(1)
    expect(loop.running).toBe(false)
    expect(step(16)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})
