# The 2.2-radii pose was not reachable or stable on the shipped build

> **FIXED — see [Resolution](#resolution--dec-804-merged-as-pr-65-4aa3922) at the end.** DEC-804
> fixed the product half and leg G fixed the gate half; the pose is reached on 45 of 45 worlds
> today. Everything between here and that section is the finding **as it stood on 2026-09-15**, kept
> in the present tense deliberately. Do not cite a number from this document as current: the whole
> point of the finding is that these readings were taken at a pose the spec does not name.

Measured on `dec752-worlds-gate-core` @ `4b21a2f`, base main `cc00cfe`, dataset `worlds`
(`c9468f1125bcddff`), real Chrome + Metal, 1920×1080 dpr 1, 2026-09-15.

This is the finding that stopped leg G's acceptance run. It is recorded here rather than only in an
issue comment because it invalidated a premise every §3.1 criterion is written on, and the next
person to drive this app needs it before they trust a single number.

## The claim

**`radii` is not a function of the camera pose.** On a settled, motionless rig it drifts
monotonically with `multiverseAngle`. §3.1 specifies W4 *"at 2.2 radii"* and W2/W3 sample the frame
taken there, so the pose the spec names can be neither reached nor held.

## The measurement, and its control

The camera is flown to a world, left alone, and sampled every 2.5 s. `cameraDistance` is the rig's
own distance to its tether and is **constant to four decimals throughout** — nothing is moving the
camera.

`dominaria` (radius 9.978), normal motion:

| t (s) | `radii` | `cameraDistance` | `multiverseAngle` |
| ----- | ------- | ---------------- | ----------------- |
| 0.0   | 2.9203  | 31.9293          | 0.02426           |
| 5.0   | 2.6862  | 31.9293          | 0.05053           |
| 10.0  | 2.4674  | 31.9293          | 0.07670           |
| 17.5  | 2.1687  | 31.9293          | 0.11606           |

**Positive control — the same world under `prefers-reduced-motion: reduce`**, which PRD 5.9 makes
freeze the multiverse (`motion` is 0 in `planeTable.ts:208`):

| t (s) | `radii`    | `cameraDistance` | `multiverseAngle` |
| ----- | ---------- | ---------------- | ----------------- |
| 0.0   | **3.2000** | 31.9293          | 0.00000           |
| 17.5  | **3.2000** | 31.9293          | 0.00000           |

Constant to four decimals for the whole hold, at **exactly `frame: r * 3.2`** (`framing.ts:129`).
So the settle pose is 3.2 radii by construction, and 100% of the drift is the multiverse rotation.
The control is what makes this an attribution and not a correlation.

`azgol` (radius 0.55, `|home|` 94.56) is the same defect with a worse constant — `cameraDistance`
pinned at 1.7600 while `radii` runs away:

| t (s) | `radii`     | `cameraDistance` |
| ----- | ----------- | ---------------- |
| 0.0   | 3.5140      | 1.7600           |
| 17.5  | **17.4112** | 1.7600           |

The error scales with `|home| / radius`, which is why the worst offenders are small worlds far from
the multiverse centre.

## Why this is fatal to the run, in arithmetic

`dominaria` drifts ~**0.043 radii/s**. `RADII_TOLERANCE` is **0.02**. The pose leaves tolerance in
under half a second, and `driveToRadii` sleeps 400 ms between notches. On `azgol` the drift is
~0.8 radii/s — **40× the tolerance per sample interval.** No notch schedule converges against this;
the target moves faster than the instrument can read it.

Measured consequence on the acceptance run (`worlds-gate/BEFORE-attract-diagnosis.log`): of the
first 15 worlds toured, **1 scored and 14 were setup failures**, every one of them
`could not reach 2.2 radii — stopped at …`, with the reported stop growing through the tour as the
angle advanced.

## What the frame actually shows

`worlds-gate/baseline/world-alara.png` is the capture taken at what the gate believed was alara's
measurement pose. The breadcrumb reads `Multiverse › Alara` and the panel reads `Alara · 510 cards`,
so the focus is correct — but **alara is in the bottom-left corner, mostly off-screen, while empty
dust occupies the centre of the frame.** The camera is at roughly the right distance and aimed at
the wrong point.

That is the visible half of the same defect, and it is why alara scored `W2 fail / W3 insufficient`
rather than failing setup: the cells W2 and W3 sampled were at the frame edge.

## What this is not

- **Not attract mode.** Attract was the standing suspicion (PRD 5.3.22, the trap banked on DEC-752)
  and it is ruled out: `state().level` and `focus` stay `plane` throughout, `flying` stays false,
  and the drift is present from the first second after settle.
- **Not the wheel, and not the wheel's sign.** `zoomBy` is instant and hard-clamped
  (`rig.ts:399`); a notch moves `radii` by ~17.5% in the correct direction, measured.
- **Not a near clamp.** `dominaria` clamps at `cameraDistance` 13.969 = `r * 1.4`, well inside 2.2
  radii. The gate's stops are nowhere near the clamp.
- **Not the slug threading** (DEC-785 / trap 4). That is paid and holds: every payload reports the
  world that was asked for.

## Suspected source, for whoever owns the fix

Offered as a starting point, not as a conclusion — the gate can see the symptom but not the frames.

- `worldsProbe.ts:361` — `radii: camera.position.distanceTo(source.centre) / radius`.
- `worldSource.ts:145` — `centre: new Vector3(plane.home[0], plane.home[1], plane.home[2])`, a
  **static** snapshot taken at composition time.
- `planeTable.ts:9-10` — "Star positions are never touched"; the multiverse angle is applied as a
  transform, so a world's *rendered* position rotates while `plane.home` does not.

If `camera.position` and `source.centre` are expressed in frames that the multiverse rotation
separates, both the drift and the off-centre capture follow.

**This is not probe-only.** `tether.ts:466` computes the same quantity from the same `centre` and
feeds it to `anchorSlide()`, so the shipped surface-following tether consumes the drifting value
too. That is what makes this a product defect rather than an instrumentation one.

## A second, independent defect in the gate — mine, and not fixed here

Even with the drift frozen, `driveToRadii` cannot reliably land the pose. The wheel is
multiplicative — `zoomBy(exp(deltaY * ZOOM_PER_NOTCH))` — so a fixed ±120 notch moves `radii` by
~17.5%, about **0.4 radii at the 2.2 pose, against a ±0.02 tolerance**. Under the frozen control
the settle is 3.2 and the notch sequence is 3.2 → 2.64 → 2.18: it lands 0.02 from target by luck,
and misses on any world whose settle differs.

The fix is to solve rather than iterate — the response is a closed form, and the gain can be
measured from one probe notch rather than hardcoding the product's constant.

**It is deliberately not fixed in this commit.** The pose is unattainable under the shipped motion
regime, so a new drive could only be validated under the frozen control — and an instrument proven
only in a regime the gate does not run in is the failure this spec has already paid for twice.
Whoever rules on the drift should settle what "the pose" means first; the drive is then built to
match. Recorded here so the two are fixed together.

## Consequences for §3.1 that outlive the fix

1. **The docblock figure "the settle lands at `radii ≈ 2.14`" (`worlds-gate.mjs:319`) is a drift
   artefact.** The settle is exactly 3.2. Any number in this spec taken as "the settle pose" needs
   re-measuring under a frozen multiverse.
2. **A pose specified as a scalar needs a time at which it holds.** If the fix makes `radii` a true
   function of the pose this goes away; if the intended reading is that worlds orbit past a
   stationary camera, then §3.1 must name the pose differently, because "2.2 radii" would not
   identify a frame.
3. **The served payload cannot audit itself.** It carries `radii` but not `centre`, `radius` or
   `camera.position` (measured: `planeSlug|radii|viewport|cells|pool|stream|bandShares|seams`), so
   the gate is required to trust a number it has no way to check. Whatever the ruling, the payload
   should expose the terms `radii` is built from.

## Reproducing

`web/scripts/dec804-drift-diag.mjs` (drift), `dec804-frozen-control.mjs` (frozen control) and
`dec804-zoom-diag.mjs` (per-notch rig state) are one-shot diagnostics kept for reproduction, in the
shape `dec697-diag.mjs` already established. They are not part of the gate and nothing imports them:
each starts its own preview on the `worlds` dataset and prints the tables above. Kept rather than
deleted because the ruling they produced changed the product, and a ruling whose evidence cannot be
re-run is a ruling nobody after today can check.

## Resolution — DEC-804, merged as PR #65 (`4aa3922`)

**Both defects are fixed, and this document is now a record rather than a live finding.**

The product half was ruled a Design System defect and fixed at `worldSource.ts`: the centre now
follows the rig instead of snapshotting `plane.home` at composition time. Note that the root-cause
guess in *Suspected source* above was **inverted**, and the review (DEC-809) established the
correct account: there was no reader of `multiverseAngle` in the worlds scene at all — the **camera
orbited while the worlds stood still**. The symptom and the arithmetic in this document reproduce
exactly; only the attribution of which side moved was wrong. Offering the guess as "a starting
point, not a conclusion" is what kept it from being adopted as the fix.

Verified live after the merge, on the full 45-world tour: the drive reaches 2.2 radii on every
world, `captureFrame`'s across-the-capture stability guard (`|Δradii| > 1e-3`) no longer trips, and
the setup failures this document reported — 14 of the first 15 worlds — are **0 of 45**.

The gate half is fixed too, and by the method proposed here rather than a schedule: `driveToRadii`
now measures the wheel's gain from one probe notch and solves `deltaY = ln(target/current) / k`.
The gain is measured rather than copied from `attachRig.ts` on purpose — a copied constant would
make the drive agree with the product by construction, and would go silently wrong the day the
wheel is retuned.

Consequence 3 below is also answered, and it is the one worth carrying forward: the payload now
publishes `centre`, `cameraPosition` and `radius` beside `radii`, and
`worlds-probe-read.mjs`'s `readPose` audits the identity `radii == |cameraPosition − centre| /
radius` on **every** read. The defect survived a whole phase because every individual field was
well-formed and nothing inside the payload disagreed with anything else inside it; the gate had to
instrument the product from outside to see it. It cannot recur silently now.
