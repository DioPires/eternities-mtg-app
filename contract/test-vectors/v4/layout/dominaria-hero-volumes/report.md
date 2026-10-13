# Layout report: Dominaria (`dominaria`)

- Dataset: `a5846bec28d1447e`. Plane index (v3 `planes.json`): 19.
- Law: the plane's lore tables (lore). Digest `sha256:59322664c8da5b437cf9c5c00a7126a12bdf0570c458cfd154a2680ee443b8d2`; acceptance status: accepted.
- Stands: 6,271. Sites: 26 (15 era, 11 regional, 0 set). Regions: 12. Hero volumes: 1.
- R₀ = 572,633 mm. R = 1,115,904 mm after 8 of 20 passes, so the world is 2,231,808 mm across. Restarts at step (4): 86.
- Site widenings: 102 (57 for capacity, 0 for no path and approach, 25 where the kept slots ran out, 20 where two void slots in a row cut the path).
- Trig table: sha256 `fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777` (5.4.18 (6)).
- Independent checker (3.2): pass, 0 violations.

## Passes over R

| Pass | R (mm) | Site widenings | Restarts | Region | Site | Result |
|---|---|---|---|---|---|---|
| 1 | 572,633 | 0 | 0 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 2 | 629,897 | 0 | 0 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 3 | 692,887 | 0 | 0 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 4 | 762,176 | 7 | 6 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 5 | 838,394 | 58 | 43 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 6 | 922,234 | 4 | 4 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 7 | 1,014,458 | 1 | 1 | `terisiare` | `era:ice-age` | R is widened: region 'terisiare' cannot hold site 'era:ice-age' |
| 8 | 1,115,904 | 32 | 32 | none | none | the world is laid out |

## Regions

| Region | Cell area (m²) | Sites | Bounding discs' area (m²) | Discs' share of the cell (percent, rounded down) |
|---|---|---|---|---|
| `benalia` | 263,314 | 2 | 32,132 | 12 |
| `shiv` | 359,316 | 3 | 81,229 | 22 |
| `llanowar` | 79,643 | 1 | 7,221 | 9 |
| `yavimaya` | 73,812 | 1 | 7,221 | 9 |
| `terisiare` | 580,587 | 4 | 223,148 | 38 |
| `sarpadia` | 121,350 | 2 | 19,946 | 16 |
| `tolaria` | 326,657 | 2 | 69,727 | 21 |
| `caliman` | 116,953 | 1 | 16,363 | 13 |
| `jamuraa` | 544,545 | 3 | 122,773 | 22 |
| `urborg` | 407,143 | 2 | 72,031 | 17 |
| `otaria` | 672,668 | 3 | 140,604 | 20 |
| `keld` | 361,090 | 2 | 74,946 | 20 |

## Sites

| # | Site | Region | Stands | Clusters | Chapter stones | Base r_s (mm) | Final r_s (mm) | b_s (mm) | Widenings | By cause: capacity / no path / slots ran out / cut | Sweep-direction tries | Sweeps | Capacity | Centre (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `era:first-ages` | `shiv` | 288 | 76 | 1 | 57,447 | 84,107 | 115,929 | 4 | 1 / 0 / 2 / 1 | 1 | 8 | 555 | 370,000, 450,000 |
| 1 | `era:brothers-war` | `terisiare` | 366 | 94 | 2 | 64,761 | 94,815 | 128,778 | 4 | 1 / 0 / 2 / 1 | 1 | 9 | 722 | 390,000, 170,000 |
| 2 | `era:the-dark` | `terisiare` | 119 | 30 | 0 | 36,927 | 54,062 | 79,875 | 4 | 1 / 0 / 2 / 1 | 1 | 5 | 223 | 610,000, 170,000 |
| 3 | `era:fallen-empires` | `sarpadia` | 102 | 28 | 0 | 34,188 | 50,052 | 75,063 | 4 | 3 / 0 / 0 / 1 | 1 | 4 | 168 | 640,000, -580,000 |
| 4 | `era:ice-age` | `terisiare` | 635 | 164 | 2 | 85,302 | 166,225 | 214,470 | 7 | 2 / 0 / 1 / 4 | 1 | 16 | 2333 | 720,000, -270,000 |
| 5 | `era:urzas-academy` | `tolaria` | 565 | 150 | 2 | 80,463 | 107,094 | 143,513 | 3 | 1 / 0 / 1 / 1 | 1 | 10 | 920 | 390,000, -580,000 |
| 6 | `era:legends` | `jamuraa` | 304 | 81 | 0 | 59,021 | 78,556 | 109,268 | 3 | 1 / 0 / 1 / 1 | 1 | 7 | 482 | -70,000, -550,000 |
| 7 | `era:caliman` | `caliman` | 112 | 29 | 0 | 35,824 | 47,680 | 72,216 | 3 | 2 / 0 / 0 / 1 | 1 | 4 | 171 | -20,000, -840,000 |
| 8 | `era:jamuraa-wars` | `jamuraa` | 615 | 159 | 3 | 83,948 | 122,906 | 162,488 | 4 | 1 / 0 / 1 / 2 | 1 | 13 | 1222 | -290,000, -740,000 |
| 9 | `era:invasion` | `urborg` | 716 | 185 | 3 | 90,580 | 109,601 | 146,522 | 2 | 1 / 0 / 0 / 1 | 1 | 11 | 968 | -740,000, -250,000 |
| 10 | `era:mirari` | `otaria` | 604 | 154 | 2 | 83,194 | 110,730 | 147,876 | 3 | 1 / 0 / 2 / 0 | 2 | 11 | 1001 | -440,000, 130,000 |
| 11 | `era:karona` | `otaria` | 606 | 153 | 2 | 83,332 | 110,914 | 148,097 | 3 | 1 / 0 / 2 / 0 | 2 | 11 | 1013 | -500,000, 430,000 |
| 12 | `era:time-rifts` | `keld` | 600 | 152 | 3 | 82,918 | 110,361 | 147,434 | 3 | 1 / 0 / 1 / 1 | 1 | 10 | 992 | -40,000, 750,000 |
| 13 | `era:renewal` | `benalia` | 209 | 56 | 0 | 48,938 | 65,135 | 93,162 | 3 | 1 / 0 / 0 / 2 | 2 | 6 | 331 | 100,000, 240,000 |
| 14 | `era:second-invasion` | `shiv` | 265 | 73 | 2 | 55,106 | 73,344 | 103,013 | 3 | 1 / 0 / 2 / 0 | 1 | 7 | 438 | 390,000, 680,000 |
| 15 | `region:benalia` | `benalia` | 17 | 6 | 0 | 13,957 | 20,432 | 39,519 | 4 | 4 / 0 / 0 / 0 | 1 | 2 | 23 | 180,000, 120,000 |
| 16 | `region:shiv` | `shiv` | 15 | 4 | 0 | 13,110 | 23,223 | 42,868 | 6 | 5 / 0 / 1 / 0 | 1 | 2 | 38 | 510,000, 580,000 |
| 17 | `region:llanowar` | `llanowar` | 21 | 6 | 0 | 15,512 | 27,476 | 47,972 | 6 | 4 / 0 / 1 / 1 | 1 | 2 | 47 | 670,000, 330,000 |
| 18 | `region:yavimaya` | `yavimaya` | 21 | 6 | 0 | 15,512 | 27,476 | 47,972 | 6 | 3 / 0 / 2 / 1 | 1 | 2 | 49 | 900,000, 210,000 |
| 19 | `region:terisiare` | `terisiare` | 28 | 8 | 0 | 17,912 | 26,224 | 46,469 | 4 | 2 / 0 / 2 / 0 | 1 | 2 | 43 | 750,000, 180,000 |
| 20 | `region:sarpadia` | `sarpadia` | 4 | 1 | 0 | 9,000 | 9,900 | 26,880 | 1 | 0 / 0 / 1 / 0 | 1 | 1 | 5 | 750,000, -540,000 |
| 21 | `region:tolaria` | `tolaria` | 15 | 4 | 0 | 13,110 | 21,112 | 40,335 | 5 | 5 / 0 / 0 / 0 | 1 | 2 | 34 | 180,000, -370,000 |
| 22 | `region:jamuraa` | `jamuraa` | 4 | 1 | 0 | 9,000 | 10,890 | 28,068 | 2 | 2 / 0 / 0 / 0 | 1 | 1 | 4 | -100,000, -310,000 |
| 23 | `region:urborg` | `urborg` | 13 | 4 | 0 | 12,205 | 19,653 | 38,584 | 5 | 5 / 0 / 0 / 0 | 1 | 1 | 19 | -470,000, -120,000 |
| 24 | `region:otaria` | `otaria` | 8 | 2 | 0 | 9,574 | 14,016 | 31,820 | 4 | 4 / 0 / 0 / 0 | 1 | 1 | 11 | -10,000, 370,000 |
| 25 | `region:keld` | `keld` | 19 | 5 | 0 | 14,755 | 26,137 | 46,365 | 6 | 4 / 0 / 1 / 1 | 5 | 2 | 41 | 210,000, 680,000 |

## Site widenings in order

| # | Pass | Site | Cause | What was found | New r_s (mm) |
|---|---|---|---|---|---|
| 1 | 4 | `era:first-ages` | capacity | capacity 240 for 288 | 63,191 |
| 2 | 4 | `era:brothers-war` | capacity | capacity 317 for 366 | 71,237 |
| 3 | 4 | `era:the-dark` | capacity | capacity 92 for 119 | 40,619 |
| 4 | 4 | `era:fallen-empires` | capacity | capacity 68 for 102 | 37,606 |
| 5 | 4 | `era:fallen-empires` | capacity | capacity 90 for 102 | 41,366 |
| 6 | 4 | `era:fallen-empires` | capacity | capacity 99 for 102 | 45,502 |
| 7 | 4 | `era:ice-age` | capacity | capacity 587 for 635 | 93,832 |
| 8 | 5 | `era:urzas-academy` | capacity | capacity 517 for 565 | 88,509 |
| 9 | 5 | `era:legends` | capacity | capacity 254 for 304 | 64,923 |
| 10 | 5 | `era:caliman` | capacity | capacity 80 for 112 | 39,406 |
| 11 | 5 | `era:caliman` | capacity | capacity 97 for 112 | 43,346 |
| 12 | 5 | `era:jamuraa-wars` | capacity | capacity 545 for 615 | 92,342 |
| 13 | 5 | `era:invasion` | capacity | capacity 650 for 716 | 99,638 |
| 14 | 5 | `era:mirari` | capacity | capacity 556 for 604 | 91,513 |
| 15 | 5 | `era:karona` | capacity | capacity 544 for 606 | 91,665 |
| 16 | 5 | `era:time-rifts` | capacity | capacity 519 for 600 | 91,209 |
| 17 | 5 | `era:renewal` | capacity | capacity 185 for 209 | 53,831 |
| 18 | 5 | `era:second-invasion` | capacity | capacity 233 for 265 | 60,616 |
| 19 | 5 | `region:benalia` | capacity | capacity 10 for 17 | 15,352 |
| 20 | 5 | `region:benalia` | capacity | capacity 10 for 17 | 16,887 |
| 21 | 5 | `region:benalia` | capacity | capacity 16 for 17 | 18,575 |
| 22 | 5 | `region:benalia` | capacity | capacity 15 for 17 | 20,432 |
| 23 | 5 | `region:shiv` | capacity | capacity 5 for 15 | 14,421 |
| 24 | 5 | `region:shiv` | capacity | capacity 10 for 15 | 15,863 |
| 25 | 5 | `region:shiv` | capacity | capacity 10 for 15 | 17,449 |
| 26 | 5 | `region:shiv` | capacity | capacity 10 for 15 | 19,193 |
| 27 | 5 | `region:llanowar` | capacity | capacity 6 for 21 | 17,063 |
| 28 | 5 | `region:llanowar` | capacity | capacity 6 for 21 | 18,769 |
| 29 | 5 | `region:llanowar` | capacity | capacity 11 for 21 | 20,645 |
| 30 | 5 | `region:llanowar` | capacity | capacity 9 for 21 | 22,709 |
| 31 | 5 | `region:yavimaya` | capacity | capacity 12 for 21 | 17,063 |
| 32 | 5 | `region:yavimaya` | capacity | capacity 13 for 21 | 18,769 |
| 33 | 5 | `region:yavimaya` | capacity | capacity 13 for 21 | 20,645 |
| 34 | 5 | `region:terisiare` | capacity | capacity 8 for 28 | 19,703 |
| 35 | 5 | `region:terisiare` | capacity | capacity 8 for 28 | 21,673 |
| 36 | 5 | `region:tolaria` | capacity | capacity 6 for 15 | 14,421 |
| 37 | 5 | `region:tolaria` | capacity | capacity 5 for 15 | 15,863 |
| 38 | 5 | `region:tolaria` | capacity | capacity 6 for 15 | 17,449 |
| 39 | 5 | `region:tolaria` | capacity | capacity 7 for 15 | 19,193 |
| 40 | 5 | `region:tolaria` | capacity | capacity 9 for 15 | 21,112 |
| 41 | 5 | `region:jamuraa` | capacity | capacity 0 for 4 | 9,900 |
| 42 | 5 | `region:jamuraa` | capacity | capacity 0 for 4 | 10,890 |
| 43 | 5 | `region:urborg` | capacity | capacity 4 for 13 | 13,425 |
| 44 | 5 | `region:urborg` | capacity | capacity 4 for 13 | 14,767 |
| 45 | 5 | `region:urborg` | capacity | capacity 8 for 13 | 16,243 |
| 46 | 5 | `region:urborg` | capacity | capacity 8 for 13 | 17,867 |
| 47 | 5 | `region:urborg` | capacity | capacity 8 for 13 | 19,653 |
| 48 | 5 | `region:otaria` | capacity | capacity 0 for 8 | 10,531 |
| 49 | 5 | `region:otaria` | capacity | capacity 0 for 8 | 11,584 |
| 50 | 5 | `region:otaria` | capacity | capacity 0 for 8 | 12,742 |
| 51 | 5 | `region:otaria` | capacity | capacity 7 for 8 | 14,016 |
| 52 | 5 | `region:keld` | capacity | capacity 6 for 19 | 16,230 |
| 53 | 5 | `region:keld` | capacity | capacity 10 for 19 | 17,853 |
| 54 | 5 | `region:keld` | capacity | capacity 16 for 19 | 19,638 |
| 55 | 5 | `region:keld` | capacity | capacity 16 for 19 | 21,601 |
| 56 | 5 | `era:first-ages` | the kept slots ran out | exhausted at 211 of 288 stands, the kept slots ran out | 69,510 |
| 57 | 5 | `era:first-ages` | the kept slots ran out | exhausted at 265 of 288 stands, the kept slots ran out | 76,461 |
| 58 | 5 | `era:brothers-war` | the kept slots ran out | exhausted at 271 of 366 stands, the kept slots ran out | 78,360 |
| 59 | 5 | `era:brothers-war` | the kept slots ran out | exhausted at 342 of 366 stands, the kept slots ran out | 86,196 |
| 60 | 5 | `era:the-dark` | the kept slots ran out | exhausted at 77 of 119 stands, the kept slots ran out | 44,680 |
| 61 | 5 | `era:the-dark` | the kept slots ran out | exhausted at 111 of 119 stands, the kept slots ran out | 49,148 |
| 62 | 5 | `era:the-dark` | two void slots in a row | exhausted at 74 of 119 stands, two void slots in a row cut the path at slot 24 | 54,062 |
| 63 | 5 | `era:fallen-empires` | two void slots in a row | exhausted at 14 of 102 stands, two void slots in a row cut the path at slot 7 | 50,052 |
| 64 | 5 | `era:ice-age` | two void slots in a row | exhausted at 515 of 635 stands, two void slots in a row cut the path at slot 148 | 103,215 |
| 65 | 5 | `era:ice-age` | the kept slots ran out | exhausted at 627 of 635 stands, the kept slots ran out | 113,536 |
| 66 | 6 | `era:ice-age` | capacity | capacity -2 for 635 | 124,889 |
| 67 | 6 | `era:first-ages` | two void slots in a row | exhausted at 284 of 288 stands, two void slots in a row cut the path at slot 88 | 84,107 |
| 68 | 6 | `era:ice-age` | two void slots in a row | exhausted at 528 of 635 stands, two void slots in a row cut the path at slot 148 | 137,377 |
| 69 | 6 | `era:ice-age` | two void slots in a row | exhausted at 0 of 635 stands, two void slots in a row cut the path at slot 2 | 151,114 |
| 70 | 7 | `era:brothers-war` | two void slots in a row | exhausted at 42 of 366 stands, two void slots in a row cut the path at slot 13 | 94,815 |
| 71 | 8 | `era:ice-age` | two void slots in a row | exhausted at 473 of 635 stands, two void slots in a row cut the path at slot 134 | 166,225 |
| 72 | 8 | `era:urzas-academy` | two void slots in a row | exhausted at 430 of 565 stands, two void slots in a row cut the path at slot 123 | 97,359 |
| 73 | 8 | `era:urzas-academy` | the kept slots ran out | exhausted at 553 of 565 stands, the kept slots ran out | 107,094 |
| 74 | 8 | `era:legends` | two void slots in a row | exhausted at 195 of 304 stands, two void slots in a row cut the path at slot 62 | 71,415 |
| 75 | 8 | `era:legends` | the kept slots ran out | exhausted at 277 of 304 stands, the kept slots ran out | 78,556 |
| 76 | 8 | `era:caliman` | two void slots in a row | exhausted at 46 of 112 stands, two void slots in a row cut the path at slot 16 | 47,680 |
| 77 | 8 | `era:jamuraa-wars` | the kept slots ran out | exhausted at 477 of 615 stands, the kept slots ran out | 101,576 |
| 78 | 8 | `era:jamuraa-wars` | two void slots in a row | exhausted at 483 of 615 stands, two void slots in a row cut the path at slot 142 | 111,733 |
| 79 | 8 | `era:jamuraa-wars` | two void slots in a row | exhausted at 476 of 615 stands, two void slots in a row cut the path at slot 143 | 122,906 |
| 80 | 8 | `era:invasion` | two void slots in a row | exhausted at 81 of 716 stands, two void slots in a row cut the path at slot 25 | 109,601 |
| 81 | 8 | `era:mirari` | the kept slots ran out | exhausted at 488 of 604 stands, the kept slots ran out | 100,664 |
| 82 | 8 | `era:mirari` | the kept slots ran out | exhausted at 590 of 604 stands, the kept slots ran out | 110,730 |
| 83 | 8 | `era:karona` | the kept slots ran out | exhausted at 505 of 606 stands, the kept slots ran out | 100,831 |
| 84 | 8 | `era:karona` | the kept slots ran out | exhausted at 604 of 606 stands, the kept slots ran out | 110,914 |
| 85 | 8 | `era:time-rifts` | two void slots in a row | exhausted at 0 of 600 stands, two void slots in a row cut the path at slot 2 | 100,329 |
| 86 | 8 | `era:time-rifts` | the kept slots ran out | exhausted at 595 of 600 stands, the kept slots ran out | 110,361 |
| 87 | 8 | `era:renewal` | two void slots in a row | exhausted at 0 of 209 stands, two void slots in a row cut the path at slot 2 | 59,214 |
| 88 | 8 | `era:renewal` | two void slots in a row | exhausted at 87 of 209 stands, two void slots in a row cut the path at slot 26 | 65,135 |
| 89 | 8 | `era:second-invasion` | the kept slots ran out | exhausted at 190 of 265 stands, the kept slots ran out | 66,677 |
| 90 | 8 | `era:second-invasion` | the kept slots ran out | exhausted at 241 of 265 stands, the kept slots ran out | 73,344 |
| 91 | 8 | `region:shiv` | the kept slots ran out | exhausted at 13 of 15 stands, the kept slots ran out | 21,112 |
| 92 | 8 | `region:shiv` | capacity | capacity 10 for 15 | 23,223 |
| 93 | 8 | `region:llanowar` | the kept slots ran out | exhausted at 16 of 21 stands, the kept slots ran out | 24,979 |
| 94 | 8 | `region:llanowar` | two void slots in a row | exhausted at 11 of 21 stands, two void slots in a row cut the path at slot 5 | 27,476 |
| 95 | 8 | `region:yavimaya` | the kept slots ran out | exhausted at 14 of 21 stands, the kept slots ran out | 22,709 |
| 96 | 8 | `region:yavimaya` | the kept slots ran out | exhausted at 18 of 21 stands, the kept slots ran out | 24,979 |
| 97 | 8 | `region:yavimaya` | two void slots in a row | exhausted at 12 of 21 stands, two void slots in a row cut the path at slot 5 | 27,476 |
| 98 | 8 | `region:terisiare` | the kept slots ran out | exhausted at 20 of 28 stands, the kept slots ran out | 23,840 |
| 99 | 8 | `region:terisiare` | the kept slots ran out | exhausted at 21 of 28 stands, the kept slots ran out | 26,224 |
| 100 | 8 | `region:sarpadia` | the kept slots ran out | exhausted at 3 of 4 stands, the kept slots ran out | 9,900 |
| 101 | 8 | `region:keld` | the kept slots ran out | exhausted at 18 of 19 stands, the kept slots ran out | 23,761 |
| 102 | 8 | `region:keld` | two void slots in a row | exhausted at 15 of 19 stands, two void slots in a row cut the path at slot 6 | 26,137 |

## Sweep-direction tries (5.4.8)

| Site | The try that passes | Why each earlier try fails, in try order |
|---|---|---|
| `era:mirari` | 2 | the attachment square lies within 5 m of the blob |
| `era:karona` | 2 | the attachment square lies within 5 m of the blob |
| `era:renewal` | 2 | the attachment square lies within 5 m of the blob |
| `region:keld` | 5 | the stone test fails; the stone test fails; the attachment square lies within 5 m of the blob; the attachment square lies within 5 m of the blob |

## Site paths and gaps (mm)

| Site | Path as built | Cut at capacity | Path after the cut | Path after the trim | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end |
|---|---|---|---|---|---|---|---|
| `era:first-ages` | 1,016,717 | none | 1,016,717 | 751,577 | 9,000 | 18,000 | 4,577 |
| `era:brothers-war` | 1,358,516 | none | 1,358,516 | 913,725 | 9,000 | 18,000 | 4,725 |
| `era:the-dark` | 410,154 | none | 410,154 | 328,862 | 9,000 | 18,000 | 4,862 |
| `era:fallen-empires` | 340,508 | none | 340,508 | 310,869 | 9,000 | 18,000 | 4,869 |
| `era:ice-age` | 4,263,837 | 4,257,000 | 4,257,211 | 1,579,886 | 9,000 | 18,000 | 4,886 |
| `era:urzas-academy` | 1,786,454 | none | 1,786,454 | 1,462,862 | 9,000 | 18,000 | 4,862 |
| `era:legends` | 926,061 | none | 926,061 | 842,046 | 9,000 | 18,000 | 5,046 |
| `era:caliman` | 306,607 | none | 306,607 | 293,840 | 9,000 | 18,000 | 5,840 |
| `era:jamuraa-wars` | 2,266,194 | none | 2,266,194 | 1,561,820 | 9,000 | 18,000 | 4,820 |
| `era:invasion` | 1,795,382 | none | 1,795,382 | 1,787,012 | 9,000 | 18,000 | 5,012 |
| `era:mirari` | 1,861,732 | none | 1,861,732 | 1,490,906 | 9,000 | 18,000 | 5,906 |
| `era:karona` | 1,849,807 | none | 1,849,807 | 1,490,045 | 9,000 | 18,000 | 5,045 |
| `era:time-rifts` | 1,820,169 | none | 1,820,169 | 1,444,646 | 9,000 | 18,000 | 4,646 |
| `era:renewal` | 627,064 | none | 627,064 | 580,930 | 9,000 | 18,000 | 4,930 |
| `era:second-invasion` | 844,116 | none | 844,116 | 754,057 | 9,000 | 18,000 | 7,057 |
| `region:benalia` | 68,713 | none | 68,713 | 67,840 | 9,000 | 18,000 | 4,840 |
| `region:shiv` | 69,133 | none | 69,133 | 51,990 | 9,000 | 18,000 | 6,990 |
| `region:llanowar` | 95,220 | none | 95,220 | 77,538 | 9,000 | 18,000 | 5,538 |
| `region:yavimaya` | 92,375 | none | 92,375 | 76,941 | 9,000 | 18,000 | 4,941 |
| `region:terisiare` | 90,155 | none | 90,155 | 85,550 | 9,000 | 18,000 | 4,550 |
| `region:sarpadia` | 14,599 | none | 14,599 | 13,810 | 9,000 | 0 | 4,810 |
| `region:tolaria` | 67,418 | none | 67,418 | 50,498 | 9,000 | 18,000 | 5,498 |
| `region:jamuraa` | 16,265 | none | 16,265 | 14,208 | 9,000 | 0 | 5,208 |
| `region:urborg` | 37,938 | none | 37,938 | 37,938 | 9,000 | 9,000 | 1,938 |
| `region:otaria` | 24,305 | none | 24,305 | 22,978 | 9,000 | 9,000 | 4,978 |
| `region:keld` | 94,702 | none | 94,702 | 50,911 | 9,000 | 9,000 | 5,911 |

The bounds of 5.4.10 are 18,000 mm, 18,000 mm and 10,000 mm.

## Slots on the final layout (on runs / on half-turns)

| Site | Kept at capacity | Void: the disc is not inside the blob | Void: under 3 candidates | Withdrawn at placement | Occupied |
|---|---|---|---|---|---|
| `era:first-ages` | 88 / 24 | 0 / 0 | 0 / 0 | 1 / 6 | 66 / 10 |
| `era:brothers-war` | 118 / 30 | 2 / 0 | 0 / 0 | 0 / 5 | 81 / 13 |
| `era:the-dark` | 31 / 13 | 1 / 0 | 0 / 0 | 1 / 5 | 25 / 5 |
| `era:fallen-empires` | 26 / 10 | 1 / 0 | 0 / 0 | 1 / 4 | 22 / 6 |
| `era:ice-age` | 410 / 58 | 5 / 0 | 0 / 0 | 1 / 9 | 149 / 15 |
| `era:urzas-academy` | 158 / 34 | 6 / 0 | 0 / 0 | 2 / 7 | 131 / 19 |
| `era:legends` | 79 / 20 | 3 / 0 | 0 / 0 | 1 / 9 | 70 / 11 |
| `era:caliman` | 22 / 11 | 1 / 0 | 0 / 0 | 0 / 3 | 21 / 8 |
| `era:jamuraa-wars` | 201 / 44 | 6 / 0 | 0 / 0 | 0 / 11 | 141 / 18 |
| `era:invasion` | 163 / 34 | 2 / 0 | 0 / 0 | 1 / 11 | 162 / 23 |
| `era:mirari` | 170 / 36 | 0 / 0 | 0 / 0 | 2 / 9 | 135 / 19 |
| `era:karona` | 166 / 37 | 2 / 0 | 0 / 0 | 2 / 9 | 135 / 18 |
| `era:time-rifts` | 163 / 35 | 4 / 0 | 0 / 0 | 1 / 6 | 131 / 21 |
| `era:renewal` | 48 / 19 | 2 / 0 | 0 / 0 | 0 / 6 | 43 / 13 |
| `era:second-invasion` | 69 / 20 | 4 / 0 | 0 / 0 | 1 / 6 | 63 / 10 |
| `region:benalia` | 2 / 4 | 1 / 0 | 0 / 0 | 0 / 0 | 2 / 4 |
| `region:shiv` | 3 / 4 | 0 / 0 | 0 / 0 | 0 / 1 | 2 / 2 |
| `region:llanowar` | 5 / 4 | 1 / 0 | 0 / 0 | 0 / 2 | 4 / 2 |
| `region:yavimaya` | 6 / 3 | 1 / 0 | 0 / 0 | 0 / 2 | 5 / 1 |
| `region:terisiare` | 5 / 4 | 1 / 0 | 0 / 0 | 0 / 1 | 5 / 3 |
| `region:sarpadia` | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |
| `region:tolaria` | 3 / 4 | 0 / 0 | 0 / 0 | 0 / 1 | 2 / 2 |
| `region:jamuraa` | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 1 / 0 |
| `region:urborg` | 4 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 4 / 0 |
| `region:otaria` | 2 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 2 / 0 |
| `region:keld` | 6 / 3 | 1 / 0 | 0 / 0 | 0 / 0 | 4 / 1 |

## Clusters by size

| Stands in the cluster | Clusters |
|---|---|
| 1 | 5 |
| 2 | 6 |
| 3 | 534 |
| 4 | 786 |
| 5 | 292 |
| 6 | 8 |

## The path vertex of each stand (ruling 2, V)

3,090 of 6,271 stands face a vertex other than the nearest vertex of their window. The largest turn from the nearest vertex is 98,982,000 micro-degrees. The largest arc length between the two vertices is 11,833 mm.

| Rank of the path vertex in the window (0 is the nearest) | Stands |
|---|---|
| 0 | 3181 |
| 1 | 403 |
| 2 | 312 |
| 3 | 312 |
| 4 | 258 |
| 5 | 229 |
| 6 | 197 |
| 7 | 192 |
| 8 | 177 |
| 9 | 178 |
| 10 | 167 |
| 11 | 126 |
| 12 | 103 |
| 13 | 101 |
| 14 | 74 |
| 15 | 60 |
| 16 | 68 |
| 17 | 40 |
| 18 | 38 |
| 19 | 21 |
| 20 | 13 |
| 21 | 15 |
| 22 | 6 |

## The trail

| Leg | Kind | From | To | Length (mm) | Cells routed | Start cell blocked |
|---|---|---|---|---|---|---|
| 0 | trail | plaza | `era:first-ages` | 655,414 | 96 | no |
| 1 | trail | era:first-ages | `era:brothers-war` | 483,729 | 86 | no |
| 2 | trail | era:brothers-war | `era:the-dark` | 354,152 | 65 | no |
| 3 | trail | era:the-dark | `era:fallen-empires` | 891,118 | 155 | no |
| 4 | trail | era:fallen-empires | `era:ice-age` | 639,338 | 107 | no |
| 5 | trail | era:ice-age | `era:urzas-academy` | 910,817 | 164 | no |
| 6 | trail | era:urzas-academy | `era:legends` | 507,684 | 83 | no |
| 7 | trail | era:legends | `era:caliman` | 355,313 | 68 | no |
| 8 | trail | era:caliman | `era:jamuraa-wars` | 319,588 | 50 | no |
| 9 | trail | era:jamuraa-wars | `era:invasion` | 672,078 | 112 | no |
| 10 | trail | era:invasion | `era:mirari` | 637,460 | 98 | no |
| 11 | trail | era:mirari | `era:karona` | 340,873 | 60 | no |
| 12 | trail | era:karona | `era:time-rifts` | 642,723 | 102 | no |
| 13 | trail | era:time-rifts | `era:renewal` | 445,738 | 85 | no |
| 14 | trail | era:renewal | `era:second-invasion` | 549,838 | 85 | no |
| 15 | spur | trail | `region:benalia` | 64,872 | 11 | no |
| 16 | spur | trail | `region:shiv` | 129,371 | 22 | no |
| 17 | spur | trail | `region:llanowar` | 145,798 | 28 | no |
| 18 | spur | trail | `region:yavimaya` | 284,234 | 49 | no |
| 19 | spur | trail | `region:terisiare` | 3,315 | 1 | no |
| 20 | spur | trail | `region:sarpadia` | 19,439 | 4 | no |
| 21 | spur | trail | `region:tolaria` | 214,285 | 30 | no |
| 22 | spur | trail | `region:jamuraa` | 231,815 | 40 | no |
| 23 | spur | trail | `region:urborg` | 77,873 | 14 | no |
| 24 | spur | trail | `region:otaria` | 133,141 | 26 | no |
| 25 | spur | trail | `region:keld` | 156,078 | 27 | no |

- The trail's legs: 8,405,863 mm. The spurs: 1,460,221 mm.
- From the plaza's edge path to the last site's pad on the trail: 8,425,863 mm (the plaza approach, 10,000 mm; the legs; the last approach, 10,000 mm). No site path is counted.
- At `AvatarController.WalkSpeed` (3,000 mm/s): 46 min 49 s. At `AvatarController.RunSpeed` (6,000 mm/s): 23 min 24 s.

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

- Result: pass. Violations: 0. Path network connected: yes. Least distance between two stands: 2,559 mm.

| Assertion | Tested |
|---|---|
| approach-length | 26 |
| apron-apron | 2 |
| apron-corridor | 4,121 |
| apron-pad | 0 |
| apron-path | 874 |
| apron-plaza | 0 |
| apron-stone | 0 |
| apron-volume | 0 |
| card-set | 6,271 |
| card-site | 6,271 |
| card-stand | 12,542 |
| chapter-first | 37 |
| chapter-list | 6,191 |
| chapter-order | 1,569 |
| chapter-stone | 37 |
| cluster-arcs | 1,605 |
| cluster-count | 1,631 |
| cluster-size | 1,631 |
| corridor-end | 6,271 |
| corridor-plaza | 0 |
| corridor-stone | 12 |
| corridor-volume | 0 |
| corridor-window | 6,271 |
| footprint-apron | 0 |
| footprint-blob | 6,271 |
| footprint-cluster | 6,271 |
| footprint-corridor | 3,263 |
| footprint-footprint | 0 |
| footprint-pad | 0 |
| footprint-path | 3 |
| footprint-plaza | 0 |
| footprint-stone | 0 |
| footprint-volume | 0 |
| gap-between | 1,605 |
| gap-end | 26 |
| gap-first | 26 |
| header | 1 |
| leg-attachment | 52 |
| pad-head | 26 |
| pad-list | 27 |
| pad-pad | 0 |
| pad-plaza | 1 |
| pad-volume | 0 |
| plaza-approach | 1 |
| plaza-figures | 1 |
| record-class | 6,271 |
| record-cluster | 6,271 |
| record-count | 1 |
| record-order | 6,270 |
| record-site | 6,271 |
| record-vertex | 6,271 |
| record-yaw | 6,271 |
| site-bounds | 27,277 |
| site-list | 63 |
| site-reached | 26 |
| site-region | 26 |
| spur | 11 |
| stand-count | 1 |
| stand-region | 6,271 |
| stand-spacing | 1,176 |
| stone-pad | 0 |
| stone-path | 19 |
| stone-plaza | 0 |
| stone-stone | 0 |
| stone-volume | 0 |
| trail-leg | 15 |
| volume-arrival | 1 |
| volume-path | 0 |
| volume-site | 1 |
| world-format | 1 |
