/**
 * One concept B world: a globe, an instanced sheet of cells over it, and an atmosphere shell.
 *
 * The cells are a single `InstancedBufferGeometry` draw — one quad, N instances, each oriented to
 * its own tangent frame — which is the arrangement review §4.2 costs at "~2,000 opaque textured
 * quads ≈ 2–3 ms". Dominaria puts 6,266 of them in that draw.
 *
 * Two things in the fragment shader are deliberate rather than incidental:
 *
 *   - **swatches are shaded, art is not.** The lambert term is what makes a mosaic read as a
 *     sphere from framing distance, and it is also a brightness shift, which Scryfall's terms
 *     forbid applying to card art (review §4.4 flags the current planet shader for exactly that).
 *     So the shade multiplies the swatch and the art is mixed in at full value: a cell that has
 *     resolved to art is flat-lit, on purpose.
 *   - **no full-scene bloom.** The rim lives in the atmosphere shell. Review §4.2's cost estimate
 *     assumes there is no post chain here, so there is none.
 *
 * Everything is in world space, and every group carries a translation and no rotation, so an
 * instance normal is already a world normal and no `normalMatrix` is needed. A production version
 * would need the plane's `tilt` quaternion and would have to reinstate one.
 */

import * as THREE from 'three'

import type { ArtPool } from './art'
import { artUri, paletteColour, type WorldCard, type WorldData } from './data'
import { buildSurface, type SurfaceLayout } from './layout'

/** Cell edges pull in slightly, so the tiling reads as masonry with grout rather than as a skin. */
const GROUT = 0.93

/** Cells sit just off the globe, enough to beat depth precision at system distance. */
const CELL_LIFT = 1.006

/** `radius = WORLD_RADIUS_K · √cardCount` — constant area per card (review §4.2). */
export const WORLD_RADIUS_K = 0.126

/** Below this on-screen height a cell is a swatch; above it, art is requested and faded in. */
export const ART_PIXEL_THRESHOLD = 24

const CELL_VERTEX = /* glsl */ `
  precision highp float;

  in vec3 position;
  in vec3 iNormal;
  in vec3 iEast;
  in vec2 iSize;
  in vec3 iSwatch;
  in float iLayer;
  in float iArt;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uRadius;

  out vec2 vUv;
  out vec3 vSwatch;
  out vec3 vNormal;
  out float vLayer;
  out float vArt;

  void main() {
    vec3 n = normalize(iNormal);
    vec3 east = normalize(iEast);
    vec3 north = cross(east, n);

    vec3 local = n * (uRadius * ${CELL_LIFT.toFixed(4)})
      + east * (position.x * iSize.x * uRadius * ${GROUT.toFixed(4)})
      + north * (position.y * iSize.y * uRadius * ${GROUT.toFixed(4)});

    vUv = position.xy + 0.5;
    vSwatch = iSwatch;
    vNormal = n;
    vLayer = iLayer;
    vArt = iArt;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
  }
`

const CELL_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler2DArray;

  in vec2 vUv;
  in vec3 vSwatch;
  in vec3 vNormal;
  in float vLayer;
  in float vArt;

  uniform sampler2DArray uArt;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  uniform float uFlat;

  out vec4 fragColour;

  void main() {
    // Wrapped lambert: a hard terminator across a mosaic reads as a bug, not as night.
    float lambert = dot(normalize(vNormal), normalize(uLight));
    float shade = clamp(lambert * 0.5 + 0.5, 0.0, 1.0);
    shade = mix(0.10 + 0.95 * shade * shade, 1.0, uFlat);

    vec3 swatch = vSwatch * shade + uAmbient;

    vec3 colour = swatch;
    if (vArt > 0.0 && vLayer >= 0.0) {
      // V is flipped here, not on upload: a DataArrayTexture ignores UNPACK_FLIP_Y_WEBGL.
      vec3 art = texture(uArt, vec3(vUv.x, 1.0 - vUv.y, vLayer)).rgb;
      colour = mix(swatch, art, vArt);
    }

    fragColour = vec4(colour, 1.0);
  }
`

const SHELL_VERTEX = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec3 normal;
  uniform mat4 modelMatrix;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform vec3 cameraPosition;
  out vec3 vNormal;
  out vec3 vView;
  void main() {
    vNormal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const GLOBE_FRAGMENT = /* glsl */ `
  precision highp float;
  in vec3 vNormal;
  in vec3 vView;
  uniform vec3 uTint;
  uniform vec3 uLight;
  uniform float uRimStrength;
  out vec4 fragColour;
  void main() {
    vec3 n = normalize(vNormal);
    float lambert = clamp(dot(n, normalize(uLight)) * 0.5 + 0.5, 0.0, 1.0);
    float fresnel = pow(1.0 - clamp(dot(n, normalize(vView)), 0.0, 1.0), 3.0);
    vec3 ground = uTint * (0.020 + 0.060 * lambert);
    fragColour = vec4(ground + uTint * fresnel * uRimStrength, 1.0);
  }
`

const AIR_FRAGMENT = /* glsl */ `
  precision highp float;
  in vec3 vNormal;
  in vec3 vView;
  uniform vec3 uTint;
  uniform vec3 uLight;
  out vec4 fragColour;
  void main() {
    vec3 n = normalize(vNormal);
    float fresnel = pow(1.0 - abs(dot(n, normalize(vView))), 2.6);
    float lit = clamp(dot(-n, normalize(uLight)) * 0.6 + 0.55, 0.0, 1.0);
    fragColour = vec4(uTint * fresnel * lit * 0.9, fresnel * lit * 0.85);
  }
`

/**
 * A unit quad centred on the origin, as an instanced base.
 *
 * The winding is **clockwise in the quad's own x-y plane**, which is what makes the face point
 * *outwards* once the vertex shader maps x to east and y to north. Counter-clockwise — the obvious
 * order — gives a geometric normal of `east × north = -n`, so every front-facing cell is
 * back-face culled and the only cells that survive are the ones on the far hemisphere, seen from
 * the inside. That failure is invisible when the globe is hidden (the far hemisphere fills the
 * silhouette, so it reads as a complete mosaic) and looks like a depth-precision bug when it is
 * not, which cost an hour. Do not "tidy" this back to `[0, 1, 2, 0, 2, 3]`.
 */
function cellBaseGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  )
  geometry.setIndex([0, 2, 1, 0, 3, 2])
  return geometry
}

export class World {
  readonly group = new THREE.Group()
  readonly data: WorldData
  readonly surface: SurfaceLayout
  readonly radius: number

  /** Cards in instance order, so an instance index is the lookup key everywhere else. */
  readonly cellCard: readonly WorldCard[]

  private readonly cellCardIndex: Int32Array
  private readonly normals: Float32Array
  private readonly cellHeights: Float32Array
  private readonly layerAttr: THREE.InstancedBufferAttribute
  private readonly artAttr: THREE.InstancedBufferAttribute
  private readonly artMix: Float32Array

  private readonly toCamera = new THREE.Vector3()
  private readonly probe = new THREE.Vector3()
  private readonly cellMaterial: THREE.RawShaderMaterial
  readonly globe: THREE.Mesh
  readonly air: THREE.Mesh

  private artCells = 0
  private litCells = 0

  constructor(data: WorldData, art: ArtPool, light: THREE.Vector3) {
    this.data = data
    this.surface = buildSurface(data.cards, data.setCounts)
    this.radius = WORLD_RADIUS_K * Math.sqrt(Math.max(1, data.plane.cardCount))

    const used: number[] = []
    for (let i = 0; i < this.surface.cardOfSlot.length; i += 1) {
      if (this.surface.cardOfSlot[i] !== -1) used.push(i)
    }
    const count = used.length

    this.normals = new Float32Array(count * 3)
    this.cellHeights = new Float32Array(count)
    this.cellCardIndex = new Int32Array(count)
    this.artMix = new Float32Array(count)

    const iEast = new Float32Array(count * 3)
    const iSize = new Float32Array(count * 2)
    const iSwatch = new Float32Array(count * 3)
    const layers = new Float32Array(count).fill(-1)
    const cards: WorldCard[] = []

    used.forEach((slotIndex, i) => {
      const slot = this.surface.slots[slotIndex]!
      const cardIndex = this.surface.cardOfSlot[slotIndex]!
      const card = data.cards[cardIndex]!
      this.normals[i * 3] = slot.nx
      this.normals[i * 3 + 1] = slot.ny
      this.normals[i * 3 + 2] = slot.nz
      iEast[i * 3] = slot.ex
      iEast[i * 3 + 2] = slot.ez
      iSize[i * 2] = slot.halfW * 2
      iSize[i * 2 + 1] = slot.halfH * 2
      iSwatch[i * 3] = card.swatch[0]
      iSwatch[i * 3 + 1] = card.swatch[1]
      iSwatch[i * 3 + 2] = card.swatch[2]
      this.cellHeights[i] = slot.halfH * 2 * this.radius
      this.cellCardIndex[i] = cardIndex
      cards.push(card)
    })
    this.cellCard = cards

    const geometry = cellBaseGeometry()
    geometry.instanceCount = count
    geometry.setAttribute('iNormal', new THREE.InstancedBufferAttribute(this.normals, 3))
    geometry.setAttribute('iEast', new THREE.InstancedBufferAttribute(iEast, 3))
    geometry.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 2))
    geometry.setAttribute('iSwatch', new THREE.InstancedBufferAttribute(iSwatch, 3))
    this.layerAttr = new THREE.InstancedBufferAttribute(layers, 1)
    this.layerAttr.setUsage(THREE.DynamicDrawUsage)
    this.artAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    this.artAttr.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('iLayer', this.layerAttr)
    geometry.setAttribute('iArt', this.artAttr)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.1)

    const tint = data.plane.nebulaTint
    const ground = paletteColour(data.plane)

    const cells = new THREE.Mesh(
      geometry,
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: CELL_VERTEX,
        fragmentShader: CELL_FRAGMENT,
        uniforms: {
          uArt: { value: art.texture },
          uRadius: { value: this.radius },
          uLight: { value: light },
          uAmbient: { value: new THREE.Vector3(...tint).multiplyScalar(0.035) },
          uFlat: { value: 0 },
        },
      }),
    )
    cells.frustumCulled = false
    this.cellMaterial = cells.material

    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 72, 40),
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: SHELL_VERTEX,
        fragmentShader: GLOBE_FRAGMENT,
        uniforms: {
          uTint: { value: new THREE.Vector3(...ground) },
          uLight: { value: light },
          uRimStrength: { value: 0.5 },
        },
      }),
    )

    this.air = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius * 1.055, 48, 28),
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: SHELL_VERTEX,
        fragmentShader: AIR_FRAGMENT,
        uniforms: {
          uTint: { value: new THREE.Vector3(...tint) },
          uLight: { value: light },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    )

    this.group.add(this.globe, cells, this.air)
    this.group.position.set(...data.plane.home)
  }

  /**
   * Decide which cells are big enough to be worth art, ask for it, and advance the cross-fade.
   *
   * A cell's on-screen height is computed at its own depth and gated on its facing, so a cell at
   * the limb never wins the race for a layer against one at the sub-camera point.
   */
  update(
    camera: THREE.PerspectiveCamera,
    art: ArtPool,
    viewportHeight: number,
    dt: number,
    threshold = ART_PIXEL_THRESHOLD,
  ): void {
    const toCamera = this.toCamera.copy(camera.position).sub(this.group.position)
    const distance = Math.max(1e-3, toCamera.length())
    toCamera.divideScalar(distance)

    const fovScale = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
    const layers = this.layerAttr.array as Float32Array
    const mixes = this.artAttr.array
    const fadeRate = Math.min(1, dt * 3.2)

    let artCells = 0
    let litCells = 0

    for (let i = 0; i < this.cellCard.length; i += 1) {
      const facing =
        this.normals[i * 3]! * toCamera.x +
        this.normals[i * 3 + 1]! * toCamera.y +
        this.normals[i * 3 + 2]! * toCamera.z

      let target = 0
      if (facing > 0.12) {
        const cellDistance = Math.max(1e-3, distance - facing * this.radius)
        const pixels = (this.cellHeights[i]! * fovScale) / cellDistance
        if (pixels >= threshold && this.onScreen(i, camera)) {
          litCells += 1
          const layer = art.want(this.cellCardIndex[i]!, artUri(this.cellCard[i]!), pixels)
          if (layer >= 0) {
            layers[i] = layer
            target = Math.min(1, (pixels - threshold) / threshold + 0.35)
            artCells += 1
          }
        }
      }

      const current = this.artMix[i]!
      if (current !== target) {
        const next =
          current < target
            ? Math.min(target, current + fadeRate)
            : Math.max(target, current - fadeRate)
        this.artMix[i] = next
        mixes[i] = next
      }
    }

    this.artAttr.needsUpdate = true
    this.layerAttr.needsUpdate = true
    this.artCells = artCells
    this.litCells = litCells
  }

  /**
   * Whether a cell's centre is inside the frustum, with a margin of one screen.
   *
   * Facing alone is not enough to decide who gets a layer: at the near view 2,753 cells face the
   * camera and the pool holds 1,024, and half of those are behind the viewer's shoulder or over
   * the horizon. Without this the pool is spent on cells that are not in the frame.
   */
  private onScreen(index: number, camera: THREE.PerspectiveCamera): boolean {
    this.probe
      .set(this.normals[index * 3]!, this.normals[index * 3 + 1]!, this.normals[index * 3 + 2]!)
      .multiplyScalar(this.radius)
      .add(this.group.position)
      .applyMatrix4(camera.matrixWorldInverse)
    // View space, so a point behind the eye is caught before the projection divides by a negative
    // w and folds it back into the frame. `Vector3.applyMatrix4` does that divide itself.
    if (this.probe.z > -camera.near) return false
    this.probe.applyMatrix4(camera.projectionMatrix)
    return Math.abs(this.probe.x) <= 2 && Math.abs(this.probe.y) <= 2
  }

  /** `?flat=1` — drop the lambert term, so the mosaic can be read without the terminator. */
  setFlatLight(flat: boolean): void {
    const uniform = this.cellMaterial.uniforms['uFlat']
    if (uniform !== undefined) uniform.value = flat ? 1 : 0
  }

  /** `?only=cells` — hide the ground and the air, leaving the cell sheet on its own. */
  setShellsVisible(visible: boolean): void {
    this.globe.visible = visible
    this.air.visible = visible
  }

  /** Cells currently showing art, cells that asked for it, and the total in the draw. */
  artCounts(): { readonly drawn: number; readonly wanted: number; readonly cells: number } {
    return { drawn: this.artCells, wanted: this.litCells, cells: this.cellCard.length }
  }

  /** The card nearest a direction out of the world centre — the caption's subject. */
  cardAlong(direction: THREE.Vector3): WorldCard | null {
    let best = -1
    let bestDot = 0.9
    for (let i = 0; i < this.cellCard.length; i += 1) {
      const d =
        this.normals[i * 3]! * direction.x +
        this.normals[i * 3 + 1]! * direction.y +
        this.normals[i * 3 + 2]! * direction.z
      if (d > bestDot) {
        bestDot = d
        best = i
      }
    }
    return best < 0 ? null : this.cellCard[best]!
  }
}
