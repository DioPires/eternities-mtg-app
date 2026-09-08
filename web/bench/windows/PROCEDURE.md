# Windows measurement procedure

Review §9. Do this on **two laptops**: one 12th/13th-gen Intel with **Iris Xe** and a 1080p panel,
one Ryzen with **Radeon 780M**. It measures the live site, so you need no dataset and no Python.
Budget **20 minutes per laptop**, plus 10 more if you do the 1440p monitor.

Everything you produce lands in `web/bench/windows/results/`. Send that whole folder back.

---

## Once per laptop — setup

1. Install **Node 22 or newer** (<https://nodejs.org>, LTS) and **Google Chrome**, **Brave** and
   **Firefox**, all release channel. Leave Brave's shields at their default.
2. Get the repo and its dependencies:
   ```
   git clone https://github.com/DioPires/eternities-mtg-app.git
   cd eternities-mtg-app/web
   npm install -g pnpm
   pnpm install
   ```
3. **Leave the display scaling exactly as Windows shipped it.** Do not change it to 100% to "make
   it fair" — the whole question is what the machine's real pixel ratio costs.
4. Plug the laptop in. Set the power plan to **Balanced** (the default). Close every other
   application, especially other browsers — an integrated GPU shares memory bandwidth with
   everything.

---

## The runs

Run these from `eternities-mtg-app/web`. Each command prints a table and writes two files.
Replace `iris-xe` with `780m` on the second laptop.

**1. Plugged in, on the laptop's own panel.** The main run.

```
pnpm windows-kit --machine iris-xe --power plugged
```

**2. On battery.** Unplug, wait 30 seconds, then run it again. Integrated-GPU clocks roughly halve
on battery and §9 wants both numbers.

```
pnpm windows-kit --machine iris-xe --power battery
```

**3. On the external 1440p monitor at 150% scaling.** Plug the monitor in, set it to 2560×1440 at
150% in Windows display settings, then drag a browser window onto it once so you know its
coordinates. `--window-position` places the measured window there; on a monitor sitting to the
right of a 1080p laptop panel, `1920,0` is usually correct.

```
pnpm windows-kit --machine iris-xe-1440p --power plugged --resolutions 2560x1440 --window-position 1920,0
```

Check the printed `viewport` line — if it does not say roughly `2560x1440`, the window landed on
the wrong display. Fix the coordinates and run it again.

**4. The other ANGLE backend.** Chrome defaults to Direct3D 11; this asks for Vulkan instead. If
the two disagree, that is a finding.

```
pnpm windows-kit --machine iris-xe-vulkan --power plugged --browsers chrome --angle vulkan
```

---

## Firefox, if the automated run could not drive it

Firefox is driven over WebDriver BiDi and this is the part of the kit most likely to fail on your
machine. If the output says `firefox: NOT RUN`, get its numbers by hand — it takes three minutes:

1. Open **Firefox** and go to
   `https://eternities-mtg-app.vercel.app/?bench=1&quality=0`
2. **Wait for the on-screen counter to finish.** The scripted camera path takes 39 seconds and the
   numbers do not exist until it ends.
3. Press **F12**, click **Console**, and paste the entire contents of
   `web/bench/windows/results/console-probe.js`. Press Enter.
4. It prints a block of JSON and copies it to your clipboard. Paste it into a new file called
   `results/iris-xe-firefox-bench.json`.
5. Now go to `https://eternities-mtg-app.vercel.app/?selfcheck=1`, wait for it to settle, and paste
   the same snippet again. Save that as `results/iris-xe-firefox-selfcheck.json`.

This hand path reports frame timing, the point-size probe and the self-check. It **cannot** report
the allocation rate or shader compile timing — those need the browser instrumented before the page
loads, which a console cannot do. That gap is expected; do not try to work around it.

Do the same for Brave if you want its numbers with shields genuinely on, since the automated run
uses a fresh profile.

---

## Finally — two pages to paste in by hand

The kit cannot read either of these.

1. In Chrome, open `chrome://gpu`, click **Copy report to clipboard**, and save it as
   `results/iris-xe-chrome-gpu.txt`.
2. In Firefox, open `about:support`, click **Copy raw data to clipboard**, and save it as
   `results/iris-xe-firefox-support.json`.

---

## What you should see, and what to flag

The kit prints review §9's pass criteria with the measured value beside each one. You do not need to
judge them — send the files back either way. But these are the ones that matter:

| Criterion | Expectation going in |
|---|---|
| p95 frame interval ≤ 16.7 ms at tier 0, 1080p | §3.3 predicts this is **marginal** — expect it to fail or sit close |
| tier ≤ 1 holds 60 fps at 1440p/150% | §3.3 predicts **not plausible today** |
| zero self-check tolerance failures | expected to pass; a failure is a driver finding and is important |
| zero console errors under the production CSP | expected to pass |
| allocation rate < 1 MB/s | expected to **fail badly** — this Mac measures ~330 MB/s (§2.2) |

**Stop and say so** if any of these happen, because they mean the run did not measure the product:

- the output ends with `refusing: the runs above did not measure what they claim`;
- the GPU line names `SwiftShader`, `Basic Render` or anything with "software" in it;
- the printed `viewport` is not close to the resolution you asked for;
- a point size comes back marked `CLAMPED`.

Anything else — a failed criterion, a slow number, an ugly picture — is a result, not a problem.
Send it.

One line that looks alarming but is not: `self-check float32 ... FAILED: the page went away`, followed
by `self-check float32 (attempt 2)`. The browser occasionally drops the page before it answers; the
kit relaunches it once and the report records `[took 2 attempts]`. Let it run. Only the **second**
failure in a row is a real one.
