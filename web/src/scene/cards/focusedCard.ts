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
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
  Color,
  type BufferGeometry,
} from 'three'

import { cardBackImageUri, printingImageUri, CARD_BACK_URI } from '../../data/images'
import type { CardRecord } from '../../data/types'
import { PICK_LAYER } from '../picking/idPicker'
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
  PLANET_RADIUS,
  PLANET_TEXTURE_PX,
} from '../tuning'
import {
  CARD_FACE_FRAGMENT_SHADER,
  CARD_FACE_VERTEX_SHADER,
  ID_FRAGMENT_SHADER,
  ID_VERTEX_SHADER,
  PLANET_FRAGMENT_SHADER,
  PLANET_VERTEX_SHADER,
} from './cardShaders'
import type { ImageQueue } from './imageQueue'
import { planetLayout, planetPosition, type PlanetLayout } from './planets'
import { cardEdgeGeometry, cardFaceGeometry } from './roundedRect'

/**
 * Ids the pick pass writes for planets, offset well clear of the star ids.
 *
 * Star ids are `gl_VertexID + 1`, so they run to the star count — 28,587 on the production dataset
 * and bounded by the 24 bits the id buffer has. Half of that range is a boundary no dataset can
 * reach and no arithmetic can land on by accident.
 */
export const PLANET_ID_BASE = 0x800000

/** Scryfall's `large` image, for the GPU budget of PRD 7.2. */
export const CARD_IMAGE_WIDTH = 672
export const CARD_IMAGE_HEIGHT = 936

/** `art_crop` is 626 × 457; PRD 8.5.10 downscales it to 256 on the long side. */
export const PLANET_TEXTURE_HEIGHT = Math.round((PLANET_TEXTURE_PX * 457) / 626)

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
  private readonly planetGeometry = new SphereGeometry(PLANET_RADIUS, 24, 16)
  private readonly planets: Planet[] = []

  private card: CardRecord | null = null
  private starIndexValue = -1
  private activePrintingValue = 0
  private layout: PlanetLayout = { slots: [], overflow: 0, rings: 0 }

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
    this.flipGroup.add(new Mesh(edge, new MeshBasicMaterial({ color: 0x14161f })))
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

    for (let i = 0; i < this.planets.length; i += 1) {
      const planet = this.planets[i]!
      const slot = this.layout.slots[i]!
      planetPosition(slot, this.elapsed, motionScale, positionScratch)
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

  /** PRD 5.6.7-8, plus PRD 8.5.10's 256 px art crops. */
  private rebuildPlanets(): void {
    this.clearPlanets()
    const card = this.card
    if (!card) return
    this.layout = planetLayout(card.p.length)

    for (let i = 0; i < this.layout.slots.length; i += 1) {
      const slot = this.layout.slots[i]!
      const printing = card.p[slot.printing]
      if (!printing) continue

      const material = new ShaderMaterial({
        uniforms: {
          uImage: { value: null },
          uHasImage: { value: 0 },
          uImageFade: { value: 0 },
          uGlow: { value: new Color(0.16, 0.17, 0.22) },
          uActive: { value: slot.printing === this.activePrintingValue ? 1 : 0 },
          uHover: { value: 0 },
        },
        vertexShader: PLANET_VERTEX_SHADER,
        fragmentShader: PLANET_FRAGMENT_SHADER,
      })
      const mesh = new Mesh(this.planetGeometry, material)
      mesh.layers.set(0)

      const id = PLANET_ID_BASE + i + 1
      const pickMaterial = new ShaderMaterial({
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

      const url = printingImageUri(printing, 'art_crop')
      image.url = url
      void this.queue
        .request({
          key: image.key!,
          url,
          // PRD 8.5.10: downscaled on decode. A full-size art crop is about 1 MB of texels and 72
          // of them would be the whole GPU budget on their own.
          resize: { width: PLANET_TEXTURE_PX, height: PLANET_TEXTURE_HEIGHT },
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
  }

  private clearPlanets(): void {
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
    this.layout = { slots: [], overflow: 0, rings: 0 }
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
      if (planet.image.texture) bytes += PLANET_TEXTURE_PX * PLANET_TEXTURE_HEIGHT * 4
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
  }
}

/** PRD 7.2's worst case: a 72-printing card, both faces loaded and every planet textured. */
export function worstCaseCardBytes(): number {
  return CARD_IMAGE_WIDTH * CARD_IMAGE_HEIGHT * 4 * 2 + PLANET_CAP * PLANET_TEXTURE_PX * PLANET_TEXTURE_HEIGHT * 4
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
