/**
 * The tick: one `requestAnimationFrame`, a fixed phase order, no React (review §3.5, §3.6 phase 3).
 *
 * Review §3.5 asks for "one tick owner". DEC-703 landed the first half of it — `PostEffects`
 * subscribed at `useFrame` priority 1, which takes react-three-fiber off the render path and makes
 * the post chain the last thing to run. This is the other half: the order stops being a property of
 * *where components are mounted* and becomes a property of this file.
 *
 * **Why the mount-order arrangement had to go.** Before this, a frame was five `useFrame`
 * subscribers (`StarScene`, `MotionSync`, `CameraRigController`, `CardTier`, `PostEffects`) plus
 * `PlaneLabels` on a `requestAnimationFrame` of its own. R3F runs same-priority subscribers in
 * subscription order, which is mount order, which is JSX sibling order in `EternitiesScene` — so
 * the frame's contract was "these five JSX elements are in this order, and one of them is in a
 * different file entirely". Nothing failed if someone reordered the siblings; the tether just went
 * a frame stale. Here the order is {@link TICK_PHASES}, a list, and `test/frame-loop.test.ts`
 * asserts it.
 *
 * **The labels were a second clock.** `PlaneLabels` drove its own rAF because HTML cannot live
 * inside an R3F tree (PRD 8.4.4), so label placement ran at an arbitrary offset from the frame that
 * moved the camera — the browser gives both callbacks the same timestamp but not the same position
 * in the queue, and the labels' callback was registered first on a cold load. A label a frame
 * behind the plane it names is PRD 5.3.8's whole complaint. The `labels` phase below runs *after*
 * `rig`, which is where the camera matrices become final, so the two cannot disagree.
 *
 * No allocation per tick (PRD 7.3.2): the step list is flattened on subscription change, not per
 * frame, and one mutable {@link FrameTiming} is reused for the life of the loop.
 */

/**
 * The frame, in order. This list is the contract; everything else here is plumbing.
 *
 * The issue's scope names it as `input -> rig.update(dt) -> plane table -> uniforms -> async pick ->
 * main pass -> bloom source -> mip chain -> composite -> label tick -> quality sample`. Two
 * deliberate departures, both recorded here because a reviewer will diff this list against that
 * sentence:
 *
 *  1. **`planeTable` and `motionSync` run before `rig`, not after it.** The scope has the rig first.
 *     That inverts a documented dependency: `scene/MotionSync` copies the table's time, multiverse
 *     angle and per-plane spin angles into the rig's motion mirror, and `CameraRig.update` tethers
 *     through that mirror. Advancing the rig first would tether frame N's camera to frame N-1's
 *     plane positions — a one-frame lag between the camera and the card sitting on its star, which
 *     is exactly what PRD 8.5.7's CPU mirror exists to prevent. The table's `advance` needs nothing
 *     from the rig but the spin scales, which `motionSync` writes for the *next* advance, so
 *     table-then-rig is the order with no stale read in it. Flagged on DEC-740 for the reviewer.
 *  2. **The four draw steps are one phase, `draw`.** `PostChain.render` runs main pass, bloom
 *     source, mip chain and composite itself, in that order, and DEC-703 made it deliberately the
 *     only thing in the app that binds a framebuffer during a frame. Splitting it into four
 *     subscribable phases would hand that back out.
 *
 * `cards` is not in the scope's sentence and has to be somewhere: the card tier reads the camera's
 * world position and direction and projects the hovered planet's label, so it runs after `rig` and
 * before anything draws.
 */
export const TICK_PHASES = [
  /** Drain whatever the pointer and wheel listeners queued since the last tick. */
  'input',
  /** `PlaneTable.advance` and the background shells (PRD 5.3.17). */
  'planeTable',
  /** Table clock -> rig motion mirror, eased spin scale -> table (PRD 5.6.6, 8.4.5). */
  'motionSync',
  /** `CameraRig.update(dt)`, then the camera's position, look-at and world matrix. */
  'rig',
  /** Per-frame uniform writes: sprite sizing, bloom scale, point-size clamp. */
  'uniforms',
  /** Thumbnail tier, focused card springs, planet label projection (PRD 5.5, 5.6). */
  'cards',
  /** At most one id-buffer read in flight (PRD 8.5.6). Fires and forgets; resolves later. */
  'pick',
  /** `PostChain.render`: main pass -> bloom source -> mip chain -> composite (DEC-703). */
  'draw',
  /** HTML label placement, after the camera matrices are final (PRD 5.3.8-12, 8.4.4). */
  'labels',
  /** `QualityMonitor.sample` and the `FrameStats` snapshot (PRD 8.5.11, 7.2). */
  'quality',
] as const

export type TickPhase = (typeof TICK_PHASES)[number]

const PHASE_INDEX = new Map<TickPhase, number>(TICK_PHASES.map((phase, index) => [phase, index]))

export interface FrameTiming {
  /**
   * Seconds since the previous tick.
   *
   * Unclamped, which matches what R3F handed `useFrame` (a `THREE.Clock` delta) and therefore
   * preserves the behaviour this refactor is not allowed to change. A backgrounded tab still
   * returns one large delta; it did before too.
   */
  readonly delta: number
  /** The `requestAnimationFrame` timestamp, or `performance.now()` when stepped by hand. */
  readonly now: number
  /** Ticks since {@link FrameLoop.start}; 1 on the first. */
  readonly frame: number
}

export type FrameStep = (timing: FrameTiming) => void

interface Registration {
  readonly phase: TickPhase
  readonly step: FrameStep
  /** Insertion order, so two steps in one phase keep the order they subscribed in. */
  readonly seq: number
}

export interface FrameLoopOptions {
  /** Injected by `test/frame-loop.test.ts` and by the bench, which steps the loop by hand. */
  readonly requestFrame?: (callback: (now: number) => void) => number
  readonly cancelFrame?: (handle: number) => void
  readonly now?: () => number
  /**
   * Called once after every step in a tick has run, with the CPU time they took.
   *
   * A hook rather than a `quality`-phase subscriber because "last" is the whole point and a phase
   * cannot express it: subscriptions within a phase run in insertion order, so anything that
   * subscribed to `quality` later would run *after* a step that claimed to measure the tick. This
   * is the one measurement whose correctness depends on nothing else being appendable behind it.
   */
  readonly onTickEnd?: (timing: FrameTiming, cpuMs: number) => void
}

export class FrameLoop {
  private readonly registrations = new Set<Registration>()
  /** The flattened, phase-ordered step list. Rebuilt on subscription change, never per tick. */
  private steps: FrameStep[] = []
  private dirty = false
  private seq = 0

  private handle: number | null = null
  private lastNow = 0
  private frame = 0

  /** Reused every tick (PRD 7.3.2). Handed out as `FrameTiming`, whose fields are readonly. */
  private readonly timing = { delta: 0, now: 0, frame: 0 }

  private readonly requestFrame: (callback: (now: number) => void) => number
  private readonly cancelFrame: (handle: number) => void
  private readonly now: () => number
  private readonly onTickEnd: ((timing: FrameTiming, cpuMs: number) => void) | null

  constructor(options: FrameLoopOptions = {}) {
    this.requestFrame =
      options.requestFrame ?? ((callback) => requestAnimationFrame((now) => callback(now)))
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle))
    this.now = options.now ?? (() => performance.now())
    this.onTickEnd = options.onTickEnd ?? null
  }

  get running(): boolean {
    return this.handle !== null
  }

  /**
   * Register a step in a phase. Returns its unsubscribe.
   *
   * Safe to call from inside a tick: the flat list is rebuilt at the top of the *next* one, so the
   * array being iterated is never mutated underneath the loop.
   */
  subscribe(phase: TickPhase, step: FrameStep): () => void {
    const registration: Registration = { phase, step, seq: this.seq++ }
    this.registrations.add(registration)
    this.dirty = true
    return () => {
      this.registrations.delete(registration)
      this.dirty = true
    }
  }

  start(): void {
    if (this.handle !== null) return
    // Not zero: the first tick's delta is measured against the moment the loop started, not against
    // the epoch, which would hand every subscriber a delta of ~1.7e9 seconds on the first frame.
    this.lastNow = this.now()
    this.schedule()
  }

  stop(): void {
    if (this.handle === null) return
    this.cancelFrame(this.handle)
    this.handle = null
  }

  /**
   * Run one frame. Public so the bench, the self-check and the tests can step the loop by hand
   * rather than racing a real rAF — `scripts/bench.mjs` needs a frame it can attribute.
   */
  tick(now: number): void {
    if (this.dirty) this.rebuild()

    const delta = Math.max(0, (now - this.lastNow) / 1000)
    this.lastNow = now
    this.timing.delta = delta
    this.timing.now = now
    this.timing.frame = ++this.frame

    const steps = this.steps
    const end = this.onTickEnd
    if (end === null) {
      for (let i = 0; i < steps.length; i += 1) steps[i]!(this.timing)
      return
    }

    // In a `finally` so a throwing step is still measured and still reported: the frame it broke is
    // exactly the frame worth having a number for, and `schedule` has already booked the next one.
    const started = this.now()
    try {
      for (let i = 0; i < steps.length; i += 1) steps[i]!(this.timing)
    } finally {
      end(this.timing, this.now() - started)
    }
  }

  /** The phase-ordered step list, for `test/frame-loop.test.ts`. */
  stepCount(): number {
    if (this.dirty) this.rebuild()
    return this.steps.length
  }

  private schedule(): void {
    this.handle = this.requestFrame((now) => {
      // Rescheduled *before* the steps run, so a step that throws costs one frame rather than the
      // session. Under R3F a throwing subscriber killed the loop outright; nothing depended on
      // that, and a dropped frame is the better failure.
      this.schedule()
      this.tick(now)
    })
  }

  private rebuild(): void {
    this.steps = [...this.registrations]
      .sort((a, b) => {
        const byPhase = PHASE_INDEX.get(a.phase)! - PHASE_INDEX.get(b.phase)!
        return byPhase !== 0 ? byPhase : a.seq - b.seq
      })
      .map((registration) => registration.step)
    this.dirty = false
  }
}
