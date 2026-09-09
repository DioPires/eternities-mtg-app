/**
 * The devtools-console half of the kit, for a browser no driver on the machine can automate.
 *
 * `run.mjs` drives real Chrome, Brave and Edge over CDP and attempts Firefox over WebDriver BiDi.
 * When that attempt fails — and BiDi against release Firefox is the part of this kit most likely to
 * fail on a machine the author never had — review §9 still wants Firefox stable, and it wants Brave
 * with **shields on**, which an automated profile does not reproduce. This is that path: one block
 * of text the owner pastes into the console, on any browser, with no driver involved.
 *
 * **What it can and cannot reach, exactly.** A pasted snippet runs *after* the page has loaded, so
 * it cannot wrap WebGL before the app creates its context. That splits §9's six items in two:
 *
 *   reachable  — 1 frame timing (the page computes it itself into `window.__eternitiesBench`),
 *                4 the point-size probe (it builds its own context), 5 the self-check
 *                (`window.__eternitiesSelfCheck`), and the GPU strings and pixel ratio.
 *   NOT reachable — 2 the allocation counter and 3 per-program shader timing. Both need the
 *                prototypes wrapped before the first context exists. There is no way to do that
 *                from a console, and this script says so in its own output rather than reporting a
 *                zero that would read like a clean result.
 *
 * The GPU strings are in the reachable column only because of `gpuFromExistingCanvas`: the probe's
 * `getContext` wrapper cannot see a context created before it was installed, which is *every*
 * context on this path, so reading them requires going back to the app's live canvas. Getting that
 * wrong is not cosmetic — this is the only path Firefox has, Firefox on Windows is the engine most
 * likely to fall back to a software renderer, and `run.mjs`'s `SOFTWARE_RENDERER` refusal never sees
 * console-probe output. So the snippet makes that judgement itself and says so in its own console.
 *
 * `run.mjs` writes `results/console-probe.js` on every run, so the snippet can never drift from the
 * instrumentation the driven runs used. Run `node bench/windows/console-probe.mjs` to write it
 * without doing a measurement pass — the same single location, so `PROCEDURE.md` only ever names
 * one path.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installGpuProbe } from './instrument.mjs'

/**
 * The pasteable source: the instrumentation, plus a tail that collects everything a console can
 * legitimately see and prints it as JSON.
 */
export const CONSOLE_PROBE_SOURCE = `/* Eternities — Windows measurement kit, console probe (review §9).
 *
 * Paste this whole block into the devtools console on the page you are measuring, then follow what
 * it prints. It reports the frame statistics, the self-check, the point-size probe and the GPU
 * strings, and it warns you if this browser turns out to be rendering WebGL in software. It CANNOT
 * report the allocation counter or shader compile timing — those need WebGL wrapped before the page
 * loaded, which a console cannot do. Use run.mjs for those.
 */
(function () {
  var install = ${installGpuProbe.toString()};
  install();
  var probe = window.__eternitiesGpuProbe;
  var dpr = window.devicePixelRatio;
  var canvas = document.querySelector('canvas');
  var bench = window.__eternitiesBench || null;
  var selfCheck = window.__eternitiesSelfCheck || null;
  var point = probe.pointSizeProbe([1, 7, 22 * dpr, 33]);

  // The app's context was created long before this snippet was pasted, so the getContext wrapper
  // never saw it and snapshot().gpu is null. getContext on a canvas that already has a context
  // returns that context, so the driver strings are readable anyway.
  var gpu = probe.snapshot().gpu || probe.gpuFromExistingCanvas();
  var renderer = (gpu && (gpu.renderer || gpu.glRenderer)) || '';
  var software = /swiftshader|llvmpipe|software|mesa offscreen|basic render/i.test(renderer);

  var out = {
    kit: 'windows-measurement-kit console probe',
    note: 'allocation rate and shader compile timing are NOT measurable from a console; ' +
      'they are absent here rather than reported as zero',
    href: location.href,
    userAgent: navigator.userAgent,
    devicePixelRatio: dpr,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: screen.width, height: screen.height },
    drawingBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
    gpu: gpu,
    softwareRenderer: software,
    pointSize: point,
    bench: bench,
    selfCheck: selfCheck && {
      ok: selfCheck.ok,
      positionMode: selfCheck.positionMode,
      checked: selfCheck.checked,
      measured: selfCheck.measured,
      agreed: selfCheck.agreed,
      occluded: selfCheck.occluded,
      missed: selfCheck.missed.length,
      meanOffsetPx: selfCheck.meanOffsetPx,
      maxOffsetPx: selfCheck.maxOffsetPx,
      tolerancePx: selfCheck.tolerancePx,
      buffer: selfCheck.buffer
    }
  };

  var json = JSON.stringify(out, null, 2);
  console.log(json);
  if (software) {
    console.warn(
      'STOP AND SAY SO: this browser is rendering WebGL in software (' + renderer + '). ' +
      'The numbers above are not a GPU measurement.'
    );
  } else if (!gpu) {
    console.warn(
      'Could not read the GPU strings — no canvas with a live WebGL context on this page. ' +
      'Load ?bench=1&quality=0 or ?selfcheck=1 first, then paste this again.'
    );
  }
  if (!bench && !selfCheck) {
    console.warn(
      'Neither window.__eternitiesBench nor window.__eternitiesSelfCheck is set. Load the page ' +
      'with ?bench=1&quality=0 (and wait for the 39 s path to finish) or ?selfcheck=1, then paste ' +
      'this again.'
    );
  }
  try {
    copy(json);
    console.log('--- copied to the clipboard; paste it into a file named after the browser ---');
  } catch (error) {
    console.log('--- select the JSON above and copy it by hand ---');
  }
  return out;
})();
`

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = resolve(fileURLToPath(new URL('.', import.meta.url)), 'results')
  mkdirSync(results, { recursive: true })
  const path = resolve(results, 'console-probe.js')
  writeFileSync(path, CONSOLE_PROBE_SOURCE)
  console.log(`wrote ${path}`)
}
