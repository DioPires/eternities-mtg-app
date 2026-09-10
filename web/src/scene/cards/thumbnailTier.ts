/**
 * PRD 5.5's card sheet tier: the instanced quads, the LRU that decides what is in the atlas, and
 * the nearest-first fetch that fills it.
 *
 * The three parts are deliberately separable — {@link ThumbnailAtlas} owns cells and eviction,
 * {@link ThumbnailSelector} owns "which cards are near", {@link ImageQueue} owns "six at a time" —
 * and this is the piece that makes them one tier. What it adds on top of them is the arithmetic
 * that has to be in one place to be right:
 *
 *  - an instance exists only for a star whose cell is *loaded*, so PRD 5.5.3's "fall back to the
 *    star glow until loaded" is structural rather than a special case;
 *  - the star's `aThumb` byte is set from the same event, so the star stops fading out at exactly
 *    the moment there is something to fade into;
 *  - the 200 ms fade of PRD 7.3.5 is per instance and starts when the cell loads, so an image
 *    arriving is never a step change;
 *  - and the cross-fade itself is in the shader, off camera distance, so the *representation*
 *    changes on distance while the *image* changes on arrival — which is PRD 7.3.4 and 7.3.5
 *    being two different rules rather than one.
 *
 * Dust participates exactly as stars do (PRD 8.6.3, and the phase brief says so explicitly). It
 * needs no code here: a dust star is a star on the Blind Eternities row, its local position comes
 * from the same buffer, and `starWorldPosition` in the shared motion chunk applies the curl noise
 * for that row. The one thing that would break it is a special case, so there is none.
 */

import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  type Uniform,
  type WebGLRenderer,
} from 'three'

import type { PlaneRecord, PrintingTuple } from '../../data/types'
import type { SceneMotion } from '../../camera/motion'
import { printingImageUri } from '../../data/images'
import { PICK_LAYER } from '../picking/idPicker'
import type { StarGeometry } from '../starfield/starGeometry'
import type { PlaneTable } from '../starfield/planeTable'
import {
  ATLAS_CELL_HEIGHT,
  ATLAS_CELL_WIDTH,
  HUE_COLOURS,
  IMAGE_FADE_MS,
  RARITY_SIZE,
  STAR_WORLD_DIAMETER,
  THUMBNAIL_FADE_FULL_PX,
  THUMBNAIL_FADE_START_PX,
  THUMBNAIL_SELECT_INTERVAL_S,
  THUMBNAIL_WORLD_HEIGHT,
} from '../tuning'
import { SHADER_NAME_THUMBNAIL_TIER, SHADER_NAME_THUMBNAIL_TIER_PICK } from '../shaderNames'
import { ThumbnailAtlas, ATLAS_CELLS, type AtlasCellUv } from './atlas'
import { THUMBNAIL_FRAGMENT_SHADER, THUMBNAIL_VERTEX_SHADER } from './cardShaders'
import type { ImageQueue } from './imageQueue'
import { ThumbnailSelector, type SelectorView } from './thumbnailSelector'

/** What the tier needs to know about a star to fetch its picture. */
export interface CardIndex {
  /** The card's first printing (PRD 5.5.1), or `null` while the plane's shards have not landed. */
  readonly firstPrintingOf: (starIndex: number) => PrintingTuple | null
}

function uniform<T>(value: T): Uniform<T> {
  return { value } as Uniform<T>
}

export interface ThumbnailTierStats {
  /** Instances drawn this frame. */
  readonly drawn: number
  /** Cells the atlas is holding, and how many it may hold at the current quality tier. */
  readonly cells: number
  readonly capacity: number
  readonly requested: number
  readonly loaded: number
  readonly failed: number
}

export class ThumbnailTier {
  readonly atlas: ThumbnailAtlas
  readonly mesh: Mesh
  readonly pickMesh: Mesh
  private readonly selector: ThumbnailSelector

  private readonly geometry: InstancedBufferGeometry
  private readonly aLocal: InstancedBufferAttribute
  private readonly aRow: InstancedBufferAttribute
  private readonly aCell: InstancedBufferAttribute
  private readonly aHue: InstancedBufferAttribute
  private readonly aSize: InstancedBufferAttribute
  private readonly aStar: InstancedBufferAttribute
  private readonly aFade: InstancedBufferAttribute

  private readonly uSizeScale = uniform(1)
  private readonly uThumbStartPx = uniform(THUMBNAIL_FADE_START_PX)
  private readonly uThumbFullPx = uniform(THUMBNAIL_FADE_FULL_PX)

  /** Star index → the scene time its cell finished loading, for PRD 7.3.5's fade. */
  private readonly loadedAt = new Map<number, number>()
  /** Star indices with a fetch in flight, so a second pass does not queue them twice. */
  private readonly inFlight = new Set<number>()
  /**
   * Star indices whose image failed, so the selector does not ask for it again every 200 ms.
   *
   * PRD 7.4.1's three attempts with backoff are for **data chunks**; PRD 7.4.2 says only that a
   * failed *image* leaves the glow in place. Without this the two rules combine into a retry storm:
   * the failure frees the cell, the next selector pass sees a near card with no cell, and asks
   * again — forever, against Scryfall, at six requests at a time. Measured on `fixture-small`,
   * whose synthetic ids 404 by construction: 286 requests for a 215-card plane inside four
   * seconds, and climbing.
   *
   * Bounded by the plane's card count and cleared with the tier, which is the session.
   */
  private readonly failed = new Set<number>()

  private readonly cellUv: AtlasCellUv = { u: 0, v: 0, du: 0, dv: 0 }
  private drawn = 0
  private requested = 0
  private now = 0

  constructor(
    private readonly starGeometry: StarGeometry,
    private readonly table: PlaneTable,
    private readonly queue: ImageQueue,
    capacity: number,
  ) {
    this.atlas = new ThumbnailAtlas(capacity)
    this.selector = new ThumbnailSelector(ATLAS_CELLS)

    this.geometry = new InstancedBufferGeometry()
    this.geometry.setAttribute(
      'position',
      // prettier-ignore
      new BufferAttribute(new Float32Array([
        -0.5, -0.5, 0,  0.5, -0.5, 0,  0.5, 0.5, 0,  -0.5, 0.5, 0,
      ]), 3),
    )
    this.geometry.setIndex([0, 1, 2, 0, 2, 3])
    this.geometry.boundingSphere = null

    const instanced = (items: number): InstancedBufferAttribute => {
      const attribute = new InstancedBufferAttribute(new Float32Array(ATLAS_CELLS * items), items)
      attribute.setUsage(DynamicDrawUsage)
      return attribute
    }
    this.aLocal = instanced(3)
    this.aRow = instanced(1)
    this.aCell = instanced(4)
    this.aHue = instanced(1)
    this.aSize = instanced(1)
    this.aStar = instanced(1)
    this.aFade = instanced(1)
    this.geometry.setAttribute('aLocal', this.aLocal)
    this.geometry.setAttribute('aRow', this.aRow)
    this.geometry.setAttribute('aCell', this.aCell)
    this.geometry.setAttribute('aHue', this.aHue)
    this.geometry.setAttribute('aSize', this.aSize)
    this.geometry.setAttribute('aStar', this.aStar)
    this.geometry.setAttribute('aFade', this.aFade)
    this.geometry.instanceCount = 0

    const shared = {
      uPlaneTable: uniform(this.table.texture),
      uTime: uniform(0),
      uMultiverseAngle: uniform(0),
      uMotion: uniform(1),
      uAtlas: uniform(this.atlas.texture),
      uHues: uniform(HUE_COLOURS.map(([r, g, b]) => new Color(r, g, b))),
      uStarDiameter: uniform(STAR_WORLD_DIAMETER),
      uSizeScale: this.uSizeScale,
      uThumbStartPx: this.uThumbStartPx,
      uThumbFullPx: this.uThumbFullPx,
      uQuadHeight: uniform(THUMBNAIL_WORLD_HEIGHT),
      uQuadAspect: uniform(ATLAS_CELL_WIDTH / ATLAS_CELL_HEIGHT),
    }

    const material = new ShaderMaterial({
      name: SHADER_NAME_THUMBNAIL_TIER,
      uniforms: shared,
      vertexShader: THUMBNAIL_VERTEX_SHADER,
      fragmentShader: THUMBNAIL_FRAGMENT_SHADER,
      transparent: true,
      blending: NormalBlending,
      // Thumbnails are pictures, not glows: two overlapping cards must occlude rather than add.
      // Instances are written nearest-first, so the near one lays down depth and the far one is
      // rejected before it ever blends.
      depthWrite: true,
      depthTest: true,
    })

    const idMaterial = new ShaderMaterial({
      name: SHADER_NAME_THUMBNAIL_TIER_PICK,
      uniforms: { ...shared },
      defines: { ID_PASS: '' },
      vertexShader: THUMBNAIL_VERTEX_SHADER,
      fragmentShader: THUMBNAIL_FRAGMENT_SHADER,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    })

    this.mesh = new Mesh(this.geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
    this.mesh.layers.set(0)
    // After the star field, so a thumbnail's depth write cannot reject the additive glow it is
    // cross-fading with.
    this.mesh.renderOrder = 1

    this.pickMesh = new Mesh(this.geometry, idMaterial)
    this.pickMesh.frustumCulled = false
    this.pickMesh.matrixAutoUpdate = false
    this.pickMesh.layers.set(PICK_LAYER)
  }

  /**
   * The star indices drawn this frame, in the order the instances were written — nearest first.
   * Read by the `?probe=1` seam only; the frame path never allocates it.
   */
  get drawnStars(): readonly number[] {
    const stars = this.aStar.array as Float32Array
    const out: number[] = []
    for (let i = 0; i < this.drawn; i += 1) out.push(stars[i]!)
    return out
  }

  get stats(): ThumbnailTierStats {
    return {
      drawn: this.drawn,
      cells: this.atlas.used,
      capacity: this.atlas.capacity,
      requested: this.requested,
      loaded: this.loadedAt.size,
      failed: this.failed.size,
    }
  }

  /** PRD 8.5.11's third step. Evicting also cancels whatever was being fetched into those cells. */
  setCapacity(capacity: number): void {
    const evicted: number[] = []
    this.atlas.setCapacity(capacity, evicted)
    for (const star of evicted) this.forget(star)
  }

  /**
   * One pass. Returns the number of instances drawn.
   *
   * `plane` is the focused plane, or `null` at multiverse level — where nothing is near enough to
   * be a card and the whole tier costs one comparison. `focusedStar` is the star that has grown
   * into the focused card, so the selector can keep the sheet from standing in front of it.
   *
   * **Known deviation from PRD 5.5.1 (recorded, not fixed — DEC-638/N4).** The PRD keys the
   * cross-fade on a star's *drawn size*, which is a property of the star and not of what is
   * focused; this tier draws thumbnails only for the focused plane. The two agree in practice
   * because PRD 5.7.1's per-level distance limits keep every other plane far enough away that no
   * star of it reaches the 24 px threshold — the narrowing is unreachable on the production
   * roster. It is still narrower than the PRD promises, and a future change to those limits, to
   * plane spacing, or to the threshold could separate them. Widening it means running the selector
   * over every plane's cards rather than one plane's, which is a different cost model than the one
   * PRD 7.2's budgets were measured against, so it is not a change to make inside a fix leg.
   */
  update(
    dt: number,
    renderer: WebGLRenderer,
    motion: SceneMotion,
    plane: PlaneRecord | null,
    view: SelectorView,
    cards: CardIndex,
    motionScale: number,
    focusedStar = -1,
  ): number {
    this.now += dt
    this.uSizeScale.value = view.sizeScale
    this.uThumbStartPx.value = THUMBNAIL_FADE_START_PX * view.pixelRatio
    this.uThumbFullPx.value = THUMBNAIL_FADE_FULL_PX * view.pixelRatio
    this.syncSharedUniforms(motionScale)

    if (!plane) {
      this.selector.clear()
      this.drawn = 0
      this.geometry.instanceCount = 0
      return 0
    }

    this.selector.update(
      dt,
      THUMBNAIL_SELECT_INTERVAL_S,
      this.starGeometry,
      motion,
      plane,
      view,
      this.atlas.capacity,
      focusedStar,
    )

    const visible = this.selector.visible
    const count = this.selector.count
    let instances = 0

    for (let i = 0; i < count; i += 1) {
      const star = visible[i]!
      this.atlas.touch(star, this.now)

      if (this.atlas.hasLoaded(star)) {
        this.writeInstance(instances, star, plane)
        instances += 1
        continue
      }
      if (this.atlas.slotOf(star) >= 0 || this.inFlight.has(star) || this.failed.has(star)) continue
      this.fetch(star, cards, renderer)
    }

    this.drawn = instances
    this.geometry.instanceCount = instances
    if (instances > 0) {
      this.markUpdated(instances)
    }
    return instances
  }

  private syncSharedUniforms(motionScale: number): void {
    for (const material of [this.mesh.material, this.pickMesh.material]) {
      const uniforms = (material as ShaderMaterial).uniforms
      uniforms.uTime!.value = this.table.time
      uniforms.uMultiverseAngle!.value = this.table.multiverseAngle
      uniforms.uMotion!.value = motionScale
    }
  }

  private writeInstance(slot: number, star: number, plane: PlaneRecord): void {
    const cell = this.atlas.slotOf(star)
    this.atlas.cellUv(cell, this.cellUv)

    const local = this.aLocal.array as Float32Array
    this.starGeometry.localPosition(star, localScratch)
    local[slot * 3] = localScratch.x
    local[slot * 3 + 1] = localScratch.y
    local[slot * 3 + 2] = localScratch.z
    ;(this.aRow.array as Float32Array)[slot] = plane.index
    const cellArray = this.aCell.array as Float32Array
    cellArray[slot * 4] = this.cellUv.u
    cellArray[slot * 4 + 1] = this.cellUv.v
    cellArray[slot * 4 + 2] = this.cellUv.du
    cellArray[slot * 4 + 3] = this.cellUv.dv
    ;(this.aHue.array as Float32Array)[slot] = this.starGeometry.hueClassOf(star)
    ;(this.aSize.array as Float32Array)[slot] =
      RARITY_SIZE[this.starGeometry.sizeClassOf(star)] ?? 1
    ;(this.aStar.array as Float32Array)[slot] = star

    // PRD 7.3.5: the image fades in over 200 ms from the moment its cell was filled.
    const since = this.now - (this.loadedAt.get(star) ?? this.now)
    ;(this.aFade.array as Float32Array)[slot] = Math.min(1, (since * 1000) / IMAGE_FADE_MS)
  }

  private markUpdated(count: number): void {
    for (const attribute of [
      this.aLocal,
      this.aRow,
      this.aCell,
      this.aHue,
      this.aSize,
      this.aStar,
      this.aFade,
    ]) {
      attribute.addUpdateRange(0, count * attribute.itemSize)
      attribute.needsUpdate = true
    }
  }

  /**
   * Claim a cell and queue the image.
   *
   * The claim happens *before* the fetch on purpose: if there is no cell to be had, there is no
   * point spending one of PRD 7.2's six slots, and a request whose destination was evicted while it
   * waited would decode a bitmap into someone else's cell.
   */
  private fetch(star: number, cards: CardIndex, renderer: WebGLRenderer): void {
    const printing = cards.firstPrintingOf(star)
    if (!printing) return
    const evicted: number[] = []
    const slot = this.atlas.claim(star, this.now, evicted)
    for (const gone of evicted) this.forget(gone)
    if (slot < 0) return

    this.inFlight.add(star)
    this.requested += 1
    void this.queue
      .request({
        key: `thumb:${star}`,
        url: printingImageUri(printing, 'small'),
        resize: { width: ATLAS_CELL_WIDTH, height: ATLAS_CELL_HEIGHT },
        // Re-read at dequeue: a card that has drifted out of the band while it waited is dropped
        // rather than fetched, and the nearest waiting card goes first (PRD 5.5.3).
        priority: () => {
          if (this.atlas.slotOf(star) < 0) return null
          const px = this.selector.screenPxOf(this.starGeometry, star)
          if (px < THUMBNAIL_FADE_START_PX) return null
          return this.selector.distanceOf(this.starGeometry, star)
        },
      })
      .then((result) => {
        this.inFlight.delete(star)
        if (!result.ok) {
          // PRD 7.4.2: the star glow stays exactly where it was. Give the cell back so a card that
          // *can* be fetched gets it.
          this.atlas.release(star)
          // Only a genuine failure is remembered. A request that was dropped because the card left
          // the cross-fade band, or cancelled because its cell was evicted, is one the camera can
          // perfectly well come back to — blacklisting those would leave permanent holes in the
          // sheet wherever the user had once flown past.
          if (result.reason === 'failed') this.failed.add(star)
          return
        }
        if (!this.atlas.upload(renderer, star, result.bitmap)) return
        this.loadedAt.set(star, this.now)
        this.starGeometry.setThumbnailPresent(star, true)
      })
  }

  /** Drop everything remembered about a star whose cell has gone. */
  private forget(star: number): void {
    this.loadedAt.delete(star)
    this.starGeometry.setThumbnailPresent(star, false)
    this.queue.cancel(`thumb:${star}`)
    this.inFlight.delete(star)
  }

  dispose(): void {
    for (const star of this.loadedAt.keys()) this.starGeometry.setThumbnailPresent(star, false)
    for (const star of this.inFlight) this.queue.cancel(`thumb:${star}`)
    this.inFlight.clear()
    this.failed.clear()
    this.loadedAt.clear()
    this.atlas.dispose()
    this.geometry.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
    ;(this.pickMesh.material as ShaderMaterial).dispose()
  }
}

/** Module-level scratch, so `writeInstance` allocates nothing (PRD 7.3.2). */
const localScratch = { x: 0, y: 0, z: 0 }
