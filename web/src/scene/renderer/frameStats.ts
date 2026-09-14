/**
 * What the loop reports outwards: one mutable record, polled (review §3.6 phase 3, item 3).
 *
 * > outbound = a mutable `FrameStats` snapshot polled by one HUD leaf at 2 Hz.
 *
 * **The defect this replaces.** Everything the scene told the UI went out as React state on
 * `SceneView` — the component that owns the canvas. `onQualityChange` called `setTier`, and under
 * the free ladder the quality monitor changes tier about twice a second, so the canvas owner
 * re-rendered twice a second for the life of the session. `PostEffects`, `StarScene`, `CardTier`
 * and `PixelRatioHost` are all its children, and all of them re-ran. That is review finding R1, and
 * `EternitiesScene`'s own comments name it three separate times while still doing it — the warm-up
 * result, the backing-store size and the probe's three values each got shunted into a `useRef`
 * *specifically* to dodge it. A ref per escaping value is the workaround; this is the seam.
 *
 * So: the loop writes numbers here, every frame, into fields that already exist. Nothing subscribes.
 * One leaf polls at 2 Hz and re-renders itself when a number it displays has actually moved.
 *
 * **No allocation per frame** (PRD 7.3.2). Writers assign to fields on this one object; they never
 * construct a snapshot. The 2 Hz reader is the only thing that copies, 120 times a minute, off the
 * frame path entirely.
 *
 * **No three.js here, deliberately.** Every field is a number or a string, which is what lets
 * `ui/` import this module under the boundary `eslint.config.js` puts on it (review §3.6, item 6).
 * A `Vector2` for the bloom size would have made the HUD import three to read its width.
 */

/** The fields the loop writes and the HUD reads. Plain data; see the header. */
export interface FrameStatsFields {
  /** Wall-clock interval between the last two ticks, in ms. PRD 7.2's frame time. */
  frameMs: number
  /**
   * CPU time the tick's own work cost, in ms — measured across the phases, not across the frame.
   *
   * A floor rather than the whole cost: it stops at the end of `quality` and the GPU has not
   * necessarily finished the `draw` phase's passes when it does. `StarScene` reported the same
   * figure with the same caveat and the bench treats it the same way.
   */
  cpuMs: number
  /** Stars the field is drawing (PRD 8.7.3's streamed count). */
  drawn: number
  /** The live quality tier's label (PRD 8.5.11). */
  qualityTier: string
  /** How many times the monitor has changed tier this session. PRD 9.1.4's forced-degradation check. */
  qualityChanges: number
  /** The bloom source's real size, which since DEC-703 is also the size the rung asked for. */
  bloomWidth: number
  bloomHeight: number
  /** Thumbnails the tier is drawing right now (PRD 5.5). */
  thumbnails: number
  /** PRD 7.2's six-request image budget, as it is being spent. */
  imagesInFlight: number
  /** Live GPU bytes for the atlas and for everything the focused card has uploaded (PRD 7.2). */
  atlasBytes: number
  cardBytes: number
}

/** A read-only view of {@link FrameStatsFields}, for consumers that must not write. */
export type FrameStatsSnapshot = Readonly<FrameStatsFields>

/** The field list, in one place, so the copy and the compare below cannot drift apart. */
const FIELDS = [
  'frameMs',
  'cpuMs',
  'drawn',
  'qualityTier',
  'qualityChanges',
  'bloomWidth',
  'bloomHeight',
  'thumbnails',
  'imagesInFlight',
  'atlasBytes',
  'cardBytes',
] as const

export function createFrameStats(): FrameStatsFields {
  return {
    frameMs: 0,
    cpuMs: 0,
    drawn: 0,
    qualityTier: '',
    qualityChanges: 0,
    bloomWidth: 0,
    bloomHeight: 0,
    thumbnails: 0,
    imagesInFlight: 0,
    atlasBytes: 0,
    cardBytes: 0,
  }
}

/** A fresh copy, for a reader that needs a value React can compare by identity. */
export function copyFrameStats(from: FrameStatsSnapshot): FrameStatsFields {
  return { ...from }
}

/**
 * Whether any field the HUD displays has moved.
 *
 * The point of asking: `frameMs` changes every single frame, so a poller that re-rendered on any
 * difference would re-render twice a second forever — including on a still scene under reduced
 * motion, which is the case PRD 5.9 exists to make cheap. Callers that display a *quantised*
 * frame time should compare against their own rounding, which is what {@link sameDisplayedStats}
 * is for.
 */
export function sameStats(a: FrameStatsSnapshot, b: FrameStatsSnapshot): boolean {
  for (const field of FIELDS) {
    if (a[field] !== b[field]) return false
  }
  return true
}

/**
 * Whether two samples would *render* the same, at the precision the HUD shows.
 *
 * Frame and CPU times are compared at whole milliseconds and byte counts at whole kilobytes,
 * because that is what the readouts print. Two samples that differ only below the printed
 * precision are the same picture, and re-rendering for them is the 2 Hz version of the per-frame
 * re-render this whole seam exists to stop.
 */
export function sameDisplayedStats(a: FrameStatsSnapshot, b: FrameStatsSnapshot): boolean {
  return (
    Math.round(a.frameMs) === Math.round(b.frameMs) &&
    Math.round(a.cpuMs) === Math.round(b.cpuMs) &&
    a.drawn === b.drawn &&
    a.qualityTier === b.qualityTier &&
    a.qualityChanges === b.qualityChanges &&
    a.bloomWidth === b.bloomWidth &&
    a.bloomHeight === b.bloomHeight &&
    a.thumbnails === b.thumbnails &&
    a.imagesInFlight === b.imagesInFlight &&
    Math.round(a.atlasBytes / 1024) === Math.round(b.atlasBytes / 1024) &&
    Math.round(a.cardBytes / 1024) === Math.round(b.cardBytes / 1024)
  )
}

/** How often the HUD leaf polls, per the scope. Exported so the test and the leaf agree. */
export const FRAME_STATS_POLL_MS = 500
