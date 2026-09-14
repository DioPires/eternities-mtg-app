/**
 * How many device pixels the canvas actually gets, and what to do when that changes (review §3.5).
 *
 * > **DPR and monitors.** `ResizeObserver` with `device-pixel-content-box` sizes the backing store
 * > exactly; a re-armed `matchMedia('(resolution: Xdppx)')` listener catches window moves between
 * > monitors. Cap = `min(tier.cap, devicePixelRatio)`, applied by the renderer, not by a prop.
 *
 * Three separate defects sit behind that sentence, and they are worth naming apart because only one
 * of them was the `dpr` prop:
 *
 *  1. **`devicePixelRatio` is not the ratio you get.** At an OS scale of 125% the browser reports
 *     1.25, but the compositor allocates a whole number of device pixels for a CSS box that is very
 *     often fractional, so `floor(cssWidth * 1.25)` misses the real backing store by a pixel or two.
 *     The scene is then drawn at one size and blitted to another, which is a resample of the whole
 *     frame for nothing. `device-pixel-content-box` is the only API that answers the question
 *     exactly, and it is what {@link observeBackingStore} reads.
 *  2. **`devicePixelRatio` does not fire an event.** Dragging the window from a 2x laptop panel to
 *     a 1x external monitor changes it with no `resize` on the window if the CSS box is unchanged.
 *     The only notification is a `matchMedia` query for the *current* ratio going false, which then
 *     has to be **re-armed** against the new ratio — see {@link observeDevicePixelRatio}. Without
 *     this, the app keeps drawing 4x the pixels it needs after the move, indefinitely.
 *  3. **The cap had two writers.** That was review finding R2 and DEC-692 closed it by making the
 *     `dpr` prop the single one. This module finishes the job the other way round: the cap is
 *     computed here and pushed into the renderer, and the prop is switched off. See
 *     `./PixelRatioHost`.
 *
 * Nothing here imports three or React. It is the DOM half of the platform layer, and Wave 3's
 * `SceneRenderer` is meant to call it directly once the loop leaves React.
 */

/** What the compositor is actually giving the canvas, right now. */
export interface BackingStoreSize {
  /** The CSS content box, in CSS pixels. */
  readonly cssWidth: number
  readonly cssHeight: number
  /** The backing store the browser will allocate for that box, in device pixels. */
  readonly devicePixelWidth: number
  readonly devicePixelHeight: number
  /**
   * `devicePixelWidth / cssWidth` — the ratio the *compositor* is using, which is not always
   * `window.devicePixelRatio`. See defect 1 in this file's header.
   */
  readonly ratio: number
  /**
   * True when the numbers came from `device-pixel-content-box`, false when they were reconstructed
   * from the CSS box and `devicePixelRatio`.
   *
   * Reported rather than hidden because the two are different claims. Safari shipped
   * `device-pixel-content-box` in 16.4 and Firefox in 93, so every browser in scope has it — but a
   * fallback that silently pretended to be exact would make the whole point of this module
   * unverifiable, and `?probe=1` asserts on it.
   */
  readonly exact: boolean
}

/**
 * The pixel ratio the renderer should use: the tier's cap, never above what the display gives.
 *
 * `min`, in that order, is the whole rule. The cap bounds the cost of a 4K display (PRD 7.1.3) and
 * the display's own ratio bounds the pointlessness — rendering at 1.5 on a 1x monitor would draw
 * 2.25x the pixels and then throw two thirds of them away in the blit, which is precisely what
 * review §2.2 measured the shipped app doing ("2880x1620 in every phase ... i.e. dpr 1.5 on a dpr-1
 * viewport").
 *
 * Guarded rather than trusting: a `devicePixelRatio` of 0 or `NaN` is reachable in a detached
 * document and would take the whole drawing buffer to nothing.
 */
export function resolvePixelRatio(tierCap: number, deviceRatio: number): number {
  const device = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1
  const cap = Number.isFinite(tierCap) && tierCap > 0 ? tierCap : 1
  return Math.min(cap, device)
}

/**
 * Watch an element's backing store, exactly.
 *
 * Fires once on the first observation and then on every change. The callback receives the *device
 * pixel* box, so a caller wanting `setSize` in CSS pixels reads `cssWidth`/`cssHeight` and a caller
 * wanting the ratio the compositor chose reads `ratio`.
 *
 * Returns a disposer. Safe to call in an environment with no `ResizeObserver` (jsdom, a worker),
 * where it reports nothing and the disposer is a no-op — the CSS-pixel path r3f already owns is
 * still in force, so the app sizes correctly and only loses the exactness.
 */
export function observeBackingStore(
  element: Element,
  onChange: (size: BackingStoreSize) => void,
): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1]
    if (entry) onChange(sizeFrom(entry))
  })

  try {
    // `box: 'device-pixel-content-box'` throws a `TypeError` on a browser that does not know the
    // value rather than ignoring it, which is the one case where a try/catch is the feature test.
    observer.observe(element, { box: 'device-pixel-content-box' })
  } catch {
    observer.observe(element, { box: 'content-box' })
  }

  return () => {
    observer.disconnect()
  }
}

/**
 * The device-pixel box of a `ResizeObserver` entry, falling back to the CSS box times
 * `devicePixelRatio` when the browser did not report one.
 */
function sizeFrom(entry: ResizeObserverEntry): BackingStoreSize {
  const css = boxOf(entry.contentBoxSize) ?? {
    width: entry.contentRect.width,
    height: entry.contentRect.height,
  }
  const device = boxOf(entry.devicePixelContentBoxSize)
  const cssWidth = Math.max(1, css.width)
  const cssHeight = Math.max(1, css.height)
  if (device && device.width > 0 && device.height > 0) {
    return {
      cssWidth,
      cssHeight,
      devicePixelWidth: device.width,
      devicePixelHeight: device.height,
      ratio: device.width / cssWidth,
      exact: true,
    }
  }
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return {
    cssWidth,
    cssHeight,
    devicePixelWidth: Math.floor(cssWidth * ratio),
    devicePixelHeight: Math.floor(cssHeight * ratio),
    ratio,
    exact: false,
  }
}

/**
 * `ResizeObserverSize` arrives as a frozen array-like in every browser and as a bare object in some
 * older polyfills; both spellings are read here because getting it wrong reads as "no support".
 */
function boxOf(
  sizes: readonly ResizeObserverSize[] | ResizeObserverSize | undefined,
): { width: number; height: number } | null {
  if (!sizes) return null
  const entry = Array.isArray(sizes)
    ? (sizes[0] as ResizeObserverSize | undefined)
    : (sizes as ResizeObserverSize)
  if (!entry || typeof entry.inlineSize !== 'number' || typeof entry.blockSize !== 'number') {
    return null
  }
  return { width: entry.inlineSize, height: entry.blockSize }
}

/**
 * Call `onChange` whenever `window.devicePixelRatio` changes — including a window dragged between
 * monitors, which fires no `resize`.
 *
 * **The re-arm is the whole mechanism, and it is easy to get subtly wrong.** A
 * `(resolution: Xdppx)` query matches exactly one ratio, so the moment it reports a change it has
 * *stopped being the right query* — the ratio it names is now the old one, and it will never fire
 * again. Every notification therefore has to tear the listener down and build a new one against the
 * new ratio before doing anything else. A listener that is not re-armed catches the first monitor
 * move of a session and no others, which is worse than none: it looks like it works.
 *
 * Returns a disposer. No-ops where `matchMedia` is absent.
 */
export function observeDevicePixelRatio(onChange: (ratio: number) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}

  let query: MediaQueryList | null = null
  let disposed = false

  const handle = (): void => {
    if (disposed) return
    // Re-arm *first*. `onChange` re-enters the renderer and may throw; a listener left pointing at
    // the ratio we have just left would then never fire again, and the failure would be silent.
    arm()
    onChange(window.devicePixelRatio)
  }

  function arm(): void {
    if (disposed) return
    query?.removeEventListener('change', handle)
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    query.addEventListener('change', handle)
  }

  arm()

  return () => {
    disposed = true
    query?.removeEventListener('change', handle)
    query = null
  }
}
