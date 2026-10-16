# Forest kit: asset credits

Every binary asset of the `forest` kit (PRD v4 5.6, 8.12), one row each. All are CC0 1.0.
`sources.yaml` carries the same rows with each file's download URL and SHA-256.

The binaries are committed in this folder through Git LFS. `./fetch.sh` verifies each against
`sources.yaml` and downloads a missing file from its source. The `fetch.sh` run fails if a row here
differs from its `sources.yaml` entry or if an asset folder holds a file without one, Unity's
`.meta` files aside (PRD 8.12.2: an asset without a row blocks the merge). Whatever is made from
these files lives beside `Audio/`, not inside it.

The kit is at `standard: basic` (PRD v4 8.12.6). It holds only the loops of its ambient family
(`forest`, PRD v4 5.12.1, Appendix C) so far: the second slice dresses Dominaria with the
temperate kit alone (PRD v4 9.6), and the woods of Llanowar, Yavimaya, Sarpadia and Otaria take this kit's sound (PRD v4 8.12.5; DEC-1005).

## Audio (Ogg Vorbis)

| File | Source | Author | Licence | Fetched | Intended use |
|---|---|---|---|---|---|
| `Audio/forest_woodland_loop.ogg` | <https://freesound.org/people/ecfike/sounds/160893/> | ecfike | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-10-16 | Ambient bed, `forest` (PRD 5.12.1); stereo, 59.1 s, its author's seamless loop |

## Notes

- **Audio files are Freesound's high-quality Ogg previews** of the CC0 sounds: the uploads need a
  Freesound login to download. A loop whose recording does not end where it begins is played into
  itself with a crossfade of three seconds (`WorldSound`), so no file is cut or made again here.
- **Cooked size.** 1.1 MB on 2026-10-16 (DEC-1005, at `000732c`): its loop, as the build's
  `Build: cooked by owner` counts it, in megabytes of 1,048,576 bytes. That is about 1.15 million bytes;
  the build's figure has one decimal.
