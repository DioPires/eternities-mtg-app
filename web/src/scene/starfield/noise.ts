/**
 * The one value-noise lattice the scene uses, in its two shapes.
 *
 * Both used to be written out in full — 3-D in `./motion`, periodic 2-D in `./nebulaTexture` — with
 * the same avalanche constants copied into each and the same smoothstep spelled twice (review
 * §6.2). They are here together so the mixing is written once: {@link avalanche} is the primitive,
 * and a change to it changes both consumers or neither.
 *
 * **`Math.imul` is not a style choice.** The 3-D path has a GLSL twin in `./shaders`, and the
 * self-check of PRD 8.5.7 asserts the two agree to a pixel. `Math.imul` is exactly the `uint`
 * multiply GLSL performs; plain `*` overflows to a double and drifts. See `./motion`'s header.
 */

/** 32-bit integer hash, Wang-style. `>>> 0` after every step keeps it in `uint` range. */
function avalanche(seed: number): number {
  let h = seed >>> 0
  h = (h ^ (h >>> 15)) >>> 0
  h = Math.imul(h, 2246822519) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 3266489917) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h
}

/** The hash as a float in [0, 1), from the top 24 bits so it is exact in float32. */
function unit(hash: number): number {
  return (hash >>> 8) * (1 / 16777216)
}

/** Smoothstep on the unit interval — the interpolant both lattices use. */
function ease(t: number): number {
  return t * t * (3 - 2 * t)
}

/** The 3-D lattice hash. Its GLSL twin is `hash01(ivec3)` in `./shaders`. */
export function hash01(x: number, y: number, z: number): number {
  return unit(
    avalanche(Math.imul(x, 747796405) + Math.imul(y, 2891336453) + Math.imul(z, 3266489917)),
  )
}

/** Trilinear value noise on the integer lattice, smoothstep-interpolated. Range [0, 1). */
export function valueNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const ux = ease(x - ix)
  const uy = ease(y - iy)
  const uz = ease(z - iz)
  const c000 = hash01(ix, iy, iz)
  const c100 = hash01(ix + 1, iy, iz)
  const c010 = hash01(ix, iy + 1, iz)
  const c110 = hash01(ix + 1, iy + 1, iz)
  const c001 = hash01(ix, iy, iz + 1)
  const c101 = hash01(ix + 1, iy, iz + 1)
  const c011 = hash01(ix, iy + 1, iz + 1)
  const c111 = hash01(ix + 1, iy + 1, iz + 1)
  const x00 = c000 + (c100 - c000) * ux
  const x10 = c010 + (c110 - c010) * ux
  const x01 = c001 + (c101 - c001) * ux
  const x11 = c011 + (c111 - c011) * ux
  const y0 = x00 + (x10 - x00) * uy
  const y1 = x01 + (x11 - x01) * uy
  return y0 + (y1 - y0) * uz
}

/**
 * The 2-D lattice hash, wrapped to `period` so the noise tiles seamlessly.
 *
 * Not {@link hash01} with `z = 0`: the wrap is the whole point, and it has to happen on the
 * *integer coordinates* before they reach the mix, or the lattice does not close on itself.
 */
function hash01Periodic(x: number, y: number, period: number): number {
  const cx = ((x % period) + period) % period
  const cy = ((y % period) + period) % period
  return unit(avalanche(Math.imul(cx, 747796405) + Math.imul(cy, 2891336453)))
}

/** Bilinear value noise that tiles with `period`. Range [0, 1). */
export function valueNoise2Periodic(x: number, y: number, period: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const ux = ease(x - ix)
  const uy = ease(y - iy)
  const c00 = hash01Periodic(ix, iy, period)
  const c10 = hash01Periodic(ix + 1, iy, period)
  const c01 = hash01Periodic(ix, iy + 1, period)
  const c11 = hash01Periodic(ix + 1, iy + 1, period)
  return c00 + (c10 - c00) * ux + (c01 - c00) * uy + (c00 - c10 - c01 + c11) * ux * uy
}
