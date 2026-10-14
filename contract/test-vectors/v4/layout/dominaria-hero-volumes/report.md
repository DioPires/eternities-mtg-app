# Layout report: Dominaria (`dominaria`)

- Dataset: `a5846bec28d1447e`. Plane index (v3 `planes.json`): 19.
- Law: the plane's lore tables (lore). Digest `sha256:59322664c8da5b437cf9c5c00a7126a12bdf0570c458cfd154a2680ee443b8d2`; acceptance status: accepted.
- Stands: 6,271. Sites: 26 (15 era, 11 regional, 0 set). Regions: 12. Hero volumes: 1.
- R₀ = 572,633 mm. R = 838,394 mm after 5 of 20 passes, so the world is 1,676,788 mm across. Restarts at step (4): 111 (39 after a redraw, 30 after a widening at placement, 42 where a widened site no longer fits at its centre).
- Site widenings: 87 (57 for capacity, 0 for no path and approach, 24 where the kept slots ran out, 6 where two void slots in a row cut the path).
- Redraws at the same radius: 39, at most 1 at a radius. Sites laid out at the radius of a redraw (a = 1): 9 of 26.
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Redraws | Restarts | Restarts by cause: a redraw / a widening at placement / a site that no longer fits | Region | Site | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | 572,633 | 0 | 0 | 0 | 0 / 0 / 0 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 2 | 629,897 | 0 | 0 | 0 | 0 / 0 / 0 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 3 | 692,887 | 2 | 0 | 2 | 0 / 0 / 2 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 4 | 762,176 | 55 | 4 | 45 | 4 / 4 / 37 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 5 | 838,394 | 30 | 35 | 64 | 35 / 26 / 3 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| `benalia` | 148,633 | 2 | 32,132 | 21 |
| `shiv` | 202,824 | 3 | 80,751 | 39 |
| `llanowar` | 44,956 | 1 | 5,601 | 12 |
| `yavimaya` | 41,665 | 1 | 5,601 | 13 |
| `terisiare` | 327,726 | 4 | 127,647 | 38 |
| `sarpadia` | 68,499 | 2 | 19,767 | 28 |
| `tolaria` | 184,389 | 2 | 69,727 | 37 |
| `caliman` | 66,017 | 1 | 19,059 | 28 |
| `jamuraa` | 307,380 | 3 | 109,666 | 35 |
| `urborg` | 229,821 | 2 | 72,031 | 31 |
| `otaria` | 379,702 | 3 | 140,604 | 37 |
| `keld` | 203,826 | 2 | 73,456 | 36 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Redraws | Final a | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `era:first-ages` | `shiv` | 288 | 77 | 1 | 57,447 | 76,461 | 106,754 | 3 | 1 / 0 / 2 / 0 | 2 | 0 | 1 | 8 | 453 | 300,000, 360,000 |
| 1 | `era:brothers-war` | `terisiare` | 366 | 93 | 2 | 64,761 | 86,196 | 118,436 | 3 | 1 / 0 / 2 / 0 | 2 | 0 | 1 | 8 | 613 | 310,000, 100,000 |
| 2 | `era:the-dark` | `terisiare` | 119 | 31 | 0 | 36,927 | 49,148 | 73,978 | 3 | 1 / 0 / 2 / 0 | 3 | 1 | 2 | 5 | 177 | 420,000, -70,000 |
| 3 | `era:fallen-empires` | `sarpadia` | 102 | 28 | 0 | 34,188 | 50,052 | 75,063 | 4 | 3 / 0 / 1 / 0 | 1 | 0 | 1 | 4 | 172 | 500,000, -460,000 |
| 4 | `era:ice-age` | `terisiare` | 635 | 165 | 2 | 85,302 | 103,215 | 138,858 | 2 | 1 / 0 / 0 / 1 | 2 | 1 | 1 | 10 | 880 | 600,000, -230,000 |
| 5 | `era:urzas-academy` | `tolaria` | 565 | 145 | 2 | 80,463 | 107,094 | 143,513 | 3 | 1 / 0 / 0 / 2 | 3 | 1 | 1 | 10 | 955 | 250,000, -460,000 |
| 6 | `era:legends` | `jamuraa` | 304 | 80 | 0 | 59,021 | 78,556 | 109,268 | 3 | 1 / 0 / 2 / 0 | 2 | 0 | 1 | 7 | 488 | -80,000, -390,000 |
| 7 | `era:caliman` | `caliman` | 112 | 31 | 0 | 35,824 | 52,448 | 77,938 | 4 | 2 / 0 / 2 / 0 | 2 | 0 | 1 | 5 | 184 | -30,000, -680,000 |
| 8 | `era:jamuraa-wars` | `jamuraa` | 615 | 157 | 3 | 83,948 | 111,733 | 149,080 | 3 | 1 / 0 / 1 / 1 | 3 | 1 | 1 | 10 | 1032 | -280,000, -570,000 |
| 9 | `era:invasion` | `urborg` | 716 | 183 | 3 | 90,580 | 109,601 | 146,522 | 2 | 1 / 0 / 1 / 0 | 1 | 0 | 1 | 11 | 977 | -640,000, -210,000 |
| 10 | `era:mirari` | `otaria` | 604 | 158 | 2 | 83,194 | 110,730 | 147,876 | 3 | 1 / 0 / 2 / 0 | 2 | 0 | 2 | 11 | 1000 | -320,000, 140,000 |
| 11 | `era:karona` | `otaria` | 606 | 151 | 2 | 83,332 | 110,914 | 148,097 | 3 | 1 / 0 / 1 / 1 | 2 | 0 | 2 | 11 | 1018 | -380,000, 440,000 |
| 12 | `era:time-rifts` | `keld` | 600 | 155 | 3 | 82,918 | 110,361 | 147,434 | 3 | 2 / 0 / 1 / 0 | 1 | 0 | 1 | 10 | 985 | -60,000, 670,000 |
| 13 | `era:renewal` | `benalia` | 209 | 56 | 0 | 48,938 | 65,135 | 93,162 | 3 | 1 / 0 / 2 / 0 | 2 | 0 | 2 | 6 | 326 | 70,000, 130,000 |
| 14 | `era:second-invasion` | `shiv` | 265 | 70 | 2 | 55,106 | 80,678 | 111,814 | 4 | 1 / 0 / 2 / 1 | 3 | 0 | 2 | 7 | 522 | 340,000, 590,000 |
| 15 | `region:benalia` | `benalia` | 17 | 6 | 0 | 13,957 | 20,432 | 39,519 | 4 | 4 / 0 / 0 / 0 | 0 | 0 | 1 | 2 | 24 | 110,000, -10,000 |
| 16 | `region:shiv` | `shiv` | 15 | 4 | 0 | 13,110 | 23,223 | 42,868 | 6 | 5 / 0 / 1 / 0 | 1 | 0 | 1 | 2 | 36 | 500,000, 550,000 |
| 17 | `region:llanowar` | `llanowar` | 21 | 6 | 0 | 15,512 | 22,709 | 42,251 | 4 | 4 / 0 / 0 / 0 | 1 | 1 | 1 | 2 | 34 | 550,000, 250,000 |
| 18 | `region:yavimaya` | `yavimaya` | 21 | 6 | 0 | 15,512 | 22,709 | 42,251 | 4 | 3 / 0 / 1 / 0 | 2 | 1 | 1 | 2 | 38 | 700,000, 160,000 |
| 19 | `region:terisiare` | `terisiare` | 28 | 8 | 0 | 17,912 | 23,840 | 43,608 | 3 | 2 / 0 / 1 / 0 | 2 | 1 | 1 | 2 | 45 | 480,000, 140,000 |
| 20 | `region:sarpadia` | `sarpadia` | 4 | 1 | 0 | 9,000 | 9,000 | 25,800 | 0 | 0 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 4 | 610,000, -420,000 |
| 21 | `region:tolaria` | `tolaria` | 15 | 4 | 0 | 13,110 | 21,112 | 40,335 | 5 | 5 / 0 / 0 / 0 | 0 | 0 | 1 | 2 | 31 | 140,000, -300,000 |
| 22 | `region:jamuraa` | `jamuraa` | 4 | 1 | 0 | 9,000 | 10,890 | 28,068 | 2 | 2 / 0 / 0 / 0 | 1 | 1 | 1 | 1 | 4 | -80,000, -240,000 |
| 23 | `region:urborg` | `urborg` | 13 | 4 | 0 | 12,205 | 19,653 | 38,584 | 5 | 5 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 20 | -370,000, -90,000 |
| 24 | `region:otaria` | `otaria` | 8 | 2 | 0 | 9,574 | 14,016 | 31,820 | 4 | 4 / 0 / 0 / 0 | 0 | 0 | 1 | 1 | 12 | -30,000, 290,000 |
| 25 | `region:keld` | `keld` | 19 | 6 | 0 | 14,755 | 21,601 | 40,922 | 4 | 4 / 0 / 0 / 0 | 1 | 1 | 1 | 2 | 27 | 160,000, 600,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 3 | `era:first-ages` | capacity | capacity 242 for 288 | 63,191 |
| 2 | 3 | `era:brothers-war` | capacity | capacity 312 for 366 | 71,237 |
| 3 | 4 | `era:the-dark` | capacity | capacity 92 for 119 | 40,619 |
| 4 | 4 | `era:fallen-empires` | capacity | capacity 68 for 102 | 37,606 |
| 5 | 4 | `era:fallen-empires` | capacity | capacity 90 for 102 | 41,366 |
| 6 | 4 | `era:fallen-empires` | capacity | capacity 99 for 102 | 45,502 |
| 7 | 4 | `era:ice-age` | capacity | capacity 592 for 635 | 93,832 |
| 8 | 4 | `era:urzas-academy` | capacity | capacity 517 for 565 | 88,509 |
| 9 | 4 | `era:legends` | capacity | capacity 261 for 304 | 64,923 |
| 10 | 4 | `era:caliman` | capacity | capacity 86 for 112 | 39,406 |
| 11 | 4 | `era:caliman` | capacity | capacity 102 for 112 | 43,346 |
| 12 | 4 | `era:jamuraa-wars` | capacity | capacity 545 for 615 | 92,342 |
| 13 | 4 | `era:invasion` | capacity | capacity 652 for 716 | 99,638 |
| 14 | 4 | `era:mirari` | capacity | capacity 549 for 604 | 91,513 |
| 15 | 4 | `era:karona` | capacity | capacity 542 for 606 | 91,665 |
| 16 | 4 | `era:time-rifts` | capacity | capacity 529 for 600 | 91,209 |
| 17 | 4 | `era:renewal` | capacity | capacity 186 for 209 | 53,831 |
| 18 | 4 | `era:second-invasion` | capacity | capacity 241 for 265 | 60,616 |
| 19 | 4 | `region:benalia` | capacity | capacity 10 for 17 | 15,352 |
| 20 | 4 | `region:benalia` | capacity | capacity 10 for 17 | 16,887 |
| 21 | 4 | `region:shiv` | capacity | capacity 5 for 15 | 14,421 |
| 22 | 4 | `region:shiv` | capacity | capacity 10 for 15 | 15,863 |
| 23 | 4 | `region:shiv` | capacity | capacity 10 for 15 | 17,449 |
| 24 | 4 | `region:shiv` | capacity | capacity 10 for 15 | 19,193 |
| 25 | 4 | `region:llanowar` | capacity | capacity 5 for 21 | 17,063 |
| 26 | 4 | `region:llanowar` | capacity | capacity 7 for 21 | 18,769 |
| 27 | 4 | `region:llanowar` | capacity | capacity 11 for 21 | 20,645 |
| 28 | 4 | `region:llanowar` | capacity | capacity 8 for 21 | 22,709 |
| 29 | 4 | `region:yavimaya` | capacity | capacity 13 for 21 | 17,063 |
| 30 | 4 | `region:yavimaya` | capacity | capacity 13 for 21 | 18,769 |
| 31 | 4 | `region:yavimaya` | capacity | capacity 13 for 21 | 20,645 |
| 32 | 4 | `region:terisiare` | capacity | capacity 8 for 28 | 19,703 |
| 33 | 4 | `region:terisiare` | capacity | capacity 8 for 28 | 21,673 |
| 34 | 4 | `region:tolaria` | capacity | capacity 4 for 15 | 14,421 |
| 35 | 4 | `region:tolaria` | capacity | capacity 5 for 15 | 15,863 |
| 36 | 4 | `region:tolaria` | capacity | capacity 5 for 15 | 17,449 |
| 37 | 4 | `region:tolaria` | capacity | capacity 8 for 15 | 19,193 |
| 38 | 4 | `region:tolaria` | capacity | capacity 8 for 15 | 21,112 |
| 39 | 4 | `region:jamuraa` | capacity | capacity 0 for 4 | 9,900 |
| 40 | 4 | `region:jamuraa` | capacity | capacity 0 for 4 | 10,890 |
| 41 | 4 | `region:urborg` | capacity | capacity 4 for 13 | 13,425 |
| 42 | 4 | `region:urborg` | capacity | capacity 4 for 13 | 14,767 |
| 43 | 4 | `region:urborg` | capacity | capacity 8 for 13 | 16,243 |
| 44 | 4 | `region:urborg` | capacity | capacity 8 for 13 | 17,867 |
| 45 | 4 | `region:urborg` | capacity | capacity 8 for 13 | 19,653 |
| 46 | 4 | `region:otaria` | capacity | capacity 0 for 8 | 10,531 |
| 47 | 4 | `region:otaria` | capacity | capacity 0 for 8 | 11,584 |
| 48 | 4 | `region:otaria` | capacity | capacity 0 for 8 | 12,742 |
| 49 | 4 | `region:otaria` | capacity | capacity 7 for 8 | 14,016 |
| 50 | 4 | `region:keld` | capacity | capacity 6 for 19 | 16,230 |
| 51 | 4 | `region:keld` | capacity | capacity 10 for 19 | 17,853 |
| 52 | 4 | `region:keld` | capacity | capacity 16 for 19 | 19,638 |
| 53 | 4 | `region:keld` | capacity | capacity 16 for 19 | 21,601 |
| 54 | 4 | `era:first-ages` | the kept slots ran out | exhausted at 225 of 288 stands, the kept slots ran out | 69,510 |
| 55 | 4 | `era:first-ages` | the kept slots ran out | exhausted at 269 of 288 stands, the kept slots ran out | 76,461 |
| 56 | 4 | `era:brothers-war` | the kept slots ran out | exhausted at 260 of 366 stands, the kept slots ran out | 78,360 |
| 57 | 4 | `era:brothers-war` | the kept slots ran out | exhausted at 335 of 366 stands, the kept slots ran out | 86,196 |
| 58 | 5 | `region:benalia` | capacity | capacity 16 for 17 | 18,575 |
| 59 | 5 | `region:benalia` | capacity | capacity 15 for 17 | 20,432 |
| 60 | 5 | `era:the-dark` | the kept slots ran out | exhausted at 70 of 119 stands, the kept slots ran out | 44,680 |
| 61 | 5 | `era:the-dark` | the kept slots ran out | exhausted at 102 of 119 stands, the kept slots ran out | 49,148 |
| 62 | 5 | `era:fallen-empires` | the kept slots ran out | exhausted at 93 of 102 stands, the kept slots ran out | 50,052 |
| 63 | 5 | `era:ice-age` | two void slots in a row | exhausted at 29 of 635 stands, two void slots in a row cut the path at slot 10 | 103,215 |
| 64 | 5 | `era:urzas-academy` | two void slots in a row | exhausted at 122 of 565 stands, two void slots in a row cut the path at slot 35 | 97,359 |
| 65 | 5 | `era:urzas-academy` | two void slots in a row | exhausted at 297 of 565 stands, two void slots in a row cut the path at slot 81 | 107,094 |
| 66 | 5 | `era:legends` | the kept slots ran out | exhausted at 223 of 304 stands, the kept slots ran out | 71,415 |
| 67 | 5 | `era:legends` | the kept slots ran out | exhausted at 262 of 304 stands, the kept slots ran out | 78,556 |
| 68 | 5 | `era:caliman` | the kept slots ran out | exhausted at 88 of 112 stands, the kept slots ran out | 47,680 |
| 69 | 5 | `era:caliman` | the kept slots ran out | exhausted at 83 of 112 stands, the kept slots ran out | 52,448 |
| 70 | 5 | `era:jamuraa-wars` | the kept slots ran out | exhausted at 510 of 615 stands, the kept slots ran out | 101,576 |
| 71 | 5 | `era:jamuraa-wars` | two void slots in a row | exhausted at 479 of 615 stands, two void slots in a row cut the path at slot 140 | 111,733 |
| 72 | 5 | `era:invasion` | the kept slots ran out | exhausted at 559 of 716 stands, the kept slots ran out | 109,601 |
| 73 | 5 | `era:mirari` | the kept slots ran out | exhausted at 478 of 604 stands, the kept slots ran out | 100,664 |
| 74 | 5 | `era:mirari` | the kept slots ran out | exhausted at 600 of 604 stands, the kept slots ran out | 110,730 |
| 75 | 5 | `era:karona` | the kept slots ran out | exhausted at 495 of 606 stands, the kept slots ran out | 100,831 |
| 76 | 5 | `era:karona` | two void slots in a row | exhausted at 59 of 606 stands, two void slots in a row cut the path at slot 19 | 110,914 |
| 77 | 5 | `era:time-rifts` | the kept slots ran out | exhausted at 473 of 600 stands, the kept slots ran out | 100,329 |
| 78 | 5 | `era:time-rifts` | capacity | capacity -3 for 600 | 110,361 |
| 79 | 5 | `era:renewal` | the kept slots ran out | exhausted at 139 of 209 stands, the kept slots ran out | 59,214 |
| 80 | 5 | `era:renewal` | the kept slots ran out | exhausted at 189 of 209 stands, the kept slots ran out | 65,135 |
| 81 | 5 | `era:second-invasion` | the kept slots ran out | exhausted at 193 of 265 stands, the kept slots ran out | 66,677 |
| 82 | 5 | `era:second-invasion` | the kept slots ran out | exhausted at 224 of 265 stands, the kept slots ran out | 73,344 |
| 83 | 5 | `era:second-invasion` | two void slots in a row | exhausted at 34 of 265 stands, two void slots in a row cut the path at slot 11 | 80,678 |
| 84 | 5 | `region:shiv` | the kept slots ran out | exhausted at 11 of 15 stands, the kept slots ran out | 21,112 |
| 85 | 5 | `region:shiv` | capacity | capacity 10 for 15 | 23,223 |
| 86 | 5 | `region:yavimaya` | the kept slots ran out | exhausted at 20 of 21 stands, the kept slots ran out | 22,709 |
| 87 | 5 | `region:terisiare` | the kept slots ran out | exhausted at 22 of 28 stands, the kept slots ran out | 23,840 |

## Redraws in order

| # | Pass | Site | Cause | What was found | r_s (mm) |
|---|---|---|---|---|---|
| 1 | 4 | `era:first-ages` | the kept slots ran out | exhausted at 208 of 288 stands, the kept slots ran out | 63,191 |
| 2 | 4 | `era:first-ages` | the kept slots ran out | exhausted at 266 of 288 stands, the kept slots ran out | 69,510 |
| 3 | 4 | `era:brothers-war` | the kept slots ran out | exhausted at 273 of 366 stands, the kept slots ran out | 71,237 |
| 4 | 4 | `era:brothers-war` | the kept slots ran out | exhausted at 340 of 366 stands, the kept slots ran out | 78,360 |
| 5 | 5 | `era:the-dark` | the kept slots ran out | exhausted at 80 of 119 stands, the kept slots ran out | 40,619 |
| 6 | 5 | `era:the-dark` | the kept slots ran out | exhausted at 112 of 119 stands, the kept slots ran out | 44,680 |
| 7 | 5 | `era:the-dark` | the kept slots ran out | exhausted at 117 of 119 stands, the kept slots ran out | 49,148 |
| 8 | 5 | `era:fallen-empires` | two void slots in a row | exhausted at 14 of 102 stands, two void slots in a row cut the path at slot 7 | 45,502 |
| 9 | 5 | `era:ice-age` | the kept slots ran out | exhausted at 510 of 635 stands, the kept slots ran out | 93,832 |
| 10 | 5 | `era:ice-age` | the kept slots ran out | exhausted at 627 of 635 stands, the kept slots ran out | 103,215 |
| 11 | 5 | `era:urzas-academy` | two void slots in a row | exhausted at 431 of 565 stands, two void slots in a row cut the path at slot 125 | 88,509 |
| 12 | 5 | `era:urzas-academy` | two void slots in a row | exhausted at 423 of 565 stands, two void slots in a row cut the path at slot 123 | 97,359 |
| 13 | 5 | `era:urzas-academy` | two void slots in a row | exhausted at 310 of 565 stands, two void slots in a row cut the path at slot 89 | 107,094 |
| 14 | 5 | `era:legends` | the kept slots ran out | exhausted at 233 of 304 stands, the kept slots ran out | 64,923 |
| 15 | 5 | `era:legends` | the kept slots ran out | exhausted at 276 of 304 stands, the kept slots ran out | 71,415 |
| 16 | 5 | `era:caliman` | the kept slots ran out | exhausted at 89 of 112 stands, the kept slots ran out | 43,346 |
| 17 | 5 | `era:caliman` | the kept slots ran out | exhausted at 107 of 112 stands, the kept slots ran out | 47,680 |
| 18 | 5 | `era:jamuraa-wars` | the kept slots ran out | exhausted at 483 of 615 stands, the kept slots ran out | 92,342 |
| 19 | 5 | `era:jamuraa-wars` | two void slots in a row | exhausted at 181 of 615 stands, two void slots in a row cut the path at slot 54 | 101,576 |
| 20 | 5 | `era:jamuraa-wars` | two void slots in a row | exhausted at 373 of 615 stands, two void slots in a row cut the path at slot 107 | 111,733 |
| 21 | 5 | `era:invasion` | the kept slots ran out | exhausted at 565 of 716 stands, the kept slots ran out | 99,638 |
| 22 | 5 | `era:mirari` | the kept slots ran out | exhausted at 490 of 604 stands, the kept slots ran out | 91,513 |
| 23 | 5 | `era:mirari` | the kept slots ran out | exhausted at 593 of 604 stands, the kept slots ran out | 100,664 |
| 24 | 5 | `era:karona` | the kept slots ran out | exhausted at 500 of 606 stands, the kept slots ran out | 91,665 |
| 25 | 5 | `era:karona` | the kept slots ran out | exhausted at 600 of 606 stands, the kept slots ran out | 100,831 |
| 26 | 5 | `era:time-rifts` | two void slots in a row | exhausted at 0 of 600 stands, two void slots in a row cut the path at slot 2 | 91,209 |
| 27 | 5 | `era:renewal` | two void slots in a row | exhausted at 0 of 209 stands, two void slots in a row cut the path at slot 2 | 53,831 |
| 28 | 5 | `era:renewal` | two void slots in a row | exhausted at 129 of 209 stands, two void slots in a row cut the path at slot 39 | 59,214 |
| 29 | 5 | `era:second-invasion` | the kept slots ran out | exhausted at 195 of 265 stands, the kept slots ran out | 60,616 |
| 30 | 5 | `era:second-invasion` | the kept slots ran out | exhausted at 237 of 265 stands, the kept slots ran out | 66,677 |
| 31 | 5 | `era:second-invasion` | two void slots in a row | exhausted at 27 of 265 stands, two void slots in a row cut the path at slot 11 | 73,344 |
| 32 | 5 | `region:shiv` | the kept slots ran out | exhausted at 12 of 15 stands, the kept slots ran out | 19,193 |
| 33 | 5 | `region:llanowar` | the kept slots ran out | exhausted at 17 of 21 stands, the kept slots ran out | 22,709 |
| 34 | 5 | `region:yavimaya` | the kept slots ran out | exhausted at 15 of 21 stands, the kept slots ran out | 20,645 |
| 35 | 5 | `region:yavimaya` | two void slots in a row | exhausted at 11 of 21 stands, two void slots in a row cut the path at slot 6 | 22,709 |
| 36 | 5 | `region:terisiare` | the kept slots ran out | exhausted at 16 of 28 stands, the kept slots ran out | 21,673 |
| 37 | 5 | `region:terisiare` | the kept slots ran out | exhausted at 19 of 28 stands, the kept slots ran out | 23,840 |
| 38 | 5 | `region:jamuraa` | the kept slots ran out | exhausted at 3 of 4 stands, the kept slots ran out | 10,890 |
| 39 | 5 | `region:keld` | the kept slots ran out | exhausted at 16 of 19 stands, the kept slots ran out | 21,601 |

## Sweep-direction tries (5.4.8)

| Site | The try that passes | Why each earlier try fails, in try order |
|---|---|---|
| `era:the-dark` | 2 | the attachment square lies within 5 m of the blob |
| `era:mirari` | 2 | the attachment square lies within 5 m of the blob |
| `era:karona` | 2 | the attachment square lies within 5 m of the blob |
| `era:renewal` | 2 | the attachment square lies within 5 m of the blob |
| `era:second-invasion` | 2 | the attachment square lies within 5 m of the blob |

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `era:first-ages` | 852,082 | none | 852,082 | 780,106 | 9,000 | 18,000 | 6,106 |
| `era:brothers-war` | 1,107,225 | none | 1,107,225 | 958,844 | 9,000 | 18,000 | 4,844 |
| `era:the-dark` | 338,379 | none | 338,379 | 337,712 | 9,000 | 18,000 | 4,712 |
| `era:fallen-empires` | 340,508 | none | 340,508 | 301,740 | 9,000 | 18,000 | 4,740 |
| `era:ice-age` | 1,649,943 | none | 1,649,943 | 1,633,681 | 9,000 | 18,000 | 4,681 |
| `era:urzas-academy` | 1,762,279 | none | 1,762,279 | 1,417,806 | 9,000 | 18,000 | 4,806 |
| `era:legends` | 926,061 | none | 926,061 | 816,925 | 9,000 | 18,000 | 6,925 |
| `era:caliman` | 385,164 | none | 385,164 | 330,009 | 9,000 | 18,000 | 6,009 |
| `era:jamuraa-wars` | 1,873,774 | none | 1,873,774 | 1,508,304 | 9,000 | 18,000 | 5,304 |
| `era:invasion` | 1,795,382 | none | 1,795,382 | 1,750,703 | 9,000 | 18,000 | 4,703 |
| `era:mirari` | 1,861,732 | none | 1,861,732 | 1,490,906 | 9,000 | 18,000 | 5,906 |
| `era:karona` | 1,849,807 | none | 1,849,807 | 1,462,800 | 9,000 | 18,000 | 4,800 |
| `era:time-rifts` | 1,820,169 | none | 1,820,169 | 1,489,649 | 9,000 | 18,000 | 4,649 |
| `era:renewal` | 627,064 | none | 627,064 | 573,909 | 9,000 | 18,000 | 6,909 |
| `era:second-invasion` | 991,647 | none | 991,647 | 688,974 | 9,000 | 18,000 | 4,974 |
| `region:benalia` | 68,713 | none | 68,713 | 67,840 | 9,000 | 18,000 | 4,840 |
| `region:shiv` | 69,133 | none | 69,133 | 51,990 | 9,000 | 18,000 | 6,990 |
| `region:llanowar` | 82,766 | none | 82,766 | 76,693 | 9,000 | 18,000 | 4,693 |
| `region:yavimaya` | 78,918 | none | 78,918 | 76,791 | 9,000 | 18,000 | 4,791 |
| `region:terisiare` | 83,403 | none | 83,403 | 83,403 | 9,000 | 18,000 | 2,403 |
| `region:sarpadia` | 12,795 | none | 12,795 | 12,795 | 9,000 | 0 | 3,795 |
| `region:tolaria` | 67,418 | none | 67,418 | 50,498 | 9,000 | 18,000 | 5,498 |
| `region:jamuraa` | 18,643 | none | 18,643 | 14,559 | 9,000 | 0 | 5,559 |
| `region:urborg` | 37,938 | none | 37,938 | 37,938 | 9,000 | 9,000 | 1,938 |
| `region:otaria` | 24,305 | none | 24,305 | 22,978 | 9,000 | 9,000 | 4,978 |
| `region:keld` | 73,824 | none | 73,824 | 67,505 | 9,000 | 18,000 | 4,505 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `era:first-ages` | 64 / 27 | 3 / 0 | 0 / 0 | 0 / 8 | 61 / 16 |
| `era:brothers-war` | 96 / 24 | 3 / 0 | 0 / 0 | 3 / 8 | 81 / 12 |
| `era:the-dark` | 22 / 14 | 1 / 0 | 0 / 0 | 0 / 5 | 22 / 9 |
| `era:fallen-empires` | 26 / 10 | 1 / 0 | 0 / 0 | 0 / 4 | 22 / 6 |
| `era:ice-age` | 145 / 34 | 4 / 0 | 0 / 0 | 2 / 11 | 142 / 23 |
| `era:urzas-academy` | 161 / 33 | 1 / 0 | 0 / 0 | 1 / 11 | 131 / 14 |
| `era:legends` | 79 / 20 | 3 / 0 | 0 / 0 | 1 / 7 | 68 / 12 |
| `era:caliman` | 25 / 15 | 2 / 0 | 0 / 0 | 0 / 4 | 23 / 8 |
| `era:jamuraa-wars` | 172 / 34 | 2 / 0 | 0 / 0 | 3 / 7 | 138 / 19 |
| `era:invasion` | 163 / 34 | 2 / 0 | 0 / 0 | 1 / 9 | 158 / 25 |
| `era:mirari` | 170 / 36 | 0 / 0 | 0 / 0 | 0 / 7 | 137 / 21 |
| `era:karona` | 166 / 37 | 2 / 0 | 0 / 0 | 0 / 10 | 135 / 16 |
| `era:time-rifts` | 163 / 35 | 4 / 0 | 0 / 0 | 0 / 9 | 137 / 18 |
| `era:renewal` | 48 / 19 | 2 / 0 | 0 / 0 | 1 / 4 | 42 / 14 |
| `era:second-invasion` | 88 / 21 | 1 / 0 | 0 / 0 | 0 / 6 | 63 / 7 |
| `region:benalia` | 2 / 4 | 1 / 0 | 0 / 0 | 0 / 0 | 2 / 4 |
| `region:shiv` | 3 / 4 | 0 / 0 | 0 / 0 | 0 / 1 | 2 / 2 |
| `region:llanowar` | 3 / 4 | 2 / 0 | 0 / 0 | 0 / 1 | 3 / 3 |
| `region:yavimaya` | 5 / 3 | 0 / 0 | 0 / 0 | 0 / 2 | 5 / 1 |
| `region:terisiare` | 5 / 4 | 0 / 0 | 0 / 0 | 0 / 1 | 5 / 3 |
| `region:sarpadia` | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |
| `region:tolaria` | 3 / 4 | 0 / 0 | 0 / 0 | 0 / 1 | 2 / 2 |
| `region:jamuraa` | 1 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |
| `region:urborg` | 4 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 4 / 0 |
| `region:otaria` | 2 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 2 / 0 |
| `region:keld` | 4 / 3 | 1 / 0 | 0 / 0 | 0 / 1 | 4 / 2 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 1 | 7 |
| 2 | 6 |
| 3 | 518 |
| 4 | 793 |
| 5 | 298 |
| 6 | 6 |

## The path vertex of each stand (ruling 2, V)

3,109 of 6,271 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 89,745,000 micro-degrees. The largest arc length between the two vertices is 11,800 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 3162 |
| 1 | 436 |
| 2 | 344 |
| 3 | 360 |
| 4 | 249 |
| 5 | 241 |
| 6 | 198 |
| 7 | 168 |
| 8 | 154 |
| 9 | 187 |
| 10 | 152 |
| 11 | 125 |
| 12 | 103 |
| 13 | 75 |
| 14 | 68 |
| 15 | 62 |
| 16 | 52 |
| 17 | 44 |
| 18 | 30 |
| 19 | 26 |
| 20 | 20 |
| 21 | 11 |
| 22 | 4 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `era:first-ages` | 553,102 | 85 | no |
| 1 | trail | era:first-ages | `era:brothers-war` | 467,308 | 84 | no |
| 2 | trail | era:brothers-war | `era:the-dark` | 212,696 | 32 | no |
| 3 | trail | era:the-dark | `era:fallen-empires` | 408,410 | 72 | no |
| 4 | trail | era:fallen-empires | `era:ice-age` | 182,833 | 32 | no |
| 5 | trail | era:ice-age | `era:urzas-academy` | 509,696 | 82 | no |
| 6 | trail | era:urzas-academy | `era:legends` | 360,552 | 53 | no |
| 7 | trail | era:legends | `era:caliman` | 340,854 | 65 | no |
| 8 | trail | era:caliman | `era:jamuraa-wars` | 464,464 | 85 | no |
| 9 | trail | era:jamuraa-wars | `era:invasion` | 504,856 | 75 | no |
| 10 | trail | era:invasion | `era:mirari` | 624,800 | 93 | no |
| 11 | trail | era:mirari | `era:karona` | 340,873 | 60 | no |
| 12 | trail | era:karona | `era:time-rifts` | 462,695 | 74 | no |
| 13 | trail | era:time-rifts | `era:renewal` | 475,592 | 91 | no |
| 14 | trail | era:renewal | `era:second-invasion` | 568,806 | 93 | no |
| 15 | spur | trail | `region:benalia` | 106,247 | 18 | no |
| 16 | spur | trail | `region:shiv` | 123,976 | 21 | no |
| 17 | spur | trail | `region:llanowar` | 160,427 | 30 | no |
| 18 | spur | trail | `region:yavimaya` | 218,288 | 40 | no |
| 19 | spur | trail | `region:terisiare` | 77,296 | 15 | no |
| 20 | spur | trail | `region:sarpadia` | 19,163 | 4 | no |
| 21 | spur | trail | `region:tolaria` | 132,005 | 21 | no |
| 22 | spur | trail | `region:jamuraa` | 137,285 | 22 | no |
| 23 | spur | trail | `region:urborg` | 3,334 | 1 | no |
| 24 | spur | trail | `region:otaria` | 122,685 | 24 | no |
| 25 | spur | trail | `region:keld` | 106,944 | 20 | no |

- The trail's legs: 6,477,537 mm. The spurs: 1,207,650 mm.
- From the plaza's edge path to the last site's pad on the trail: 6,497,537 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 36 min 06 s. At `AvatarController.RunSpeed` (6,000 mm/s): 18 min 03 s.

## Keyword assignments (5.4.3)

304 cards have a selected keyword. 165 of them stand at a regional site; the others stand at their era's site, which lies in the keyword's region.

| Card | Keyword | Region | Era | Stands at |
|---|---|---|---|---|
| Benalish Hero | Benalish | `benalia` | `first-ages` | `region:benalia` |
| Shivan Dragon | Shivan | `shiv` | `first-ages` | `era:first-ages` |
| Keldon Warlord | Keldon | `keld` | `first-ages` | `region:keld` |
| Llanowar Elves | Llanowar | `llanowar` | `first-ages` | `region:llanowar` |
| Argivian Archaeologist | Argivian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Argivian Blacksmith | Argivian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Argothian Pixies | Argothian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Argothian Treefolk | Argothian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Yotian Soldier | Yotian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Tolaria | Tolaria | `tolaria` | `legends` | `region:tolaria` |
| Urborg | Urborg | `urborg` | `legends` | `region:urborg` |
| Icatian Javelineers | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Priest | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Lieutenant | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Store | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Skirmishers | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Moneychanger | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Infantry | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Phalanx | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Town | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Icatian Scout | Icatian | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Havenwood Battleground | Havenwood | `sarpadia` | `fallen-empires` | `era:fallen-empires` |
| Kjeldoran Knight | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Skycaptain | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Warrior | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Royal Guard | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Elite Guard | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Phalanx | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Skyknight | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Guard | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Shaman | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Conjurer | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Dead | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Barbarians | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Hydra | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Bears | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Yavimaya Gnats | Yavimaya | `yavimaya` | `ice-age` | `region:yavimaya` |
| Kjeldoran Frostbeast | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Escort | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Home Guard | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Outpost | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian War-Makers | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Trading Post | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Horde | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Yavimaya Ancients | Yavimaya | `yavimaya` | `ice-age` | `region:yavimaya` |
| Yavimaya Ants | Yavimaya | `yavimaya` | `ice-age` | `region:yavimaya` |
| Heart of Yavimaya | Yavimaya | `yavimaya` | `ice-age` | `region:yavimaya` |
| Balduvian Dead | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Pride | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Zhalfirin Commander | Zhalfirin | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Femeref Scouts | Femeref | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Femeref Knight | Femeref | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Zhalfirin Knight | Zhalfirin | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Femeref Healer | Femeref | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Suq'Ata Firewalker | Suq'Ata | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Urborg Panther | Urborg | `urborg` | `jamuraa-wars` | `region:urborg` |
| Purraj of Urborg | Urborg | `urborg` | `jamuraa-wars` | `region:urborg` |
| Femeref Archers | Femeref | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Urborg Mindsucker | Urborg | `urborg` | `jamuraa-wars` | `region:urborg` |
| Zhalfirin Crusader | Zhalfirin | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Jamuraan Lion | Jamuraan | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Suq'Ata Assassin | Suq'Ata | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Suq'Ata Lancer | Suq'Ata | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Femeref Enchantress | Femeref | `jamuraa` | `jamuraa-wars` | `era:jamuraa-wars` |
| Argivian Find | Argivian | `terisiare` | `invasion` | `region:terisiare` |
| Benalish Knight | Benalish | `benalia` | `invasion` | `region:benalia` |
| Benalish Infantry | Benalish | `benalia` | `invasion` | `region:benalia` |
| Benalish Missionary | Benalish | `benalia` | `invasion` | `region:benalia` |
| Tolarian Entrancer | Tolarian | `tolaria` | `invasion` | `region:tolaria` |
| Tolarian Serpent | Tolarian | `tolaria` | `invasion` | `region:tolaria` |
| Argivian Restoration | Argivian | `terisiare` | `invasion` | `region:terisiare` |
| Tolarian Drake | Tolarian | `tolaria` | `invasion` | `region:tolaria` |
| Urborg Justice | Urborg | `urborg` | `invasion` | `era:invasion` |
| Urborg Stalker | Urborg | `urborg` | `invasion` | `era:invasion` |
| Maraxus of Keld | Keld | `keld` | `invasion` | `region:keld` |
| Llanowar Sentinel | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Llanowar Behemoth | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Llanowar Druid | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Thran Tome | Thran | `terisiare` | `invasion` | `region:terisiare` |
| Thran Forge | Thran | `terisiare` | `invasion` | `region:terisiare` |
| Tolarian Winds | Tolarian | `tolaria` | `urzas-academy` | `era:urzas-academy` |
| Tolarian Academy | Tolarian | `tolaria` | `urzas-academy` | `era:urzas-academy` |
| Academy Researchers | Academy | `tolaria` | `urzas-academy` | `era:urzas-academy` |
| Shivan Hellkite | Shivan | `shiv` | `urzas-academy` | `region:shiv` |
| Shivan Raptor | Shivan | `shiv` | `urzas-academy` | `region:shiv` |
| Shiv's Embrace | Shiv | `shiv` | `urzas-academy` | `region:shiv` |
| Shivan Gorge | Shivan | `shiv` | `urzas-academy` | `region:shiv` |
| Argothian Enchantress | Argothian | `terisiare` | `urzas-academy` | `region:terisiare` |
| Argothian Swine | Argothian | `terisiare` | `urzas-academy` | `region:terisiare` |
| Argothian Elder | Argothian | `terisiare` | `urzas-academy` | `region:terisiare` |
| Argothian Wurm | Argothian | `terisiare` | `urzas-academy` | `region:terisiare` |
| Thran Quarry | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Thran Turbine | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Shivan Phoenix | Shivan | `shiv` | `urzas-academy` | `region:shiv` |
| Yavimaya Scion | Yavimaya | `yavimaya` | `urzas-academy` | `region:yavimaya` |
| Yavimaya Wurm | Yavimaya | `yavimaya` | `urzas-academy` | `region:yavimaya` |
| Yavimaya Granger | Yavimaya | `yavimaya` | `urzas-academy` | `region:yavimaya` |
| Thran Lens | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Thran Weaponry | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Thran War Machine | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Academy Rector | Academy | `tolaria` | `urzas-academy` | `era:urzas-academy` |
| Rayne, Academy Chancellor | Academy | `tolaria` | `urzas-academy` | `era:urzas-academy` |
| Keldon Vandals | Keldon | `keld` | `urzas-academy` | `region:keld` |
| Keldon Champion | Keldon | `keld` | `urzas-academy` | `region:keld` |
| Rofellos, Llanowar Emissary | Llanowar | `llanowar` | `urzas-academy` | `region:llanowar` |
| Yavimaya Enchantress | Yavimaya | `yavimaya` | `urzas-academy` | `region:yavimaya` |
| Yavimaya Hollow | Yavimaya | `yavimaya` | `urzas-academy` | `region:yavimaya` |
| Yavimaya Elder | Yavimaya | `yavimaya` | `urzas-academy` | `region:yavimaya` |
| Thran Foundry | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Thran Dynamo | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Thran Golem | Thran | `terisiare` | `urzas-academy` | `region:terisiare` |
| Keldon Berserker | Keldon | `keld` | `jamuraa-wars` | `region:keld` |
| Latulla, Keldon Overseer | Keldon | `keld` | `jamuraa-wars` | `region:keld` |
| Keldon Arsonist | Keldon | `keld` | `jamuraa-wars` | `region:keld` |
| Keldon Firebombers | Keldon | `keld` | `jamuraa-wars` | `region:keld` |
| Keldon Battlewagon | Keldon | `keld` | `jamuraa-wars` | `region:keld` |
| Benalish Lancer | Benalish | `benalia` | `invasion` | `region:benalia` |
| Benalish Trapper | Benalish | `benalia` | `invasion` | `region:benalia` |
| Urborg Skeleton | Urborg | `urborg` | `invasion` | `era:invasion` |
| Urborg Shambler | Urborg | `urborg` | `invasion` | `era:invasion` |
| Shivan Harvest | Shivan | `shiv` | `invasion` | `region:shiv` |
| Keldon Necropolis | Keldon | `keld` | `invasion` | `region:keld` |
| Llanowar Vanguard | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Llanowar Elite | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Pulse of Llanowar | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Urborg Volcano | Urborg | `urborg` | `invasion` | `era:invasion` |
| Yavimaya Barbarian | Yavimaya | `yavimaya` | `invasion` | `region:yavimaya` |
| Benalish Heralds | Benalish | `benalia` | `invasion` | `region:benalia` |
| Shivan Emissary | Shivan | `shiv` | `invasion` | `region:shiv` |
| Yavimaya Kavu | Yavimaya | `yavimaya` | `invasion` | `region:yavimaya` |
| Llanowar Cavalry | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Urborg Drake | Urborg | `urborg` | `invasion` | `era:invasion` |
| Llanowar Knight | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Tolarian Emissary | Tolarian | `tolaria` | `invasion` | `region:tolaria` |
| Benalish Emissary | Benalish | `benalia` | `invasion` | `region:benalia` |
| Shivan Oasis | Shivan | `shiv` | `invasion` | `region:shiv` |
| Fires of Yavimaya | Yavimaya | `yavimaya` | `invasion` | `region:yavimaya` |
| Urborg Emissary | Urborg | `urborg` | `invasion` | `era:invasion` |
| Urborg Phantom | Urborg | `urborg` | `invasion` | `era:invasion` |
| Shivan Zombie | Shivan | `shiv` | `invasion` | `region:shiv` |
| Keldon Mantle | Keldon | `keld` | `invasion` | `region:keld` |
| Keldon Twilight | Keldon | `keld` | `invasion` | `region:keld` |
| Shivan Wurm | Shivan | `shiv` | `invasion` | `region:shiv` |
| Urborg Uprising | Urborg | `urborg` | `invasion` | `era:invasion` |
| Shivan Reef | Shivan | `shiv` | `invasion` | `region:shiv` |
| Llanowar Wastes | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Caves of Koilos | Koilos | `terisiare` | `invasion` | `region:terisiare` |
| Llanowar Dead | Llanowar | `llanowar` | `invasion` | `region:llanowar` |
| Yavimaya Coast | Yavimaya | `yavimaya` | `invasion` | `region:yavimaya` |
| Urborg Elf | Urborg | `urborg` | `invasion` | `era:invasion` |
| Yavimaya's Embrace | Yavimaya | `yavimaya` | `invasion` | `region:yavimaya` |
| Pardic Swordsmith | Pardic | `otaria` | `mirari` | `era:mirari` |
| Pardic Firecat | Pardic | `otaria` | `mirari` | `era:mirari` |
| Pardic Miner | Pardic | `otaria` | `mirari` | `era:mirari` |
| Krosan Beast | Krosan | `otaria` | `mirari` | `era:mirari` |
| Seton, Krosan Protector | Krosan | `otaria` | `mirari` | `era:mirari` |
| Krosan Avenger | Krosan | `otaria` | `mirari` | `era:mirari` |
| Krosan Archer | Krosan | `otaria` | `mirari` | `era:mirari` |
| Otarian Juggernaut | Otarian | `otaria` | `mirari` | `era:mirari` |
| Pardic Lancer | Pardic | `otaria` | `mirari` | `era:mirari` |
| Pardic Arsonist | Pardic | `otaria` | `mirari` | `era:mirari` |
| Krosan Constrictor | Krosan | `otaria` | `mirari` | `era:mirari` |
| Krosan Restorer | Krosan | `otaria` | `mirari` | `era:mirari` |
| Pardic Collaborator | Pardic | `otaria` | `mirari` | `era:mirari` |
| Krosan Wayfarer | Krosan | `otaria` | `mirari` | `era:mirari` |
| Krosan Reclamation | Krosan | `otaria` | `mirari` | `era:mirari` |
| Krosan Verge | Krosan | `otaria` | `mirari` | `era:mirari` |
| Daru Lancer | Daru | `otaria` | `karona` | `era:karona` |
| Daru Encampment | Daru | `otaria` | `karona` | `era:karona` |
| Daru Healer | Daru | `otaria` | `karona` | `era:karona` |
| Daru Cavalier | Daru | `otaria` | `karona` | `era:karona` |
| Krosan Groundshaker | Krosan | `otaria` | `karona` | `era:karona` |
| Krosan Colossus | Krosan | `otaria` | `karona` | `era:karona` |
| Krosan Tusker | Krosan | `otaria` | `karona` | `era:karona` |
| Kamahl, Fist of Krosa | Krosa | `otaria` | `karona` | `era:karona` |
| Daru Mender | Daru | `otaria` | `karona` | `era:karona` |
| Daru Stinger | Daru | `otaria` | `karona` | `era:karona` |
| Daru Sanctifier | Daru | `otaria` | `karona` | `era:karona` |
| Krosan Cloudscraper | Krosan | `otaria` | `karona` | `era:karona` |
| Krosan Vorine | Krosan | `otaria` | `karona` | `era:karona` |
| Daru Warchief | Daru | `otaria` | `karona` | `era:karona` |
| Daru Spiritualist | Daru | `otaria` | `karona` | `era:karona` |
| Krosan Warchief | Krosan | `otaria` | `karona` | `era:karona` |
| Krosan Drover | Krosan | `otaria` | `karona` | `era:karona` |
| Kjeldoran Outrider | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Javelineer | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran Gargoyle | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Darien, King of Kjeldor | Kjeldor | `terisiare` | `ice-age` | `era:ice-age` |
| Kjeldoran War Cry | Kjeldoran | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Frostwaker | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Rage | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Warlord | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Balduvian Fallen | Balduvian | `terisiare` | `ice-age` | `era:ice-age` |
| Benalish Cavalry | Benalish | `benalia` | `time-rifts` | `region:benalia` |
| Icatian Crier | Icatian | `sarpadia` | `time-rifts` | `region:sarpadia` |
| Teferi, Mage of Zhalfir | Zhalfir | `jamuraa` | `time-rifts` | `region:jamuraa` |
| Academy Ruins | Academy | `tolaria` | `time-rifts` | `region:tolaria` |
| Tolarian Sentinel | Tolarian | `tolaria` | `time-rifts` | `region:tolaria` |
| Evil Eye of Urborg | Urborg | `urborg` | `time-rifts` | `region:urborg` |
| Urborg Syphon-Mage | Urborg | `urborg` | `time-rifts` | `region:urborg` |
| Keldon Halberdier | Keldon | `keld` | `time-rifts` | `era:time-rifts` |
| Pardic Dragon | Pardic | `otaria` | `time-rifts` | `region:otaria` |
| Krosan Grip | Krosan | `otaria` | `time-rifts` | `region:otaria` |
| Yavimaya Dryad | Yavimaya | `yavimaya` | `time-rifts` | `region:yavimaya` |
| Havenwood Wurm | Havenwood | `sarpadia` | `time-rifts` | `region:sarpadia` |
| Might of Old Krosa | Krosa | `otaria` | `time-rifts` | `region:otaria` |
| Stonebrow, Krosan Hero | Krosan | `otaria` | `time-rifts` | `region:otaria` |
| Thelon of Havenwood | Havenwood | `sarpadia` | `time-rifts` | `region:sarpadia` |
| Sarpadian Empires, Vol. VII | Sarpadian | `sarpadia` | `time-rifts` | `region:sarpadia` |
| Benalish Commander | Benalish | `benalia` | `time-rifts` | `region:benalia` |
| Shivan Wumpus | Shivan | `shiv` | `time-rifts` | `region:shiv` |
| Shivan Meteor | Shivan | `shiv` | `time-rifts` | `region:shiv` |
| Keldon Marauders | Keldon | `keld` | `time-rifts` | `era:time-rifts` |
| Radha, Heir to Keld | Keld | `keld` | `time-rifts` | `era:time-rifts` |
| Urborg, Tomb of Yawgmoth | Urborg | `urborg` | `time-rifts` | `region:urborg` |
| New Benalia | Benalia | `benalia` | `time-rifts` | `region:benalia` |
| Tolaria West | Tolaria | `tolaria` | `time-rifts` | `region:tolaria` |
| Shivan Sand-Mage | Shivan | `shiv` | `time-rifts` | `region:shiv` |
| Keldon Megaliths | Keldon | `keld` | `time-rifts` | `era:time-rifts` |
| Llanowar Empath | Llanowar | `llanowar` | `time-rifts` | `region:llanowar` |
| Llanowar Reborn | Llanowar | `llanowar` | `time-rifts` | `region:llanowar` |
| Llanowar Augur | Llanowar | `llanowar` | `time-rifts` | `region:llanowar` |
| Baru, Fist of Krosa | Krosa | `otaria` | `time-rifts` | `region:otaria` |
| Llanowar Mentor | Llanowar | `llanowar` | `time-rifts` | `region:llanowar` |
| Benalish Honor Guard | Benalish | `benalia` | `renewal` | `era:renewal` |
| Benalish Marshal | Benalish | `benalia` | `renewal` | `era:renewal` |
| Fall of the Thran | Thran | `terisiare` | `renewal` | `region:terisiare` |
| Kwende, Pride of Femeref | Femeref | `jamuraa` | `renewal` | `region:jamuraa` |
| Baird, Steward of Argive | Argive | `terisiare` | `renewal` | `region:terisiare` |
| Knight of New Benalia | Benalia | `benalia` | `renewal` | `era:renewal` |
| History of Benalia | Benalia | `benalia` | `renewal` | `era:renewal` |
| Academy Drake | Academy | `tolaria` | `renewal` | `region:tolaria` |
| Tolarian Scholar | Tolarian | `tolaria` | `renewal` | `region:tolaria` |
| Academy Journeymage | Academy | `tolaria` | `renewal` | `region:tolaria` |
| Yargle, Glutton of Urborg | Urborg | `urborg` | `renewal` | `region:urborg` |
| Keldon Raider | Keldon | `keld` | `renewal` | `region:keld` |
| Keldon Overseer | Keldon | `keld` | `renewal` | `region:keld` |
| The Flame of Keld | Keld | `keld` | `renewal` | `region:keld` |
| Shivan Fire | Shivan | `shiv` | `renewal` | `region:shiv` |
| Keldon Warcaller | Keldon | `keld` | `renewal` | `region:keld` |
| Krosan Druid | Krosan | `otaria` | `renewal` | `region:otaria` |
| Llanowar Scout | Llanowar | `llanowar` | `renewal` | `region:llanowar` |
| Yavimaya Sapherd | Yavimaya | `yavimaya` | `renewal` | `region:yavimaya` |
| Multani, Yavimaya's Avatar | Yavimaya | `yavimaya` | `renewal` | `region:yavimaya` |
| Llanowar Envoy | Llanowar | `llanowar` | `renewal` | `region:llanowar` |
| Zhalfirin Void | Zhalfirin | `jamuraa` | `renewal` | `region:jamuraa` |
| Thran Temporal Gateway | Thran | `terisiare` | `renewal` | `region:terisiare` |
| Pardic Wanderer | Pardic | `otaria` | `renewal` | `region:otaria` |
| Guardians of Koilos | Koilos | `terisiare` | `renewal` | `region:terisiare` |
| Moira, Urborg Haunt | Urborg | `urborg` | `second-invasion` | `region:urborg` |
| Fallaji Wayfarer | Fallaji | `terisiare` | `second-invasion` | `region:terisiare` |
| The Lady of Otaria | Otaria | `otaria` | `second-invasion` | `region:otaria` |
| Torsten, Founder of Benalia | Benalia | `benalia` | `second-invasion` | `region:benalia` |
| Argivian Phalanx | Argivian | `terisiare` | `second-invasion` | `region:terisiare` |
| Benalish Faithbonder | Benalish | `benalia` | `second-invasion` | `region:benalia` |
| Guardian of New Benalia | Benalia | `benalia` | `second-invasion` | `region:benalia` |
| Danitha, Benalia's Hope | Benalia | `benalia` | `second-invasion` | `region:benalia` |
| Argivian Cavalier | Argivian | `terisiare` | `second-invasion` | `region:terisiare` |
| Academy Wall | Academy | `tolaria` | `second-invasion` | `region:tolaria` |
| The Phasing of Zhalfir | Zhalfir | `jamuraa` | `second-invasion` | `region:jamuraa` |
| Academy Loremaster | Academy | `tolaria` | `second-invasion` | `region:tolaria` |
| Tolarian Terror | Tolarian | `tolaria` | `second-invasion` | `region:tolaria` |
| Keldon Flamesage | Keldon | `keld` | `second-invasion` | `region:keld` |
| Balduvian Berserker | Balduvian | `terisiare` | `second-invasion` | `region:terisiare` |
| Yavimaya Steelcrusher | Yavimaya | `yavimaya` | `second-invasion` | `region:yavimaya` |
| Shivan Devastator | Shivan | `shiv` | `second-invasion` | `era:second-invasion` |
| Llanowar Loamspeaker | Llanowar | `llanowar` | `second-invasion` | `region:llanowar` |
| Llanowar Greenwidow | Llanowar | `llanowar` | `second-invasion` | `region:llanowar` |
| Llanowar Stalker | Llanowar | `llanowar` | `second-invasion` | `region:llanowar` |
| Yavimaya Sojourner | Yavimaya | `yavimaya` | `second-invasion` | `region:yavimaya` |
| Urborg Repossession | Urborg | `urborg` | `second-invasion` | `region:urborg` |
| Balduvian Atrocity | Balduvian | `terisiare` | `second-invasion` | `region:terisiare` |
| Benalish Sleeper | Benalish | `benalia` | `second-invasion` | `region:benalia` |
| Baird, Argivian Recruiter | Argivian | `terisiare` | `second-invasion` | `region:terisiare` |
| Garna, Bloodfist of Keld | Keld | `keld` | `second-invasion` | `region:keld` |
| Keldon Strike Team | Keldon | `keld` | `second-invasion` | `region:keld` |
| Tribute to Urborg | Urborg | `urborg` | `second-invasion` | `region:urborg` |
| Yavimaya Iconoclast | Yavimaya | `yavimaya` | `second-invasion` | `region:yavimaya` |
| Ratadrabik of Urborg | Urborg | `urborg` | `second-invasion` | `region:urborg` |
| Tolarian Geyser | Tolarian | `tolaria` | `second-invasion` | `region:tolaria` |
| Aron, Benalia's Ruin | Benalia | `benalia` | `second-invasion` | `region:benalia` |
| Urborg Lhurgoyf | Urborg | `urborg` | `second-invasion` | `region:urborg` |
| Thran Portal | Thran | `terisiare` | `second-invasion` | `region:terisiare` |
| Terisiare's Devastation | Terisiare | `terisiare` | `brothers-war` | `era:brothers-war` |
| Myrel, Shield of Argive | Argive | `terisiare` | `brothers-war` | `era:brothers-war` |
| Yotian Frontliner | Yotian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Yotian Medic | Yotian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Koilos Roc | Koilos | `terisiare` | `brothers-war` | `era:brothers-war` |
| Fallaji Archaeologist | Fallaji | `terisiare` | `brothers-war` | `era:brothers-war` |
| Terisian Mindbreaker | Terisian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Thran Vigil | Thran | `terisiare` | `brothers-war` | `era:brothers-war` |
| Fallaji Chaindancer | Fallaji | `terisiare` | `brothers-war` | `era:brothers-war` |
| Fallaji Dragon Engine | Fallaji | `terisiare` | `brothers-war` | `era:brothers-war` |
| Argothian Sprite | Argothian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Argoth, Sanctum of Nature | Argoth | `terisiare` | `brothers-war` | `era:brothers-war` |
| Fallaji Excavation | Fallaji | `terisiare` | `brothers-war` | `era:brothers-war` |
| Argothian Opportunist | Argothian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Yotian Tactician | Yotian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Yotian Dissident | Yotian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Fallaji Vanguard | Fallaji | `terisiare` | `brothers-war` | `era:brothers-war` |
| Thran Power Suit | Thran | `terisiare` | `brothers-war` | `era:brothers-war` |
| Thran Spider | Thran | `terisiare` | `brothers-war` | `era:brothers-war` |
| Argivian Avenger | Argivian | `terisiare` | `brothers-war` | `era:brothers-war` |
| Shivan Branch-Burner | Shivan | `shiv` | `second-invasion` | `era:second-invasion` |

### Cards whose name matches keywords of two regions

None.

### Empty chapters

None.

## Headline cards per era (5.13.2)

| Era | Rule | Cards |
|---|---|---|
| `first-ages` | the era row's list | Shivan Dragon; Dragon Whelp; Benalish Hero; Llanowar Elves; Keldon Warlord |
| `brothers-war` | story spotlight | Calamity's Wake; Kayla's Reconstruction; Loran's Escape; Meticulous Excavation; Soul Partition; Tocasia's Welcome |
| `the-dark` | the era row's list | City of Shadows; Tivadar's Crusade; Preacher; Maze of Ith; Barl's Cage |
| `fallen-empires` | the era row's list | Order of the Ebon Hand; Icatian Town; Vodalian Knights; Elvish Farmer; Dwarven Soldier; Thallid |
| `ice-age` | the era row's list | Darien, King of Kjeldor; Lovisa Coldeyes; Heidar, Rimewind Master; Márton Stromgald; Kaysa; Ice Cauldron |
| `urzas-academy` | the era row's list | Barrin, Master Wizard; Karn, Silver Golem; Tolarian Academy; Multani, Maro-Sorcerer; Rayne, Academy Chancellor |
| `legends` | the era row's list | Hazezon Tamar; Jedit Ojanen; Johan; Nicol Bolas; Tetsuo Umezawa; Ramses Overdark |
| `caliman` | the era row's list | Alaborn Musketeer; Talas Warrior; Goblin General; Norwood Ranger; Dakmor Sorceress; Prowling Nightstalker |
| `jamuraa-wars` | the era row's list | Sidar Jabari; Asmira, Holy Avenger; Rashida Scalebane; Teferi's Isle; Mageta the Lion; Latulla, Keldon Overseer |
| `invasion` | the era row's list | Gerrard Capashen; Captain Sisay; Hanna, Ship's Navigator; Tsabo Tavoc; Skyship Weatherlight; Legacy Weapon |
| `mirari` | the era row's list | Mirari; Kamahl, Pit Fighter; Chainer, Dementia Master; Cabal Patriarch; Ambassador Laquatus; Jeska, Warrior Adept |
| `karona` | the era row's list | Kamahl, Fist of Krosa; Ixidor, Reality Sculptor; Phage the Untouchable; Akroma, Angel of Wrath; Karona, False God; Sliver Overlord |
| `time-rifts` | the era row's list | Teferi, Mage of Zhalfir; Jhoira of the Ghitu; Venser, Shaper Savant; Radha, Heir to Keld |
| `renewal` | story spotlight | In Bolas's Clutches; Final Parting; Settle the Score; Broken Bond |
| `second-invasion` | story spotlight | Heroic Charge; Temporary Lockdown; Ertai's Scorn; Protect the Negotiators; Silver Scrutiny; Extinguish the Light |

## The independent checker (3.2, 5.4.10)

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,555 mm.

| Assertion | Tested |
|---|---|
| approach-length | 26 |
| apron-apron | 0 |
| apron-corridor | 4,070 |
| apron-pad | 0 |
| apron-path | 902 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-plane | 6,271 |
| card-set | 6,271 |
| card-site | 6,271 |
| card-stand | 12,542 |
| chapter-cluster | 22 |
| chapter-first | 37 |
| chapter-list | 6,191 |
| chapter-order | 1,565 |
| chapter-stone | 37 |
| cluster-arcs | 1,602 |
| cluster-cap | 1,628 |
| cluster-count | 1,628 |
| cluster-size | 1,628 |
| corridor-end | 6,271 |
| corridor-plaza | 0 |
| corridor-stone | 17 |
| corridor-volume | 0 |
| corridor-window | 6,271 |
| footprint-apron | 0 |
| footprint-blob | 6,271 |
| footprint-cluster | 6,271 |
| footprint-corridor | 3,187 |
| footprint-footprint | 0 |
| footprint-pad | 0 |
| footprint-path | 7 |
| footprint-plaza | 0 |
| footprint-stone | 0 |
| footprint-volume | 0 |
| gap-between | 1,602 |
| gap-end | 26 |
| gap-first | 26 |
| header | 1 |
| leg-attachment | 52 |
| pad-head | 26 |
| pad-list | 27 |
| pad-pad | 0 |
| pad-plaza | 1 |
| pad-volume | 0 |
| path-empty | 0 |
| plaza-approach | 1 |
| plaza-figures | 1 |
| record-class | 6,271 |
| record-cluster | 6,271 |
| record-count | 1 |
| record-order | 6,270 |
| record-site | 6,271 |
| record-vertex | 6,271 |
| record-yaw | 6,271 |
| site-bounds | 26,869 |
| site-list | 63 |
| site-reached | 26 |
| site-region | 26 |
| spur | 11 |
| stand-count | 1 |
| stand-region | 6,271 |
| stand-spacing | 1,125 |
| stand-yaw | 6,271 |
| stone-pad | 0 |
| stone-path | 14 |
| stone-place | 26 |
| stone-plaza | 0 |
| stone-stone | 0 |
| stone-volume | 0 |
| trail-leg | 15 |
| trail-order | 27 |
| volume-arrival | 1 |
| volume-path | 0 |
| volume-site | 0 |
| world-format | 1 |
