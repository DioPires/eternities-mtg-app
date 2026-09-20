/**
 * World composition (spec §1.4–§1.6): the object that owns one world's sheet and drives it.
 *
 * Everything under `worlds/` up to this file is a part — the surface law, the geometry, the two
 * textures, the pool, the threshold, the stream. This is the thing that holds them and runs a
 * frame, and it is the seam {@link WorldsProbeSource} was written against: `?probe=` returns
 * `undefined` until a `WorldSurface` exists, which is exactly leg G's setup-failure path.
 *
 * > **Normative — the draw quantities have one spelling and it is `cellDrawAngles`/`drawRadius`
 * > (DEC-749).** The crossover, the art threshold and the probe all size cells from the *drawn*
 * > extents, never the nominal ones. Un-inset angles over-report a cell by 7.5% and the unlifted
 * > radius under-reports by 0.6%, and both land on the two numbers that are scored — W1's pixel
 * > floor and §1.11's 24 px proxy — while the picture stays correct, because the shader draws from
 * > its own attributes and only the *measurement* moves.
 *
 * GL enters this file in exactly two places: the `Mesh` it builds and the art texture it binds. The
 * per-frame body touches neither, so a whole frame can be run and asserted in jsdom.
 */

import { Matrix4, Mesh, Quaternion, Vector3, type DataArrayTexture, type ShaderMaterial } from 'three'

import { IMAGE_FADE_MS } from '../tuning'

import { ThresholdMemory, type AdaptiveThreshold, type ThresholdReport } from './adaptiveThreshold'
import { LAYER_FREE } from './artPool'
import type { ArtPool } from './artPool'
import { facesCamera, withinFrustum } from './cellSelection'
import { createCellMaterial, createCellPickMaterial, type CellUniforms } from './cellMaterial'
import { buildCellSheet, type CellSheet } from './cellSheet'
import { PICK_LAYER } from '../picking/idPicker'
import {
  bakeEquirectLayer,
  buildRowIndex,
  cellHeightPx,
  crossoverState,
  type CrossoverState,
} from './lod'
import { cellScreenRect } from './probePayload'
import { cellDrawAngles, drawRadius, rowColatitude, rowOfUnitY } from './surfaceLaw'
import { shufflePermutation, type WorldsSeams } from './seams'
import type { ArtStream } from './artStream'
import type { PlaneCentreSource } from './centre'
import type { ProbeCamera, WorldsProbeSource } from './worldsProbe'

/** The printing a cell's art comes from. `null` for a card with no printing to fetch. */
export interface WorldCard {
  readonly printingId: string
  /** `imageTs`, the cache-bust the shared image path already keys on (§1.6). */
  readonly imageTs: number
}

/** One world's decoded data, as leg P publishes it. */
export interface WorldSurfaceSource {
  readonly planeSlug: string | null
  /** One cell per card on the world (§1.4). */
  readonly cardCount: number
  /** The world's **published** `rowCells` (§2.4), never one recomputed on the client. */
  readonly rowCells: readonly number[]
  /** Decoded unit-sphere cell centres, three floats each. */
  readonly normals: Float32Array
  /** Per cell, the result of `rowOfUnitY` — matched by **nearest** row, never floored (§2.1). */
  readonly rows: Int32Array
  /** Linear RGB per **card**, three floats in 0..1 (§2.2). */
  readonly swatches: Float32Array
  /** Per {@link HueClass}, the plane's card count in that class. */
  readonly hueCounts: readonly number[]
  /** The world's radius in scene units, **before** §1.4's lift. */
  readonly radius: number
  /**
   * `planes.json`'s `home` — the world's centre with the multiverse **stopped at t=0**.
   *
   * Not where the world is. See `centre.ts`: PRD 5.3.15 drifts a plane around `home` and PRD 8.5.3
   * rotates the whole multiverse about `+Y`, so the live position is PRD 5.7.1's `planePosition`
   * and it is {@link WorldSurface.centre}, written per frame. This field is the composition-time
   * fixture and is the **seed** for that vector, nothing more — reading it as a position is
   * DEC-804.
   */
  readonly home: Vector3
  /** The printing for a **card** index — called with a card, never with a cell. See `cardOfCell`. */
  readonly cardOf: (card: number) => WorldCard | null
  /**
   * The offset that turns this world's card index into the **art pool's** key (§1.6, §1.12).
   *
   * > **Normative — the pool is one pool for the whole multiverse, so its keys have to be
   * > multiverse-wide (DEC-749).** §1.12 budgets a *single* art pool of 1,024 layers, and §1.2 keeps
   * > every world's sheet resident because any number of them may be above the crossover at once. A
   * > surface that offered `pool.reserve(card)` with its own 0-based card index would therefore have
   * > Dominaria's card 5 and Alara's card 5 claim **the same layer**: the second world's request is
   * > de-duplicated against the first's as an already-held key, so it never fetches, and its cell
   * > samples the first world's art at full opacity for the rest of the session. No fetch fails, no
   * > counter moves, and the pool's own `resident` invariant still holds — the only symptom is cards
   * > wearing other planes' pictures.
   *
   * `stars.bin`'s `starOffset` is the natural value: star order *is* the swatch encoding (§2.2), so
   * `starOffset + card` is already the multiverse-wide identity every other artefact keys on. It is
   * required rather than defaulted because a default of 0 is exactly the aliasing above, silently.
   */
  readonly artKeyBase: number
}

/** What the surface is driven with. The pool and threshold are shared; the stream may be absent. */
export interface WorldSurfaceOptions {
  readonly seams: WorldsSeams
  readonly pool: ArtPool
  readonly threshold: AdaptiveThreshold
  /** `null` on a build with no art stream — a legal swatch-only world (§1.6). */
  readonly stream: ArtStream | null
  /** The pool texture the material samples, or `null` for swatch-only. */
  readonly artTexture: DataArrayTexture | null
}

/**
 * The capacity §1.6's quantile is taken against: the pool's layers **and** what the budget can pay
 * to keep resident, whichever is smaller (§1.6, DEC-819).
 *
 * > **Normative — the threshold is budget-aware (board ruling on DEC-816 R2).** It used to be
 * > `pool.layers` alone. The two bounds are independent — a pool can have layers free while the
 * > budget is spent — so on a world whose bodies are large enough the quantile admitted a working
 * > set the session could not pay for and the stream then declined its tail for budget, arriving at
 * > swatch-only *by exhaustion* rather than by policy. See {@link ArtStream.affordableCells} for the
 * > conversion, for why it is a total rather than a remainder, and for why it cannot bind at the
 * > shipped default.
 *
 * A stream-less world is a legal swatch-only build (§1.6) with no budget to be bound by, so the
 * pool is the whole of its bound: `null` here must not read as "affords nothing", which would raise
 * the threshold on a world that has no byte problem. `admitted` is still a true count of what the
 * frame *would* have asked for, which is what `wantsArt` reports.
 */
export function admissibleCells(pool: ArtPool, stream: ArtStream | null): number {
  if (stream === null) return pool.layers
  return Math.min(pool.layers, stream.affordableCells)
}

/** One tick's view state. */
export interface WorldFrame {
  readonly camera: ProbeCamera
  readonly viewport: { readonly width: number; readonly height: number }
  /** The camera's **vertical** field of view, in radians. */
  readonly fovRadians: number
  readonly deltaSeconds: number
  /** §1.7's key light, a unit vector in world space. */
  readonly lightDirection: Vector3
  /**
   * Where each plane is **this frame** (DEC-804). See `centre.ts`.
   *
   * On the frame rather than passed beside it because §1.2's steps 2, 4, 7 and 8 all place geometry
   * at a world's centre and all four take a {@link WorldFrame}: a centre supplied to some of them
   * and not others is a system icosphere at one position cross-fading into a cell sheet at another,
   * across §1.5's whole band, which draws as a smear rather than as an error.
   */
  readonly centreOf: PlaneCentreSource
}

/** §1.6's art cross-fade, in seconds. PRD 7.3.5 — "images fade in over 200 ms". */
export const ART_FADE_S = IMAGE_FADE_MS / 1000

const worldPoint = new Vector3()
const toCamera = new Vector3()
const scratchNormal = new Vector3()

/**
 * The world's centre in its **own** frame, and the model matrix's scale.
 *
 * Both exist so the local-frame substitution has one spelling. §1.3's radius is not a scale on the
 * model matrix — it is baked into `iSize` and into `uRadius`, and putting it here as well would
 * apply it twice, which draws a world `radius²` across and still looks like a world.
 */
const LOCAL_ORIGIN = new Vector3(0, 0, 0)
const UNIT_SCALE = new Vector3(1, 1, 1)

/**
 * One composed world.
 *
 * > **Normative — residency drives the picture, admission drives the asking (§1.6, DEC-752).** A
 * > cell draws art when the pool holds its key *resolved*, and asks for art when it is above the
 * > frame's effective threshold. The two are deliberately not the same predicate:
 * >
 * > - **Fading toward a RESERVED layer shows the previous card's pixels.** `ArtPool.layerOf`
 * >   returns `null` while a fetch is in flight — a reserved layer holds no art yet — so the fade
 * >   may only advance on a layer that has resolved. Keying the fade on `reserve`'s return instead
 * >   cross-fades every cell into whatever its layer held before it was claimed.
 * > - **Eviction has to pull the picture back, and this is the only place that can.** A cell
 * >   holding layer `L` at `iArt = 1` whose key is evicted keeps sampling `L`, which now belongs to
 * >   another card — so it shows the *wrong card's art*, at full opacity, indefinitely. Re-reading
 * >   `layerOf` every frame is what repairs it; there is no eviction callback and adding one would
 * >   put the same invariant in two places.
 * >
 * > Tying the picture to admission instead would also flicker the boundary cells the threshold's
 * > hysteresis exists to hold still.
 */
export class WorldSurface {
  readonly sheet: CellSheet
  readonly material: ShaderMaterial
  readonly mesh: Mesh
  /** §1.11's pick material — the same GLSL with `ID_PASS`, sharing {@link material}'s uniforms. */
  readonly pickMaterial: ShaderMaterial
  /** The sheet on {@link PICK_LAYER}, so PRD 8.5.6's id pass hits cells (§1.11). */
  readonly pickMesh: Mesh
  /** The world's 256x128 equirect bake, for §1.5's far LOD. Written once, at build. */
  readonly equirect: Uint8Array
  /**
   * Cell to **card**. The identity unless `?bands=shuffle` is on.
   *
   * > A global permutation of cards across cells is the only one of the four spellings of that
   * > control that is not silently green (§1.6, DEC-752): relabelling the reported `band`,
   * > permuting the band-to-class map and permuting *within* a band all leave every band internally
   * > uniform, so W3 still passes. The grid and the reported `band` are untouched here — what moves
   * > is which card's swatch and which card's **art** a cell carries, so the multiset of swatches
   * > inside a band changes, which is the distinguishing assertion.
   */
  readonly cardOfCell: Uint32Array

  private readonly source: WorldSurfaceSource
  private readonly options: WorldSurfaceOptions
  private readonly lifted: number
  /** `dphi/2` after the inset — the same on every row (§2.1), which is what makes it a scalar. */
  private readonly latArc: number
  /**
   * Per cell, the parameterisation `cellScreenRect` needs. Fixed at build: a cell's row, its row's
   * colatitude, its longitude and its row's longitudinal arc are all properties of the lattice, not
   * of the camera, so recomputing them every frame would be 6,271 `atan2`es a frame for nothing.
   */
  private readonly colatitude: Float64Array
  private readonly longitude: Float64Array
  private readonly lonArc: Float64Array

  /**
   * Per cell, this frame.
   *
   * `Float64Array`, not `Float32Array`: this holds the same rect height the probe reports, and the
   * probe's is a double. Narrowing it here would put the two a rounding step apart at the threshold
   * boundary — so a cell could report `wantsArt` while the renderer had declined to ask for it, on
   * exactly the cells W4 scores.
   */
  private readonly heightPx: Float64Array
  private readonly admitted: Uint8Array
  private readonly frontFacing: Uint8Array
  private readonly onScreen: Uint8Array
  /** Linear fade progress; the attribute carries its smoothstep. */
  private readonly fade: Float32Array

  private frameIndex = 0
  /**
   * §1.6's hysteresis, for **this** world (DEC-768 F2).
   *
   * Constructed here and handed out nowhere, which is the point: the {@link AdaptiveThreshold} is
   * shared across the roster because §1.12's pool is, and before this field the bucket the
   * hysteresis held was shared with it — so on a 45-world roster every surface's "previous frame"
   * was the previous *surface*, and the hold branch could not fire at all. See
   * {@link ThresholdMemory}.
   */
  private readonly thresholdMemory = new ThresholdMemory()
  private thresholdReport: ThresholdReport
  private crossoverValue: CrossoverState
  private medianHeightPxValue = 0
  private radiiValue = 0

  /**
   * This world's orientation — `tilt ∘ spin`, written by the owner once per frame (§1.3, DEC-750).
   *
   * > **Normative — the spin axis is the pole axis, `±Y` (CEO ruling, DEC-750).** See `spin.ts` for
   * > the ruling and the measurement behind it. `starfield/motion.ts` disagreed with both datasets
   * > until DEC-774 moved PRD 8.5.7's CPU mirror onto the same axis; `worlds-spin.test.ts` now
   * > checks the mirror against this file's law rather than only against its own twin.
   *
   * **The frame does not rotate the cells; it rotates the camera.** Every per-cell quantity below —
   * facing, the frustum test, the projected rect, the shade — is computed in the world's **own**
   * frame, with the camera and the key light transformed into it once per frame and the orientation
   * left on `mesh.quaternion` for the GPU. Rotating 6,271 normals instead would be the same answer
   * at 6,271 times the cost, and would put a second copy of the orientation on the CPU side of a
   * value the shader reads off the model matrix.
   *
   * That substitution is exact rather than approximate, and the one output it could have disturbed
   * is checked: {@link WorldsProbe.radii} is `|camera.position − centre| / radius`, and a rigid
   * motion preserves it — in the local frame the centre is the origin and the distance is the
   * transformed camera's own length. `worlds-spin.test.ts` pins that equality against a rotated and
   * an unrotated surface.
   */
  readonly orientation = new Quaternion()

  /**
   * This world's centre in world space — written by the owner once per frame (DEC-804).
   *
   * The positional twin of {@link orientation}, and it exists for the identical reason: the value
   * is a function of the scene clock, the clock belongs to the plane table, and a pass that derived
   * it would be a second integration of an angle the camera has already integrated. `attachWorlds`
   * writes this from {@link WorldFrame.centreOf} immediately before {@link update}, in the same
   * loop and one line from `planeOrientation`.
   *
   * Seeded from `source.home` so a surface that has never ticked is at its t=0 position rather than
   * at the origin — the multiverse's centre is a **place**, and a world parked there would draw a
   * plausible globe in the middle of the belt.
   *
   * > Everything downstream reads *this*, never `source.home`: `mesh.position` and
   * > `pickMesh.position` (so the pick pass cannot select a cell the draw pass put elsewhere), the
   * > model matrix that defines the local frame, and §1.9's tether ends, which hold this vector **by
   * > reference**. `source.home` has exactly one reader left, three lines below.
   */
  readonly centre = new Vector3()

  /** The scratch the substitution above needs. All fixed size; nothing here allocates per frame. */
  private readonly inverseOrientation = new Quaternion()
  private readonly modelMatrix = new Matrix4()
  private readonly localCamera: { -readonly [K in keyof ProbeCamera]: ProbeCamera[K] } = {
    matrixWorldInverse: new Matrix4(),
    projectionMatrix: new Matrix4(),
    position: new Vector3(),
    near: 0,
  }
  private readonly localLight = new Vector3(0, 0, 1)

  constructor(source: WorldSurfaceSource, options: WorldSurfaceOptions) {
    this.source = source
    this.options = options
    this.lifted = drawRadius(source.radius)
    // Row 0's latitudinal half-extent. `cellDrawAngles` returns `dphi/2 * CELL_INSET` on every row
    // — the latitudinal component carries no `sin(theta)` (§2.1) — and `worlds-composition.test.ts`
    // pins that constancy rather than letting this line rely on it silently.
    this.latArc = cellDrawAngles(source.rowCells, 0).lat

    const cardCount = source.cardCount
    this.cardOfCell = buildCardOfCell(cardCount, options.seams)
    const drawSwatches = buildDrawSwatches(source.swatches, this.cardOfCell, options.seams)

    this.sheet = buildCellSheet({
      cardCount,
      rowCells: source.rowCells,
      normals: source.normals,
      rows: source.rows,
      swatches: drawSwatches,
      // §1.11's pick id, through `cardOfCell` and off `artKeyBase` — the same two terms
      // `setFilterMask` composes, because they are the same question: which card is in this cell.
      stars: buildCellStars(source.artKeyBase, this.cardOfCell),
      radius: source.radius,
    })
    this.material = createCellMaterial(source.radius, options.artTexture)
    this.mesh = new Mesh(this.sheet.geometry, this.material)
    // The t=0 seed for the live centre — see {@link centre}. `update` rewrites both meshes'
    // positions from it every frame; this is only what they show before the first tick.
    this.centre.copy(source.home)
    // `frustumCulled` stays on: `buildCellSheet` sets the bounding sphere by hand precisely so that
    // three can cull this correctly, and turning it off here would waste that.
    this.mesh.position.copy(this.centre)

    // §1.11's pick pass. The SAME geometry, so the two can never disagree about where a cell is,
    // and the draw material's own uniforms object, so they can never disagree about `uRadius`.
    this.pickMaterial = createCellPickMaterial(this.material.uniforms as CellUniforms)
    this.pickMesh = new Mesh(this.sheet.geometry, this.pickMaterial)
    this.pickMesh.position.copy(this.centre)
    // The pick camera renders this layer and nothing else (`idPicker.ts`), which is also what keeps
    // the pick mesh out of the drawn frame -- it is never "hidden", it is simply not in that pass.
    this.pickMesh.layers.set(PICK_LAYER)

    // The bake reads the SAME swatches the sheet draws, so a control seam moves both LOD
    // representations together. Baking the unpermuted array would leave `?swatch=mean` and
    // `?bands=shuffle` visible only above the crossover, and inside §1.5's band — where both passes
    // draw and cross-fade — the two would disagree cell for cell.
    this.equirect = bakeEquirectLayer(
      buildRowIndex(longitudesOf(source.normals, cardCount), source.rows, source.rowCells),
      source.rowCells,
      drawSwatches,
    )

    // The same nearest-row match the probe makes, and for the same reason it does not take a row
    // from its source: a supplied row would be a second model of §2.1 sitting next to the first.
    const rows = source.rowCells.length
    this.colatitude = new Float64Array(cardCount)
    this.longitude = new Float64Array(cardCount)
    this.lonArc = new Float64Array(cardCount)
    for (let cell = 0; cell < cardCount; cell += 1) {
      const row = rowOfUnitY(source.normals[cell * 3 + 1] ?? 0, rows)
      this.colatitude[cell] = rowColatitude(row, rows)
      this.longitude[cell] = Math.atan2(
        source.normals[cell * 3] ?? 0,
        source.normals[cell * 3 + 2] ?? 0,
      )
      this.lonArc[cell] = cellDrawAngles(source.rowCells, row).lon
    }

    this.heightPx = new Float64Array(cardCount)
    this.admitted = new Uint8Array(cardCount)
    this.frontFacing = new Uint8Array(cardCount)
    this.onScreen = new Uint8Array(cardCount)
    this.fade = new Float32Array(cardCount)

    this.thresholdReport = options.threshold.end(
      admissibleCells(options.pool, options.stream),
      this.thresholdMemory,
    )
    this.crossoverValue = crossoverState(0)
  }

  /** Which passes this world draws in, and how they blend (§1.2, §1.5). */
  get crossover(): CrossoverState {
    return this.crossoverValue
  }

  // The four read-only facts about *which* world this is. The source itself stays private — it
  // holds the decoded arrays, and handing those out would let a caller build a second model of
  // §2.1 beside this one, which is the thing `WorldsProbeSource` is shaped to prevent.

  /** `planes.json`'s slug, or `null` — the name §3.1's criteria are stated against. */
  get planeSlug(): string | null {
    return this.source.planeSlug
  }

  /** §1.3's radius, **before** §1.4's lift. `drawRadius` is what the sheet actually draws at. */
  get radius(): number {
    return this.source.radius
  }

  get cardCount(): number {
    return this.source.cardCount
  }

  /** The multiverse-wide art key this world's cards start at. See {@link WorldSurfaceSource}. */
  get artKeyBase(): number {
    return this.source.artKeyBase
  }

  /**
   * PRD 5.8's dimming mask, for this world's cells (§1.11).
   *
   * `mask` is the store's per-**star** evaluation — one byte per star over the whole multiverse,
   * `FILTER_MASK_PASS` where the card matches — so this world's window into it starts at
   * {@link artKeyBase}, the identity `swatches.bin` and the art pool are already keyed by. `null`
   * clears, which is both "no filter" and "the filter was removed": one state, not two paths.
   *
   * Reads a card's byte through `cardOfCell` rather than through the cell index, because
   * `?bands=shuffle` permutes which card a cell draws (§3.1's W3 control). Under that seam the two
   * identities differ, and dimming by cell index would dim the wrong cards — a control that
   * quietly changes a second thing is exactly what `seams.ts` is written against.
   */
  setFilterMask(mask: Uint8Array | null): void {
    const filtered = this.sheet.filtered.array as Float32Array
    const base = this.source.artKeyBase
    for (let cell = 0; cell < filtered.length; cell += 1) {
      if (mask === null) {
        filtered[cell] = 0
        continue
      }
      const star = base + this.cardOfCell[cell]!
      // A star past the end of the mask is not "filtered out" — it is a mask that disagrees with
      // the roster, and the honest reading of an absent byte is that nothing excluded this card.
      filtered[cell] = star < mask.length && mask[star] === 0 ? 1 : 0
    }
    this.sheet.filtered.needsUpdate = true
  }

  /** The per-world scalar §1.5's crossover and §3.1's W1 are both written against. */
  get medianCellHeightPx(): number {
    return this.medianHeightPxValue
  }

  get threshold(): ThresholdReport {
    return this.thresholdReport
  }

  /**
   * Run one frame: demand, admission, requests, fade, attributes, crossover.
   *
   * Two passes over the cells and no sort. The first measures every cell and offers its height to
   * the histogram; the threshold can only be chosen once the whole frame's demand is known, which
   * is what forces the second pass rather than a single fused one.
   */
  update(frame: WorldFrame): void {
    const { camera, viewport, fovRadians } = frame
    const { pool, threshold, stream, seams } = this.options
    const source = this.source
    const cardCount = source.cardCount

    this.frameIndex += 1
    stream?.beginFrame(this.frameIndex)
    threshold.begin()

    // The world's own frame, once per frame (§1.3, DEC-750). See {@link WorldSurface.orientation}:
    // from here down, "camera" is `this.localCamera`, the light is `this.localLight` and the world's
    // centre is the origin — so every cell quantity below is computed against the geometry the GPU
    // actually rasterises, whatever the orientation is.
    this.mesh.quaternion.copy(this.orientation)
    // The live centre, onto both meshes, **every frame** (DEC-804). Set once at construction it
    // was `plane.home` for the session, so the sheet stood still while PRD 8.5.3 rotated the
    // multiverse the camera flies in — `radii` drifting 2.92 → 2.17 on a rig that never moved, and
    // the focused world in the corner of its own capture. The pick mesh is written from the same
    // vector on the same line for the reason it shares the geometry: two positions is a pick pass
    // that selects a cell the draw pass has drawn somewhere else.
    this.mesh.position.copy(this.centre)
    this.pickMesh.position.copy(this.centre)
    this.inverseOrientation.copy(this.orientation).invert()
    this.modelMatrix.compose(this.centre, this.orientation, UNIT_SCALE)
    this.localCamera.matrixWorldInverse.multiplyMatrices(camera.matrixWorldInverse, this.modelMatrix)
    this.localCamera.projectionMatrix.copy(camera.projectionMatrix)
    this.localCamera.position
      .copy(camera.position)
      .sub(this.centre)
      .applyQuaternion(this.inverseOrientation)
    this.localCamera.near = camera.near
    this.localLight.copy(frame.lightDirection).applyQuaternion(this.inverseOrientation)
    const local = this.localCamera

    // `local.position` is the world-space offset put through a rotation, so its length IS
    // `|camera.position - centre|`. Taken here rather than from the untransformed pair so that every
    // distance in this method comes from one vector.
    const centreDistance = local.position.length()
    this.radiiValue = source.radius > 0 ? centreDistance / source.radius : 0
    this.medianHeightPxValue = cellHeightPx(
      this.latArc,
      this.lifted,
      centreDistance,
      viewport.height,
      fovRadians,
    )
    this.crossoverValue = crossoverState(this.medianHeightPxValue)

    for (let cell = 0; cell < cardCount; cell += 1) {
      normalAt(source.normals, cell, scratchNormal)
      // Local, so no `+ centre`: the model matrix folded into `local.matrixWorldInverse` carries it.
      worldPoint.copy(scratchNormal).multiplyScalar(this.lifted)
      toCamera.copy(local.position).sub(worldPoint)

      const front = facesCamera(
        scratchNormal.x,
        scratchNormal.y,
        scratchNormal.z,
        toCamera.x,
        toCamera.y,
        toCamera.z,
      )
      const on = withinFrustum(
        worldPoint.x,
        worldPoint.y,
        worldPoint.z,
        local.matrixWorldInverse,
        local.projectionMatrix,
        local.near,
      )
      // **The admission height is the projected rect's, and it is the SAME call the probe makes.**
      // A small-angle extent — `2 * latArc * radius` over the depth — is the obvious cheaper
      // spelling and it is wrong in a way that hides: it carries no foreshortening, so a cell at
      // the limb measures as tall as one at the centre of the disc and asks for a 128x96 art layer
      // it cannot fill a tenth of. Worse, the probe reports `wantsArt` as `rect.height >= threshold`
      // (§3.1), so under two spellings the gate's W4 row would score a predicate the renderer never
      // evaluated. Measured over the shipped roster at the poses §3.1 states, the two disagree by up
      // to 79% on the same cell. One quantity, one call site.
      const rect = cellScreenRect(
        this.colatitude[cell]!,
        this.longitude[cell]!,
        this.lonArc[cell]!,
        this.latArc,
        this.sheet.subdivision,
        LOCAL_ORIGIN,
        this.lifted,
        local.matrixWorldInverse,
        local.projectionMatrix,
        local.near,
        viewport.width,
        viewport.height,
      )
      const height = rect === null ? 0 : rect.height

      this.heightPx[cell] = height
      this.frontFacing[cell] = front ? 1 : 0
      this.onScreen[cell] = on ? 1 : 0
      // A back-facing or off-screen cell is not demand. Counting it would let a world that is
      // mostly behind itself raise the threshold for the half that is actually visible.
      if (front && on) threshold.offer(height)
    }

    this.thresholdReport = threshold.end(admissibleCells(pool, stream), this.thresholdMemory)
    const effective = this.thresholdReport.effectiveThresholdPx
    const fadeStep = ART_FADE_S > 0 ? frame.deltaSeconds / ART_FADE_S : 1

    const layers = this.sheet.layers.array as Float32Array
    const art = this.sheet.art.array as Float32Array
    const filterMask = this.sheet.filtered.array as Float32Array

    for (let cell = 0; cell < cardCount; cell += 1) {
      // §1.11: a filtered cell never resolves to art **at all**. That is the whole rule under
      // worlds, and it is simpler than the thumbnail-era one: the cell is excluded from admission
      // rather than admitted and then dimmed, so it never asks the stream for a printing and never
      // holds a pool layer a visible cell could use. The dim is the shader's half.
      const admit =
        filterMask[cell] === 0 &&
        this.frontFacing[cell] === 1 &&
        this.onScreen[cell] === 1 &&
        this.heightPx[cell]! >= effective
      this.admitted[cell] = admit ? 1 : 0

      // A cell filtered *while* it held a layer keeps that layer until the pool evicts it, so
      // admission alone is not enough: without this the card stays on screen, at full art, for as
      // long as the LRU leaves it resident. §1.11 says a filtered cell shows its swatch, so it is
      // dropped back to the swatch here and the layer is released to the cells that can use it.
      if (filterMask[cell] !== 0) {
        layers[cell] = LAYER_FREE
        this.fade[cell] = 0
        art[cell] = 0
        continue
      }

      // `?art=off` (§1.6, DEC-821): the swatch-only control seam. **After** admission and **before**
      // the request, which is the whole of its design — the frame still measures and still reports
      // exactly what it would have asked for, so `wantsArt` names the same set as the no-seam run
      // and only `showingArt` moves. That is what lets W2's and W3's swatch-perturbing controls
      // reach the capture at all: at §3.1's pose `artFraction` measures 0.987–0.997, so a control
      // that moves the swatch moves nothing anyone can see (see `seams.ts` for the measurement).
      //
      // The three writes are §1.6's swatch-only cell, spelled exactly as the filtered branch above
      // and as a zero-layer pool reaches by having nothing resident — not a fourth path.
      if (seams.artOff) {
        layers[cell] = LAYER_FREE
        this.fade[cell] = 0
        art[cell] = 0
        continue
      }

      const card = this.cardOfCell[cell]!
      // The **pool's** key, not this world's card index. One pool serves the whole multiverse, so a
      // 0-based key would alias every world onto the first one's layers — see `artKeyBase`.
      const key = source.artKeyBase + card
      if (admit && stream !== null) {
        const printing = source.cardOf(card)
        // A card with no printing has nothing to fetch. It is not a failure and must not enter the
        // pool's failed set — it simply never asks.
        if (printing !== null) {
          stream.request(key, printing.printingId, printing.imageTs, this.priorityOf(cell))
        }
      }

      // Re-read every frame. This is the eviction repair and the reserved-layer guard in one line;
      // see the class header for both failure modes.
      const resident = pool.layerOf(key)
      if (resident === null) {
        layers[cell] = LAYER_FREE
        this.fade[cell] = 0
        art[cell] = 0
        continue
      }
      layers[cell] = resident
      const next = this.fade[cell]! + fadeStep
      const progress = next > 1 ? 1 : next
      this.fade[cell] = progress
      // Smoothstep, the same easing `planeTable` gives an arriving plane. It is monotonic and fixes
      // both endpoints, so `showingArt` — `iArt >= 1` — lands on the same frame either way.
      art[cell] = progress * progress * (3 - 2 * progress)
    }

    this.sheet.layers.needsUpdate = true
    this.sheet.art.needsUpdate = true
    const uniforms = this.material.uniforms as {
      uLight: { value: Vector3 }
      uSheetMix: { value: number }
    }
    // The light in the world's OWN frame, because the sheet's `iNormal` is in that frame too. The
    // shader's `dot(normalize(vNormal), normalize(uLight))` is then the same product `shadeOf` takes
    // for the probe, which is what §3.1 requires of the reported `shade`.
    uniforms.uLight.value.copy(this.localLight)
    // §1.5's cross-fade, which R1 computed and nothing applied (DEC-750). See `cellShaders.ts`: the
    // sheet dissolves in over the band rather than blending, so §1.2's "steps 2-4 are opaque and
    // depth-tested" survives having a cross-fade in the middle of it.
    uniforms.uSheetMix.value = this.crossoverValue.sheetMix
  }

  /**
   * The `?probe=` source for this world (§3.1).
   *
   * Every field is read back off the live surface rather than recomputed, which is the whole point
   * of the seam: a gate that re-derived these would be asserting against its own model of the
   * renderer and would stay green on a renderer that had drifted away from it.
   */
  probeSource(frame: WorldFrame): WorldsProbeSource {
    const source = this.source
    const art = this.sheet.art.array as Float32Array
    return {
      planeSlug: source.planeSlug,
      cardCount: source.cardCount,
      rowCells: source.rowCells,
      normalOf: (cell, out) => normalAt(source.normals, cell, out),
      hueCounts: source.hueCounts,
      subdivision: this.sheet.subdivision,
      // The world's own frame, exactly as `update` measured in — see {@link
      // WorldSurface.orientation}. Reporting the world-space centre and camera here instead would
      // give a probe whose rects were of an unrotated world while the frame drew a rotated one, and
      // the two agree at every orientation except the ones the world actually spends time in.
      // `radii` is unchanged by the substitution: it is a distance, and this is a rigid motion.
      centre: LOCAL_ORIGIN,
      radius: source.radius,
      lightDirection: this.localLight,
      camera: this.localCamera,
      // The same two points in **world** space, additively, so the gate can recompute `radii`
      // instead of trusting it (DEC-804 ask 3). Not a second derivation of the payload's own
      // number: `radii` comes out of the local pair above, these are the untransformed pair, and
      // requiring `|worldCameraPosition − worldCentre| / radius == radii` is what checks the
      // substitution this class makes. A drifting centre fails it in world space first.
      worldCentre: this.centre,
      worldCameraPosition: frame.camera.position,
      viewport: frame.viewport,
      pool: this.options.pool.report(),
      threshold: this.thresholdReport,
      // Read live, like every other field here — and `null` where there is no stream, which is
      // §1.6's zero-layer swatch-only world rather than a stream that has done nothing (DEC-778).
      stream: this.options.stream?.report() ?? null,
      seams: this.options.seams,
      artOf: (cell) => art[cell] ?? 0,
    }
  }

  /** Camera distance in units of this world's radius — §3.1 states W1 and W4 at a pose. */
  get radii(): number {
    return this.radiiValue
  }

  /**
   * The height this frame's admission used for `cell`, in CSS px — the projected rect's.
   *
   * The same number §3.1's payload reports as `height`, read off the same array, so the two cannot
   * drift. `0` for a cell wholly behind the near plane.
   */
  admissionHeightPx(cell: number): number {
    return this.heightPx[cell] ?? 0
  }

  /**
   * Whether `cell` asked the stream for art this frame.
   *
   * > Strictly narrower than the probe's `wantsArt`, and the difference is deliberate. `wantsArt` is
   * > `height >= threshold` alone, because §3.1 needs W4's *denominator* to be stated without the
   * > visibility terms folded in; this adds §1.6's facing and frustum tests, which are reported
   * > beside it as `frontFacing` and `onScreen` so the gate can recover either predicate. Folding
   * > them into the reported field instead would leave the gate unable to tell a cell that was too
   * > small from one that was merely turned away.
   */
  wasAdmitted(cell: number): boolean {
    return this.admitted[cell] === 1
  }

  /**
   * The queue's nearest-first priority for one cell, read **live**.
   *
   * Lower is nearer (`imageQueue` scans for the minimum), so a taller cell sorts ahead. Returning
   * `null` is the queue's "the caller stopped wanting this" path, which drops the request rather
   * than failing it — and §1.6 makes that a distinct pool transition (`release`) precisely so a
   * cell that merely drifted out of the admitted set does not become unfetchable for the session.
   * The closure has to read this frame's state for that to work: capturing the height at request
   * time would pin the priority of a cell that has since turned away.
   */
  private priorityOf(cell: number): () => number | null {
    return () => (this.admitted[cell] === 1 ? -this.heightPx[cell]! : null)
  }

  dispose(): void {
    this.sheet.geometry.dispose()
    this.material.dispose()
    // Its own program, so its own disposal — the shared uniforms object is not a shared material.
    this.pickMaterial.dispose()
  }
}

/** Cell to card: the identity, or §1.6's global permutation under `?bands=shuffle`. */
function buildCardOfCell(cardCount: number, seams: WorldsSeams): Uint32Array {
  if (seams.bandsShuffle) return shufflePermutation(cardCount)
  const identity = new Uint32Array(cardCount)
  for (let cell = 0; cell < cardCount; cell += 1) identity[cell] = cell
  return identity
}

/**
 * The swatch each **cell** draws.
 *
 * `?swatch=mean` wins over `?bands=shuffle` when both are set, and it is not an ordering choice:
 * permuting a constant array is that same constant array, so the two compose to the flat wash under
 * either order.
 */
function buildDrawSwatches(
  swatches: Float32Array,
  cardOfCell: Uint32Array,
  seams: WorldsSeams,
): Float32Array {
  const cardCount = cardOfCell.length
  const out = new Float32Array(cardCount * 3)
  if (seams.swatchMean) {
    let r = 0
    let g = 0
    let b = 0
    for (let card = 0; card < cardCount; card += 1) {
      r += swatches[card * 3] ?? 0
      g += swatches[card * 3 + 1] ?? 0
      b += swatches[card * 3 + 2] ?? 0
    }
    const n = cardCount > 0 ? cardCount : 1
    for (let cell = 0; cell < cardCount; cell += 1) {
      out[cell * 3] = r / n
      out[cell * 3 + 1] = g / n
      out[cell * 3 + 2] = b / n
    }
    return out
  }
  for (let cell = 0; cell < cardCount; cell += 1) {
    const card = cardOfCell[cell]!
    out[cell * 3] = swatches[card * 3] ?? 0
    out[cell * 3 + 1] = swatches[card * 3 + 1] ?? 0
    out[cell * 3 + 2] = swatches[card * 3 + 2] ?? 0
  }
  return out
}

/**
 * Per cell, the star index of the card it draws — §1.11's pick id (DEC-751).
 *
 * The composition is `artKeyBase + cardOfCell[cell]`, and both terms are load-bearing in a way that
 * is worth stating because each fails silently on its own:
 *
 *  - **without `cardOfCell`**, `?bands=shuffle` makes the pick name the card whose *cell* the
 *    pointer is over rather than the card it is *looking at*. The seam permutes the swatch and the
 *    art but not the id, so the page draws one card and focuses another, and only under a control
 *    seam nothing else on the page reacts to;
 *  - **without `artKeyBase`**, all 45 sheets number from 0 and the id buffer cannot say which world
 *    wrote the pixel. Cell 5 of every world is star 5, so the picker resolves every world's sixth
 *    card to the first world's sixth card. This is exactly the aliasing `artKeyBase`'s own doc
 *    comment describes for the art pool, and it is silent for the same reason: the id is a valid
 *    star index, so nothing downstream can tell it is the wrong one.
 */
function buildCellStars(artKeyBase: number, cardOfCell: Uint32Array): Float32Array {
  const out = new Float32Array(cardOfCell.length)
  for (let cell = 0; cell < cardOfCell.length; cell += 1) {
    out[cell] = artKeyBase + cardOfCell[cell]!
  }
  return out
}

/** `atan2(x, z)` per cell — the convention `eastOf` runs along (§1.5). */
function longitudesOf(normals: Float32Array, cardCount: number): Float64Array {
  const lon = new Float64Array(cardCount)
  for (let cell = 0; cell < cardCount; cell += 1) {
    lon[cell] = Math.atan2(normals[cell * 3] ?? 0, normals[cell * 3 + 2] ?? 0)
  }
  return lon
}

function normalAt(normals: Float32Array, cell: number, out: Vector3): Vector3 {
  return out.set(
    normals[cell * 3] ?? 0,
    normals[cell * 3 + 1] ?? 0,
    normals[cell * 3 + 2] ?? 0,
  )
}

/** Re-exported so the composition's consumers need one import. */
export type { CrossoverState }
