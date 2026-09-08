# Prototypes

Throwaway visual prototypes. **Not production code, not in the production build, not deployed.**

`web/index.html` is the only Rollup entry (`vite.config.ts`), so nothing here reaches `dist/`, the
Vercel deploy or the PRD §8 budget. `web/tsconfig.json` does not include `prototypes/` either, so
`pnpm typecheck` does not cover it; `prototypes/tsconfig.json` does, and that is the gate to run
before touching anything here:

```sh
cd web && npx tsc -p prototypes/tsconfig.json
```

---

## `worlds/` — concept B, for the DEC-694 / W2.3 decision gate

Review `REVIEW-2026-09-08.md` §4.2 proposes three visual concepts and §4.3 asks for concept B —
"worlds" — to be prototyped before any further galaxy tuning. This is that prototype: Dominaria
and Rabiah as instanced cells on spheres, faked colour swatches, real `art_crop` streaming for
near cells, and a surface-following tether between the two.

```sh
cd web && pnpm dev
# then open http://localhost:5173/prototypes/worlds/
```

Drag to orbit, shift-drag to pan the reticle, wheel to dolly. `1` Dominaria, `2` Rabiah,
`3` system, `4` the tether anchor, `h` hides the HUD.

Query parameters:

| Parameter | Default | What it does |
|---|---|---|
| `view=<name>` | `system` | start at a named camera view; the HUD shows which |
| `dpr=<n>` | `min(2, devicePixelRatio)` | pin the device pixel ratio, so a capture is at a known scale |
| `artpx=<n>` | `24` | the swatch → art threshold, in CSS pixels (review §4.2's number) |
| `layers=<n>` | `1024` | art pool size in layers; 1,024 × 128 × 96 × 4 B = 48 MB |
| `dataset=<hash>` | `datasets.json`'s `production` | render a different dataset |
| `hud=0` | — | hide the HUD, reticle and caption |
| `flat=1` | — | drop the lambert term, so the surface law can be read off a still |
| `only=cells` | — | hide the globe, the air, the system and the backdrop |

Views: `system`, `dominaria-far`, `dominaria-frame`, `dominaria-near`, `dominaria-terminator`,
`rabiah`, `rabiah-near`, `tether-far`, `tether-surface`.

### Captures

```sh
cd web
node scripts/worlds-capture.mjs                 # all nine views → review/dec694-worlds/
node scripts/strata-still.mjs                   # the concept C still → the same directory
```

Both write at **1920×1080 CSS, dpr 1**, so a PNG's pixel dimensions are its CSS dimensions and the
frame is judged at 100% (DEC-683: never judge an upscaled crop). 1920×1080 is also the native
resolution of the Iris Xe laptop review §9 targets, so a later Windows re-capture is directly
comparable. `captures.json` records the camera distance, the cell size in CSS pixels, and the art
pool state for every frame.

### What the prototype fakes

Everything below is a stand-in. The data, the card population, the plane positions and the art are
real; these are not.

1. **The swatch.** The one fake that matters. Concept B wants a per-card colour derived from the
   *art*, and the contract does not carry one — the 12-byte star record has `hueClass`, a
   seven-way classification of the card's colour identity, not a pixel statistic
   (`docs/data-contract.md:136-149`). So a cell's swatch is its hue-class colour, pulled 32–61%
   towards its own luminance and then nudged three ways off a hash of the oracle id (value, tint,
   saturation). The desaturation is a guess about what real art swatches look like — raw colour-pie
   hues make a world read as a beach ball, and paintings are far less saturated than a hue — but
   it *is* a guess, and it is the thing to be most sceptical of in these captures. Review §4.2's
   `swatches.bin` (28,587 × 8 B ≈ 230 KB, one `small` fetch per card) is what would replace it.
2. **The set index.** Longitude is time, and time means "which of the plane's own sets the card
   belongs to" — the chronology band of PRD 5.4.2. The pipeline bakes that band into the star's
   *radius* and does not store the index, so this recovers it as "the earliest of the plane's sets
   the card was actually printed in". That is what the pipeline decided, but it is a reconstruction
   and it can disagree at the margins.
3. **The band layout is a refinement, not the review's.** §4.2 says "five bands, gold as an
   equatorial belt, colourless as ice caps", which does not fit one hemisphere. Here the bands are
   mirrored about the equator — each mono colour is a matched pair, gold is the single belt, and
   colourless is split between the two caps — which makes all three named readings literally true
   and makes a world symmetric. Bands are equal-*area*, so a colour covers the fraction of the
   sphere it is of the plane.
4. **Cells do not always land on their own colour × set.** The grid holds ~N slots and the
   population does not distribute evenly over them, so assignment runs three passes: exact, colour
   only, anywhere. The HUD and `captures.json` print all four counts. Dominaria: 5,372 exact, 694
   colour-only, 200 displaced, 0 bare, of 6,266. Rabiah: 49 / 0 / 26 / 3, of 75. A production
   version would relax the grid to the population instead of displacing cards.
5. **The key light follows the camera.** Offset 41° in azimuth and 22° in elevation from the view
   direction. A fixed sun is more honest to a solar system and useless for judging a mosaic: at
   half the orbit the subject is its own night side. A product would want a real star.
6. **The art pool is the binding constraint at the near views, and you can see it.** 1,024 layers
   (48 MB) against 2,759 cells that want art at `tether-surface` — the swatch/art boundary visible
   across that frame is the pool running out, not a fade. Review §4.2 budgets exactly this number,
   so the frame is the budget, drawn.
7. **Undetailed worlds get a contrast-stretched palette colour.** Only Dominaria and Rabiah have
   cells; the other 27 worlds with cards are single icospheres coloured by `planes.json`'s own
   `palette` weights — a real statistic — but with the deviation from the card-weighted mean
   amplified ×3.2. Mixed straight, all 27 come out the same grey, because Magic's colour pie is
   balanced (review §4.1, and the reason the shipped arm-skew law is inert). The stretch is a
   choice; the grey is the data.
8. **No production wiring at all.** No shell, router, store, filters, search, labels, picking,
   quality ladder, error hub, attract mode, plane tilt/spin/drift, printings ring, or card flip.
   Nothing is budgeted, retried, streamed incrementally or measured. There is no `stars.bin` read:
   positions here come from the surface law, not from the shipped layout.
9. **Not measured on Windows.** Captured on an Apple Silicon Mac in headless Chrome
   (`--use-angle=metal`), not on the Iris Xe. Review §3.3's cost class for concept B is an
   estimate and this does not change that; the W0.1 kit is what would.

### Compliance notes (review §4.4)

- Art is **letterboxed** into its 128×96 layer, never stretched or cropped, and is drawn
  **unshaded** — the lambert term multiplies the swatch only. Scryfall's terms forbid distorting,
  stretching, blurring, sharpening, desaturating or colour-shifting card images, and §4.4 flags the
  shipped planet shader for the brightness shift. Concept B should not inherit it, so the
  compliance is in the shader rather than in a follow-up.
- **The artist is missing and the caption says so.** Scryfall asks that an `art_crop` be shown with
  the artist name and copyright in the same interface; the printing tuple carries no artist field
  (`docs/data-contract.md:283`) and the shipped app satisfies the alternative clause by showing the
  full card. Any concept that shows art crops without the full card — B and C both — needs
  `artist` added to the contract. The prototype's footer names Scryfall and Wizards of the Coast
  and states the gap.
- Images are fetched once per cell, `mode: 'cors'`, cache-busted by the contract's own `imageTs`,
  from `cards.scryfall.io` under the production CSP (`vite dev` serves the real headers).

---

## `scripts/strata-still.mjs` — concept C, one still

The streamgraph review §4.3 says is "worth making regardless": one stratum per plane, thickness =
cards printed that year, 1993→2026, the Blind Eternities as bedrock, the 57 empty planes absent and
counted in the caption. Built from `planes.json` alone. No smoothing and no interpolation — the
spikes are real, because Magic returns to a plane in bursts, and that burstiness is the structure
concept C is claiming is the strongest one in the data.
