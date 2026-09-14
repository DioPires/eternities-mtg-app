/**
 * Link every GPU program at boot, so that nothing links on a first draw (review §3.5, §3.7).
 *
 * **The defect this closes.** three links a program the first time an object using it is drawn, and
 * `WebGLProgram`'s `onFirstUse` then calls `getProgramInfoLog` *synchronously* — a full pipeline
 * flush that blocks the main thread until the driver has finished compiling. DEC-645 measured 362 ms
 * and 322 ms from exactly this on Metal, and `checkShaderErrors = false` only moves the stall rather
 * than removing it. Review §3.7 is blunt about what that means off this Mac: "On Windows every
 * browser compiles through ANGLE's D3D11/FXC path, which is markedly slower than Metal, so the first
 * plane focus and the first card focus are the likely hitches."
 *
 * Those are the two worst moments to hitch in. They are both *navigations* — the camera is flying,
 * PRD 6.2.3's two-stage fly-to is mid-flight — and a third of a second of frozen main thread reads
 * as the app having crashed.
 *
 * **The fix, and why it is not just `compileAsync(scene, camera)`.** three's `compile` traverses a
 * scene and links what it finds, so it can only warm what is *mounted*. Three of the program set are
 * not: the glow's cheap variant belongs to a ladder rung nobody has descended to, the focused card's
 * planets are rebuilt per card, and the post chain's four passes live on a quad whose material is
 * swapped between draws. Warming only the mounted ones would leave precisely the programs whose
 * first draw happens deepest into a navigation.
 *
 * So the caller hands over {@link ProgramWarmupSpec}s — a geometry and a material — and this builds
 * a **stand-in** object per spec in a scene of its own. The stand-in shares the *real* geometry
 * object, which is what makes the warmed program the one the real draw will use:
 * `getProgramCacheKey` keys on the material's interned source ids and defines *and* on a parameter
 * list derived from the object and its geometry, so a stand-in over a plain `BufferGeometry` would
 * link a different program for an `InstancedBufferGeometry` draw and leave the real stall in place.
 * Sharing the geometry makes `instancing`, `vertexColors` and the rest identical by construction.
 *
 * Nothing is reparented: `Object3D.add` detaches from the previous parent, so adding a live scene
 * object to a warm-up scene would silently remove it from the picture. Geometry and materials are
 * shared by reference; only the stand-in `Mesh`/`Points` wrappers are created and dropped.
 *
 * **`KHR_parallel_shader_compile` is what makes this free.** With the extension, three's
 * `compileAsync` polls `COMPLETION_STATUS_KHR` and the driver compiles on its own threads, so the
 * links overlap each other and the 4 s intro. Without it, `compileAsync` still resolves — it just
 * serialises, and the cost lands during the intro rather than during a navigation. That is still
 * the trade worth making, which is why the absence of the extension is reported rather than acted
 * on: a hitch while the camera is flying a scripted intro is a hitch nobody is steering through.
 */

import {
  type BufferGeometry,
  Camera,
  type Material,
  Mesh,
  type Object3D,
  Points,
  Scene,
  type WebGLRenderer,
} from 'three'

/**
 * Whether the boot-time warm-up should run, from `?warmup=0`.
 *
 * It exists so the claim this module makes is **falsifiable**. "Nothing links on a first draw" is
 * only worth anything against a measurement of what happens when things do, and without a switch
 * that measurement means rebuilding the app with a line deleted — which is not a comparison anyone
 * will repeat on the two Windows laptops of review §9, where the whole effect is expected to be
 * several times larger than on Metal. `bench/windows/` runs the same URL with and without it.
 *
 * Anything other than the exact string `0` leaves the warm-up on, so a typo cannot silently turn it
 * off for a user.
 */
export function programWarmupRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  return new URLSearchParams(search).get('warmup') !== '0'
}

export interface ProgramWarmupSpec {
  /**
   * The *real* geometry the program will be drawn with. Shared, never disposed here — see the note
   * on `getProgramCacheKey` in this file's header for why a stand-in geometry would not do.
   */
  readonly geometry: BufferGeometry
  readonly material: Material
  /**
   * `Points` draws can take a different program from `Mesh` draws over the same material and
   * geometry — `getParameters` reads `object.isPoints` — so the stand-in has to match, and so does
   * {@link dedupeSpecs}'s key.
   */
  readonly points?: boolean
}

export interface ProgramWarmupResult {
  /** How many distinct (geometry, material, `points`) specs were submitted. */
  readonly specs: number
  /** Wall-clock milliseconds from the first submission to the last resolution. */
  readonly durationMs: number
  /** Whether the driver compiled in parallel. See this file's header. */
  readonly parallel: boolean
  /** Set when the warm-up could not finish; the app draws anyway and pays the stalls. */
  readonly error: string | null
}

/**
 * Link every program in `specs`, and resolve when the driver says they are all ready.
 *
 * Never rejects. A warm-up that fails costs the first-draw stalls it was there to remove, which is
 * exactly the behaviour the app had before this existed — so a failure is reported and swallowed
 * rather than taken to the scene's error boundary.
 */
export async function warmPrograms(
  renderer: WebGLRenderer,
  camera: Camera,
  specs: readonly ProgramWarmupSpec[],
  parallel: boolean,
): Promise<ProgramWarmupResult> {
  const started = performance.now()
  const done = (error: string | null): ProgramWarmupResult => ({
    specs: specs.length,
    durationMs: performance.now() - started,
    parallel,
    error,
  })

  if (specs.length === 0) return done(null)

  const scene = new Scene()
  const standIns: Object3D[] = []
  try {
    for (const spec of specs) {
      const object = spec.points
        ? new Points(spec.geometry, spec.material)
        : new Mesh(spec.geometry, spec.material)
      // `compile` walks with `traverseVisible`, and an instanced geometry whose `instanceCount` is
      // still 0 is perfectly compilable — the count is a draw parameter, not a program one. What
      // would skip it is invisibility, so nothing here sets `visible = false`.
      object.frustumCulled = false
      object.matrixAutoUpdate = false
      standIns.push(object)
      scene.add(object)
    }

    await renderer.compileAsync(scene, camera)
    return done(null)
  } catch (error) {
    return done(error instanceof Error ? error.message : String(error))
  } finally {
    // The stand-ins go; the geometries and materials they borrowed do not.
    for (const object of standIns) scene.remove(object)
  }
}

/**
 * Every drawable in an object graph, as warm-up specs.
 *
 * For the parts of the scene that *are* mounted and whose materials are not swapped, handing over
 * the root is both shorter and safer than listing the pairs by hand — a mesh added to the graph
 * later is warmed without anyone remembering to add it here.
 */
export function specsFromObject(root: Object3D): ProgramWarmupSpec[] {
  const specs: ProgramWarmupSpec[] = []
  root.traverse((object) => {
    const geometry = (object as Partial<Mesh>).geometry
    const material = (object as Partial<Mesh>).material
    if (!geometry || !material) return
    const points = (object as Partial<Points>).isPoints === true
    for (const single of Array.isArray(material) ? material : [material]) {
      specs.push({ geometry, material: single, ...(points ? { points } : {}) })
    }
  })
  return specs
}

/**
 * Drop specs that would link the same program twice.
 *
 * three's own program cache already makes a repeat link a no-op, so this is about the *report*
 * rather than the work: `ProgramWarmupResult.specs` is the number the bench records as "programs
 * warmed at boot", and counting the card's front and back faces twice for one shared program would
 * make that number describe the scene graph instead of the driver. Keyed on the pair, because two
 * materials over one geometry and one material over two geometries are both genuinely two programs.
 *
 * **`points` is part of the key too** (DEC-747 N2). It was not, and the omission was a hole rather
 * than untidiness: `WebGLPrograms.getParameters` derives `pointsUvs` from `object.isPoints`, and
 * `getProgramCacheKey` folds it into the second layer mask (bit 18, three 0.170), so one material
 * over one geometry drawn both ways can be two programs. Keying on the pair alone dropped the second
 * of them — leaving a `Points` first-draw stall in place while reporting it warmed, which is the
 * failure this whole module exists to prevent.
 *
 * **The condition is narrower than "drawn both ways", and the difference is worth stating**
 * (DEC-756 N7). `getParameters` reads
 *
 * ```js
 * pointsUvs: object.isPoints === true && !! geometry.attributes.uv && ( HAS_MAP || HAS_ALPHAMAP )
 * ```
 *
 * — so the split only *actually* produces two programs when the geometry carries a `uv` attribute
 * **and** the material has a `map` or an `alphaMap`. For this app's `ShaderMaterial`s neither is
 * generally true, so today the extra key usually costs one redundant stand-in draw at boot rather
 * than catching a real second program. Splitting is still the right call — it is conservative in the
 * safe direction, `quality.spec.ts` bounds `warmup.specs` from below so a split can never redden it,
 * and nothing in the scene produces a colliding pair — but it is pinned to a three internal that a
 * 0.170 -> 0.186 bump can move silently. Routed to DEC-741's audit list beside N4.
 *
 * Nothing in the scene draws the colliding shape today; the `?warmup=0` comparison is the only thing
 * that would ever have shown it, and by then the number it was being compared against would already
 * have been wrong.
 */
export function dedupeSpecs(specs: readonly ProgramWarmupSpec[]): ProgramWarmupSpec[] {
  // Sets of object identities rather than a string key: geometries and materials have no stable id.
  // Two sets per material because `points` is a flag and not an identity — a `Points` draw and a
  // `Mesh` draw over the same geometry land in different buckets and neither hides the other.
  const seen = new Map<Material, { mesh: Set<BufferGeometry>; points: Set<BufferGeometry> }>()
  const unique: ProgramWarmupSpec[] = []
  for (const spec of specs) {
    let buckets = seen.get(spec.material)
    if (!buckets) {
      buckets = { mesh: new Set<BufferGeometry>(), points: new Set<BufferGeometry>() }
      seen.set(spec.material, buckets)
    }
    const geometries = spec.points ? buckets.points : buckets.mesh
    if (geometries.has(spec.geometry)) continue
    geometries.add(spec.geometry)
    unique.push(spec)
  }
  return unique
}
