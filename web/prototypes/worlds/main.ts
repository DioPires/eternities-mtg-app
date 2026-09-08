/**
 * Concept B "worlds" prototype — DEC-694 / review §4.2, §4.3.
 *
 * Throwaway. It shares no code with the product's render path on purpose: it is imperative
 * three.js with no react-three-fiber and no post chain, which is both what review §3.5 recommends
 * the product move to and the only way the §4.2 cost estimate means anything. Nothing here is
 * wired to the shell, the router, the store, the quality ladder or the label overlay.
 *
 *   pnpm dev  →  http://localhost:5173/prototypes/worlds/
 *
 * Query parameters (all optional):
 *   ?view=<name>    start at a named camera view; `views` below is the list
 *   ?dpr=<n>        pin the device pixel ratio, so a capture is at a known scale
 *   ?artpx=<n>      the swatch → art threshold in CSS pixels (default 24, review §4.2)
 *   ?layers=<n>     art pool size in layers (default 1024 ≈ 50 MB, review §4.2)
 *   ?dataset=<hash> a dataset other than the production one
 *   ?hud=0          hide the HUD, reticle and caption
 */

import * as THREE from 'three'

import { ArtPool } from './art'
import { loadPlanes, loadWorld, type WorldCard } from './data'
import { buildSystem } from './system'
import { Tether } from './tether'
import { ART_PIXEL_THRESHOLD, World } from './world'

const DETAILED = ['dominaria', 'rabiah'] as const

/**
 * Direction *towards* the key light. Mutated in place every frame, and every material holds this
 * same `Vector3` as its uniform value, so one write relights the scene.
 *
 * The light is **camera-relative**, offset from the view direction by the angles below. A fixed
 * sun is more honest to a solar system and completely useless for judging a mosaic: at half the
 * orbit the world being looked at is its own night side, and the capture is of a black ball. A
 * product would want a real star; a concept capture wants the subject lit.
 */
const LIGHT = new THREE.Vector3(0.45, 0.5, 0.72).normalize()
const KEY_LIGHT_AZIMUTH = 0.72
const KEY_LIGHT_ELEVATION = 0.38

interface ViewSpec {
  readonly focus: 'dominaria' | 'rabiah' | 'system' | 'pair'
  /** Multiples of the focused world's radius; absolute units for `system` and `pair`. */
  readonly distance: number
  readonly azimuth: number
  readonly elevation: number
  readonly offsetX?: number
  readonly offsetY?: number
  readonly caption: string
}

/** The system is hidden on a single-world view; an unrelated neighbour in frame is an accident. */
function showsSystem(focus: ViewSpec['focus']): boolean {
  return focus === 'system' || focus === 'pair'
}

const VIEWS: Readonly<Record<string, ViewSpec>> = {
  system: {
    focus: 'system',
    distance: 330,
    azimuth: 0.62,
    elevation: 0.42,
    caption:
      'System view — radius ∝ √N. Every plane at its shipped `home`; empty planes are dark moons; the Blind Eternities is the belt, one arc per set.',
  },
  'dominaria-far': {
    focus: 'dominaria',
    distance: 6,
    azimuth: 3.6,
    elevation: 0.24,
    caption:
      'Dominaria at 6× radius — 6,266 cells, swatches only. Latitude is colour (gold belt, colourless caps); longitude is time, one meridian slice per set.',
  },
  'dominaria-frame': {
    focus: 'dominaria',
    distance: 3,
    azimuth: 3.6,
    elevation: 0.24,
    caption:
      'Dominaria framed at 3× radius — the mosaic-to-art threshold. Cells at the sub-camera point are crossing 24 px and resolving.',
  },
  'dominaria-near': {
    focus: 'dominaria',
    distance: 1.32,
    azimuth: 3.6,
    elevation: 0.18,
    caption:
      'Dominaria near — cells past the threshold are real `art_crop`, letterboxed and unshaded. The horizon is the same draw call.',
  },
  'dominaria-terminator': {
    focus: 'dominaria',
    distance: 2.1,
    azimuth: 2.35,
    elevation: 0.55,
    caption:
      'Dominaria over the pole — the colourless ice cap, the mono-colour bands mirrored about the equator, and the gold belt on the limb.',
  },
  rabiah: {
    focus: 'rabiah',
    distance: 3.4,
    azimuth: 1.1,
    elevation: 0.2,
    caption:
      'Rabiah — 75 cards, one set (Arabian Nights, 1993). Its single set owns all 360° of longitude, so a one-set plane looks complete rather than 97% missing.',
  },
  'rabiah-near': {
    focus: 'rabiah',
    distance: 1.5,
    azimuth: 1.1,
    elevation: 0.12,
    caption:
      'Rabiah near — 13 cells across the equator, so a small plane is a moon with big tiles, not a galaxy with too few stars.',
  },
  'tether-far': {
    focus: 'pair',
    distance: 300,
    azimuth: 1.02,
    elevation: 0.3,
    caption:
      'The tether at system scale — Dominaria (r 9.97) and Rabiah (r 1.09), 220 units apart at their shipped `home` positions. Both anchors are relaxed onto the sub-points.',
  },
  'tether-surface': {
    focus: 'dominaria',
    distance: 2.2,
    // Chosen so the anchor and the sub-point facing Rabiah are ~45° apart, and the camera is far
    // enough out that both the anchor and the lift-off are inside the visible cap. At 70° / 1.7×
    // the run left the frame before it lifted, which is the shot not being taken.
    azimuth: 1.327,
    elevation: 0.28,
    offsetX: 0.08,
    offsetY: -0.05,
    caption:
      'The tether anchored under the reticle — the near end has slid off the centre onto the surface point the reticle is on, runs across the ground on a great circle, and leaves perpendicular.',
  },
}

interface HudNumbers {
  readonly view: string
  readonly focus: string
  readonly distance: number
  readonly cameraDistanceRadii: number
  readonly cellPixels: number
}

function query(): URLSearchParams {
  return new URLSearchParams(location.search)
}

function numberParam(key: string, fallback: number): number {
  const raw = query().get(key)
  if (raw === null) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  const bootNote = document.getElementById('boot')!
  const hud = document.getElementById('hud')!
  const hudBody = document.getElementById('hud-body')!
  const reticle = document.getElementById('reticle')!
  const caption = document.getElementById('caption')!
  const captionText = document.getElementById('caption-text')!

  if (query().get('hud') === '0') {
    for (const node of [hud, reticle, caption]) node.classList.add('hidden')
  }

  const dpr = numberParam('dpr', Math.min(2, window.devicePixelRatio))
  const artThreshold = numberParam('artpx', ART_PIXEL_THRESHOLD)
  const poolLayers = Math.round(numberParam('layers', 1024))

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(dpr)
  renderer.setClearColor(0x05060a, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20000)
  scene.add(new THREE.AmbientLight(0xffffff, 0.22))
  const sun = new THREE.DirectionalLight(0xffffff, 1.15)
  sun.position.copy(LIGHT).multiplyScalar(1000)
  scene.add(sun, sun.target)

  // A far starfield, so space reads as space. Deliberately 1 px and unattenuated: review §4.1's
  // complaint about the shipped renderer is that its stars are bokeh discs.
  const backdrop = new Float32Array(4000 * 3)
  for (let i = 0; i < 4000; i += 1) {
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    backdrop[i * 3] = Math.cos(theta) * r * 9000
    backdrop[i * 3 + 1] = u * 9000
    backdrop[i * 3 + 2] = Math.sin(theta) * r * 9000
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(backdrop, 3)),
    new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, color: 0x8d97b0 }),
  )
  stars.frustumCulled = false
  scene.add(stars)

  const planesFile = await loadPlanes()
  const detailedPlanes = DETAILED.map((slug) => {
    const plane = planesFile.planes.find((candidate) => candidate.slug === slug)
    if (plane === undefined) throw new Error(`plane ${slug} is not in this dataset`)
    return plane
  })

  const art = new ArtPool(renderer, poolLayers)
  const worldData = await Promise.all(detailedPlanes.map((plane) => loadWorld(plane)))
  const worlds = worldData.map((data) => new World(data, art, LIGHT))
  for (const world of worlds) scene.add(world.group)
  const [dominaria, rabiah] = worlds as [World, World]

  const system = buildSystem(
    planesFile.planes,
    new Set<string>(DETAILED),
    planesFile.multiverseRadius,
  )
  scene.add(system.group)

  // Two debug switches, kept because they are the only way to read the surface law off a capture:
  // `?flat=1` drops the lambert term, `?only=cells` hides everything but the cell sheet.
  const flat = query().get('flat') === '1'
  const onlyCells = query().get('only') === 'cells'
  for (const world of worlds) {
    world.setFlatLight(flat)
    if (onlyCells) world.setShellsVisible(false)
  }
  if (onlyCells) {
    system.group.visible = false
    stars.visible = false
  }

  const tether = new Tether([1.0, 0.78, 0.42])
  scene.add(tether.mesh, ...tether.pads)

  bootNote.classList.add('hidden')

  // ---- camera ----------------------------------------------------------------------------------

  let viewName = query().get('view') ?? 'system'
  if (!(viewName in VIEWS)) viewName = 'system'
  let spec = VIEWS[viewName]!
  const target = new THREE.Vector3()
  const lookAt = new THREE.Vector3()
  let distance = 1
  let azimuth = 0
  let elevation = 0
  let offsetX = 0
  let offsetY = 0

  const focusWorld = (focus: ViewSpec['focus']): World | null =>
    focus === 'dominaria' ? dominaria : focus === 'rabiah' ? rabiah : null

  function applyView(name: string): void {
    const next = VIEWS[name]
    if (next === undefined) return
    viewName = name
    spec = next
    azimuth = next.azimuth
    elevation = next.elevation
    offsetX = next.offsetX ?? 0
    offsetY = next.offsetY ?? 0
    const world = focusWorld(next.focus)
    if (world !== null) {
      target.copy(world.group.position)
      distance = next.distance * world.radius
    } else if (next.focus === 'pair') {
      target.copy(dominaria.group.position).add(rabiah.group.position).multiplyScalar(0.5)
      distance = next.distance
    } else {
      target.set(0, 0, 0)
      distance = next.distance
    }
    system.group.visible = showsSystem(next.focus) && !onlyCells
    captionText.textContent = next.caption
  }
  applyView(viewName)

  const right = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  function placeCamera(): void {
    const cosE = Math.cos(elevation)
    camera.position.set(
      target.x + Math.cos(azimuth) * cosE * distance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.sin(azimuth) * cosE * distance,
    )
    // Screen right for the given azimuth: `cross(worldUp, cameraToTarget)` reduces to this.
    right.set(-Math.sin(azimuth), 0, Math.cos(azimuth)).negate()
    lookAt
      .copy(target)
      .addScaledVector(right, offsetX * distance)
      .addScaledVector(up, offsetY * distance)
    camera.lookAt(lookAt)
    camera.updateMatrixWorld()

    const lightElevation = THREE.MathUtils.clamp(elevation + KEY_LIGHT_ELEVATION, -1.2, 1.2)
    const lightAzimuth = azimuth + KEY_LIGHT_AZIMUTH
    const lightCosE = Math.cos(lightElevation)
    LIGHT.set(
      Math.cos(lightAzimuth) * lightCosE,
      Math.sin(lightElevation),
      Math.sin(lightAzimuth) * lightCosE,
    )
    sun.position.copy(LIGHT).multiplyScalar(1000).add(target)
    sun.target.position.copy(target)
    sun.target.updateMatrixWorld()
  }

  let dragging = false
  let lastX = 0
  let lastY = 0
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointerup', (event) => {
    dragging = false
    canvas.releasePointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    if (event.shiftKey) {
      offsetX -= dx * 0.0012
      offsetY += dy * 0.0012
    } else {
      azimuth -= dx * 0.004
      elevation = THREE.MathUtils.clamp(elevation + dy * 0.004, -1.45, 1.45)
    }
  })
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      distance = THREE.MathUtils.clamp(distance * Math.exp(event.deltaY * 0.0012), 0.2, 4000)
    },
    { passive: false },
  )
  window.addEventListener('keydown', (event) => {
    if (event.key === '1') applyView('dominaria-far')
    else if (event.key === '2') applyView('rabiah')
    else if (event.key === '3') applyView('system')
    else if (event.key === '4') applyView('tether-surface')
    else if (event.key === 'h') for (const node of [hud, reticle, caption]) node.classList.toggle('hidden')
  })

  // ---- tether anchors --------------------------------------------------------------------------

  /**
   * The reticle's surface point, and how much of it the tether has taken up.
   *
   * `slide` is the review's "slides from the centre to the surface point under the reticle": 0 when
   * the camera is further than 8 radii out (the world is a dot, so an anchor is meaningless and the
   * tether may as well leave from the sub-point) and 1 inside 2.5 radii.
   */
  const ray = new THREE.Ray()
  const sphere = new THREE.Sphere()
  const hit = new THREE.Vector3()
  const anchorA = new THREE.Vector3(1, 0, 0)
  const anchorB = new THREE.Vector3(1, 0, 0)
  const exitA = new THREE.Vector3()
  const exitB = new THREE.Vector3()
  const wanted = new THREE.Vector3()

  function reticleAnchor(world: World, out: THREE.Vector3): boolean {
    ray.origin.copy(camera.position)
    ray.direction.copy(lookAt).sub(camera.position).normalize()
    sphere.set(world.group.position, world.radius)
    if (ray.intersectSphere(sphere, hit) === null) return false
    out.copy(hit).sub(world.group.position).normalize()
    return true
  }

  function slideFactor(world: World): number {
    const d = camera.position.distanceTo(world.group.position) / world.radius
    return THREE.MathUtils.clamp((8 - d) / (8 - 2.5), 0, 1)
  }

  function advanceAnchor(world: World, anchor: THREE.Vector3, exit: THREE.Vector3, dt: number): void {
    const slide = slideFactor(world)
    if (slide > 0 && reticleAnchor(world, wanted)) {
      wanted.lerp(exit, 1 - slide).normalize()
    } else {
      wanted.copy(exit)
    }
    anchor.lerp(wanted, Math.min(1, dt * 6)).normalize()
  }

  // ---- loop ------------------------------------------------------------------------------------

  let width = 0
  let height = 0
  function resize(): void {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === width && h === height) return
    width = w
    height = h
    renderer.setSize(w, h, false)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
  }

  let frames = 0
  let elapsed = 0
  let last = performance.now()
  let hudNumbers: HudNumbers = {
    view: viewName,
    focus: spec.focus,
    distance: 0,
    cameraDistanceRadii: 0,
    cellPixels: 0,
  }
  let captionCard: WorldCard | null = null

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    elapsed += dt
    frames += 1

    resize()
    placeCamera()

    const bufferHeight = height * dpr

    exitA.copy(rabiah.group.position).sub(dominaria.group.position).normalize()
    exitB.copy(dominaria.group.position).sub(rabiah.group.position).normalize()
    advanceAnchor(dominaria, anchorA, exitA, dt)
    advanceAnchor(rabiah, anchorB, exitB, dt)

    art.beginFrame()
    for (const world of worlds) world.update(camera, art, bufferHeight, dt, artThreshold * dpr)
    art.pump()

    tether.update(
      camera,
      { centre: dominaria.group.position, radius: dominaria.radius, anchor: anchorA, exit: exitA },
      { centre: rabiah.group.position, radius: rabiah.radius, anchor: anchorB, exit: exitB },
      bufferHeight,
      elapsed,
    )

    renderer.render(scene, camera)

    const focused = focusWorld(spec.focus) ?? dominaria
    const centreDistance = camera.position.distanceTo(focused.group.position)
    const fovScale = bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
    const cellHeight = (focused.surface.slots[0]?.halfH ?? 0) * 2 * focused.radius
    hudNumbers = {
      view: viewName,
      focus: focused.data.plane.displayName,
      distance: centreDistance,
      cameraDistanceRadii: centreDistance / focused.radius,
      cellPixels: (cellHeight * fovScale) / Math.max(1e-3, centreDistance - focused.radius) / dpr,
    }

    if (frames % 6 === 0) {
      captionCard = focused.cardAlong(
        wanted.copy(camera.position).sub(focused.group.position).normalize(),
      )
      hudBody.textContent = hudText(hudNumbers)
    }

    requestAnimationFrame(frame)
  }

  function hudText(numbers: HudNumbers): string {
    const stats = art.stats()
    const dom = dominaria.artCounts()
    const rab = rabiah.artCounts()
    const layout = dominaria.surface.stats
    const rlayout = rabiah.surface.stats
    const megabytes = (stats.layers * 128 * 96 * 4) / (1024 * 1024)
    const card = captionCard
    return [
      `view          ${numbers.view}`,
      `focus         ${numbers.focus}`,
      `camera        ${numbers.distance.toFixed(1)} u  =  ${numbers.cameraDistanceRadii.toFixed(2)}× radius`,
      `cell height   ${numbers.cellPixels.toFixed(1)} css px   (art at ≥ ${artThreshold})`,
      `viewport      ${width}×${height} css @ dpr ${dpr}  →  ${Math.round(width * dpr)}×${Math.round(height * dpr)}`,
      ``,
      `Dominaria     ${dom.cells} cells · ${dom.wanted} want art · ${dom.drawn} showing`,
      `  layout      ${layout.exact} exact · ${layout.bandOnly} colour-only · ${layout.displaced} displaced · ${layout.bare} bare`,
      `Rabiah        ${rab.cells} cells · ${rab.wanted} want art · ${rab.drawn} showing`,
      `  layout      ${rlayout.exact} exact · ${rlayout.bandOnly} colour-only · ${rlayout.displaced} displaced · ${rlayout.bare} bare`,
      ``,
      `art pool      ${stats.resident}/${stats.layers} layers (${megabytes.toFixed(1)} MB) · ${stats.inFlight} in flight`,
      `              ${stats.completed} loaded · ${stats.failed} failed · ${stats.evicted} evicted`,
      `system        ${system.worlds} worlds · ${system.moons} dark moons · ${system.beltPoints} belt points`,
      ``,
      card === null ? `under reticle —` : `under reticle  ${card.name}  (${card.setCode} ${card.year})`,
    ].join('\n')
  }

  interface WorldsProbe {
    readonly views: readonly string[]
    view(name: string): void
    state(): {
      readonly frames: number
      readonly hud: HudNumbers
      readonly art: ReturnType<ArtPool['stats']>
      readonly dominaria: ReturnType<World['artCounts']>
      readonly rabiah: ReturnType<World['artCounts']>
      readonly layout: {
        readonly dominaria: (typeof dominaria)['surface']['stats']
        readonly rabiah: (typeof rabiah)['surface']['stats']
      }
      readonly system: { readonly worlds: number; readonly moons: number; readonly belt: number }
      readonly radii: { readonly dominaria: number; readonly rabiah: number }
      readonly viewport: {
        readonly cssWidth: number
        readonly cssHeight: number
        readonly dpr: number
      }
      readonly caption: string
    }
  }

  const probe: WorldsProbe = {
    views: Object.keys(VIEWS),
    view: (name) => {
      applyView(name)
    },
    state: () => ({
      frames,
      hud: hudNumbers,
      art: art.stats(),
      dominaria: dominaria.artCounts(),
      rabiah: rabiah.artCounts(),
      layout: { dominaria: dominaria.surface.stats, rabiah: rabiah.surface.stats },
      system: { worlds: system.worlds, moons: system.moons, belt: system.beltPoints },
      radii: { dominaria: dominaria.radius, rabiah: rabiah.radius },
      viewport: { cssWidth: width, cssHeight: height, dpr },
      caption: captionText.textContent ?? '',
    }),
  }
  ;(window as unknown as { __worlds: WorldsProbe }).__worlds = probe

  requestAnimationFrame(frame)
}

void boot().catch((error: unknown) => {
  const bootNote = document.getElementById('boot')
  if (bootNote !== null) {
    bootNote.classList.remove('hidden')
    bootNote.textContent = `prototype failed to boot: ${String(error)}`
  }
  console.error(error)
})
