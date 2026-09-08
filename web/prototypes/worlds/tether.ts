/**
 * The surface-following tether (review §4.2, §4.3).
 *
 * The claim being prototyped is that the tether stops being a line between two dots and becomes a
 * thing anchored to ground: "the camera dollies in and the tether slides from the centre to the
 * surface point under the reticle". So each end has two directions — the **anchor**, which is
 * wherever the reticle is pointing when the camera is close, and the **exit**, which is the
 * sub-point facing the other world — and the curve is a great-circle run across the surface from
 * the anchor to the exit, then a Bézier through space to the far world's exit, then its surface run
 * in reverse. When the camera is far the anchor relaxes onto the exit and the surface runs collapse
 * to nothing, which is the far-field behaviour you want and costs no special case.
 *
 * Drawn as a camera-facing ribbon of constant *pixel* width rather than a `LineSegments`, because
 * a 1 px `gl.LINES` line is the one primitive whose width WebGL is allowed to ignore, and because
 * the judgement here is about how the tether reads.
 */

import * as THREE from 'three'

const SURFACE_SAMPLES = 24
const SPAN_SAMPLES = 96
const SAMPLES = SURFACE_SAMPLES * 2 + SPAN_SAMPLES

/** Ribbon half-width, in CSS pixels — held constant by scaling with depth. */
const HALF_WIDTH_PX = 2.1

/**
 * How much wider the ribbon gets at the two anchors.
 *
 * At constant width the tether is invisible over a surface of card art, which is the one place it
 * has to read: the flare plus the anchor pads below are what makes it look footed into ground
 * rather than laid across a photograph.
 */
const ANCHOR_FLARE = 2.0

const VERTEX = /* glsl */ `
  precision highp float;
  in vec3 position;
  in float aT;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  out float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;
  in float vT;
  uniform vec3 uColour;
  uniform float uTime;
  out vec4 fragColour;
  void main() {
    // A short fade only, so the run across the ground survives; 6% swallowed the whole anchor.
    float ends = smoothstep(0.0, 0.012, vT) * smoothstep(1.0, 0.988, vT);
    float flow = 0.55 + 0.45 * sin((vT * 26.0) - uTime * 2.2);
    fragColour = vec4(uColour * (0.45 + 0.7 * flow) * ends, ends * (0.4 + 0.4 * flow));
  }
`

function slerp(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1)
  const theta = Math.acos(dot)
  if (theta < 1e-4) return out.copy(b)
  const sin = Math.sin(theta)
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * theta) / sin)
    .addScaledVector(b, Math.sin(t * theta) / sin)
    .normalize()
}

export interface TetherEnd {
  readonly centre: THREE.Vector3
  readonly radius: number
  /** Where the reticle is pointing, as a unit direction out of `centre`. */
  readonly anchor: THREE.Vector3
  /** The sub-point facing the other world. */
  readonly exit: THREE.Vector3
}

/** A glowing pad on the ground where the tether meets it. */
const PAD_FRAGMENT = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  uniform vec3 uColour;
  out vec4 fragColour;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(1.0, 0.72, r) * smoothstep(0.28, 0.55, r);
    float core = smoothstep(0.34, 0.0, r);
    float a = ring * 0.7 + core * 0.35;
    fragColour = vec4(uColour * (ring * 0.85 + core * 0.55), a);
  }
`

const PAD_VERTEX = /* glsl */ `
  precision highp float;
  in vec3 position;
  in vec2 uv;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export class Tether {
  readonly mesh: THREE.Mesh
  readonly pads: readonly [THREE.Mesh, THREE.Mesh]

  private readonly positions: THREE.BufferAttribute
  private readonly points: THREE.Vector3[] = []
  private readonly time: { value: number }

  private readonly dir = new THREE.Vector3()
  private readonly tangent = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly view = new THREE.Vector3()
  private readonly ca = new THREE.Vector3()
  private readonly cb = new THREE.Vector3()
  private readonly pa = new THREE.Vector3()
  private readonly pb = new THREE.Vector3()
  private readonly padLook = new THREE.Vector3()

  constructor(colour: readonly [number, number, number]) {
    const positions = new Float32Array(SAMPLES * 2 * 3)
    const t = new Float32Array(SAMPLES * 2)
    const index: number[] = []
    for (let i = 0; i < SAMPLES; i += 1) {
      t[i * 2] = i / (SAMPLES - 1)
      t[i * 2 + 1] = i / (SAMPLES - 1)
      if (i + 1 < SAMPLES) {
        const a = i * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
      this.points.push(new THREE.Vector3())
    }

    const geometry = new THREE.BufferGeometry()
    this.positions = new THREE.BufferAttribute(positions, 3)
    this.positions.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', this.positions)
    geometry.setAttribute('aT', new THREE.BufferAttribute(t, 1))
    geometry.setIndex(index)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.time = { value: 0 }
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uColour: { value: new THREE.Vector3(...colour) }, uTime: this.time },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.mesh.frustumCulled = false

    const padMaterial = (): THREE.RawShaderMaterial =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: PAD_VERTEX,
        fragmentShader: PAD_FRAGMENT,
        uniforms: { uColour: { value: new THREE.Vector3(...colour) } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    const padGeometry = new THREE.PlaneGeometry(1, 1)
    this.pads = [new THREE.Mesh(padGeometry, padMaterial()), new THREE.Mesh(padGeometry, padMaterial())]
    for (const pad of this.pads) pad.frustumCulled = false
  }

  private placePad(pad: THREE.Mesh, end: TetherEnd): void {
    pad.position.copy(end.centre).addScaledVector(end.anchor, end.radius * 1.012)
    this.padLook.copy(pad.position).addScaledVector(end.anchor, 1)
    pad.lookAt(this.padLook)
    pad.scale.setScalar(end.radius * 0.11)
    pad.updateMatrixWorld()
  }

  update(
    camera: THREE.PerspectiveCamera,
    a: TetherEnd,
    b: TetherEnd,
    viewportHeight: number,
    elapsed: number,
  ): void {
    this.time.value = elapsed

    // Surface runs, then the free span. `lift` is what makes the curve leave perpendicular to the
    // ground instead of shooting off tangentially.
    this.pa.copy(a.centre).addScaledVector(a.exit, a.radius * 1.01)
    this.pb.copy(b.centre).addScaledVector(b.exit, b.radius * 1.01)
    const span = this.pa.distanceTo(this.pb)
    const lift = span * 0.28
    this.ca.copy(this.pa).addScaledVector(a.exit, lift)
    this.cb.copy(this.pb).addScaledVector(b.exit, lift)

    for (let i = 0; i < SURFACE_SAMPLES; i += 1) {
      const t = i / SURFACE_SAMPLES
      slerp(this.dir, a.anchor, a.exit, t * t)
      this.points[i]!.copy(a.centre).addScaledVector(this.dir, a.radius * 1.008)
    }
    for (let i = 0; i < SPAN_SAMPLES; i += 1) {
      const t = i / (SPAN_SAMPLES - 1)
      const u = 1 - t
      const w0 = u * u * u
      const w1 = 3 * u * u * t
      const w2 = 3 * u * t * t
      const w3 = t * t * t
      this.points[SURFACE_SAMPLES + i]!.set(
        w0 * this.pa.x + w1 * this.ca.x + w2 * this.cb.x + w3 * this.pb.x,
        w0 * this.pa.y + w1 * this.ca.y + w2 * this.cb.y + w3 * this.pb.y,
        w0 * this.pa.z + w1 * this.ca.z + w2 * this.cb.z + w3 * this.pb.z,
      )
    }
    for (let i = 0; i < SURFACE_SAMPLES; i += 1) {
      const t = 1 - i / SURFACE_SAMPLES
      slerp(this.dir, b.anchor, b.exit, t * t)
      this.points[SURFACE_SAMPLES + SPAN_SAMPLES + i]!
        .copy(b.centre)
        .addScaledVector(this.dir, b.radius * 1.008)
    }

    // Camera-facing ribbon. Coincident samples — which the collapsed surface runs produce — reuse
    // the last good tangent rather than emitting a zero-area quad with a NaN normal.
    const fovScale = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
    const array = this.positions.array as Float32Array
    this.tangent.set(0, 0, 1)

    for (let i = 0; i < SAMPLES; i += 1) {
      const point = this.points[i]!
      const next = this.points[Math.min(SAMPLES - 1, i + 1)]!
      const prev = this.points[Math.max(0, i - 1)]!
      this.dir.copy(next).sub(prev)
      if (this.dir.lengthSq() > 1e-12) this.tangent.copy(this.dir).normalize()

      this.view.copy(camera.position).sub(point)
      const depth = Math.max(1e-3, this.view.length())
      this.view.divideScalar(depth)
      this.side.crossVectors(this.tangent, this.view)
      if (this.side.lengthSq() < 1e-12) this.side.set(0, 1, 0)
      const t = i / (SAMPLES - 1)
      const flare = 1 + (ANCHOR_FLARE - 1) * Math.max(0, 1 - Math.min(t, 1 - t) / 0.14)
      this.side.normalize().multiplyScalar((HALF_WIDTH_PX * flare * depth) / fovScale)

      array[i * 6] = point.x - this.side.x
      array[i * 6 + 1] = point.y - this.side.y
      array[i * 6 + 2] = point.z - this.side.z
      array[i * 6 + 3] = point.x + this.side.x
      array[i * 6 + 4] = point.y + this.side.y
      array[i * 6 + 5] = point.z + this.side.z
    }

    this.positions.needsUpdate = true
    this.placePad(this.pads[0], a)
    this.placePad(this.pads[1], b)
  }
}
