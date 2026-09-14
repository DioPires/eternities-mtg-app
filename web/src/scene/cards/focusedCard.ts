/**
 * PRD 5.6: the focused card, its faces, its tilt, its flip and its planets.
 *
 * The object graph is four nested groups, and the nesting is the specification rather than a
 * convenience:
 *
 *   root      — at the star's world position, turned to face the camera
 *     tilt    — PRD 5.6.3's ±12° spring
 *       flip  — PRD 5.6.5's 180° about the vertical axis
 *         front face, back face, edge
 *     orbit   — PRD 5.6.7's planets
 *
 * The planets hang off `root` and not off `tilt`, because PRD 5.6.7 makes their orbit "independent
 * of the plane's spin" and PRD 5.6.3 makes the tilt a response to the *pointer*: a ring that tipped
 * with the card would read as one rigid object, and the flip would take the printings round the
 * back with it, where PRD 5.6.5 says only the card turns.
 *
 * **Facing the camera is a decision, and this is it.** PRD 5.6.1 puts the card "at a fixed
 * on-screen size" and PRD 5.7.1 lets the camera orbit any focus, so a card fixed in world
 * orientation would present its dark edge to a user who orbited 90°. The root therefore turns to
 * face the camera, and everything PRD 5.6 asks for — tilt, sheen, flip — happens relative to that.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Texture,
  Vector3,
  Color,
} from 'three'

import { cardBackImageUri, printingImageUri, CARD_BACK_URI } from '../../data/images'
import type { CardRecord } from '../../data/types'
import { PICK_LAYER } from '../picking/idPicker'
import type { ProgramWarmupSpec } from '../platform/programWarmup'
import {
  CARD_CORNER_RADIUS,
  CARD_FLIP_S,
  CARD_HEIGHT,
  CARD_THICKNESS,
  CARD_TILT_DAMPING,
  CARD_TILT_FREQUENCY,
  CARD_TILT_MAX_RAD,
  CARD_WIDTH,
  HUE_COLOURS,
  IMAGE_FADE_MS,
  PLANET_CAP,
  PLANET_PERIOD_S,
  PLANET_QUAD_HEIGHT,
  PLANET_QUAD_WIDTH,
  PLANET_SMALL_HEIGHT,
  PLANET_SMALL_WIDTH,
  PLANET_TICK_PX,
} from '../tuning'
import {
  CARD_FACE_FRAGMENT_SHADER,
  CARD_FACE_VERTEX_SHADER,
  ID_FRAGMENT_SHADER,
  ID_VERTEX_SHADER,
  PLANET_FRAGMENT_SHADER,
  PLANET_VERTEX_SHADER,
} from './cardShaders'
import {
  SHADER_NAME_CARD_EDGE,
  SHADER_NAME_CARD_FACE,
  SHADER_NAME_CARD_PLANET,
  SHADER_NAME_CARD_PLANET_PICK,
  SHADER_NAME_CARD_PRINTING_TICKS,
} from '../shaderNames'
import type { ImageQueue } from './imageQueue'
import { planetLayout, planetPosition, type PlanetLayout } from './planets'
import { cardEdgeGeometry, cardFaceGeometry } from './roundedRect'

/**
 * Ids the pick pass writes for planets, offset well clear of the star ids.
 *
 * Star ids are `gl_VertexID + 1`, so they run to the star count — 28,603 on the production dataset
 * and bounded by the 24 bits the id buffer has. Half of that range is a boundary no dataset can
 * reach and no arithmetic can land on by accident.
 */
export const PLANET_ID_BASE = 0x800000

/** Scryfall's `large` image, for the GPU budget of PRD 7.2. */
export const CARD_IMAGE_WIDTH = 672
export const CARD_IMAGE_HEIGHT = 936

/**
 * A printing's image, worlds spec §1.10: Scryfall's `small`, uploaded at its own size.
 *
 * Re-exported from the tuning constants rather than computed here, because the pair that used to
 * live at this name *was* computed — `art_crop` is 626 × 457 and PRD 8.5.10 downscaled it to 256
 * on the long side, so the height was a derivation of the width. `small` has no such step: the
 * bytes on the GPU are the bytes Scryfall serves.
 */
export const PRINTING_IMAGE_WIDTH = PLANET_SMALL_WIDTH
export const PRINTING_IMAGE_HEIGHT = PLANET_SMALL_HEIGHT

interface ImageSlot {
  texture: Texture | null
  /**
   * The size {@link texture}'s GL storage was allocated at, so a mismatch can be caught.
   *
   * `texSubImage2D` writes the image's own dimensions at offset 0: a smaller bitmap would leave the
   * previous printing's pixels showing around it and a larger one is a GL error. Every `large` is
   * 672 × 936, so a mismatch should not happen — and if it ever does, the storage is reallocated
   * rather than written past. Same invariant as the atlas's staging texture (DEC-697).
   */
  width: number
  height: number
  /** Seconds since the image landed, for PRD 7.3.5's 200 ms fade. */
  since: number
  /** The url currently loaded or loading, so a re-show does not re-fetch. */
  url: string | null
  /** The queue key, so an abandoned request can be cancelled by the thing that made it. */
  key: string | null
}

/** PRD 5.6.3's spring, per axis. */
interface SpringState {
  value: number
  rate: number
}

export type { SpringState }

interface Planet {
  readonly mesh: Mesh
  readonly pickMesh: Mesh
  readonly material: ShaderMaterial
  readonly image: ImageSlot
}

function faceMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    // The front and back faces share one program — same sources, no defines — so they share this
    // name too, which is the honest label for it. See `shaderNames.ts`.
    name: SHADER_NAME_CARD_FACE,
    uniforms: {
      uImage: { value: null },
      uHasImage: { value: 0 },
      uImageFade: { value: 0 },
      uGlow: { value: new Color(0.2, 0.2, 0.25) },
      uOpacity: { value: 1 },
      uSheenOffset: { value: 0.5 },
    },
    vertexShader: CARD_FACE_VERTEX_SHADER,
    fragmentShader: CARD_FACE_FRAGMENT_SHADER,
    transparent: false,
  })
}

export class FocusedCard {
  readonly root = new Group()
  private readonly tiltGroup = new Group()
  private readonly flipGroup = new Group()
  private readonly orbitGroup = new Group()

  private readonly frontMaterial = faceMaterial()
  private readonly backMaterial = faceMaterial()
  private readonly frontImage: ImageSlot = {
    texture: null,
    width: 0,
    height: 0,
    since: 0,
    url: null,
    key: null,
  }
  private readonly backImage: ImageSlot = {
    texture: null,
    width: 0,
    height: 0,
    since: 0,
    url: null,
    key: null,
  }

  private readonly faceGeometries: BufferGeometry[] = []
  /**
   * §1.10's flat quad, shared by every printing and by its pick mesh.
   *
   * **It needs no billboarding, and that is a property of where it hangs rather than luck.** A
   * `PlaneGeometry` faces +Z, and this class's header records that `root` turns to face the camera
   * every frame so the card never presents its edge to an orbiting viewer. The ring hangs off
   * `root`, so the quads inherit exactly that facing — which is also why a `FrontSide` material is
   * safe here and why the sphere's 24 × 16 tessellation was 384 triangles per printing, 27,648 on
   * a capped card, to draw something the camera only ever sees one side of.
   */
  private readonly planetGeometry = new PlaneGeometry(PLANET_QUAD_WIDTH, PLANET_QUAD_HEIGHT)

  /**
   * §1.10's overflow ticks: one `Points` object for the whole tail, not one object per tick.
   *
   * Swamp drops 498 printings, so per-tick meshes would be 498 draw calls for five cards' worth of
   * disclosure. The geometry holds each tick at its phase-zero position and the object is *rotated*
   * on the orbit — one transform a frame for the whole tail, and it is also what guarantees the
   * ticks cannot drift against the quads, since a single angle drives all of them.
   */
  private readonly tickMaterial = new PointsMaterial({
    name: SHADER_NAME_CARD_PRINTING_TICKS,
    color: new Color(0xffffff),
    // `false`, so the mark is a fixed pixel size at any distance (§1.10: "1 px ticks"). With
    // attenuation on, the tail would fade to nothing exactly when the card is far enough away for
    // the disclosure to matter.
    sizeAttenuation: false,
    size: PLANET_TICK_PX,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  private tickPoints: Points | null = null
  /** Device pixels per CSS pixel, so a "1 px" tick is 1 **CSS** px on a 2x display too. */
  private pixelRatio = 1

  /**
   * Tell the ring what a CSS pixel is worth (§1.10).
   *
   * `gl_PointSize` is in **device** pixels, so a `PointsMaterial` of size 1 draws a half-CSS-pixel
   * mark on a 2x display — visible as a dimmer tick rather than as a missing one, which is the
   * kind of wrong that never gets reported. The card tier already reads `getPixelRatio()` for the
   * thumbnail fade; this rides the same read rather than adding a second one.
   */
  setPixelRatio(ratio: number): void {
    const next = ratio > 0 ? ratio : 1
    if (next === this.pixelRatio) return
    this.pixelRatio = next
    this.tickMaterial.size = PLANET_TICK_PX * next
  }
  private readonly planets: Planet[] = []

  /**
   * One planet material of each kind, held solely so the boot-time warm-up has something to link
   * against (DEC-739, `../platform/programWarmup`).
   *
   * The planets themselves are rebuilt per card in {@link rebuildPlanets}, so at boot there is no
   * planet in the scene graph and a traversal finds nothing — while `FocusedCardPlanet` and
   * `FocusedCardPlanetPick` are among the last programs the app links and therefore land their
   * first-draw stall in the middle of PRD 6.2.3's fly-to-card, which review §3.7 names as one of
   * the two likely hitches on ANGLE D3D11.
   *
   * These cost two `ShaderMaterial` objects and **no extra program**: `getProgramCacheKey` reads
   * the interned sources and the defines, both of which these share with every real planet, so
   * warming through them warms the program the real planets will be drawn with.
   */
  private readonly warmupPlanetMaterial = planetMaterial(0)
  private readonly warmupPlanetPickMaterial = planetPickMaterial(PLANET_ID_BASE + 1)

  private card: CardRecord | null = null
  private starIndexValue = -1
  private activePrintingValue = 0
  private layout: PlanetLayout = { slots: [], overflow: 0, rings: 0, ticks: [] }

  /** PRD 5.6.3's spring: angle and angular velocity per axis, and the pointer's target. */
  private readonly tiltX: SpringState = { value: 0, rate: 0 }
  private readonly tiltY: SpringState = { value: 0, rate: 0 }
  private targetX = 0
  private targetY = 0
  /** 0 shows the front, 1 the back. PRD 5.6.5's turn eases between them. */
  private flip = 0
  private flipTarget = 0
  private hoveredPlanet = -1
  private elapsed = 0
  /** PRD 5.6.7's orbit clock, advanced only while motion is on. See `update`. */
  private orbitElapsed = 0

  private readonly scratch = new Vector3()
  /**
   * Textures whose bitmap has not reached the GPU yet.
   *
   * `three` uploads a texture lazily, on the first frame that draws it. An `ImageBitmap` closed
   * before that frame is a texture with nothing in it — which renders as a flat grey card, exactly
   * as Phase 3's first browser run showed. `update` forces the upload with the renderer it is
   * handed and closes the bitmap immediately after, so nothing decoded is held for longer than one
   * frame and the GPU budget of PRD 7.2 counts the texture and not the bitmap too.
   */
  private readonly pendingUploads: Array<{ texture: Texture; bitmap: ImageBitmap }> = []

  constructor(private readonly queue: ImageQueue) {
    this.root.visible = false
    this.root.matrixAutoUpdate = true
    this.root.add(this.tiltGroup)
    this.root.add(this.orbitGroup)
    this.tiltGroup.add(this.flipGroup)

    const front = cardFaceGeometry(
      CARD_WIDTH,
      CARD_HEIGHT,
      CARD_CORNER_RADIUS,
      CARD_THICKNESS / 2 + 0.0004,
      true,
    )
    const back = cardFaceGeometry(
      CARD_WIDTH,
      CARD_HEIGHT,
      CARD_CORNER_RADIUS,
      -CARD_THICKNESS / 2 - 0.0004,
      false,
    )
    const edge = cardEdgeGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_CORNER_RADIUS, CARD_THICKNESS)
    this.faceGeometries.push(front, back, edge)

    this.flipGroup.add(new Mesh(front, this.frontMaterial))
    this.flipGroup.add(new Mesh(back, this.backMaterial))
    // PRD 5.6.2: "Edge: dark neutral."
    this.flipGroup.add(
      new Mesh(edge, new MeshBasicMaterial({ name: SHADER_NAME_CARD_EDGE, color: 0x14161f })),
    )
  }

  get starIndex(): number {
    return this.starIndexValue
  }

  get visible(): boolean {
    return this.root.visible
  }

  get activePrinting(): number {
    return this.activePrintingValue
  }

  get printingOverflow(): number {
    return this.layout.overflow
  }

  get planetCount(): number {
    return this.layout.slots.length
  }

  /** PRD 5.6.5: only a card with a genuine back image gets a flip control. */
  get canFlip(): boolean {
    const printing = this.card?.p[this.activePrintingValue]
    if (!this.card || !printing) return false
    return cardBackImageUri(this.card, printing, 'large') !== null
  }

  get flipped(): boolean {
    return this.flipTarget === 1
  }

  /** Focus this card. Idempotent for the same star, so a re-render never re-fetches. */
  show(card: CardRecord, starIndex: number, hueClass: number): void {
    if (this.starIndexValue === starIndex && this.card === card) {
      this.root.visible = true
      return
    }
    this.card = card
    this.starIndexValue = starIndex
    this.activePrintingValue = 0
    this.flip = 0
    this.flipTarget = 0
    this.tiltX.value = 0
    this.tiltX.rate = 0
    this.tiltY.value = 0
    this.tiltY.rate = 0
    this.hoveredPlanet = -1
    this.root.visible = true

    const [r, g, b] = HUE_COLOURS[hueClass] ?? HUE_COLOURS[6]!
    // PRD 5.5.3 and 7.4.2: until an image lands — or if it never does — the card is its own hue,
    // not a broken rectangle. Dimmed, because a full-brightness card-sized block of hue would read
    // as a deliberate colour swatch rather than as "loading".
    ;(this.frontMaterial.uniforms.uGlow!.value as Color).setRGB(r * 0.22, g * 0.22, b * 0.22)
    ;(this.backMaterial.uniforms.uGlow!.value as Color).setRGB(r * 0.14, g * 0.14, b * 0.14)

    // A new card must not wear the last one's face while its own image is in flight. PRD 7.4.2's
    // "leaves the previous image in place" is about a *failed* image for the card you are looking
    // at, not about a card you have navigated away from.
    this.clearFace(this.frontImage, this.frontMaterial)
    this.clearFace(this.backImage, this.backMaterial)

    this.rebuildPlanets()
    this.loadFaces()
  }

  /** Back to the hue glow: no image, nothing in flight, nothing remembered. */
  private clearFace(slot: ImageSlot, material: ShaderMaterial): void {
    this.releaseImage(slot)
    material.uniforms.uImage!.value = null
    material.uniforms.uHasImage!.value = 0
    material.uniforms.uImageFade!.value = 0
    material.needsUpdate = true
  }

  hide(): void {
    this.root.visible = false
    this.card = null
    this.starIndexValue = -1
    this.clearPlanets()
    this.releaseImage(this.frontImage)
    this.releaseImage(this.backImage)
  }

  /** PRD 5.6.9: clicking a planet swaps the card front to that printing and marks it active. */
  setActivePrinting(index: number): void {
    if (!this.card || index < 0 || index >= this.card.p.length) return
    if (index === this.activePrintingValue) return
    this.activePrintingValue = index
    for (let i = 0; i < this.planets.length; i += 1) {
      const slot = this.layout.slots[i]!
      this.planets[i]!.material.uniforms.uActive!.value = slot.printing === index ? 1 : 0
    }
    this.loadFaces()
  }

  /** PRD 5.6.5. "Flipping never changes focus", so this touches nothing but the turn. */
  toggleFlip(): void {
    if (!this.canFlip) return
    this.flipTarget = this.flipTarget === 0 ? 1 : 0
  }

  /**
   * PRD 5.6.3: the pointer's position over the canvas, in −1..1 from the centre. The card tilts
   * *towards* it, so the top edge comes forward when the pointer is above the centre.
   */
  setPointer(nx: number | null, ny: number | null): void {
    if (nx === null || ny === null) {
      // "Settles to rest when the pointer leaves."
      this.targetX = 0
      this.targetY = 0
      return
    }
    this.targetX = Math.max(-1, Math.min(1, ny)) * CARD_TILT_MAX_RAD
    this.targetY = Math.max(-1, Math.min(1, nx)) * CARD_TILT_MAX_RAD
  }

  setHoveredPlanet(index: number): void {
    if (index === this.hoveredPlanet) return
    this.hoveredPlanet = index
    for (let i = 0; i < this.planets.length; i += 1) {
      this.planets[i]!.material.uniforms.uHover!.value = i === index ? 1 : 0
    }
  }

  /** The printing a planet stands for (PRD 5.6.9). `null` when there is no such planet. */
  printingOfPlanet(index: number): number | null {
    const slot = this.layout.slots[index]
    return slot ? slot.printing : null
  }

  /** The label a hovered planet wants (PRD 5.6.9). `null` when nothing is hovered. */
  hoveredPlanetPrinting(): number | null {
    return this.printingOfPlanet(this.hoveredPlanet)
  }

  /** World position of a planet, for the overlay's label projection. */
  planetWorldPosition(index: number, out: Vector3): boolean {
    const planet = this.planets[index]
    if (!planet) return false
    planet.mesh.getWorldPosition(out)
    return true
  }

  /**
   * One frame.
   *
   * `worldPosition` is the focused star's live position — PRD 8.5.7's single CPU-mirrored star —
   * so the card sits exactly where the star it grew out of is, however the plane is turning.
   */
  /**
   * Push any decoded image to the GPU and release the bitmap. Called every frame, focused or not:
   * a bitmap that arrives just as focus is released still has to be let go of.
   */
  flushUploads(renderer: { initTexture: (texture: Texture) => void }): void {
    // `splice(0)` allocates its result array on every call, and the overwhelmingly common case is
    // that there is nothing to flush — so the frame path was allocating an empty array per frame
    // to iterate over nothing (DEC-692 R7). Drain in place instead.
    const pending = this.pendingUploads
    if (pending.length === 0) return
    for (let i = 0; i < pending.length; i += 1) {
      const upload = pending[i]!
      renderer.initTexture(upload.texture)
      upload.bitmap.close()
    }
    pending.length = 0
  }

  update(
    dt: number,
    worldPosition: Readonly<{ x: number; y: number; z: number }>,
    cameraPosition: Readonly<{ x: number; y: number; z: number }>,
    motionScale: number,
    reducedMotion: boolean,
  ): void {
    if (!this.root.visible) return
    this.elapsed += dt
    /*
     * The orbit's own clock (PRD 5.9, §1.10).
     *
     * Scaled *as it accumulates* rather than at the point of use. Multiplying `elapsed` by
     * `motionScale` at the call site means turning motion off sends every printing back to its
     * `t = 0` phase and turning it on again teleports the whole ring forward by however long the
     * user spent with it off — the ring jumps twice. `planeTable.advance` states the rule this
     * follows: "freezes every angle where it stands rather than resetting it, so toggling the
     * setting mid-session never makes the field jump." The quads and §1.10's tick tail read this
     * one accumulator, which is also what keeps them from drifting apart.
     */
    this.orbitElapsed += dt * motionScale

    this.root.position.set(worldPosition.x, worldPosition.y, worldPosition.z)
    this.scratch.set(cameraPosition.x, cameraPosition.y, cameraPosition.z)
    this.root.lookAt(this.scratch)

    // PRD 5.9: "card tilt is disabled" under reduced motion. Eased to rest rather than snapped, so
    // turning the setting on mid-hover is not itself a jump.
    stepSpring(this.tiltX, reducedMotion ? 0 : this.targetX, dt)
    stepSpring(this.tiltY, reducedMotion ? 0 : this.targetY, dt)
    this.tiltGroup.rotation.set(this.tiltX.value, this.tiltY.value, 0)

    // PRD 5.6.5's turn, and PRD 5.9's 0.3 s fly-to spirit: under reduced motion it is immediate.
    const flipStep = reducedMotion ? 1 : dt / CARD_FLIP_S
    this.flip += Math.sign(this.flipTarget - this.flip) * Math.min(Math.abs(this.flipTarget - this.flip), flipStep)
    this.flipGroup.rotation.y = this.flip * Math.PI

    // PRD 5.6.4: the sheen moves with the tilt. The band runs across the face, so the offset is
    // driven by both axes and centred at rest.
    const sheen =
      0.5 + (this.tiltY.value / CARD_TILT_MAX_RAD) * 0.35 - (this.tiltX.value / CARD_TILT_MAX_RAD) * 0.2
    this.frontMaterial.uniforms.uSheenOffset!.value = sheen
    this.backMaterial.uniforms.uSheenOffset!.value = 1 - sheen

    this.advanceFade(this.frontImage, this.frontMaterial, dt)
    this.advanceFade(this.backImage, this.backMaterial, dt)

    if (this.tickPoints) {
      // The same angle `planetPosition` adds to a slot's phase, applied once to the whole tail.
      // Negative about +Z because the ring runs clockwise on screen: a phase of `p` draws at
      // `(r sin p, r cos p)`, so advancing the phase rotates the plane the other way.
      this.tickPoints.rotation.z =
        -((2 * Math.PI) / PLANET_PERIOD_S) * this.orbitElapsed
    }

    for (let i = 0; i < this.planets.length; i += 1) {
      const planet = this.planets[i]!
      const slot = this.layout.slots[i]!
      planetPosition(slot, this.orbitElapsed, 1, positionScratch)
      planet.mesh.position.set(positionScratch.x, positionScratch.y, positionScratch.z)
      planet.pickMesh.position.copy(planet.mesh.position)
      this.advanceFade(planet.image, planet.material, dt)
    }
  }

  private advanceFade(slot: ImageSlot, material: ShaderMaterial, dt: number): void {
    if (!slot.texture) return
    slot.since += dt
    material.uniforms.uImageFade!.value = Math.min(1, (slot.since * 1000) / IMAGE_FADE_MS)
  }

  /** PRD 5.6.2: `large` front, Scryfall back. Both go through the shared six-request budget. */
  private loadFaces(): void {
    const card = this.card
    const printing = card?.p[this.activePrintingValue]
    if (!card || !printing) return

    const frontUrl = printingImageUri(printing, 'large')
    // PRD 5.6.2's "Back: the Scryfall-provided card back", and PRD 5.6.5's back *face* when the card
    // has one. `cardBackImageUri` is the correct gate for the second — `hasBackImage` is not, and
    // `card.b !== null` is not either; see `data/images`.
    const backUrl = cardBackImageUri(card, printing, 'large') ?? CARD_BACK_URI

    this.loadFace(this.frontImage, this.frontMaterial, frontUrl, `card-front:${frontUrl}`)
    this.loadFace(this.backImage, this.backMaterial, backUrl, `card-back:${backUrl}`)
  }

  private loadFace(
    slot: ImageSlot,
    material: ShaderMaterial,
    url: string,
    key: string,
  ): void {
    if (slot.url === url) return
    const previous = slot.url
    const previousKey = slot.key
    if (previousKey !== null) this.queue.cancel(previousKey)
    slot.url = url
    slot.key = key
    void this.queue
      .request({
        key,
        url,
        // The focused card is what the user is looking at, so it outranks every thumbnail.
        priority: () => (slot.url === url ? -1 : null),
      })
      .then((result) => {
        if (!result.ok) {
          // PRD 7.4.2: "a failed image leaves the star glow or the previous image in place". If a
          // previous printing's image is on the face, it stays and the slot is restored to it, so
          // switching back to that printing does not re-fetch what is already on the GPU.
          if (previous !== null && slot.texture) {
            slot.url = previous
            slot.key = previousKey
          }
          return
        }
        const bitmap = result.bitmap
        if (slot.url !== url) {
          bitmap.close()
          return
        }
        // Reuse this face's texture rather than disposing it and allocating a replacement.
        //
        // **Why (DEC-714).** A fresh `Texture` per upload is a fresh `glCreateTexture` and a fresh
        // `texStorage2D` — 672 × 936 × 4 is 2.5 MB of GPU storage — followed by a `glDeleteTexture`
        // the moment the next printing lands. Measured on the shipped build, six `activatePrinting`
        // switches were exactly six allocate/free cycles at 672 × 936. The pixels have to be
        // transferred either way; only the allocation around them was new.
        //
        // Safe here, and *not* safe for the planets, because a face is a single destination: there
        // is exactly one front texture and one back texture, each bound to one material and sampled
        // for as long as that face is up. The planets are 72 distinct live textures bound to 72
        // materials at once (see `rebuildPlanets`), so one shared texture would show whichever art
        // crop landed last on every planet. That is the distinction DEC-707 note N4 missed.
        //
        // Reusing works because three keys its GL texture on the *parameters* and not the image.
        // Swapping `image` and bumping the source version leaves `sourceProperties.__version`
        // defined, so `allocateMemory` is false and the upload is a bare `texSubImage2D` into
        // storage that is already the right size.
        const existing = slot.texture
        const fits = existing !== null && bitmap.width === slot.width && bitmap.height === slot.height
        let texture: Texture
        if (fits) {
          texture = existing!
          texture.image = bitmap
        } else {
          existing?.dispose()
          texture = new Texture(bitmap)
          texture.generateMipmaps = false
          slot.texture = texture
          slot.width = bitmap.width
          slot.height = bitmap.height
          material.uniforms.uImage!.value = texture
          // Only when the map's identity changes. Left on every upload it would re-run the program
          // cache lookup for a material whose shader has not moved since the first printing.
          material.needsUpdate = true
        }
        texture.needsUpdate = true
        slot.since = 0
        slot.url = url
        slot.key = key
        material.uniforms.uHasImage!.value = 1
        material.uniforms.uImageFade!.value = 0
        this.pendingUploads.push({ texture, bitmap })
      })
  }

  private releaseImage(slot: ImageSlot): void {
    if (slot.key !== null) this.queue.cancel(slot.key)
    slot.texture?.dispose()
    slot.texture = null
    // Cleared with the texture: a stale size would let the next bitmap take the reuse path against
    // storage that no longer exists.
    slot.width = 0
    slot.height = 0
    slot.url = null
    slot.key = null
    slot.since = 0
  }

  /** PRD 5.6.7-8, as §1.10's flat `small` quads. */
  private rebuildPlanets(): void {
    this.clearPlanets()
    const card = this.card
    if (!card) return
    this.layout = planetLayout(card.p.length)

    for (let i = 0; i < this.layout.slots.length; i += 1) {
      const slot = this.layout.slots[i]!
      const printing = card.p[slot.printing]
      if (!printing) continue

      const material = planetMaterial(slot.printing === this.activePrintingValue ? 1 : 0)
      const mesh = new Mesh(this.planetGeometry, material)
      mesh.layers.set(0)

      const pickMaterial = planetPickMaterial(PLANET_ID_BASE + i + 1)
      const pickMesh = new Mesh(this.planetGeometry, pickMaterial)
      pickMesh.layers.set(PICK_LAYER)

      this.orbitGroup.add(mesh)
      this.orbitGroup.add(pickMesh)

      // A planet keeps its own texture for as long as it is on screen — 72 of them at once on a
      // capped card — so there is no reuse to do here and the size is only ever recorded.
      const image: ImageSlot = {
        texture: null,
        width: 0,
        height: 0,
        since: 0,
        url: null,
        key: `planet:${printing[0]}`,
      }
      const planet: Planet = { mesh, pickMesh, material, image }
      this.planets.push(planet)

      // §1.10: the whole card at Scryfall's `small`, not a crop of its art. **No `resize`**, and
      // that is the conversion paying for itself rather than an omission: PRD 8.5.10's decode-time
      // downscale existed because an `art_crop` arrives at 626 × 457, and `small` arrives at
      // 146 × 204 — already under the 256 px the downscale was aiming for. Resizing to 256 here
      // would *upscale* 72 images and cost more than the sphere did.
      const url = printingImageUri(printing, 'small')
      image.url = url
      void this.queue
        .request({
          key: image.key!,
          url,
          // Behind the card's own faces, ahead of any thumbnail: the planets are what the user is
          // looking at once a card is focused.
          priority: () => (image.url === url ? -0.5 : null),
        })
        .then((result) => {
          if (!result.ok) return
          const bitmap = result.bitmap
          if (image.url !== url) {
            bitmap.close()
            return
          }
          const texture = new Texture(bitmap)
          texture.needsUpdate = true
          texture.generateMipmaps = false
          image.texture = texture
          image.since = 0
          material.uniforms.uImage!.value = texture
          material.uniforms.uHasImage!.value = 1
          material.uniforms.uImageFade!.value = 0
          material.needsUpdate = true
          this.pendingUploads.push({ texture, bitmap })
        })
    }
    this.rebuildTicks()
  }

  /**
   * Build the tick tail for the current layout (§1.10).
   *
   * Nothing at all when the cap does not bind, which is every card on the roster but five — the
   * common path allocates no geometry, no material use and no scene node.
   */
  private rebuildTicks(): void {
    const ticks = this.layout.ticks
    if (ticks.length === 0) return
    const positions = new Float32Array(ticks.length * 3)
    const scratch = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < ticks.length; i += 1) {
      // At t = 0: the object's rotation carries the orbit, so the geometry is the phase-zero ring.
      planetPosition(ticks[i]!, 0, 0, scratch)
      positions[i * 3] = scratch.x
      positions[i * 3 + 1] = scratch.y
      positions[i * 3 + 2] = scratch.z
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    const points = new Points(geometry, this.tickMaterial)
    points.layers.set(0)
    // Not pickable. PRD 5.6.9's click target is a planet; a 1 px mark is not one, and §1.11's own
    // conformance argument is the search path rather than a pixel-sized hit area.
    this.tickPoints = points
    this.orbitGroup.add(points)
  }

  private clearTicks(): void {
    if (!this.tickPoints) return
    this.orbitGroup.remove(this.tickPoints)
    this.tickPoints.geometry.dispose()
    this.tickPoints = null
  }

  private clearPlanets(): void {
    this.clearTicks()
    for (const planet of this.planets) {
      if (planet.image.key !== null) this.queue.cancel(planet.image.key)
      planet.image.url = null
      planet.image.key = null
      planet.image.texture?.dispose()
      this.orbitGroup.remove(planet.mesh)
      this.orbitGroup.remove(planet.pickMesh)
      planet.material.dispose()
      ;(planet.pickMesh.material as ShaderMaterial).dispose()
    }
    this.planets.length = 0
    this.layout = { slots: [], overflow: 0, rings: 0, ticks: [] }
  }

  /**
   * Bytes this card and its planets occupy on the GPU (PRD 7.2's 96 MB target / 160 MB ceiling).
   *
   * Counts what is actually uploaded, not what a worst case would be — the worst case is
   * {@link worstCaseCardBytes}, and the two are reported side by side so a measurement can be
   * checked against the budget it is supposed to be inside.
   */
  get gpuBytes(): number {
    let bytes = 0
    if (this.frontImage.texture) bytes += CARD_IMAGE_WIDTH * CARD_IMAGE_HEIGHT * 4
    if (this.backImage.texture) bytes += CARD_IMAGE_WIDTH * CARD_IMAGE_HEIGHT * 4
    for (const planet of this.planets) {
      if (planet.image.texture) bytes += PRINTING_IMAGE_WIDTH * PRINTING_IMAGE_HEIGHT * 4
    }
    return bytes
  }

  dispose(): void {
    for (const pending of this.pendingUploads.splice(0)) pending.bitmap.close()
    this.clearPlanets()
    this.releaseImage(this.frontImage)
    this.releaseImage(this.backImage)
    for (const geometry of this.faceGeometries) geometry.dispose()
    this.planetGeometry.dispose()
    this.frontMaterial.dispose()
    this.backMaterial.dispose()
    this.warmupPlanetMaterial.dispose()
    this.warmupPlanetPickMaterial.dispose()
  }

  /**
   * The two planet programs, for the boot-time warm-up. See {@link warmupPlanetMaterial}.
   *
   * The card's own faces and edge are not here: they are mounted under {@link root} from the
   * constructor, so a traversal of the live scene already finds them.
   */
  get warmupSpecs(): ProgramWarmupSpec[] {
    return [
      { geometry: this.planetGeometry, material: this.warmupPlanetMaterial },
      { geometry: this.planetGeometry, material: this.warmupPlanetPickMaterial },
    ]
  }
}

/**
 * PRD 5.6.7's orbiting printing, as §1.10's flat quad. One program for all of them — same sources,
 * no defines — so every slot's material carries the same name.
 *
 * Extracted from `rebuildPlanets` so the boot-time warm-up can build one without a card
 * (`FocusedCard.warmupSpecs`, DEC-739). A factory rather than a shared singleton because each
 * planet owns its own texture and its own `uActive`/`uHover`, which are uniform *values* and
 * therefore outside `getProgramCacheKey` — same program, different bindings.
 */
function planetMaterial(active: number): ShaderMaterial {
  return new ShaderMaterial({
    name: SHADER_NAME_CARD_PLANET,
    uniforms: {
      uImage: { value: null },
      uHasImage: { value: 0 },
      uImageFade: { value: 0 },
      uGlow: { value: new Color(0.16, 0.17, 0.22) },
      uActive: { value: active },
      uHover: { value: 0 },
    },
    vertexShader: PLANET_VERTEX_SHADER,
    fragmentShader: PLANET_FRAGMENT_SHADER,
  })
}

/**
 * The same quad into the id buffer (PRD 8.5.6), with its slot's id as a colour.
 *
 * Sharing the draw geometry is what keeps the pick target from drifting off the picture, and §1.10
 * makes the target *larger* than it was: the quad is 0.172 × 0.24 where the sphere it replaces was
 * 0.116 across, so no printing became harder to click in the conversion.
 */
function planetPickMaterial(id: number): ShaderMaterial {
  return new ShaderMaterial({
    name: SHADER_NAME_CARD_PLANET_PICK,
    uniforms: {
      uIdColour: {
        value: new Color(
          (id % 256) / 255,
          (Math.floor(id / 256) % 256) / 255,
          (Math.floor(id / 65536) % 256) / 255,
        ),
      },
    },
    vertexShader: ID_VERTEX_SHADER,
    fragmentShader: ID_FRAGMENT_SHADER,
  })
}

/** PRD 7.2's worst case: a 72-printing card, both faces loaded and every printing textured. */
export function worstCaseCardBytes(): number {
  return (
    CARD_IMAGE_WIDTH * CARD_IMAGE_HEIGHT * 4 * 2 +
    PLANET_CAP * PRINTING_IMAGE_WIDTH * PRINTING_IMAGE_HEIGHT * 4
  )
}

/**
 * One step of a damped spring (PRD 5.6.3's "spring damping"), in place.
 *
 * Semi-implicit Euler: the velocity is updated first and the position from the *new* velocity,
 * which is stable at these frequencies and, unlike explicit Euler, cannot gain energy at a low
 * frame rate. The step is capped at a 30 fps slice so that one long frame — a shard decoding, a tab
 * returning — cannot throw the card past its ±12° limit, which is the one thing PRD 9.3's "no
 * overshoot" would notice.
 */
export function stepSpring(state: SpringState, target: number, dt: number): void {
  const omega = CARD_TILT_FREQUENCY
  const zeta = CARD_TILT_DAMPING
  const step = Math.min(dt, 1 / 30)
  const acceleration = -2 * zeta * omega * state.rate - omega * omega * (state.value - target)
  state.rate += acceleration * step
  state.value += state.rate * step
}

const positionScratch = { x: 0, y: 0, z: 0 }
