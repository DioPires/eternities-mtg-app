# DEC-950 — Project overhaul: planeswalker visits worlds

**Author:** CEO. **Date:** 2026-10-10. **Status:** revision 7. Sections 1–10 are the first-pass deep dive; §11 records the owner's round-1 decisions; §12 records the round-2 decisions, the Codex review gate the board added, the PRD v4 draft, the Codex triage of all four passes (§12.5, §12.6, §12.8, §12.9) and the statements in §§1–11 that `prd_v4.md` supersedes (§12.7). **The Codex gate is passed: the fourth pass read GO WITH CHANGES and both changes are applied in `prd_v4.md` draft 5.** Where this plan and `prd_v4.md` draft 5 disagree, the PRD wins. Nothing is built.
**Basis:** `prd_v3.md`, `docs/decisions/w23-concept-and-stack.md`, `REVIEW-2026-09-08.md` §3–§4, production dataset `a5846bec28d1447e` (88 planes, 28,603 cards, 72,811 printings, 57 planes with zero cards), and the Wizards Fan Content Policy (fetched 2026-10-10).

---

## 1. Verdict in one paragraph

Yes, I like it, and I think it is the right next step rather than a restart. The idea is the natural
continuation of concept B (worlds), which we chose on 2026-09-14: planes are already globes tiled
with their cards' art, the camera already tethers to a surface point, and a card already lifts off
the surface with its printings around it. What the overhaul adds is a **body on the surface**
(you walk instead of orbit), a **place** (terrain, sky, light, sound), a **threshold** (the portal),
and a **frame** (the planeswalker you travel as). Each of those is additive to what exists.
I have three reservations, and they shape the whole recommendation: the Fan Content Policy forbids
Wizards' IP in "games", so the product must stay an explorable gallery and never become a game;
88 planes cannot be hand-built by one owner, so environments must be generated from data plus a
small curated theme table; and the stack should stay three.js on the web, with Blender only as a
tool for a handful of props. Section 8 proposes a one-week vertical slice on Dominaria before any
further commitment, which is how we decided concept B and it worked.

---

## 2. What the idea changes, and what it keeps

| Today (worlds, shipped) | Overhaul | Keep / change |
|---|---|---|
| Camera orbits a globe; dolly in; tether to the surface | Player stands on the surface and walks; can still lift off to orbit | Change: new camera mode. Keep: the rig, the tether, the globes |
| Multiverse level: all worlds in one space; the Blind Eternities as a belt | The Blind Eternities becomes the hub: a dark lobby of portals, one per plane | Change: hub presentation. Keep: the data, the belt as the dust |
| Fly-to between focus targets | Portal transition in and out of a plane | Change: the transition hides the load |
| Card level: card lifts off; printings as a flat ring | Card view: card in front of you, the plane behind; printings in a side panel you click through | Change: layout. Keep: the data, the deep link, the full-card display |
| Search, filters, index, URLs | Same, plus "travel to card" that opens a portal to the card's spot | Keep |
| No sound (PRD non-goal 2) | Ambient sound and music per plane | New |
| No avatar | A chosen planeswalker | New |
| Picture is the data | Picture is still the data, plus a per-plane theme table | Keep, with one curated input added |

The PRD's six goals survive intact: one continuous multiverse, mesmerising by default, the picture
is the data, findable and shareable, maintainable by one person, free and static. Non-goal 2 (sound)
is reversed. Nothing else in the PRD has to move.

---

## 3. The hard constraint: this must not become a game

The Fan Content Policy (company.wizards.com, last updated 2017-11-15) says, under "Don't hurt
Wizards":

> Don't use Wizards' IP in other games. This includes your own or other people's games or game
> components (e.g., rule books, tokens, figures), regardless of whether it is distributed for free.

And in the FAQ: "You cannot incorporate Wizards patents, game mechanics, logos, or trademarks into
your Fan Content without our prior written permission."

A browsable 3D gallery of card images is fan content. A walkable 3D world is still a gallery as long
as it has **no objectives, no score, no combat, no inventory, no progression, no winning state, no
rules**. The moment a player "collects", "unlocks", "levels up" or "beats" something, the product
reads as a game and the policy's clear text applies. This is the line that decides the design, so
I propose we write it into the PRD as a goal, not as a footnote:

**Rule: Eternities is a place you visit, not a game you play.** Every feature must pass the test
"would this still make sense in a museum?" Walking, looking, reading, travelling, listening and
choosing a lens all pass. Points, quests, timers, rewards, enemies and achievements all fail.

Two consequences for the proposal as written:

1. **"Playable characters" is the riskiest phrase.** A character-select screen with Teferi, Jace
   and Chandra as controllable third-person avatars is the single most game-like surface we could
   build. Section 5 proposes a planeswalker *frame* instead: first-person, no body on screen, the
   planeswalker is the spark you borrow and it changes where you start, what the world points out
   to you, and the voice of the interface. Same emotional idea, museum-safe.
2. **A "journal" of cards you have seen is fine if it is a bookmark list and lives in the browser.**
   It becomes a collection mechanic the moment it has completion percentages or rewards. I would
   ship it as "recently visited", nothing more.

The other two compliance rules already in force still apply: Scryfall images are shown flat,
undistorted, not colour-shifted; art crops shown without the full card carry the artist name in the
same interface. Neither forbids using card art as **exhibits** in a world. Both forbid projecting
it onto terrain or tinting it with scene lighting. The rule of thumb in section 4: the world can be
lit; the cards are unlit, flat, and sharp.

Wizards' own music and video are forbidden by the policy outright, so section 6's audio is ours or
public-domain, never theirs.

---

## 4. The world: what you stand on, and what is scattered on it

### 4.1 Keep the globes, put the player on the surface

Concept B's globes are the right ground for walking, and better than a flat field.

- **Scale is honest and already derived from data.** Radius ∝ √N, so every card owns a cell of the
  same size. Dominaria is about 45 cells across; Rabiah about 10. At a walking pace of 3 m/s and a
  cell pitch of about 1.2 m, Dominaria's equator is about a minute's walk; Rabiah's is ten seconds.
  A small plane is a small moon you can circle in a breath, which is exactly what a 75-card plane
  deserves. A giant plane feels like a continent. A flat field of 6,266 cards would be a 100 m ×
  100 m car park and would feel like one.
- **The horizon curves away.** On a 25 m globe the horizon is a few steps ahead, so the world keeps
  revealing itself as you walk, which is the mesmerising-by-default goal doing real work. This is
  the Super Mario Galaxy look, and it is distinctive.
- **Gravity is a direction, not a physics engine.** The player is a kinematic capsule whose "down"
  is the vector to the globe's centre. No physics library. About 300 lines of TypeScript.
- **Nothing in the data contract changes.** `stars.bin` already carries a unit-sphere point per card
  for concept B. That point is where the card stands.

The 57 empty planes stay as dark moons. A portal to one lands you on a small unlit sphere with a
sign that reads the plane's name and "no cards first printed here". That is honest, and it is
faithful to invariant 3.3.2 (every plane exists).

Flat terrain is the alternative, and I list it as an option in the question set because walking on
a globe might read as a toy to some eyes. The vertical slice (section 8) is where we find out.

### 4.2 The card is the exhibit

Each card stands on its cell as a **flat, upright panel facing outward**, about 0.6 m tall, on a
short plinth or stone. Up close it shows the `small` image; from far it is the swatch the pipeline
already bakes (`swatches.bin`). Nothing about the art changes with the lighting; the panel is unlit
(this is both the compliance rule and the look of a lit gallery with glass over the pictures). The
existing art stream, LOD, cell selection and pool (`scene/worlds/*`) are the same code with a
different camera.

What the layout means on the ground:

- **Latitude = colour.** Walking north to south crosses white, blue, black, red, green bands, with
  gold (multicolour) as the equatorial belt and colourless as the poles. These become
  **districts**: the white highlands, the blue coast, the black marsh, the red badlands, the green
  forest, the gold city at the equator, the ice caps. The biome dressing in 4.3 follows the band, so
  the terrain under your feet tells you what colour of cards you are among.
- **Longitude = time.** Walking east crosses the plane's sets in release order. A cheap and lovely
  touch: tie the sun to longitude, so the oldest set is at dawn and the newest at dusk. The whole
  globe has one fixed sun and the player's local time of day is where they are in the plane's
  history. This costs nothing and makes the data law visible.

### 4.3 Environments: generated from data, steered by a theme table

Hand-building 88 worlds is out of reach for one owner, and 57 of them have no cards. The PRD's
answer to every content question has been "derive it, and curate a small table". Do the same here:

**Appendix C — plane theme table.** One row per plane, about ten fields, curated like Appendices A
and B:

| Field | Example (Dominaria) | Example (Innistrad) | Example (Kaladesh) |
|---|---|---|---|
| biome kit | temperate | moor | filigree-city |
| sky | day, cumulus | overcast, low moon | clear, warm haze |
| palette (3 colours) | green, ochre, slate | grey-green, black, bone | copper, teal, cream |
| light | sun 35°, warm | moon 20°, cold | sun 60°, golden |
| weather | none | fog | none |
| ambient sound family | meadow | wind, crows | workshop, filigree chimes |
| music mood | heroic | gothic | bright |
| hero prop | standing stones | gallows, lanterns | aether spires |

**Biome kits.** About ten procedural kits cover the roster: temperate, forest, desert, coast,
mountain, marsh, moor, city, metal (New Phyrexia, Mirrodin), void (empty planes). A kit is a ground
shader (noise-based, tinted by the palette and by the colour band under the player), a sky
(procedural gradient, stars, one cloud layer), a fog colour, a lighting rig, and three to six
scattered prop types. Props are the only hand-made art: low-poly glTF models, each under 200 KB,
made in Blender or bought as CC0. A kit is 1–2 MB and loads when you enter the plane.

**Basic lands are the best reference art we have, and we can show them.** Every plane's basic lands
are its landscape in Wizards' own hand. Standing them as large panels at the district boundaries
(the Plains panel where the white band begins, the Island panel at the blue coast) turns the lands
into signposts and gives each plane a look that is unmistakably that plane, without us modelling
the plane. Same compliance rules: flat, unlit, artist credited.

**Where a plane has no row yet**, the kit falls back to the colour band alone, exactly as the
pipeline today falls back to "irregular" for small planes. The pipeline fails loudly if a row names
a kit that does not exist.

This keeps the product maintainable by one person: adding a plane is one Appendix A row, one
Appendix B row, and now one Appendix C row.

### 4.4 Travel inside a plane

Walking alone would be tedious on Dominaria. Three travel aids, all museum-safe:

1. **The travel menu** (the owner's ask). Search or pick a card; a small portal opens in front of
   you and you step through to that card's cell. This is the deep link `/plane/<slug>/card/<id>`
   made physical, so sharing a URL and walking through a portal are the same operation.
2. **Waystones** at each set's meridian and each colour band's edge. Look at one and it names the
   set or band; use it and you step to the next one. Fast travel along the two data axes.
3. **Lift off.** Hold a key and you rise into today's orbit view, pick a point on the globe, and
   drop back down. The orbit camera is not retired; it becomes the planeswalker's sight.

---

## 5. The planeswalker: a frame, not an avatar

The owner's idea is "I select Teferi and visit as Teferi". I want to keep that feeling and avoid the
character-select screen, for the reason in section 3. Proposal:

**The roster is data.** Every planeswalker is a card subtype in the dataset: the type line
`Legendary Planeswalker — Teferi` names him. The roster of choosable planeswalkers is therefore the
set of planeswalker subtypes with at least one included card, roughly seventy names, and it grows
with each refresh with no hand curation. Each planeswalker's **home plane** is the plane of their
first printing's set (Teferi: Dominaria. Jace: Lorwyn, because Jace Beleren was first printed
there, though his story home is Ravnica; the data decides, and a small override file corrects the
few cases like this).
Their **portrait** is the art of one of their cards, chosen by the pipeline's deterministic rule.

**What choosing a spark does** (all cheap, all data-derived, none a mechanic):

- You arrive first on your home plane, through your own portal.
- Cards that depict or name your planeswalker glow faintly from a distance and are listed in your
  travel menu under "your cards". That is a lens, not a quest.
- The interface voice changes: the first-visit hints and the plane signs are written in a short
  per-planeswalker tone sheet (Teferi: patient, about time; Chandra: blunt). Text only. No voice
  acting, which would be a large content cost and a likeness question.
- Optional, later: a planeswalker's colour identity tints the portal and the HUD accent.

**First person, no body.** You never see Teferi; you are the spark. This removes 3D character
modelling, rigging, animation and the likeness question in one decision. If the owner wants a
visible presence, a **reflection** is the cheap version: the planeswalker's card art appears in
still water or a mirror prop on their home plane. Charming, flat, compliant.

If the owner wants modelled third-person avatars anyway, that is a content project of its own:
one rigged, animated character is two to four weeks of a 3D artist per head, and we have none.
I would decide that after the vertical slice, not before.

---

## 6. Sound and music

Sound was a v1 non-goal and it is the cheapest big win in this proposal. Constraints: no Wizards
audio (policy), browsers block audio until the user interacts (so sound starts on the first click
and the control cluster gets a mute toggle), and the budget script gets an audio row.

- **Ambient layer.** One loop per sound family in the theme table, about ten families, 1–2 MB each
  as OGG/Opus, from CC0 libraries or recorded by the owner. Crossfades at district edges: the
  marsh gains frogs, the coast gains surf. Web Audio, no library.
- **Music layer.** Two ways, and I recommend the first for v1: (a) generative ambient music from
  the plane's colour distribution and card count: a drone, a scale and a tempo chosen per mood,
  played by a small Web Audio synthesiser, so every plane sounds different and no track exists to
  license; (b) licensed or commissioned tracks, ten moods, 2–3 MB each. (b) sounds better and
  costs money and time; it can replace (a) mood by mood later.
- **Interface sound.** Portal open, step-through, card lift, card return. Four sounds.
- **Reduced motion and reduced sound** both honour the system setting; sound defaults to off until
  the first interaction and remembers the choice.

---

## 7. The stack question: stay on three.js, use Blender for props only

### 7.1 Why not Unreal or Unity

- **Reach.** The policy and the PRD both say free and open. Unreal has no supported browser target;
  the product would become a 1–3 GB desktop download, and the audience we have today (a URL you
  can share) is gone. Unity exports to the web, but a Unity web build is 20–50 MB before any asset,
  starts in tens of seconds, and is memory-hungry; a 1,024-layer art texture array on top of it is
  not a comfortable fit.
- **The data path.** The whole value of the product is 28,603 cards streamed from Scryfall under
  CORS with a content-hashed static dataset. That path, its contract, its tests and its budgets are
  in TypeScript and Python. An engine port rewrites all of it in a language and tooling none of our
  engineers are measured on.
- **Verifiability.** Our engineering process is reviewer-draws-the-gate, headless CI, byte-level
  contract tests, and PRs an agent can diff. Engine projects are binary assets and editor state. Our
  AI engineers cannot drive the Unreal editor, and we could not review what they did if they could.
- **What we would throw away.** Twelve engineer-days of platform layer, the quality ladder, the
  worlds renderer, the gate, the measurements, and a year of decisions that still hold.

### 7.2 What three.js has to gain, and that it can

Everything the overhaul needs exists in three r185 or is a few hundred lines on top:

| Need | How |
|---|---|
| Walk on a sphere | Kinematic capsule, gravity toward the centre, height from the biome displacement. Own code. |
| Terrain and sky | Vertex displacement on the existing world sphere; procedural sky shader. The atmosphere shader already exists. |
| Props | glTF loader (in three), instanced placement from a seeded scatter. Blender authors the models. |
| Thousands of cards | Already instanced quads with a texture array; same code, a different camera. |
| Portal | A ring mesh plus a render-to-texture of the destination's first frame; the swirl is a shader. |
| Audio | Web Audio, native. |
| Quality | The ladder and monitor we just built; terrain gets a rung. |

Cost class: concept B was estimated at A far, B near. Walking is "near" all the time, plus terrain
and props. I would expect class B on an Iris Xe for a plane like Dominaria, and the vertical slice
measures this on the reference Mac; the Windows field reports are still owed from W0.1 and this
project makes them more valuable, not less.

### 7.3 Where Blender fits

Blender is a tool for making models, and we will need some: the portal ring, the plinth, the
waystone, and three to six props per biome kit. Ten kits × five props is about fifty small models,
which is a few days of modelling or a few hours of picking CC0 assets. Blender exports glTF and
three.js loads it; the pipeline gets a step that validates and compresses the models (Draco or
Meshopt) and checks the budget. Blender is not where environments are built; the environments are
code plus the theme table.

### 7.4 Alternatives worth naming, and when to revisit

- **Godot 4 web export** is the honest second choice: open source, real editor, scripting an agent
  can write. Against it: a 30–40 MB runtime, cross-origin isolation requirements that complicate
  the Scryfall image path, and the same rewrite of the data layer.
- **PlayCanvas** is web-native and has a visual level editor; it would help only if the owner wants
  to lay out environments by hand, which section 4.3 argues against.
- **WebGPU** through three's `WebGPURenderer` is available but unnecessary; WebGL2 reaches more
  machines and the cost class fits.

Revisit the stack only if the vertical slice shows a cost class C on the reference machine or the
owner decides on hand-built hero planes with dense authored geometry. Neither is expected.

---

## 8. How we would make it work: evolve, measure, then decide

Same method as concept B: a short prototype the owner judges with their own eyes, then a decision,
then waves. Nothing in Wave 4 is undone.

**Phase 0 — vertical slice, one plane, one week (one engineer).** Dominaria only, on the shipped
worlds renderer. Surface walk with the sphere-gravity capsule; cards as standing panels using the
existing art stream; the card view with the plane behind and a printings side panel; a portal in
from today's multiverse view and back out; one temperate biome kit with a procedural sky; one CC0
ambient loop. No planeswalker, no theme table, no music. The deliverable is a branch, three
captures, and a bench number on the reference Mac. The owner then answers: does walking feel better
than orbiting, and does the card view with the world behind it feel like the thing you imagined?

**Decision gate.** The owner chooses: build it, change it, or stop. If build, I write PRD v4 as an
amendment (sections 5–6 and non-goal 2, plus Appendix C and the "not a game" rule) and cut Wave 5.

**Wave 5 (if approved), in order:**

1. Walk mode and card view to production quality; orbit stays as lift-off; keyboard and gamepad;
   reduced motion honoured (walking becomes stepping between cells).
2. Portal hub: the Blind Eternities as the lobby; portals per plane; travel menu; deep links open
   through a portal.
3. Theme table and biome kits (Appendix C); basic-land signposts; the pipeline validates the table
   and the models; the budget script gets kit and audio rows.
4. Audio: ambient families, generative music, interface sounds, mute and the system settings.
5. Planeswalker frame: roster from subtypes, home planes, "your cards" lens, tone sheets.
6. Accessibility pass: the drawer's list mode stays the screen-reader path to every card; every
   portal and waystone is reachable by keyboard; the a11y gate extends to walk mode.
7. Measure on the two Windows laptops (the W0.1 kit), then cut over: the orbit-only entry retires,
   `galaxy-cutover` gets a sibling tag.

Rough size: Phase 0 is one week. Wave 5 is of the order of Wave 4, perhaps forty to sixty
engineer-days across the five engineers, with the theme table and the prop set as the owner's own
work alongside. I would not quote tighter than that before Phase 0.

---

## 9. What I would say no to

- **A score, a quest, a timer, a collection meter, or an achievement.** Section 3.
- **Modelled third-person planeswalkers in v1.** Section 5. Decide after Phase 0 if at all.
- **Hand-built environments for every plane.** Section 4.3. Hero dressing for the top eight planes
  is a reasonable later add on top of the kits, not a replacement.
- **An engine port.** Section 7.
- **Voice acting, Wizards music, and any card image shown distorted, tinted, or without credit.**
- **Multiplayer or any server.** The product stays static and private.

---

## 10. Open questions for the owner

Posted as a question set on DEC-950. The recommended option is marked in each.

1. The game boundary: strict gallery (recommended) / "recently visited" list only / full game with
   mechanics (I advise against; needs legal review).
2. Planeswalker presence: first-person spark with data-derived roster (recommended) / modelled
   avatars / narrator only.
3. Ground: walk on the existing globes (recommended) / flat terrain per plane / decide after Phase 0.
4. Environments: biome kits plus a theme table (recommended) / kits plus hand-built hero dressing for
   the top planes / hand-built everywhere.
5. Audio: CC0 ambient plus generative music (recommended) / licensed or commissioned tracks /
   ambient only.
6. Stack: stay on three.js, Blender for props (recommended) / Godot web / PlayCanvas / Unreal or
   Unity desktop.
7. Next step: authorise the one-week Dominaria slice (recommended) / write PRD v4 first / park.

---

## 11. Owner decisions (2026-10-10 15:33Z) and the revised recommendation

Revision 2. Sections 1–10 are the first-pass deep dive and stay as written. This section records the
owner's answers and changes the recommendation where the answers change the premises.

### 11.1 What the owner decided

| Question | Owner's answer | Effect |
|---|---|---|
| 1 Boundary | A gallery, not a game. No quests or battles. But the environments, a third-person player, lighting, sky, props, sounds and interaction must feel like a game. | Aligned. The rule "a place you visit, not a game you play" stands. Production values are game-grade. |
| 2 Planeswalker | Modelled third-person avatars. | Decided. Section 5's first-person frame is withdrawn. 11.2 has the content path. |
| 3 Ground | Flat terrain per plane. Feel the world fully; see how planes differ; 3D-game visuals and sound. | Decided. Section 4.1's globes are withdrawn for walking. 11.2 has the new layout law. |
| 4 Environments | Will the kits feel like a 3D game environment that differs per plane: nature and water here, lava there? | Answered in 11.3. |
| 5 Audio | The recommended option, plus the sound effects of props: a river or lake must be heard flowing. | Decided. Spatial prop sound is a third audio layer. |
| 6 Stack | Whatever makes the whole experience a beautiful 3D game. Shareable URLs are not needed; immersion is. | The engine question re-opens and the recommendation changes. 11.4. |
| 7 Next step | If the slice still makes sense: write PRD v4 first, then the slice. | It does. Sequence in 11.6. |

### 11.2 What changes in the design

**The layout law moves from a globe to a map.** On flat terrain, "latitude = colour, longitude =
time" becomes: colour is the **district** (six regions around a gold centre, colourless at the rim),
and time is the **distance from the district's inner edge**, so the oldest sets stand nearest the
centre and the newest at the frontier. Each set is a **site**: a grove, a ruin, a hamlet, a shrine,
chosen by the kit. Cards stand within their set's site. Terrain side length grows with the square
root of the card count, so density is constant: Dominaria (6,271 cards) is about 520 m across (corrected in §12.5; the first draft said 250 m),
about 90 s from the plaza to the rim at a walk; Rabiah (75) is a valley about 50 m across. Every position is still a pure
function of the data and a seed, so "the picture is the data" survives the move. Travel-to-card,
waystones and the map keep their meaning without URLs.

**Avatars.** The roster stays data-derived (every planeswalker subtype in the dataset, about
seventy), but only modelled planeswalkers are selectable; the rest are listed as "not yet
walkable". Production path per avatar: concept from the character's card art as reference, never a
copy; a stylised model (the owner in Blender, or AI mesh generation followed by clean-up);
auto-rig and a shared animation set (idle, walk, run, turn, look at a card) through Mixamo or the
engine's retargeting; import. The avatar has no stats, no abilities and no inventory; it is the
camera's subject. One rigged, animated stylised character is two to four weeks for a 3D artist by
hand; AI generation plus Mixamo brings a first acceptable version to a few days. I propose three to
five avatars for v1 and a placeholder mannequin for the slice.

**Audio gains a third layer.** Ambient bed, music, and now **spatial prop sound**: rivers, lakes,
waterfalls, lava, fire, wind in trees, machinery, with reverb zones so a cave sounds like a cave.
Engine-native spatial audio covers this; FMOD (free for small projects) is the upgrade if mixing
becomes a job of its own.

**Distribution.** A free desktop download for macOS and Windows from GitHub Releases or an itch.io
page. Not Steam: it is a store for games, it costs a fee, and it would frame the product as a game.
The Fan Content Policy notice sits on the start screen. No Wizards logos or trademarks (the Magic
logo, the planeswalker symbol); plane names and card images are the permitted material. The
product stays free, private (no accounts, no telemetry) and unofficial. A web edition is optional
later, not a goal.

### 11.3 Will the kits feel different per plane? (question 4)

Yes for the difference the owner described, and only partly for the difference between two planes
on the same kit. A kit in an engine is a real biome: terrain layers, water bodies, vegetation,
weather, sky, lighting, particle effects and the sound set. A temperate kit with rivers and lakes
and a volcanic kit with lava flows and ash are unmistakably different worlds. Two planes on the same
kit, with different palettes, seeds, site types and hero props, feel like siblings, not twins.

To make the planes that matter feel unmistakable, add **hero set-pieces built by hand in the editor
on the largest planes**. The dataset decides how many that is:

| Planes by card count | Cards | Share |
|---|---|---|
| Top 5 (Dominaria, Blind Eternities, Ravnica, Innistrad, New Phyrexia) | 15,839 | 55% |
| Top 10 (adds Zendikar, Lorwyn, Tarkir, Kamigawa, Theros) | 20,894 | 73% |
| Top 20 | 26,322 | 92% |
| Planes with 1–49 cards | 16 planes | — |
| Planes with 0 cards | 42 planes | — |

(The current dataset has 42 empty planes, not the 57 quoted from the September review.)

Proposal: ten hero planes (kit plus hand-built set-pieces), thirty-six kit planes with a tuned theme
row, and one void kit for the forty-two empty planes (a small pocket with the plane's name and
"no cards first printed here"). Twelve kits cover the roster: temperate (meadow, rivers, lakes),
forest, coast and islands, desert, volcanic, mountain and steppe, swamp, gothic moor, stone city,
filigree city, phyrexian metal, void.

### 11.4 Stack: the engine question re-opens, and the answer changes

Section 7 said stay on three.js. Two premises carried that answer: reach (a URL anyone can open)
and that the overhaul was additive to the shipped globe renderer. The owner dropped reach, and
flat terrain plus a third-person avatar plus game-grade environments plus spatial audio is a new
renderer in any stack. What the owner asked for (terrain with water and lava, vegetation, weather,
lighting, a character with a following camera, sound with reverb) is exactly what game engines
ship as built-in systems and what three.js makes us build by hand, each a multi-day project with a
ceiling below the brief. So: an engine. The choice is a one-way door, so I give the comparison and
a kill criterion.

| | Unity 6 LTS (HDRP) | Unreal Engine 5 | Godot 4 | three.js |
|---|---|---|---|---|
| Visual ceiling | High | Highest (Lumen, Nanite) | Good | Below the brief |
| Terrain, water, foliage, weather built in | Terrain tools; HDRP water system (rivers, lakes, ocean); VFX Graph; volumetric fog and clouds | Landscape; Water plugin; PCG framework; Niagara; Sky Atmosphere | Terrain and water via add-ons; GPU particles; sky shaders | None; hand-built |
| Third-person character and camera | Starter Assets controller; Cinemachine; Animation Rigging | Third-person template; Control Rig | CharacterBody3D; AnimationTree | Hand-built |
| Spatial audio | Native plus reverb zones; FMOD | MetaSounds; native spatialisation | Native 3D audio buses | Web Audio |
| Agents work in text and headless CI | Yes: C#, YAML scenes, editor scripts, batchmode tests | Partly: C++ and Python editor scripts are text; Blueprints, materials, landscapes and PCG graphs are binary | Yes: GDScript, text scenes, headless runner | Yes |
| Iteration loop | Seconds (C# domain reload) | Minutes (compile, cook) | Seconds | Seconds |
| macOS development on Apple Silicon | First-class | Supported, second-class; heavy on an ordinary laptop | First-class | First-class |
| Build size | 200–500 MB plus per-plane bundles | 2–5 GB | 100 MB plus assets | 2 MB |
| Licence | Free below US$200k revenue; proprietary | Free below US$1M revenue; proprietary | MIT | MIT |
| Learning curve for the owner | Moderate | Steep | Gentle | None |

**Recommendation: Unity 6 LTS with HDRP, with a URP quality rung for lighter Macs.** It is the
highest ceiling our agents can still work in through text, and it ships every system in the brief:
terrain tools, a water system with rivers and lakes, VFX Graph for lava and rain, volumetric fog and
clouds, a third-person controller and camera, animation rigging, per-plane asset bundles, spatial
audio with reverb. The editor is first-class on Apple Silicon. The licence is free at our revenue,
which is zero. A web export exists if a web edition is ever wanted.

**Unreal 5 is the right choice only if the owner wants to be the level artist in the editor** and
accepts that the agents are limited to C++ systems and Python editor scripts, that each cycle is
minutes, and that Mac is second-class. It is the most beautiful per hour of the owner's own editor
time, and the hero set-pieces would look best there. I do not recommend it as the primary engine
because it takes most of the work away from the five engineers who shipped Wave 4.

**Godot 4 is the fallback** if Unity's licence terms move again (they did in 2023 and were
reversed) or HDRP on Apple Silicon disappoints in the slice. **three.js is withdrawn** for this
scope; the shipped web app stays deployed as the web edition, frozen at a tag, with no further web
waves.

**What survives the move.** The Python pipeline, Appendices A and B, the override file, the first-
printing rule, the colour and time laws, the plane roster, the contract test vectors (the pipeline
emits a second data pack for the engine, or the engine gets a decoder), every product decision in
this document, and the measurement discipline: the engine's batchmode runs the bench and the
contract tests in CI, and the reviewer-draws rule continues as captured screenshots from the
editor build on the reviewer's machine.

**Kill criterion for the slice.** On the reference Mac (M5 Pro), the Dominaria slice holds a p90
frame time of 16.7 ms or better at native resolution on HDRP; on an ordinary Apple Silicon laptop
(M1 or M2 Air) the URP rung holds 33 ms. One agent engineer ships the controller, the card sites,
the card view and the data load within the week, with the owner in the editor for at most two
days. Miss either and we revisit the engine before PRD v4 is final.

### 11.5 Residual risks

- **Game read.** Named avatars raise it. Mitigations: no stats, abilities, combat, inventory or
  progression; the avatar is a camera subject; the policy notice on the start screen; no logos or
  trademarks; distribution off Steam. A short trademark check (the planeswalker symbol, mana
  symbols) belongs in PRD v4.
- **Owner time.** Hero set-pieces (ten planes) and avatars (three to five) are owner work in the
  editor and in Blender. Rough order: one to two weeks per hero plane, a few days to four weeks per
  avatar depending on the generation path.
- **Scryfall.** A native app fetching card images on demand and caching them on disk is the same
  pattern as the browser; no bulk mirroring; artist credit in the card view; images flat and
  undistorted.
- **Team skill.** The agents move from TypeScript to C#. The first wave is slower.
- **Memory.** Thousands of card textures on open terrain need the same stream-and-evict discipline
  as today's art stream: texture arrays, distance LOD, swatches far away.

### 11.6 Next steps

1. The owner confirms the engine, the hero-plane count and the v1 avatar roster (question set on
   DEC-950, this heartbeat).
2. The CEO writes PRD v4 as a new document (`prd_v4.md`): the place-not-game rule as a goal, the
   avatar and the roster, flat terrain and the map layout law, Appendix C and the kit list, the
   three audio layers, the engine, distribution, and the revised non-goals. Sections 3 and 4 of PRD
   v3 (domain model, data) carry over. Approval by confirmation on the plan revision.
3. The vertical slice: Dominaria in Unity, one engineer plus the owner in the editor, one week.
   Terrain with a river and a lake on the temperate kit; the starter mannequin as the avatar;
   card sites placed from the dataset; the card view with the printings panel; portal in and out
   from a plain hub; ambient bed and a river sound; the bench on the reference Mac.
4. Wave 5 is cut from PRD v4 after the slice passes the kill criterion.

---

## 12. Round-2 decisions (2026-10-10 15:57Z), the Codex gate, and the PRD v4 draft

Revision 3. Sections 1–11 stay as written; where this section disagrees with them, this section wins.

### 12.1 What the owner decided

| Question | Owner's answer | Effect |
|---|---|---|
| Engine | Unity | Decided. Unity 6 LTS, HDRP primary, URP quality rung. Unreal declined, Godot 4 named as the fallback, three.js withdrawn (§11.4). |
| Hero planes | Twenty | Decided. §11.3 proposed ten; the count is now twenty. On dataset `a5846bec28d1447e` the top twenty planes hold 26,322 of 28,603 cards (92.0 percent). The roster splits 20 hero planes, 26 kit planes, 42 empty planes as pockets. |
| v1 avatar roster | One, Teferi; more later | Decided. §11.2 proposed three to five; v1 ships Teferi only. The roster screen still lists the data-derived roster with the rest marked "not yet walkable". |
| Board comment, 15:58Z | "Make sure the PRD and plan are passed through Codex before we actually go on to start building." | A review gate is added before the vertical slice (12.3). |

Two corrections to §11 that the live dataset forced:

- §11.3's table omitted **Forgotten Realms**. The committed roster has a `forgotten-realms` plane with 664 cards (rank 14); the Dungeons & Dragons sets were moved off the Blind Eternities after PRD v3 was printed. Appendix A's committed form under `pipeline/data/` is canonical; `prd_v3.md`'s text is the last full print.
- §11.3 said "ten hero planes, thirty-six kit planes". The decided split is twenty and twenty-six.

### 12.2 PRD v4 is drafted

`prd_v4.md` sits at the repository root, untracked until the owner confirms it. It supersedes `prd_v3.md` sections 5–9 and keeps v3 sections 3–4 and Appendices A–B in force with amendments. What it adds, in order: the place-not-game rule as goal 1 and game-grade feel as goal 2; the added entities (world, hub, pocket, district, site, stand, portal, waystone, avatar, theme row, kit) and four added invariants; Appendix C, the engine data pack (contract v4), the avatar roster derivation and the Scryfall native-client rules; the hub, the world layout law on a flat disc (colour is the wedge, time is the radius, each set is a site, each stand owns about 10 m²), stands, the twelve kits, hero set-pieces, pockets, basic-land signposts, sky and light, the third-person avatar, portals, card view, reduced motion, three sound layers; interaction (controls, modes, HUD and map, search, filters, travel, start screen, screenshot, settings, accessibility); non-functional budgets with the reference machine, the light Mac and the W0.1 laptops; architecture (Unity 6 HDRP and URP rung, repository layout and text-first conventions, data path, scene structure, avatar and camera, audio, pipeline additions, testing and CI, deployment, privacy, the web edition freeze); quality and the slice's kill criterion; fourteen risks; thirteen open questions with defaults; the decision record; Appendix C with twenty hero rows, twenty-six kit rows and the pocket row; Appendix D (avatar roster); Appendix E (Fan Content Policy checklist).

### 12.3 The Codex review gate

The board asked that the PRD and this plan pass through Codex before building starts. There is no Codex agent in the company, so the CEO runs the Codex CLI (`codex-cli` 0.156.1, model `gpt-6-astra`, read-only sandbox) as an independent reviewer over three inputs: `prd_v4.md`, this document, and `prd_v3.md` as the reference the PRD amends. The prompt asks for a verdict per document (go, go with changes, no-go) and ranked findings on eight axes: the Fan Content Policy boundary, internal consistency, feasibility of the one-week slice and the kill criterion, the engine choice, the layout law and its edge cases, missing requirements, the data and pipeline additions, and unlisted risks. The prompt and the output are kept beside this file as `dec950-codex-prompt.md` and `dec950-codex-review.md`.

The CEO triages every finding as accepted, accepted with a change, or declined with a reason, and folds the accepted ones into `prd_v4.md` and this plan before putting PRD v4 to the owner for confirmation. The triage is posted on DEC-950. Running a review tool is a review action, not implementation; the no-execution rule is not touched.

### 12.4 Next steps (replaces §11.6)

1. Codex review round 1 of `prd_v4.md` draft 1 and this plan: done (12.5); all nineteen findings folded into draft 2.
2. Codex review round 2 of draft 2 and plan revision 4: done (12.6); all eighteen new findings and the round-1 residuals folded into draft 3 and this revision.
3. Codex review round 3 (12.8) and the confirmation pass, round 4 (12.9): done. PRD v4 reads GO WITH CHANGES; both changes are applied in draft 5. The Codex gate the board asked for is passed.
4. Owner confirms PRD v4 draft 5 by confirmation on the plan revision that records 12.9. The owner also owns the distribution gate (`prd_v4.md` 11.1), which does not block the slice.
5. The vertical slice: a child issue for one agent engineer, Dominaria in Unity 6 HDRP, one week after the prerequisites in `prd_v4.md` 9.5 are met, the owner in the editor for at most two days, acceptance matrix as 9.5.
6. Wave 5 is cut from PRD v4 after the slice passes.

### 12.5 Codex review, round 1: verdicts, triage, and what changed

**Run.** `codex exec`, read-only sandbox, model `gpt-6-astra`, reasoning effort high, 259 s. Inputs: `prd_v4.md` draft 1, this document (revision 3), `prd_v3.md`, `docs/decisions/w23-concept-and-stack.md`, the production `planes.json`. Prompt: `dec950-codex-prompt.md`. Output: `dec950-codex-review.md` (2,126 words). Codex confirmed the dataset figures (88 planes, 28,603 cards, 72,811 printings, 42 empty, top twenty 26,322 cards including the Blind Eternities).

**Verdicts.** PRD v4 draft 1: **NO-GO** ("layout, rendering and data contracts contain contradictions that implementers would have to resolve by inventing product decisions"). Plan: **GO WITH CHANGES** ("Unity and the slice-first sequence fit the constraints, but the dual-pipeline assumption, one-week scope and fallback trigger need correction").

**Triage.** Nineteen findings: three blockers, fifteen majors, one minor. All nineteen accepted, seventeen in full and two with a change of remedy. None declined.

| ID | Severity | Finding (short) | Disposition | Where it landed in `prd_v4.md` draft 2 |
|---|---|---|---|---|
| F1 | blocker | The policy conclusion exceeds the evidence; a controllable Teferi in Magic worlds can read as a game; the likeness review is too narrow. | Accepted. The CEO cannot settle a legal classification; it becomes an owner decision gate with a legal read before any public distribution. The slice and kit work proceed as engine and layout work; Teferi's model waits. | Goal 1; risk 1 and 2; open question 11.1; 7.7.2; Appendix D.3 |
| F2 | blocker | The layout law is not an algorithm: √count wedge angles give density ∝ √count; clamp renormalisation, gold and colourless allocation, empty classes, capacities and packing failure undefined. | Accepted. A deterministic allocator is specified and was run on the real dataset (below). | 5.4.1–5.4.13 |
| F3 | blocker | A URP rung is a second renderer, not a quality setting; HDRP and URP projects are incompatible. | Accepted. URP removed from v1; three HDRP quality levels; a URP build variant is a costed Wave 5 option only if HDRP low fails the light Mac. | 8.1.1; 7.1; 7.2; non-goal 13; 11.5 |
| F4 | major | Gold at the centre collides with the landmark, arrival and return portal (Dominaria: 753 gold cards over 37 sets); colourless has no chronology; 1–4-card worlds are 3.6–7.1 m across. | Accepted. Gold is a wedge; a reserved plaza comes first; the colourless ring runs time clockwise; a minimum footprint of about 40 m. | 5.4.2–5.4.6, 5.4.11 |
| F5 | major | The hub's 4,204 cards and 50 sets have no geometry; 88 portals imply a self-portal. | Accepted. The hub holds the portal ring only; the Blind Eternities gets its own world; 88 portals including it. | 3.1; 5.3; invariant 6; Appendix C.1 row 2 |
| F6 | major | Texture budgets rely on an unimplemented compression path; 1,024 RGBA slots are 358 MiB; `Texture2D.Compress` does not give ASTC/BC7; the 60 m radius implies 1,131 images. | Accepted. BC3 (DXT5) via `Compress` plus `CopyTexture`, 244 × 340, no mips, 83 MB, measured in the slice with an RGBA8 512-slot fallback; images at 25 m (about 200 stands), props at 60 m. | 8.4.3; 7.2; 7.3.3; 5.5.1 |
| F7 | major | The week is a stack integration project; URP in the gate but not the scope; targets as gate; schedule miss misdiagnosed as engine failure. | Accepted. Prerequisites outside the week listed; day-by-day sketch; gate on ceilings with p99 and longest frame, warm and cold runs; three failure classes before Godot. | 9.5; 8.1.3 |
| F8 | major | "Built-in" overstates: no built-in spatialiser plugin; Starter Assets not Unity 6 HDRP compatible; Mixamo is external; Godot would rebuild the integrations. | Accepted. Own controller on `CharacterController`; standard 3D audio with reverb zones, spatialiser plugin optional; Mixamo named as external; packages pinned; Godot trigger narrowed to a renderer failure. | 8.1.2; 8.1.3; 8.5; 8.6; 5.12.3 |
| F9 | major | Contract v4 is not a record layout; district class loses WUBRG inside gold; set membership missing; shard joins unspecified. | Accepted. A 48-byte record table with offsets, types, endianness, UUID order, yaw units, ordering; a WUBRG mask; `sets.bin` kept; shard and search joins. | 4.13.2–4.13.6; 6.5.1 |
| F10 | major | Placement ownership is circular (Python moves stands around props Unity places); no routes, banks, camera clearance or safe destinations. | Accepted. Ordered reservations: hero volumes exported as text by the owner, plaza, paths, pads, aprons, then stands, all in the pipeline; Unity scatters props last; stands fixed at emission; connectivity asserted. | 3.1 (path, apron, hero volume); invariants 8–10; 5.4.7–5.4.9; 8.4.2; 8.7.1 |
| F11 | major | Image treatment contradicts compliance: dimmed filtered images; credits only at 3 m; HUD-free screenshots drop credits; "unlit" does not escape HDRP exposure and post. | Accepted. Filtered stands show swatches; only complete card images (self-credited by the printed artist line) plus text credit; a custom after-post pass with exposure and fog off; a pixel-compare test. | 5.5.6; 4.15.5; 8.4.4; 6.8; Appendix E.6 |
| F12 | major | Appendix C cannot pass its own validation: one row per plane vs the shared pocket row; defaults vs "no silent fallback"; `hero` absent; Alara's palette; no override schema; set-piece text cannot encode volumes. | Accepted. `kits.yaml` plus `themes.yaml` with explicit inheritance printed in the report; pocket rows generated; `hero` field; Alara given three colours; per-wedge overrides deferred to v2; volumes come from the owner's exported file. | 4.12; 5.6.3; 11.9; Appendix C |
| F13 | major | Teferi, Temporal Archmage (Commander 2014) predates Dominaria 2018; Jace's origin is Vryn; both-face parsing; "your cards" count contradicts the no-count rule; unavailable roster entries resemble locked content. | Accepted. Fixtures corrected (raw home Blind Eternities, override Dominaria); both faces parsed; aliases; the HUD count removed; no roster screen in v1. | 4.14; 5.8.2; 6.3; Appendix D |
| F14 | major | The five basic lands are one card each, first printed in Alpha, so "a plane's basic lands" do not exist as cards; set search destinations ambiguous; reprint-only sets have no site. | Accepted. Basic-land signposts deferred to v2 (needs a printing-exhibit entity); set search lands on the set's largest site; reprint-only sets filter and highlight without travel. | 11.11; non-goal 14; 6.4.5 |
| F15 | major | Search can land on a filtered, non-interactive stand; a 1.5 s portal cannot hide a 6 s load; portals spawning 3 m from arbitrary points land in water or props. | Accepted. Search clears the excluding facets with an undo toast; the portal holds with input locked up to 6 s; travel lands on pads and aprons only; reachability timed in the bench. | 6.4.6; 5.9.2; 5.9.4; 7.2 |
| F16 | major | Scryfall verification deferred to release though the slice depends on it; `Accept` missing; 6 vs 8 concurrency; 50 ms spacing is not a universal limit. | Accepted. Runtime contacts only the image CDN (no API calls); `User-Agent` and `Accept`; one limit of 6; HTTP-aware backoff; verification is a slice prerequisite. | 4.15; 9.5 prerequisites |
| F17 | major | Engineers cannot commit the binary assets of the twelve kits they own; twenty heroes are 20–40 owner-weeks; kit and hero allowances total 7.8 GB against a 2 GB archive. | Accepted. A content-supply subsection with named CC0 sources, per-kit `CREDITS.md`, cooked budgets (core ≤ 400 MB, kit ≤ 60 MB, hero scene ≤ 40 MB, total 1,920 MB at ceiling), staged hero releases (first release: hub ring and Dominaria). | 8.12; 7.2; 8.2.4 |
| F18 | major | No screen-reader path in the native build; reviewer hardware unassigned; Unity Personal does not activate by licence file. | Accepted. The web edition stays the screen-reader path and is linked; the reference machine is the agents' own machine, light-Mac figures are the owner's and named per gate; a self-hosted runner on the reference machine with the owner's Hub sign-in; hosted CI runs pipeline and compile only. | 6.10.6; 7.1; 8.8.5; 8.8.6 |
| F19 | minor | Editorial: "twenty and the hub" double-counts; 282.6 m not 250 m; §5.6.1 cross-reference; "panel" banned then used; terrain cache has no directory or invalidation rule. | Accepted. "Twenty entries including the Blind Eternities"; figures recomputed with the allocator; vocabulary amended (panel = the printings panel only); terrain cache directory and invalidation named. | 3.3; 5.4.13; 7.4.4; 12 |

**Cuts Codex proposed, all accepted:** the unavailable-avatar roster screen and portrait browsing; the "your cards" HUD count; generative music and the FMOD contingency (per-mood loops instead); basic-land signposts; per-plane wedge dressing for Alara and Lorwyn; waystones for sites under five stands (marker stones instead); all twenty hero scenes as a first-release dependency (staged instead). **Additions Codex asked for before the slice** are the prerequisites list in `prd_v4.md` 9.5. **Codex's five slice questions** are adopted as 9.5's "what the slice must prove", with its first (delivery) folded into the kill criterion's delivery class.

**The allocator, run on the real dataset (2026-10-10).** Three variants were computed from the production shards before writing 5.4:

| Variant | Rule | Dominaria across | Mean ground per stand |
|---|---|---|---|
| Equal band widths, wedge angle ∝ count | the first draft's intent | 890 m | 99 m² |
| Per-wedge chronology, each site's depth ∝ its count | time is radius within a wedge only | 512 m | 33 m² |
| **Shared bands, each band's width set by its busiest site** | **time is radius across all wedges** | **524 m** | **34 m²** |

The first is unusable: the thin innermost band binds the whole world (Alpha's 48 green cards). The second and third cost the same; the third keeps "one radius, one era" across colours, so it is the law in 5.4. Other figures from the same run: the Blind Eternities' world about 640 m across with 254 sites; Ravnica about 250 m; Innistrad about 210 m; New Phyrexia about 180 m with a colourless ring about 19 m wide; Alara about 135 m with a 120° gold wedge (294 of 510 cards are gold); Rabiah about 48 m; worlds with 1–4 cards about 36 m before paths. 23 of Dominaria's 202 sites and 52 of the Blind Eternities' 254 have fewer than five stands. These numbers are the basis of `prd_v4.md` 5.4.13 and risk 15, and are to be reproduced by the pipeline's allocator as the 5.4.12 fixtures.

**A second correction surfaced by the review.** Teferi's earliest included planeswalker card is Teferi, Temporal Archmage (Commander 2014), so his data-derived home plane is the Blind Eternities and the Dominaria home is an override. §11.2's claim that the roster is "about seventy" names is also low: the dataset has about eighty planeswalker subtypes.

### 12.6 Codex review, round 2: verdicts, triage, and what changed

**Run.** Same tool and settings, 340 s, over `prd_v4.md` draft 2 and this document at revision 4. Prompt: `dec950-codex-prompt-round2.md`. Output: `dec950-codex-review-round2.md` (about 2,000 words).

**Verdicts.** PRD v4 draft 2: **NO-GO** ("the allocator still has mathematically impossible requirements and no valid packing/failure procedure"). Plan revision 4: **GO WITH CHANGES** ("correct the slice decision matrix, preliminary measurement claims and superseded instructions before execution").

**Resolution check of F1–F19.** Resolved: F3, F5, F8, F9, F12, F13, F16, F17. Partly resolved: F1, F4, F6, F7, F10, F11, F14, F15, F18, F19. Not resolved: F2 (the allocator). Every residual is closed by one of the new findings below or by the draft-3 change named against it in the table.

**New findings F20–F37.** Two blockers (F20, F21), fourteen majors, two minors. All accepted; none declined. Draft 3 of `prd_v4.md` folds them in.

| ID | Severity | Finding (short) | Disposition and where it landed in draft 3 |
|---|---|---|---|
| F20 | blocker | Wedge angle bounds [30°, 120°] are infeasible for one- and two-class worlds (Vryn: one wedge must be 360°); clamp-and-renormalise can stabilise outside the bounds; no stopping rule. | Accepted. Bounded proportional allocation by water-filling with lo = min(30°, 360°/n), hi = max(120°, 360°/n), explicit n = 0, 1, 2 cases, at most n rounds, exact 360° sum (5.4.4). Vryn, Shandalar and an all-colourless plane are fixtures (5.4.13). |
| F21 | blocker | Area does not guarantee placement: 5.4 m² is ideal hex packing, not Bridson success in fragmented polygons; a jittered 2.5 m grid can violate spacing; capacity ignored other reservations; spurs did not give every apron access. | Accepted. Bridson removed. A global hexagonal lattice at 3.0 m pitch with 0.25 m jitter (spacing ≥ 2.5 m by construction); candidates must clear every reservation with footprint, apron and corridor; capacity = candidate count; bounded widening (20 per band) then a named failure; "cannot fail" removed; validation of the chosen set after placement (5.4.9, 5.4.10). |
| F22 | major | Determinism and convergence were assertions: no initial radius, iteration cap, PRNG, candidate order, tie rules, site-centre definition or precision; published figures omit the operations. | Accepted. R₀ formula, 20-pass outer cap with the last result standing, splitmix64 seeded by FNV-1a of a named string, fixed candidate order, lowest-path-id ties, site centre defined, integer millimetres (5.4.1, 5.4.3, 5.4.8, 5.4.11). The computed figures are labelled preliminary estimates (5.4.14); an independent invariant checker runs on emitted positions (3.2, 5.4.13). |
| F23 | major | Colourless arcs were not sites; a colourless-only set left the zero-width band ambiguous; a full-circle arc's centroid falls in the plaza. | Accepted. Ring sites defined with centres, pads, seams and clockwise neighbours; arcs ∝ count with a 6 m minimum; zero-width bands for sets with only colourless cards; mid-angle centre rule for arcs over 180° (3.1, 5.4.7, 5.4.8, 6.6.2). |
| F24 | major | Drawing after post-processing does not by itself give correct depth, occlusion or TAA behaviour; HDRP warns about depth-tested objects at that injection point. | Accepted. Two-draw design: depth and stencil in the opaque pass with colour write off, then colour after post with the unjittered projection and the upscaled depth; five tests including occlusion, motion under TAA, depth-of-field and resolution scale; a costed fallback in matrix row I (8.4.4, 9.5). |
| F25 | major | `Compress` yields DXT1 for RGB, is uninterruptible, and BC loss invalidates a ±2/255 test; no mips means minification within 25 m. | Accepted. Runtime compression dropped from v1 (non-goal 14, 11.14); RGBA8 with a full mip chain, 384 slots, about 175 MB resident; 1:1 colour test at tolerance 1; the 25 m radius is a preference bounded by slots (8.4.3, 5.5.5, 7.2). |
| F26 | minor | Derived-field validation unstated; "double-faced" needs the image-back distinction including meld. | Accepted. Decoder assertions (class vs mask, set vs band, shard join); a back-image flag mapped from v3's face rules; vectors for split, adventure, transform, meld and a malformed join (4.13.3). |
| F27 | major | Travel still required walking to a pad; cross-world travel untimed; contradicts "without walking". | Accepted. The travel portal opens 2 m in front of the avatar wherever it stands and the avatar walks in automatically; cross-world travel goes straight to the destination; both timed in 7.2 and the bench (5.9.4, 6.4.4, 7.2, 8.8.4). |
| F28 | minor | Hub portal envelopes, same-year ordering and preload arbitration unspecified. | Accepted. 4 m envelopes on a 56 m ring (352 m circumference), ties by slug, one preload at a time with 1 s hysteresis (5.3.2, 5.3.3). |
| F29 | major | The slice had incompatible verdicts: cold runs informational yet mandatory; an uncached offline card cannot show an artist line; no outcome for high-fail-low-pass; light-Mac failure routed to Godot; frame time alone does not identify an engine defect. | Accepted. One acceptance matrix with rows D, R1–R3, L, C, I, A and an outcome per row; a degraded pass; bottleneck attribution before Godot; the light Mac never triggers an engine change; question 5 split into cached and uncached cases; delivery miss gets one bounded re-scope (9.5). |
| F30 | major | Hosted bench smoke contradicted "hosted runs pipeline and compile only"; a runner outage bypassed tests; Hub sign-in is not a reproducible graphics recipe. | Accepted. One CI matrix; PRs touching `unity/` wait when the runner is down; a runner recipe (dedicated GUI user, launchd agent, `-batchmode` without `-nographics`, LFS, concurrency 1) in `docs/ci-runner.md` (8.8.5, 8.8.6). |
| F31 | major | Releases on a private repository are not public downloads. | Accepted. A separate public `eternities-releases` repository or itch.io; the source stays private (7.7.2, 11.7). |
| F32 | major | A frozen web dataset cannot stay the screen-reader path once the native build refreshes. | Accepted. Every data refresh redeploys the web edition from the same commit; the default of the old 11.13 is reversed (8.11.2, 6.10.6, 8.9.2). |
| F33 | major | "Every plane differs" was quietly weakened to "identify the kit" in acceptance; inherited rows and identical pockets cannot meet the original. | Accepted. Goal 3 restated as a staged requirement (kit at every release, theme-row difference between siblings, hero set-pieces staged, pockets identical by design) and 9.3's first criterion matched to it. |
| F34 | major | Parent-mapped sets (`mul`) have sites without their own Appendix B row; the search branch treated them as reprint-only; marker sites have no waystone to list other sites. | Accepted. `sets.json` carries the effective plane; search reads the emitted site list; the travel menu lists other sites on arrival regardless of furniture (4.13.4, 4.13.6, 6.4.5); a PlayMode test for `mul`. |
| F35 | major | A lexical ban on "game" rejects legitimate catalogue content (Game of Chaos, Goblin Game) and does not address classification. | Accepted. Presentation lint scoped to authored content; catalogue data exempt; classification kept separate (9.1.6, Appendix E.5). |
| F36 | major | "Private builds" conflated internal evaluation with distribution to friends; privacy is not compliance. | Accepted. Vocabulary: internal evaluation vs distribution; every distribution waits for 11.1; privacy explicitly no exemption (3.3, 7.7.1, goal 1, risk 1, Appendix E.9). |
| F37 | minor | Content accounting implicit; nineteen hero entries remain after Dominaria, not eighteen; plan §12.1 still records URP and the unavailable-avatar roster as decided effects. | Accepted. Single-attribution accounting with cooked vs archive rows (7.2, 8.12.5); count corrected to nineteen (5.6.4, 8.12.4); `prd_v4.md` §12 lists what it supersedes in this plan, and 12.7 below marks them here. |

**Residuals from round 1 closed in draft 3.** F1 and F36 (distribution gate covers friends); F4 (angles by F20; colourless by F23); F6 (by F25); F7 (by F29); F10 (corridors, water buffer and camera clearance reserved, 5.4.1 and 8.4.2); F11 (by F24 and F25); F14 (by F34); F15 (by F27); F18 (by F30 and F32); F19 (count by F37; figures labelled preliminary).

**Closure note.** The dispositions above record what draft 3 did; round 3 (12.8) found several incomplete and round 4 (12.9) confirmed the fixes with two amendments. 12.9 is the authoritative record of the final dispositions.

### 12.7 Superseded statements in this plan

`prd_v4.md` (current draft) is authoritative. The following statements in sections 1–11 of this plan are superseded and are kept only as the record of how the recommendation moved: the first-person planeswalker frame (§5); walking on the globes (§4.1); "a URP quality rung for lighter Macs" (§11.4); a roster screen listing planeswalkers as "not yet walkable" (§11.2); ten hero planes and thirty-six kit planes (§11.3); Dominaria about 250 m across (§11.2); the hub holding the Blind Eternities cards (§2, §4); basic-land signposts (§4.3); generative music (§6); FMOD as the audio upgrade (§11.2); the kill criterion as targets (§11.4; the matrix in `prd_v4.md` 9.5 uses the ceilings and separates failure classes).

### 12.8 Codex review, round 3: verdicts, triage, and what changed

**Run.** Same tool and settings, 195 s, over `prd_v4.md` draft 3 and this document at revision 5, as a closing round (resolution check and remaining blockers only). Prompt: `dec950-codex-prompt-round3.md`. Output: `dec950-codex-review-round3.md` (about 1,300 words).

**Verdicts.** PRD v4 draft 3: **NO-GO** (two blockers, F38 and F39; "smallest coherent change lifting NO-GO: correct the allocator contract in §§3.2/5.4 to resolve F38–F39; F40–F42 can then be closed in-document without another review round"). Plan revision 5: **GO WITH CHANGES** (amend 12.6's closure claims; make slice execution conditional on the corrected PRD).

**Resolution check.** Resolved: F23, F25, F26, F27, F28, F31–F37, F1, F6, F14, F15, F19. Partly resolved: F20, F21, F22, F24, F29, F30, F4, F7, F10, F11, F18. Codex confirmed the 8.4.3 arithmetic (169,801,728 bytes for the array, 174,833,664 with card view) and that `mul` resolves to its Blind Eternities site.

**Findings and triage.** All five accepted; none declined. Draft 4 of `prd_v4.md` folds them in.

| ID | Severity | Finding (short) | Disposition and where it landed in draft 4 |
|---|---|---|---|
| F38 | blocker | Water-filling with simultaneous irreversible lower and upper clamping is not a valid bounded allocation: counts 100 : 1 : 1 clamp to 120°, 30°, 30° with 180° left over, and giving it to the largest class breaks the ceiling. | Accepted. Replaced by solving Σ clamp(λ × count, lo, hi) = 360° for λ by 64-step bisection in integer micro-degrees, then integer apportionment of the shortfall to classes below hi; proof of completion and the 100 : 1 : 1 check (120°, 120°, 120°) written in (5.4.4). The ring uses the same solver after a feasibility push of the ring's inner radius so m × lo ≤ 360° (5.4.7). |
| F39 | blocker | Invariant 9 forbade pads intersecting paths or the plaza while invariant 10 and 5.4.8 require pads on paths and the return pad inside the plaza; the checker could not accept the required layout. | Accepted. Exclusions rewritten by geometry type: footprints and aprons touch nothing; corridors end on paths and may cross each other and pad edges; pads lie on the network or inside the plaza by design and avoid footprints, aprons, volumes and other pads; hero volumes may overlap the plaza but not the arrival point, the return pad or a path (3.2 invariant 9 and 10; 5.4.8). Candidate tests use geometry inflated by the jitter radius so the final jittered positions satisfy the rules; the checker runs on the final geometry and its failure is a named build failure (5.4.9, 5.4.10, 5.4.11). |
| F40 | major | Unjittering the colour draw does not unjitter the first draw's depth and stencil; upscaling does not match coverage; depth-only writes suppress the background without establishing the composite. | Accepted. The design is now an exhibit camera with its own unjittered, output-resolution occluder depth prepass and a coverage-alpha exhibit buffer, composited after the main camera's post-processing; the main camera draws the surfaces as ordinary opaque placeholders in the swatch colour so the world's depth, fog, exposure and depth-of-field are consistent; the custom-pass variant becomes the costed alternative with its own re-rendered unjittered depth; the five tests kept, (b) and (d) tightened (8.4.4; risk 8). |
| F41 | major | Row D allowed dropping the lake while question 4 required it; row L allowed dropping the light Mac while question 1 demanded its pass; R3 success had no outcome; the delivery extension had no end state. | Accepted. Questions 1 and 4 read against the retained scope and the targets in force; R3 pass is degraded pass 2 with the 7.2 amendment named; the delivery extension ends in a stop and an owner decision; row I gets a stop outcome (9.5). |
| F42 | major | The slice prerequisites allowed deferring the self-hosted runner with a hand-run bench standing in, contradicting the no-bypass CI matrix. | Accepted. The runner is a hard prerequisite, green on the skeleton before the week starts; the reviewer's bench is in addition (9.5 prerequisites). |

**Round-1 and round-2 residuals.** F20, F21, F22 and F4 close through F38 and F39; F24 and F11 through F40; F29 and F7 through F41; F30 and F18 through F42; F10 through the invariant 9 rewrite. Nothing Codex named in three rounds remains open in draft 4.

**Stopping rule.** Codex said the F38–F39 correction lifts the NO-GO and F40–F42 close in-document. The CEO ran one narrow confirmation pass on exactly F38–F42 (12.9) and stopped iterating.

### 12.9 Codex confirmation pass (round 4): the gate is passed

**Run.** Same tool and settings, 113 s, scoped to F38–F42 on `prd_v4.md` draft 4 and this document at revision 6. Prompt: `dec950-codex-prompt-round4.md`. Output: `dec950-codex-review-round4.md`. (A first attempt hung for ten minutes waiting on stdin, a harness fault, not a review; the re-run closed stdin.)

**Verdicts.** PRD v4 draft 4: **GO WITH CHANGES** ("F38–F39 lift the NO-GO; the remaining F40–F41 corrections can be made in-document without another review round, with rendering feasibility still gated by the slice"). Plan revision 6: **GO WITH CHANGES** ("no further document-review round is required").

**Dispositions.** F38 RESOLVED (Codex re-checked 100 : 1 : 1 → 120°, 120°, 120° and 100 : 10 : 5 : 1 : 1 → 120°, 120°, 60°, 30°, 30°). F39 RESOLVED (every required pad, path, plaza and hero-volume relationship accepted; every forbidden one still rejected). F42 RESOLVED. F40 PARTLY RESOLVED: the 0.5 px inset would leave placeholder pixels unreplaced; **amended in draft 5**: the exhibit buffer carries the complete card rectangle, the composite replaces every placeholder pixel, and a sixth image-path test (f) measures the boundary under TAA, depth-of-field and both resolution scales; row I gates on it (8.4.4, 9.5). F41 PARTLY RESOLVED: row L let the slice pass with the light Mac "under review" while question 1 still demanded its pass; **amended in draft 5**: a row L miss suspends the light Mac as a gating target for the slice, and question 1 and row A are then judged on the reference machine alone (9.5).

**Execution condition.** The slice is cut from `prd_v4.md` **draft 5**, the amended document, not from draft 4. The owner's confirmation is requested on this plan revision, which records the gate as passed.

**What the gate cost and bought.** Four Codex passes, about 15 minutes of model time, 61 findings (19 + 18 + 5 + the 5 re-checked), all accepted, none declined. The board's directive was that the PRD and the plan pass through Codex before building; they have, and the record of every finding and its disposition is in this section and the review files beside it.
