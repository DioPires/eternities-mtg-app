# DEC-950 — Project overhaul: planeswalker visits worlds

**Author:** CEO. **Date:** 2026-10-10. **Status:** revision 16 (revision 15 with the DEC-994 fixes; no decision changed). §14.5 records the Codex gate on Amendment 4 through round 9, and the gate is passed: round 5 read NO-GO on the PRD (six blockers in the allocator) and GO WITH CHANGES on the plan, and all twenty-one findings went into draft 2; round 6, the confirmation pass, read NO-GO again (three new blockers, seven majors, sixteen of the twenty-one only partly resolved) and GO WITH CHANGES on the plan; all ten new findings and the sixteen partials are accepted, and draft 3 makes the pipeline's implementation the only allocator, drops the two-language numerical contract for reproducibility rules, and corrects the procedure where it could fail on valid input; round 7, the confirmation pass on draft 3, resolved twenty of the twenty-six items it re-checked, judged the single-allocator ruling sound, and read NO-GO on the PRD on two blockers, three majors and one minor in the allocator's geometric detail (F74 to F79), all accepted in draft 4; GO WITH CHANGES on the plan. Per §14.6 of revision 12, a blocker at round 7 put the choice to the owner, who chose one more confirmation pass on draft 4 (2026-10-12 17:40Z) and on the same card confirmed the two readings of §14.3 and left the single-allocator ruling to the CEO. Round 8 read NO-GO on three majors and two minors (F80 to F84) and no blocker; draft 5 fixed all five, and a narrow round 9 ran on the CEO's reading of §14.6 (no blocker, so no return to the owner; one round on the CEO's authority). Round 9 read GO WITH CHANGES on both documents, with one partial and three minors (F84 to F87), all applied in draft 6, and asked for no further document round; the Codex gate on Amendment 4 is passed, and §14.6 puts the amendment to the owner for confirmation. §14 records the owner's decision after the slice (2026-10-12 15:07Z: lore for every hero plane before the first distribution; an engineer drafts the history text; colour as a cue; photographic props staged), PRD v4 Amendment 4 (the journey law), the two readings the CEO made, the Codex gate on the amended documents and the sequence. §13 records the slice's verdicts (engine: degraded pass 1 at HDRP medium; design: an artistic miss on question 3), the owner's words of 2026-10-12, and the design proposal with three directions for the owner's choice. §12.12 converts the owner's picks on the workflow card (2026-10-10 21:00Z) into DEC-959, DEC-960 and three additions to DEC-953. §12.11 records the adversarial review of the CEO's workflow proposal (two independent reviewers, fourteen merged findings, all accepted) and the corrected recommendation. Sections 1–10 are the first-pass deep dive; §11 records the owner's round-1 decisions; §12 records the round-2 decisions, the Codex review gate the board added, the PRD v4 draft, the Codex triage of all four passes (§12.5, §12.6, §12.8, §12.9) and the statements in §§1–11 that `prd_v4.md` supersedes (§12.7). **The Codex gate is passed twice: on the base document, where the fourth pass read GO WITH CHANGES and both changes are applied in `prd_v4.md` draft 5, and on Amendment 4, where round 9 read GO WITH CHANGES and draft 6 applies its corrections (§14.5).** Where this plan and `prd_v4.md` (draft 5 with Amendments 1 to 4, Amendment 4 at draft 6) disagree, the PRD wins. Nothing is built on Amendment 4 before the owner confirms this revision (§14.6).
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

**What the gate cost and bought.** Four Codex passes, about 15 minutes of model time, 42 distinct findings (19 + 18 + 5), all accepted, none declined; round 2 re-checked the first 19 and round 4 re-checked the round-3 five. (Revisions 7 and 8 said 61, counting the round-2 re-checks as new findings; the adversarial review in 12.11 caught the arithmetic.) The board's directive was that the PRD and the plan pass through Codex before building; they have, and the record of every finding and its disposition is in this section and the review files beside it.

### 12.10 After acceptance: the owner's operational answers (2026-10-10 18:03Z and 18:06Z)

The owner accepted plan revision 7 at 17:48Z (PRD v4 draft 5 is the product contract; the Dominaria slice is authorised). PR #106 put `prd_v4.md` and this document on `main` at `65c581b`, and the tag `web-edition-v1` marks `c1d6ef7`. Three child issues carry the slice: DEC-951 (project skeleton, hosted compile job, self-hosted runner), DEC-952 (temperate kit sources with credits; Scryfall desktop-client re-verification) and DEC-953 (the slice, blocked on both).

The owner then answered the operational questions and one recommendation, and `prd_v4.md` Amendment 1 records the results:

| Question | Owner's answer | Effect |
|---|---|---|
| Unity on the reference machine | Installed and signed in | DEC-951 starts the Unity-dependent parts. |
| Runner account | "Any problem with using my own user session?" | None. The agents already run pull request code as the owner's user, so a dedicated account isolates nothing. PRD 8.8.6 amended: the runner runs in the owner's session; a dedicated account is optional hardening; the agents create the registration token through the repository's Actions API. |
| Editor days | As sketched in PRD 9.5 | Recorded on DEC-953; calendar dates confirmed at kick-off. |
| Distribution host (PRD 7.7.2 rider) | Asked for a recommendation; accepted it | The repository has been public since 2026-09-21, so its own Releases are public downloads. PRD 7.7.2, 8.9.1 and 11.7 amended: binaries are published as GitHub Releases on this repository, one per tag with the data hash in the notes; itch.io is an optional landing page. |

The Fan Content Policy classification (PRD 11.1) stays the owner's gate before any distribution, friends included. It does not block the slice.

### 12.11 Adversarial review of the workflow proposal (2026-10-10 20:42Z): verdicts, triage, corrected recommendation

**Why.** At 20:29Z the owner asked for an opinion on an article (Claude Opus 5.5 with Blender and Unity 6 through MCP, one brief, a rules file, sub-agents with a reviewer who only looks, greybox first, a lessons file). The CEO's answer at 20:36Z proposed five workflow adoptions and a pick card. At 20:42Z the owner said: "launch an adversarial review of your proposal and reasoning, then I'll decide."

**Run.** Two independent reviewers, the same prompt and inputs, read-only, no access to the CEO's reasoning beyond the proposal itself. Inputs: the proposal and card, the article, `prd_v4.md` (draft 5, Amendments 1 and 2), this document at revision 8, the README on `main`, and a fact sheet the CEO checked against `origin/main` at `ba928b2` (no root `AGENTS.md` or `CLAUDE.md`; README names `prd_v3.md` as the contract; no `docs/lessons.md`; the engineers' instruction files describe the deck project). The brief: attack factual claims, consistency with PRD v4, policy and security risk, the reasoning method, and steelman "take none now" and "take all before the slice". Reviewer 1: Codex (`codex-cli` 0.156.1, `gpt-6-astra`, reasoning high, read-only sandbox; one false start on a missing login, then about 4 minutes). Reviewer 2: a fresh Claude general-purpose agent (about 6.5 minutes, 21 tool calls). Prompt, fact sheet and both reviews are beside this file as `dec950-adversarial-prompt.md`, `dec950-adversarial-ground-truth.md`, `dec950-adversarial-review-codex.md` and `dec950-adversarial-review-claude.md`.

**Verdicts.**

| | Codex | Claude agent |
|---|---|---|
| 1 Root brief | ACCEPT WITH CHANGE | ACCEPT WITH CHANGE |
| 2 Lessons file | DEFER | REJECT |
| 3 Look before hand-off | REJECT as written | ACCEPT WITH CHANGE (as a CI artefact) |
| 4 MCP, bounded | DEFER | DEFER |
| 5 Reference boards | DEFER | ACCEPT WITH CHANGE (links, not copies) |
| The reasoning | UNSOUND | SOUND WITH CORRECTIONS |
| Strongest alternative | "take none now", except the onboarding fix | "take none now", except the two-hour README and brief fix |

Both reviewers found the same substance. The CEO accepts every finding; none is declined. The method defect they name is real: four claims ("already ours", "no owner", "ten checkpoints", "nothing delays the slice") were checked against memory instead of the PRD, and two changes rode under the card without being options on it.

**Triage.** C = Codex finding, K = Claude finding.

| # | Finding (merged) | Raised by | Disposition |
|---|---|---|---|
| 1 | Capturing "the ten 9.3 checkpoints inside the slice week" cannot be done as written: checkpoints 7, 8 and 10 are outside the slice's scope (9.5), checkpoint 6 is a sound clip, and the week has no slack (12.5 F7, F29, F41). | C-A1, K-A3 | Accepted. Captures become an artefact of the self-hosted bench job (8.8.5), scoped to the slice's checkpoints: hub arrival and portal; Dominaria plaza and the view down a wedge; a site at close range with the artist label; card view with the printings panel; the reduced-motion arrival. The capture list joins the bench harness design item that 9.5 already lists as a prerequisite. No slice-week cost is claimed; if the harness runs late, captures are the first thing dropped. |
| 2 | A capture run by hand, or a live MCP editor, on the reference machine collides with the runner: the bench job fails if any other Unity process is running (8.8.6), and pull requests touching `unity/` wait with no bypass (8.8.5). 8.8.7 says the reviewer, never the implementer, runs the bench and captures. | K-A4, C-A6 | Accepted. No implementer run by hand on the reference machine; the implementer reads the CI artefact. Any editor bridge on this machine needs a lock protocol in `docs/ci-runner.md` first. |
| 3 | The reviewer's "look verdict" before the owner sees the captures was slipped in as "already ours" and would anchor the judge that 9.3, 9.4 and matrix row A name. | C-A9, K-A5 | Accepted. Withdrawn. The reviewer's verdict covers the objective items (artist line, no tint, no stretch, the figures). The owner judges the look. |
| 4 | "The four bespoke pieces have no owner yet" is wrong for the portal ring: it is the hub's hero set-piece and the owner's work (5.3.1, 5.6.4, 8.12.3). 7.6.4 says engineers do not author binary assets, so Blender scripting by engineers is a PRD amendment, not a workflow tweak, and Blender is in no CI job. | C-A7, K-A1 | Accepted. The Blender clause is struck from adoption 4. The portal ring is the owner's. Plinth, waystone and marker stone have no named owner yet; whether an engineer may script them in Blender is a separate 7.6.4 and 8.12 decision, not asked today. |
| 5 | Boards of "real-world photos" and card images committed to a public repository: card images are "never mirrored" (4.15.2, Appendix E.8); photos carry no licence; a board is not an Appendix C field (4.12 is a validated pipeline input emitted into the pack); "a plane's basic lands" is not a defined object (11.11); the 9.3 plane-recognition criterion applies only to heroes with their set-piece, which the slice excludes. | C-A3, C-A10, K-A2, K-A9 | Accepted. Boards are link lists under `docs/boards/<slug>.md`: Scryfall printing links, photo links, one sentence each. Only CC0 or owner-made images are copied, each with a source row. Nothing ships in a build. No Appendix C field. Boards inform hero set-pieces and theme-row tuning; they do not raise the slice's acceptance to the finished hero standard. |
| 6 | "Nothing in it should delay the slice" was unsupported: a one-engineer-day brief timed "before DEC-953 starts" is on the critical path once PR #111 merges; the cost figures were estimates; the capture item was 10 percent of the week. | C-A4, K-A7 | Accepted. The brief is not a gate on DEC-953. The README fix and a pointer-only brief take hours, not a day. The no-delay sentence is withdrawn; the replacement card carries a cost per item. |
| 7 | The authority order "PRD v4, then the plan, then docs" was incomplete: v3 sections 3 and 4 and Appendices A and B stay in force, the committed pipeline tables are canonical, and the data and navigation contracts are frozen (PRD header; README). Restating rules in the brief makes a second copy that drifts. | C-A5, K-A8 | Accepted. The brief cites section numbers and files only. The README lists PRD v4, v3's surviving sections and the frozen contracts. |
| 8 | The lessons file duplicates contract text: its three examples are already 8.8.7 with DEC-878, 5.4.11, and 8.4.4 tests (a) to (f). The real gap is that no engineer loads them, a pointer problem. A third store, pruned weekly, has no supersession rule and can contradict its sources. | C-A12, K-A6 | Accepted. Adoption 2 is dropped from the recommendation. The brief points at `docs/decisions/`, PRD section 12 and this document's section 12 as the record. Revisit after the slice retrospective if a process lesson has no home. |
| 9 | MCP "bounded" was a permission statement with no enforcement: Play Mode executes project code; `blender-mcp` runs arbitrary Python in the session that hosts the runner; the evaluation had no deliverable or acceptance criterion. | C-A6, K-A11 | Accepted. Deferred to after the slice. The deliverable is a `docs/` note: tool allowlist, workspace isolation (never the runner's or the owner's project path), the lock protocol, `blender-mcp` off by default, and a go or no-go. No day-one use by the slice engineer. |
| 10 | Several claims were overstated or unverifiable from the inputs: "CC0 by decision" (8.12.1 says CC0 or owner-made); "Wave 5's seven legs" (Wave 5 is uncut; the seven legs are this document's superseded §8); "each engineer enters with the issue text alone" (the README does say read the contracts first, but names the wrong one); "only the reviewer and you see the running build" (the implementer runs PlayMode and the bench in batchmode; what it lacks is pictures); PR #85, "24 assets" and the Unity MCP licensing claims. | C-A8, K-A10 | Accepted; the record is set straight. The repository facts were checked by the CEO on `origin/main` at `ba928b2` and are in the fact sheet. PR #85 and the RED `main` are DEC-878's record in the CEO's instruction file. The 24 assets are PR #108's `CREDITS.md` rows. The Unity MCP licensing and command-line claims come from the four cited sources and are untested. The four wordings are corrected above. |
| 11 | The article was partly answered with positions it did not take: it never proposed one brief instead of design documents (its step 3 keeps them), an unreviewable MCP write loop, or sub-agents instead of issue tracking. Two real adoptions were missed: a one-page slice brief distinct from the PRD, and an owner "play it" loop on the early greybox (9.5 schedules no owner walk before the image path lands on day 3). | C-A11, K §3 | Accepted. The three "what not to take" items stand as our own boundaries, not as answers to the article. Two additions: DEC-953's description gets a "read first" header (order of authority, conventions by section number, the day plan, the matrix), which is the slice brief; and a no-cost sixth item: the owner walks the day-2 greybox (controller plus plinths) for twenty minutes inside their scheduled editor time and answers question 3 early. |
| 12 | The pick card hid a dependency (1 pointed to 2), carried two unlisted changes (the look verdict, the Blender clause), stated the recommendation in its help text, and had no defer option. | C-A13, K-A12 | Accepted. The card is withdrawn and replaced: a cost per item, no hidden items, a defer option, the recommendation in the comment and not on the card. |
| 13 | "The reviewer draws on the merged head" can be read as a draw after merge. | C-A2 | Accepted as wording. The rule is unchanged: the reviewer draws on the PR head merged with `main` through `git merge-tree --write-tree`, before merge; no figures, no merge. |
| 14 | 12.9 says "61 findings (19 + 18 + 5 + the 5 re-checked)", which is 47. | C-A13 | Accepted. The count is 42 distinct findings (19 + 18 + 5), all accepted. The 61 counted the round-2 re-check of the first 19 as new findings. Corrected in 12.9 of this revision; the repository copy is corrected in the next documents pull request; the CEO's 17:15Z comment on DEC-950 carries the same error. |

**Corrected recommendation.** Take 1 now as corrected (hours, not a gate on the slice). Take 3 as a CI artefact scoped to the slice, inside the bench harness design item, dropped first if the harness runs late. Take the new sixth item, the owner's day-2 greybox walk, at no cost. Take 5 as link lists under `docs/boards/`, on the owner's own time. Defer 4 to after the slice, without the Blender clause. Drop 2. Both reviewers favour "take none now" over "take all before the slice", with the onboarding fix as the exception; the corrected recommendation differs from theirs only in taking the capture artefact and the greybox walk, both of which cost the slice week nothing on paper and are dropped first if they cost it anything in practice.

**Method correction for the CEO.** Every "already ours", "none" or "no owner" claim in a proposal cites the PRD section or the file; nothing rides under a card that is not an option on it; a cost figure names what it displaces. Recorded in the CEO's patterns memory.

### 12.12 The owner's picks on the workflow card (2026-10-10 21:00Z) and the work they open

The owner took every option on the corrected card: 1 (root brief, corrected), 3 (captures as a CI artefact), 6 (the day-2 greybox walk), 5 (reference boards as link lists) and 4 (the MCP evaluation after the slice). Item 2 (the lessons file) was not on the card and stays dropped. The picks are converted as follows; none is a gate on DEC-953.

| Pick | Work | Owner of the leg | Where |
|---|---|---|---|
| 1 Root brief, and 5 boards format | **DEC-959.** The README contract table lists `prd_v4.md` first, v3's surviving sections and the frozen contracts; a pointer-only root `AGENTS.md` (at most 60 lines, every line a file or a section number) with `CLAUDE.md` importing it; `docs/boards/README.md` (the link-list format: Scryfall links never copied, only CC0 or owner-made images copied with a source row, nothing ships, not an Appendix C field) and two empty templates (`dominaria.md`, `temperate.md`) for the owner; the plan's repository copy synced to this revision (which carries the 12.9 correction to 42 findings); a four-line PRD erratum, because 8.8.3, the 9.5 scope and day-3 lines and risk 8 still say five image-path tests where 8.4.4 and matrix row I say six, (a) to (f). One documents pull request, about half a day. | Design System Engineer; the reviewer is cut at hand-back and is neither the implementer nor the slice engineer | child of DEC-950, todo |
| 1 (the engineers' own instruction files) | An "Eternities: read first" section, pointer-only, in each engineer's instruction file in the agents repository: read the root brief first once it exists; the order of authority; 7.6.4, 8.2.5, 8.8.5, 8.8.6, 8.8.7, 8.12, 8.11 by number; where decisions live; no lessons file. While doing it the CEO found that the Interactive Tools Engineer's file had been deleted in the 2026-05-05 team refactor (agents repository commit `b938316`) while the agent record still pointed at it, so that agent had run without instructions since; the file is restored with the handoff protocol and the comms guideline. | CEO (agent configuration, not product files) | agents repository, commit `6b4f869` |
| 3 Captures | A section added to DEC-953's description, inside the bench harness design item that 9.5 already lists: the self-hosted bench job writes the slice's five checkpoints (9.3 items 2, 3, 4, 5 and 9) as PNG files and uploads them as a run artefact on every pull request that touches `unity/`; the implementer reads the artefact; nobody runs captures by hand on the reference machine (8.8.6); the reviewer's draw at hand-back is unchanged; dropped first if the harness runs late, and never a matrix row. | Founding Engineer, inside DEC-953 | DEC-953 description and comment `6ad4f176` |
| 6 Greybox walk | Same section: inside the owner's day-2 half day, after the controller, the follow camera and the plinths are in, the owner walks Dominaria for twenty minutes and answers question 3 early; the commit and the window are named in the day-1 post of the owner's day-2 tasks; the answer goes in the day-2 log; the owner judges question 3 again on the finished slice. | Owner, inside the scheduled editor time | DEC-953 |
| 4 MCP evaluation | **DEC-960.** A documents note, `docs/mcp-evaluation.md`: which bridge (Unity's own server against the open-source "MCP for Unity"), tested against the pinned editor and the Personal licence; a tool allowlist (reads: scene inspection, console, screenshots, Play Mode; writes: only hand-authored text assets, never generated scenes); workspace isolation (its own project copy, never the runner's workspace or the owner's open project); the lock protocol with the runner (8.8.6), written into `docs/ci-runner.md` if the answer is go; `blender-mcp` off by default (it executes arbitrary Python as the owner's user in the session that hosts the runner); security on a public repository; cost against DEC-953's day logs; go or no-go. Two days, time-boxed. No product code, no change under `unity/` on `main`, no Blender authoring by engineers. | Interactive Tools Engineer | child of DEC-950, blocked on DEC-953 |

Two things surfaced alongside and are relayed to the board on DEC-950: the Founding Engineer's finding of 21:00Z that some agent runs receive a per-run `HOME` without the owner's `gh` keychain, git identity or Git LFS filter (the working rule until fixed is `HOME="$PAPERCLIP_GITHUB_HOST_HOME"` for `gh`, `git commit` and `git lfs`); and the missing instruction file above. Nothing in this section changes `prd_v4.md` beyond DEC-959's erratum. The 11.1 classification stays the owner's gate before any distribution.

---

## 13. After the slice: the engine verdict, the owner's words, and the design proposal (2026-10-12)

Revision 11. §12 stays as written. This section records what the slice settled, what the owner asked for on 2026-10-12, and a design proposal with three directions for the owner's choice. Nothing is built on the new direction until the owner picks, the PRD is amended, and the amended PRD and this plan pass Codex (the owner's standing instruction of 2026-10-10 15:58Z).

### 13.1 What the slice settled

PR #115 is on `main` at `e79a195` (DEC-953; reviews DEC-976 and DEC-977, both APPROVE, the camera fix of DEC-975 included). The matrix of `prd_v4.md` 9.5, as the reviewer drew it at `237c8aa` and re-read at `3d41c7a`:

| Row | Result | Figures and basis |
|---|---|---|
| D | Pass | The scope shipped in the week. Owner editor time: 13 minutes of the 2 days; the owner handed the editor parts to the engineer on 2026-10-11 at 16:50Z. |
| R1 | Miss, on p90 alone | HDRP high, warm, native: p90 28.18 ms against 20 ms. p99 30.83 ms, longest 49.76 ms and GPU 3.79 GB pass. The volumetric fog at its medium tier, which the owner kept, is 12 to 13 ms of the frame. |
| R2 | Pass: degraded pass 1 | HDRP medium, warm, native: p90 16.00 ms, p99 17.55 ms, longest 49.45 ms, GPU 3.01 GB. |
| L | Not run | The owner has no MacBook Air (2026-10-12 10:09Z). Treated as the matrix treats a miss: the light Mac is suspended as a gating target pending Wave 5. |
| C | Recorded | Cold p90 within 0.1 ms of warm at both levels. 301 images from Scryfall in each cold run, none failed. |
| I | Pass | The six image-path tests pass with the exhibit-camera design. |
| A | **Artistic miss** | Question 3 is a no (13.2). Questions 2 and 5 are yes. Question 4 is partly: movement, card view and the river's sound yes; the camera was fixed on DEC-975; the water is "okish". |

Consequences in force:

- **Degraded pass 1** (9.5 row R2): Wave 5 makes HDRP medium the reference machine's ceiling setting and HDRP high a target; 7.2's first three rows are relabelled in the next amendment. The engine is not in question. At HDRP medium there is 4.0 ms of room at p90; the trial of photographic CC0 props (DEC-953, 2026-10-11 21:20Z) cost 1.0 ms of it.
- **The light Mac is unmeasured.** Wave 5 decides between a URP build variant and dropping the target (11.5).
- **Row A:** change the design, not the engine; record what failed. This section is that record.

### 13.2 What the owner said

Question 3 on the finished slice (DEC-953, 2026-10-12 10:09Z):

> it's still a radial chart. I mean, the card stands are all together in circles going from the center until almost the end of the map. it's like I'm moving through a radial museum of card stands, it's not like I'm in a world discovering cards as I journey to discover this amazing world (plane) I'm in. I wanted this to be more like an experience in knowing the planes history. I venture into the plane's world, it's modelled as the plane is described in the MTG lore and then I go through its history and can read about it and see the cards that are related to that part of the plane's history. it should be a historical experience kind of "game" with amazing visuals and lighting and sounds and music

Question 4 on the same card: "the river and the lake are okish but I would like them to be translucent water with sea life (fishes, corals, algae, etc)".

The two earlier cards. What makes it a chart (2026-10-11 20:21Z): the rings, the rows, the straight paths, the empty outer bands, the plaza. The trial pictures (2026-10-12 08:52Z): the photographic models are "partly" the look and go in after the slice; still wrong on them: the same tree repeated, pale, the rocks, the bushes, the colour, too sparse; and "missing more environment features, leaves flowing in the wind, trees moving with the wind, birds flying, fish in the water, those types of details. details that actually make me believe I'm in a world".

### 13.3 What that means against PRD v4

Four asks, each with a different weight against the contract:

1. **The layout.** The law of 5.4 (colour is the wedge, time is the radius, each set is a site) produced what it says: a wheel. The slice's figures on Dominaria: 824 m across; 36 bands with a width, 28 of them at the 6 m minimum; a plaza of 20.6 m radius; 5,955 of 6,271 stands facing a ring path; 610 stands with no neighbour within 8 m; from 103 m outward the bands are 6 m rows. 5.4.16 named the risk and gave the slice the question; the answer is no. This changes goal 4, 5.1.4, the 3.1 entities and 5.4. It is the main item.
2. **History.** "Go through its history and read about it" reverses non-goal 9 ("no plane descriptions, no story text") and adds a content type the product has never had: authored text. A museum has placards, so this is not a policy problem by itself. It is a maintenance, accuracy and licence question (13.5).
3. **Lore-modelled worlds.** "Modelled as the plane is described in the MTG lore" takes goal 3's hero set-piece further: not a landmark in a kit world but a world whose geography follows the lore. For twenty hero planes that is owner authoring at a scale 8.12.3 already put at 20 to 40 owner-weeks for set-pieces alone. The data can carry part of it (13.4).
4. **Life in the world.** Wind in trees and grass, drifting clouds and particles are already 5.1.3; the slice's kit subset had none of them, and they were Wave 5 leg 3 work, not slice scope. Birds, fish, corals and algae, and translucent water, are new content. Photographic props are a budget change (7.2's kit row and 8.12.1's model cap).

Not changed: goal 1. A road through a plane's history with reading stones is a museum trail. No objective, no completion, no score. The word "game" in the owner's quote stays out of authored text (9.1.6). Scryfall's "create new games" clause (`docs/scryfall-policy.md` §11.9) bears exactly as before. The 11.1 classification stays the owner's gate before any distribution.

### 13.4 What the data can carry

Checked on Scryfall on 2026-10-12 against Dominaria's 35 sets in Appendix B (6,576 non-basic cards by Scryfall's count; the dataset has 6,271 after the v3 exclusion rules):

| Signal | Count | Use |
|---|---|---|
| Sets in release order | 35 sets, 1993-08 to 2022-11 | Today's time axis. It is not the lore's order: The Brothers' War (2022-11) depicts the same war as Antiquities (1994-03), thousands of years before Dominaria United (2022-09). An era table has to be curated; sets then map to eras by rule. |
| Story Spotlight cards (Scryfall `story_spotlight`) | 54 on Dominaria; 384 across Magic. The flag exists since 2017, so only `dom`, `dmu` and `bro` carry it | The headline exhibits of an era, chosen by Wizards, no curation. Old eras have none. |
| Cards whose name carries a region word (24 words: Tolarian, Shivan, Urborg, Benalish, Llanowar, Keldon, Yavimaya, Phyrexian, Otaria, Vesuva, Zhalfir, Jamuraa, Thran, Argoth, Koilos, Serra, Academy, Femeref, Kjeldor, Balduvia, Suq'Ata, Sarpadia, Icatia, Ice Age) | 326 of 6,576, about 5 percent | A keyword table places these in their region. The other 95 percent go where their era or set goes. |
| Legendary creatures | 368 | The people of the plane; candidates for an era's "who was here" group. |
| Planechase cards typed `Plane — Dominaria` | 9; 185 across Magic | Wizards' own pictures of the plane's places (Academy at Tolaria West, Isle of Vesuva, Krosa, Llanowar, Otaria, Shiv and others). Whether they are in the dataset depends on the v3 set-type rules; a pipeline leg checks. As exhibits they are card images: flat, credited, compliant. |
| Flavour text | On the card image | Already shown. No extra text is needed for it. |

So eras and regions are curated tables, text, one set per hero plane; the cards' assignment to them is derived by rule (set to era, keyword to region, Story Spotlight to headline). The picture stays mostly the data; goal 4 gains two curated tables beside Appendix C.

### 13.5 The reading layer: form, words, accuracy, policy, scale

- **Form.** A reading stone at each era's site: the era's name and its place in the plane's history, one to three short paragraphs, the sets that depict it, the headline cards. Text only, no voice. The map draws the trail. No counter of stones read; the recently-visited list stays as it is.
- **Words.** Every paragraph is written by us in our own words. Each era row names its sources: the cards themselves, Wizards' published story index, the MTG Wiki. The MTG Wiki's text is CC BY-NC-SA 4.0 (read at mtg.wiki on 2026-10-12); copying it would put our text under the same licence, so no sentence is copied. Facts carry no licence.
- **Accuracy.** An engineer drafts from the named sources; the reviewer checks every sentence against a source and rejects any sentence without one; the owner accepts the text under 9.3. A model's own knowledge without a source is not a source.
- **Policy.** Appendix E gains one item: lore text is our own words, names its sources, and quotes no Wizards story text. Non-goal 9 is reversed by owner decision only.
- **Scale.** Dominaria: about 10 eras, about 20 paragraphs. Twenty hero planes: about 150 eras. Kit planes: no prose; their trail is the sets in release order with names and years.

### 13.6 Three directions

**Direction A: lore-shaped hero worlds with an era trail (the owner's ask in full).** Per hero plane, three curated tables: regions (6 to 12 named places from the lore, each with a biome, a rough position and a size weight), eras (in lore order, each with its sets, its region, its paragraphs and its sources), keywords (word to region). The pipeline builds the terrain from the region table (biome per region, water on borders, roads between regions), places each card in its region or in its era's region, then in natural clusters (a grove, a ruin, a camp) with stands in groups of three to eight facing a winding path. A road runs through the regions in lore order with a reading stone at each era. Kit planes get the same cluster placement on one biome with a data-derived trail (sets in release order) and no prose. Pockets are unchanged.
Cost, engineer-days on top of Wave 5's uncut 40 to 60: allocator v2 with its checker and fixtures, 10 to 15; terrain from a region table, 5 to 8; the reading layer (stone, map trail, text in the pack), 5; pipeline tables, validation and the Scryfall flags, 5. Owner: 2 to 3 days of tables per hero plane, or 1 day of review per plane if an engineer drafts, plus the set-piece time 8.12.3 already counts. One-way doors: non-goal 9 reversed; goal 4 becomes "the data plus three curated tables"; colour leaves the map and becomes a cue on the stand, in the HUD and on the map; a hero plane without its tables reads as a kit world.

**Direction B: an organic layout, no lore.** The same data law (colour class, set), new geometry: no plaza wheel, no rings. Sites are clearings scattered over the terrain, with district blobs for colour and a soft chronology (older sets near the arrival, newer ones farther, along winding roads). Stands stand in groups of three to eight facing a path; density varies, dense by the roads and sparse at the edges; the world is sized by its content, not by its busiest band. Non-goal 9 stands; no text.
Cost: allocator v2 with checker and fixtures, 8 to 10 engineer-days; no owner tables. What it does not do: it gives the owner no history, and it may still read as a museum in a field. It is the base layer Direction A needs in any case.

**Direction C, recommended: staged. B as the law for every world; A on hero planes in Appendix C.1 order, Dominaria first.** Wave 5 leg 1 builds the organic allocator. Dominaria gets its three tables and the era trail, and the reading layer ships with Dominaria. Each later hero plane gets its tables when its set-piece is built, in C.1 order. Kit planes read as B. The first judge is a second one-week Dominaria slice on the new law, with the photographic props, wind on the vegetation and the reading stone, before Wave 5 is cut. Question 3 is restated: "from the avatar's height, does Dominaria read as a place with a history?"
Cost: B now; A's Dominaria parts in the second slice; about 25 to 33 engineer-days in all (allocator v2 10 to 15, terrain from regions 5 to 8, reading layer 5, tables and pipeline 5), of which the second slice takes the first week. The other nineteen heroes follow over the staged releases. One-way doors as A, taken one plane at a time.

What I would not do: author every hero plane's tables before the first distribution (twenty table sets before anyone walks one world is the plan that never ships); drop the data law for hand-placed stands (the picture stops being the data, and every refresh becomes owner work); keep 5.4 and dress it harder (the owner's five reasons are geometry, not dressing).

### 13.7 The content asks beside the layout

- **Photographic props.** The trial's answer stands: better, 1.0 ms at HDRP medium, "partly" the look. The next step is a per-kit asset pass with the owner's six corrections (more than one tree species, colour, rocks, bushes, density, paleness) under an amended 7.2 kit budget. Proposal: kit at most 250 MB cooked; first release is core plus the temperate kit plus Dominaria; the other kits follow in staged releases, as hero set-pieces already do. The archive ceiling is kept by staging, not by raising it.
- **Wind, clouds, particles.** 5.1.3 as written; Wave 5 leg 3 kit work. No decision needed.
- **Birds, fish, corals, algae, translucent water.** New content: HDRP water's absorption and refraction settings for translucency; underwater props; a simple flocking and schooling behaviour for birds and fish. 3 to 5 engineer-days plus assets for each kit that has water or sky life. Proposal: a stretch item in the second Dominaria slice, dropped first.

### 13.8 Sequence

1. The owner picks a direction and answers the three design questions on the card of 2026-10-12.
2. The CEO writes the PRD amendment (Amendment 4, or a v5 if the law is replaced; the content matters, not the name): goal 4, 5.1.4, the 3.1 entities (region, era, trail, reading stone, cluster), 5.4 replaced, 5.6 and Appendix C fields, non-goal 9, 7.2 budgets and the degraded-pass relabelling, 9.3 criteria, the Appendix E item, section 11.
3. Codex review of the amended PRD and this plan, as the owner's standing instruction requires; triage in this document; owner confirmation on the plan revision.
4. A second Dominaria slice, one engineer, one week, with its own acceptance matrix.
5. Wave 5 is cut after it.

Nothing is built on the new direction before step 3 is passed. DEC-978, DEC-979, DEC-960 and DEC-972 continue as housekeeping on the shipped slice.

---

## 14. The owner's decision after the slice (2026-10-12 15:07Z) and PRD v4 Amendment 4

Revision 12. §13 stays as written. This section records the owner's four answers on the design card of 2026-10-12, the PRD amendment that implements them, the two readings the CEO had to make, the Codex gate on the amended documents, and the sequence that follows. Nothing is built on Amendment 4 before the owner confirms the plan revision that records a passed gate.

### 14.1 The decision

| Question | Owner's answer | Effect |
|---|---|---|
| Direction | **Lore for every hero plane before the first distribution: all twenty table sets are written first, then the worlds are built from them.** *(Confirmed on 2026-10-12 at 17:40Z with the 11.21 sequence: Dominaria's tables first and the second slice before the other nineteen; all twenty accepted before any distribution.)* The owner chose Direction A at full scale over the staged Direction C the CEO recommended (§13.6). | The journey law replaces 5.4 on every world; every hero entry gets three lore tables (regions, eras, keywords); the first distribution waits for all twenty accepted table sets (`prd_v4.md` 4.16.5, 8.12.4, 8.12.7). The CEO's reservation stands on the record (§13.6, "what I would not do") and the decision is the owner's; risk 20 and 11.21 carry the mitigation and the one reading it needs. |
| History text | An engineer drafts each era's paragraphs in our own words from named sources; the reviewer checks every sentence against a source and rejects any without one; the owner accepts the text. | 5.13, 4.16.6, 8.12.7, Appendix F. One source per sentence is machine-checked; the reviewer is never the drafter; the sources are shown to the visitor. Owner time falls from the card's 40 to 60 days to about half to one day per entry. |
| Colour | A cue, not geography: the plinth's rim, the hover label, the HUD legend and the map show it; filters still work by colour. | Wedges, bands and rings are retired; the rim on every plinth in every kit (5.5.1); the legend and the map's dots (6.3); no dressing follows colour (5.6.3). |
| Props | Photographic CC0 models with the owner's six corrections under a 250 MB kit budget; the first release ships core, the temperate kit and Dominaria; the other kits follow by release *(confirmed on 2026-10-12 at 17:40Z as 8.12.6 reads it: every kit in the first release, the temperate kit at photographic, the photographic standard reaching the other kits release by release)*. | 7.2's kit rows (basic 60 MB, photographic 250 MB); 8.12.1's bar; 8.12.6's kit standard and staging; the archive may be several files under 2 GB (8.9.1). |

### 14.2 What Amendment 4 changes in `prd_v4.md`

- **The journey law (5.4, replaced in full; rewritten in draft 2 after Codex round 5, 14.5).** The trail runs through the plane's history; each era is a site; cards stand in clusters of three to eight beside a site's winding path; colour is on the stand. On a hero world the regions are the lore's places (a power diagram of the region table's anchors) and the trail visits the eras in lore order; on a kit world the trail runs through the sets in release order on one biome. The allocator keeps the first print's machinery (global lattice, jitter, reservations, inflated candidate tests, checker, integer millimetres, bounded loops) under new geometry: site blobs sized by count and deformed by the PRNG, serpentine sweeps with wobble, cluster slots alternating sides with caps drawn from three to eight, a trail routed by A* on a 5 m grid and wobbled, chapters along an era's path, and nine named failure modes (5.4.12). The rows risk is named with its alternative, a branching path (5.4.17, 11.17).
- **Entities and invariants (3.1, 3.2, 3.3):** region, era, keyword, cluster, chapter, trail, stone (reading, way, marker, chapter), lore tables; invariant 7 reassigned, 8 extended, 9 restated by geometry type, 10 restated for the trail, 11 new (chapter order and keyword regions, asserted by the checker).
- **Lore tables (4.16, Appendix F):** three JSON files per hero entry with the schema, the validation (every set in exactly one era; one source per sentence; host allowlist; limits per sentence and era), the emission (`lore/<slug>.json`), the retained `story_spotlight` flag, and the distribution flag that makes the twenty table sets a release gate without blocking development.
- **The reading layer (5.13):** the reading stone and its overlay (text, sets with chapter travel, headline cards with stand travel, a sources fold), the headline rule, the words rules, the review rule, no mechanic, the region sentence in the HUD, the Blind Eternities as product history.
- **Everything the geometry touched:** the pack (4.13: site and cluster indices in `stands.bin`, `worlds/<slug>.json` for geometry), 5.1.4, 5.2, 5.5, 5.6.3 (region dressing), 5.6.4, 5.6.5, 5.9, 5.12, 6.1.3 and 5.8.1 (the first slice's camera and click rules), 6.3, 6.4.5, 6.6, 7.3.3 (streaming by cluster), 8.4.2, 8.4.5, 8.7, 8.8.1, 8.8.3, 8.8.4 (the bench path on the trail), 9.1, 9.2, 9.3 (three new checkpoints, four new criteria), risks 15 to 21, 11.9 resolved, 11.17 to 11.22 new, §12 rows, Appendix C.1's set-piece column, Appendix E.10.
- **The first slice's verdicts:** 7.2's frame rows relabelled (HDRP medium is the reference setting with the 20 ms ceiling; HDRP high a target), 9.5 annotated as the record, 11.22 for the light Mac.
- **The second slice (9.6):** the journey law on Dominaria with its accepted tables, region dressing on the temperate kit's variants, the reading layer, the photographic asset pass; its own acceptance matrix with rows D, T, R, H, I, C and A, and five questions, the first of which is question 3 restated.

### 14.3 Two readings the CEO had to make

The owner's answers were taken as written. Two of them meet each other, and the PRD records the CEO's reading of each as an open question with a default, so the owner can confirm or correct it on the confirmation card:

1. **The first-release kit standard (11.20).** The props answer says the first release ships core, the temperate kit and Dominaria, and the other kits follow by release. The direction answer needs every hero world in the first release, and the hero worlds sit on nine kits. Reading: every kit ships in the first release, the temperate kit at the photographic standard and the other eleven at the basic standard the first slice used, and the photographic pass reaches the other kits release by release (8.12.6). The alternative, a first release with Dominaria alone walkable, would break invariant 6 and goal 3.
2. **The second slice before the nineteen remaining table sets (11.21).** The direction answer says all twenty table sets are written first, then the worlds are built from them. Reading: Dominaria's set is written first; the second slice proves the schema and the law on it; the other nineteen are drafted against the proven schema while Wave 5 is built; nothing is distributed before all twenty are accepted. The reason is cost: a schema change found by the slice after nineteen sets were written would rewrite them. The alternative, all twenty before the slice, is the owner's to choose.

*Both readings were confirmed by the owner on 2026-10-12 at 17:40Z on the round-7 card (14.6): they are the owner's decisions, and `prd_v4.md` draft 5 records 11.20 and 11.21 as resolved. On the same card the owner left the single-allocator ruling of 14.5 to the CEO; it stands.*

### 14.4 Cost and sequence (revised in draft 3 after Codex F62 and F73)

Engineer-days on top of Wave 5's uncut 40 to 60, as estimated, not measured. The second slice is a pipeline tooling leg and two slice legs (PRD 9.6): **leg A**, the pipeline tooling the tables need (lore validation, the acceptance digest and status, the fixture and distribution flags, the Story Spotlight sidecar's validation, the trig table), about 3 days, before Dominaria's tables can be accepted; **leg 1**, the allocator of 5.4 in the pipeline with its checker, the fixtures in scope, the emission of Dominaria's three pack files and the layout report (pull request 1, hosted CI, with a Codex read of the code at review), then the C# decoder, the C# checker on every fixture and the plinth greybox (pull request 2, the runner), about 12 to 15 days in all; **leg 2**, the walkable Dominaria (region dressing and blend, the reading layer, the HUD and map, travel, the bench), about 10 days; each with its review, so about five weeks elapsed. Beside them: Dominaria's lore tables (1 to 2 days to draft, half a day to review, half to one owner-day to accept, after leg A), the Story Spotlight sidecar (half a day, by printing id), the temperate kit's photographic asset pass (1 to 2 days). After them, in Wave 5: the rest of contract v4 and the other worlds through the one allocator (3 to 5 days; draft 2's Python port of a C# allocator, 5 to 8 days, is gone); drafting the nineteen remaining table sets (20 to 40 days, one to two each) and reviewing them (10 days); the photographic asset pass per kit (1 to 2 each, twelve kits 15 to 25 over the releases); the release manifest (1 day). Owner-days: about half to one per table set to accept (10 to 20 over the twenty), the greybox walk and the judging walk of 9.6, at most one editor day across the two legs, plus the set-piece time 8.12.3 already counts. The first distribution date is set by the slowest of the twenty table sets (risk 20).

Sequence: (1) this amendment and the plan pass Codex (14.5); (2) the owner confirms the plan revision, and with it the two readings of 14.3 and the single-allocator ruling of 14.5; (3) leg A opens, and beside it two content legs that need no tooling to start: the Dominaria tables' drafting (acceptance waits for leg A's validation) and the temperate kit's photographic asset pass; the sidecar is fetched; (4) leg 1 of the second slice in its two pull requests, the Codex read of the allocator's code at the first's review, then the owner's greybox walk; (5) leg 2, then the owner's judgement on the matrix of 9.6; (6) on a pass or a degraded pass, the nineteen remaining table legs open one issue per entry beside Wave 5's engineering legs; (7) Wave 5 is cut; (8) the first distribution waits for 11.1 and for all twenty accepted table sets.

### 14.5 Codex review of Amendment 4 and this plan: rounds 5 to 9, triage, drafts 2 to 6

**Run.** `codex exec`, read-only sandbox, model `gpt-6-astra`, reasoning effort high, about 7 minutes, over `prd_v4.md` with Amendment 4 draft 1 and this document at revision 12 (draft), with `pipeline/data/appendix_b.json`, `docs/scryfall-policy.md` §11 and the production `planes.json` as references. Prompt: `dec950-codex-prompt-round5.md`. Output: `dec950-codex-review-round5.md` (1,750 words). The run was started by the CEO run that drafted the amendment, which then died (`adapter_failed`); the process ran on and wrote its output, which the recovery run picked up at 15:41Z.

**Verdicts.** PRD v4 Amendment 4 draft 1: **NO-GO** ("the allocator can produce forbidden geometry, reject valid inputs, and diverge between implementations"). Plan revision 12 draft: **GO WITH CHANGES** ("the conditional sequence is sound, but the slice's scope, outcomes and estimates need correction before execution"). Codex also read the two readings of 14.3 as "reasonable proposed compromises, not literal restatements of the owner's answers" and asked that the confirmation card carry them explicitly, which it does (14.6).

**Triage.** Twenty-one findings: six blockers (F43 to F48), fourteen majors, one minor. All accepted; none declined. Draft 2 of the amendment folds them in; the table names where.

| ID | Severity | Finding (short) | Disposition and where it landed in draft 2 |
|---|---|---|---|
| F43 | blocker | Integer output is not an integer algorithm: rounding, trigonometry, roots, random-range mapping, lattice coordinates, curve sampling and A* ties were unspecified, so two implementations can disagree. | Accepted. 5.4.18, numerical rules: int64 units, round-half-away-from-zero once at the named point, `isqrt`, one committed trig table at thousandths of a degree, an integer hexagonal lattice (x = 3,000 i + 1,500 k, z = 2,599 k; neighbours exactly 3,000 mm), modulo-mapped draws in integer units, exact rational power cells rounded once, polylines sampled every 500 mm, overflow bounds, the Python implementation as the reference. |
| F44 | blocker | Sweeps and joins not constructible: the family was centred on the site centre, not the blob's extent (a deformed blob of r = 150 m put fourteen sweeps outside it); chord ends differ longitudinally, so a semicircle of radius h ⁄ 2 cannot join them; independent wobble disconnects endpoints. | Accepted. 5.4.8: the family is centred on the extent with every sweep at least h ⁄ 2 inside it; both chords are trimmed to the nearer end before a half-turn joins them; the wobble tapers to zero over the 6 m nearest each run's end and half-turns are not wobbled; both ends shortened by 4.5 m (sweep 0's head by 1.5 m) so the apex overshoot is 6 m; the bounding radius b_s = 1.2 r_s + 9 m is proved on the completed path and asserted by the checker. |
| F45 | blocker | Required stones violate exclusions: a pad "3 m disc" read as radius 3 m overlaps a stone 2.5 m away; several one-card chapters in one cluster put chapter stones at the same point. | Accepted. 5.4.1 states radii (pad 1.5 m, stone 0.5 m); the site stone stands 2.5 m from the pad's centre beside it, clear of the pad, the path's head and the trail's approach, on the side farther from the attachment cell; chapter stones occupy a lattice candidate of their own inside the cluster and take one unit of capacity (5.4.10), so two can never coincide; invariant 9 restated. A fixture with three one-card chapters in one cluster (5.4.14). |
| F46 | blocker | Routing permits forbidden intersections: the 10 m endpoint exception unblocked stones and volumes; the smoothed, wobbled 3 m strip had no clearance proof; corner cutting and off-grid endpoints unspecified. | Accepted. 5.4.11: obstacles expanded by 5 m (more than half width plus wobble); no diagonal past a blocked orthogonal neighbour; smoothing only along chords that cross no blocked cell; attachment cells behind the pad within 10 m and straight attachment segments, exempt only from the blob expansion and tested by the checker; the wobble tapers to zero over 10 m at each end; the stone is placed after routing on the far side. |
| F47 | blocker | Acceptance did not imply invariant 9: new footprints were not checked against earlier corridors, corridors not against stones, jitter could move a centre out of the blob, and yaw recomputation voided the translation argument. | Accepted. 5.4.10: the jitter is drawn before the tests and the displaced, oriented geometry is tested directly against every reservation, every accepted footprint, apron and corridor, every stone and the containment rules; yaw is fixed at the lattice point; candidates lie within ρ − j and their j-disc inside the blob (5.4.9). The inflation argument survives only in the capacity estimate. |
| F48 | blocker | Widening invalidated computed geometry: returning to step 5 for one site after the trail was routed, or after placements, left stale reservations and undefined counters and seeds. | Accepted. 5.4.12: capacity for every site (with in-place widening) precedes the trail; an exhaustion at placement widens the site and restarts the pass at step (4), discarding every centre, blob, path, reservation and placement, keeping widened radii and counters, resetting every PRNG; bounds restated (20 passes, 20 widenings per site, so at most 20 × sites restarts per pass). |
| F49 | major | The anchor guarantee was false: (1, 1) scales to 1.131 R, outside the world; widening cannot revive an empty cell. | Accepted. Anchors inside the unit disc (4.16.2, F.0); 5.4.5 and 5.4.6 restated: an empty cell fails on the first pass as a data error; a non-empty cell grows with R² and becomes admissible within the pass bound or fails naming the region. |
| F50 | major | Cluster population and spacing promises disagreed with placement: 3 + 1 on a four-card site, underfilled clusters, a one-candidate slot kept, an 18 m gap against a 15 m criterion. | Accepted. Clusters hold one to eight, three to eight by design; a cluster under three only as a site's last or on a site under three cards, otherwise it exhausts the site (5.4.10, 3.1, 5.5.4); a one- or two-card site keeps the first slot with at least as many candidates as stands (5.4.9); the 9.3 criterion is twenty metres and the layout report lists the largest gap per site. |
| F51 | major | Assignment and navigation lacked matching semantics: invariant 11 said "every keyword" while the allocator selects the first; lattice-row order did not give chapter order by path position; keywords can empty a chapter; empty regions and first chapters had no destination. | Accepted. "Selected keyword" (5.4.3) and invariant 11 restated; candidates ordered by arc length then distance to the path (5.4.9); empty chapters named, with no stone and not listed for travel (5.4.3, 6.6.1); a first chapter's destination is the pad; a region with no site is named on the map without travel (6.3.4, F.1); `worlds/<slug>.json` carries each chapter's destination and each region's first site (4.13.5). |
| F52 | major | The pack could not express or validate the allocator's result: float poses, no corridor points, a set-level assertion for a card-level regional assignment, launch assertions on data loaded later. | Accepted. `stands.bin` carries `x`, `z` as int32 millimetres and yaw as int32 micro-degrees (the reserved bytes used); the world file carries per-stand corridor points and arc lengths; assertions are staged (launch, shard load, world entry) and the regional check moves to the shard load; the stand index is the record position and the join is never by position within a cluster (4.13.3, 4.13.5). |
| F53 | major | The default fixture was incomplete and invalid: 37 Dominaria set codes carry first printings (F.5 omitted `mgb`, `tsb`, `mom` and listed `2ed`, which has none); missing paragraphs failed validation; unaccepted tables fell back to the kit law. | Accepted. F.5 lists the 37 codes (checked on `planes.json` of dataset `a5846bec28d1447e`) with placeholder sentences so it validates; 4.16.5 restated: a development build lays an entry out from any validating tables, accepted or not; the kit law applies only to an entry with no tables; the `--fixture` flag relaxes row minimums for synthetic fixtures (5.4.14). "35 sets" corrected throughout. |
| F54 | major | The hero-volume clipping fixture was unreachable: a bounding disc that avoids every volume and contains the path leaves nothing to cut. | Accepted. Whole-site avoidance: nothing clips a blob or a path (5.4.6, 5.4.7, 5.4.8); the fixture becomes a volume that occupies part of a region so a site moves and a leg routes around it; synthetic one-region, one-era fixtures run under `--fixture`. |
| F55 | major | Published scale estimates contradicted the formula: one floor-radius site gave 158 m across, not 60; Dominaria's lower bound was above 727 m, not 480. | Accepted. 5.4.15 recomputed from the revised constants (A_site 36 m² per stand, floor radius 9 m, b_s = 1.2 r_s + 9 m, R₀ = isqrt(2 Σ b_s²) + 25 m) on the real set counts: Dominaria about 1,100 m, the Blind Eternities about 950 m, Ravnica about 700 m, Innistrad about 600 m, Rabiah about 180 m, one-to-four-card worlds about 140 m, all starting radii before widening; a 7.2 row reports the figure; risk 22 names the knobs and the owner's judgement on the greybox. |
| F56 | major | Provenance validation was narrower than claimed: an allowlisted URL proves neither support nor independent wording; `card:<oracle_id>` cannot locate a printing's flavour text; region sources were absent from the fold. | Accepted. F.0 field types and cross-file checks; F.4 locators (`printing:<scryfall_id>#front` or `#back`), host validation by parsing; the reviewer checks support and independent wording and records the passage relied on (5.13.4); region sources in the fold (5.13.1); "one source per sentence is bookkeeping, not a licence determination" written into 4.16.6, F.4 and E.10. |
| F57 | major | Product-history geography was underspecified: a release-period era has one region while a period spans several set families. | Accepted. F.2: with `kind: product` a region is a set family carrying its `sets` list and an era is one family over one release period; validation checks the family lists cover the plane's codes once and each era's sets lie in its region's list; the era ceiling is 24 for product tables (5.13.8, 4.16.1, 4.16.2). |
| F58 | major | Acceptance survived unaccepted changes: an `accepted` record stayed valid after any edit. | Accepted. The record carries a SHA-256 digest of the canonical three files; the pipeline recomputes it on every run; stale means not accepted for distribution; the twenty-entry roster is asserted; the check runs at pack build and at packaging (F.2, 4.16.5, 5.13.4). |
| F59 | major | The missing-kit fallback had no assets to fall back on. | Accepted. 8.9.1: `release.json` with hashes, versions and install locations; core and all twelve kits required, hero scenes optional; the application refuses to start on a missing or corrupt required file; no kit substitution. |
| F60 | major | Several 9.6 misses had no terminal outcome; question 2 deferred to a Wave 5 that opens only after a pass; the branching path was not an implementable fallback. | Accepted. 9.6 rewritten: every row and every question ends in a pass, a degraded pass (A2, A3, A4) or a stop; a second R miss is a stop with the owner's choice between a content budget cut and a halt, never a renderer change; table changes need re-acceptance; the branching path is an amendment written to the standard of 5.4 and Codex-read before the one re-slice (5.4.17, 11.17). |
| F61 | major | Required inputs and measurements exceeded the slice: the pinned shards lack `story_spotlight`; the bench demanded cross-world travel with no other world in scope; no allocator acceptance result. | Accepted. A Story Spotlight sidecar and the trig table are prerequisites; the bench is reduced and the cross-world row recorded as not run; row K (allocator and checker) added (9.6). |
| F62 | major | Five days was not a supported delivery estimate against the plan's own 10 to 15 plus 5 to 8 plus 5. | Accepted. 9.6 is two reviewed legs of about ten engineer-days each; 14.4 recosted; "one week" withdrawn. |
| F63 | minor | Live cross-references to the old law: 7.1.1 "HDRP high"; risk 7 "site streaming"; a one-card site's "waystone"; 2.1.6's "one Appendix B row". | Accepted. 7.1.1 reads HDRP medium with high as a target; risk 7 reads cluster streaming; 5.4.13 reads marker stone; 2.1.6 names the era row a hero entry needs. The historical 9.5 and the plan's §12 and §13 records are left as written. |

**Changes the CEO made beyond the findings, in the same draft.** Chain placement: a site is placed at the admissible candidate nearest the previous site in site order, so consecutive eras are neighbours and trail legs are short (5.4.6); the first draft spread sites to the cell's far corners. A_site raised from 18 to 36 m² per stand and the floor radius lowered from 15 m to 9 m, from the capacity arithmetic of the sweeps (about 5 stands per 9 m slot at 21 m spacing is about 40 m² per stand), so that sites widen once or twice rather than four times. A slot on a half-turn takes the inner side, where its disc fits exactly. Both the sweep and the trail wobble taper to zero at their ends. The owner's greybox walk after leg 1 (row G) was added so the law is seen on plinths before anything is dressed.

**Confirmation pass (round 6).** Same tool and settings, about 8 minutes, scoped to F43 to F63 on `prd_v4.md` Amendment 4 draft 2 and this document at revision 12. Prompt: `dec950-codex-prompt-round6.md`. Output: `dec950-codex-review-round6.md` (about 1,500 words). The CEO run that launched it died (`claude_auth_required`) while holding for it; the process ran on and the next run picked the verdict up at 16:12Z.

**Verdicts.** PRD v4 Amendment 4 draft 2: **NO-GO** ("the revised allocator still rejects constructible inputs, lacks reproducible numerical operations, and makes guarantees its procedures do not establish"). Plan revision 12: **GO WITH CHANGES** ("validation prerequisites, reference-implementation sequencing and terminal outcomes need explicit correction before scheduling").

**Resolution check of F43 to F63.** Resolved: F45, F54, F56, F59, F63. Partly resolved: F43, F44, F46, F47, F48, F49, F50, F51, F52, F53, F55, F57, F58, F60, F61, F62. Every partial is closed by the draft-3 change named against it below.

**The structural finding, and the CEO's ruling.** Rounds 5 and 6 found the same class of defect twice: a prose contract that asks two implementations in two languages to agree integer for integer leaks at every operation the prose does not name (F43 then F64: rounding of negatives, π, inverse angles, normalisation, strip joins and caps, insets, residual sampling, corner normals, JSON conversion, int64 overflow). Each round closes some and opens others, and Codex's own closing line asks for yet another independent re-review of the contract before implementation. The CEO's ruling in draft 3, recorded in PRD §12 and overrulable by the owner on DEC-950: **there is one allocator, in the pipeline (8.3.3)**. The engine reads integer poses from the pack and never computes a position; the C# mirror of draft 2 is withdrawn, and with it the cross-language contract. 5.4.18 becomes the reproducibility rules of that one implementation: exact rational arithmetic and no floating point anywhere in the allocator or its checker, rounding once at emission with the signed half-away-from-zero formula, a 2 mm margin on every exact test so the rounded geometry satisfies what the exact geometry passed, the committed trig table with a hash, angles from vectors by table search, distance predicates in place of offset-polygon construction, and change control: an operation the text does not name is defined by the reference's code and pinned by the fixtures byte for byte, and a change to it is a reviewed pull request that re-emits them. What the documents no longer spell out is reviewed where it lives: leg 1's first pull request, the allocator and the checker, gets a Codex read of the code at its review (9.6), the owner's documents gate extended to the arithmetic. The cost moves with it: leg 1 grows to 12 to 15 days and Wave 5 loses the 5 to 8 day Python port (14.4).

**New findings F64 to F73.** Three blockers (F64 to F66), seven majors. All accepted; none declined. Draft 3 of the amendment folds them in.

| ID | Severity | Finding (short) | Disposition and where it landed in draft 3 |
|---|---|---|---|
| F64 | blocker | The numerical contract contradicts itself (add 2²⁹ then floor-divide rounds −0.5 to 0) and leaves operations unspecified: π, inverse angles, normalisation, strip joins and caps, insets and expansions, residual sampling, corner normals, JSON-to-integer conversion; squared cross products can exceed int64. | Accepted, by the ruling above. One implementation; exact rationals; no floats; the signed rounding formula; no π (the wobble's phase is 360,000,000 × u ⁄ λ + ψ in micro-degrees); angles by table search; unit directions as exact rational table values; distance predicates instead of constructions; sampling at every 500 mm from the start and at the end point; integer table inputs; unbounded integers in Python and `BigInteger` in the C# checker (5.4.18; F.0). |
| F65 | blocker | A site at the 9 m floor radius can produce an empty path on valid input (amplitudes 1000, 200, 1000; the single chord shortens to 8.73 m, under the 9 m minimum), and the build fails before capacity widening. | Accepted. An empty path is no longer a failure mode: the sweep direction is retried (ten-degree steps, at most eighteen tries) and then the site is widened under the ordinary bounds; the false "cannot happen for r_s ≥ 9 m" sentence is gone (5.4.8, 5.4.9, 5.4.12). |
| F66 | blocker | Attachment can fail at every world widening: site centres on a 10 m lattice keep the same alignment with the 5 m grid, so a pad whose every cell within 10 m intersects the blob's expansion stays unattached through all twenty passes. | Accepted. The attachment no longer depends on the grid: each site has an **approach**, a 3 m strip from its pad outward along the head ray (the ray from the site's centre through the path's head, which leaves a star-shaped blob once and never re-enters) to an approach point 10 m beyond the pad, reserved as the site's own geometry and contained in b_s = 1.2 r_s + 15 m. The approach test requires the strip outside the blob and the point 9 m clear of it, retried over sweep directions and then by widening; the minimum spacing between a site's bounding disc and everything else is 10 m, so the cell holding the approach point is free by construction and the trail's attachment segment is at most 3.54 m long (5.4.6, 5.4.8, 5.4.11). The plaza gets a plaza approach the same way. A fixture with a head ray that meets a lobe (5.4.14). |
| F67 | major | Local order was mistaken for global order: adjacent slots are 9 m apart but candidate intervals overlap, so a later cluster can hold an earlier path position than the previous cluster's last stand; displaced stands kept a stale yaw. | Accepted. Invariant 11 and 5.4.10 define chapter order **by cluster**: a lower slot holds an earlier or the same chapter as any higher slot, acceptance order within a cluster; the visitor meets clusters in slot order. The yaw is recomputed from the displaced position to the fixed path vertex before the footprint, apron and corridor are tested (5.4.10). |
| F68 | major | "Non-empty" does not imply positive area: four anchors with weights 500, 1140, 1140, 500 give a middle cell that is a line at every R. | Accepted. A cell is **degenerate** when empty or of zero area, decided exactly on the rational polygon on the first pass; it fails the build naming the region; the admissibility claim is made only for cells of positive area (5.4.5, 5.4.6, 5.4.12). |
| F69 | major | Exact integer corridor joins are not generally representable: an integer segment can have no interior lattice point, so a rounded projection cannot satisfy an exact on-path assertion; regional assertions found any matching keyword, not the selected one. | Accepted. A corridor ends at the **nearest vertex** of the path polyline (ties by the lower index); the pack carries the vertex index and the decoder asserts the index, not a position (5.4.9, 4.13.3, 4.13.5). The decoder recomputes the selected keyword by the 5.4.3 rule in table order and checks that it names the site's region and differs from the era's (4.13.3). |
| F70 | major | Acceptance lacked one validatable interpretation: sorted keys and no whitespace do not settle `1` against `1.0`, Unicode escaping or negative zero; the `accepted` members had no types; 4.16.2 made a digest mismatch a validation failure while 4.16.5 allowed a stale record. | Accepted. Every number in the tables is an integer (anchors and weights in thousandths; a fraction, exponent, plus sign or negative zero fails validation); the canonical form is fully stated and computed by the pipeline alone; the four `accepted` members are typed; **acceptance status** (accepted, stale, absent) is separated from validity and enforced only under `--distribution` (F.0, F.2, 4.16.2, 4.16.5). |
| F71 | major | Product keywords could move a card out of its family's region; no fifty-set preflight demonstrated the era ceiling. | Accepted. A product table's keyword array must be empty (4.16.2, F.0, F.3). Appendix F.6 is the preflight on the real dataset: 50 codes, 4,204 cards, ten families, thirteen eras, the largest 857 cards, within the ceiling of 24. |
| F72 | major | The scale calculation was wrong: a 600-card site is 217 m across, not 100; tiny worlds start at 106 m and reach 141 m after three widenings; the quoted figures were not labelled as diameters. | Accepted. R₀ gains a third term, 35 m + 2 b_max, so the plaza never forces widenings on a small world; with b_s = 1.2 r_s + 15 m the figures are recomputed on the dataset and labelled as initial diameters before widening: Dominaria about 1,120 m (fifteen era groups, no keyword redistribution assumed), the Blind Eternities about 1,070 m, Ravnica about 750 m, Innistrad about 650 m, New Phyrexia about 610 m, Rabiah about 270 m, one-to-four-card worlds about 175 m; a 600-card site about 229 m across, a 1,000-card site about 287 m (5.4.4, 5.4.13, 5.4.15, risk 22). |
| F73 | major | Prerequisites depended on deferred work: leg 1 needed the lore validation and the digest, which the plan scheduled after both legs; the slice judged C# divergence with no Python reference; the spotlight sidecar lost printing identity; a second Q1 or Q5 rejection ended in "owner decision" without STOP. | Accepted. Leg A, the pipeline tooling, comes before the tables' acceptance (9.6, 14.4); with one allocator there is no divergence to judge, and the C# checker on the fixtures replaces the parity gate; the sidecar lists printing ids and is validated against the dataset (9.6); a second Q1 or Q5 no is a **stop** (9.6 row A). |

**Partials of round 5 closed in draft 3.** F43 by F64's ruling; F44 by F65 (the empty path); F46 by F66 (the approach); F47 by F67 (the final yaw); F48 by 5.4.12's restart, which now keeps every site's widened r_s and widening count across restarts and across widenings of R; F49 by F68; F50 by the path cut: two consecutive void slots end the path, so no two occupied slots on a site path are more than 18 m apart and the twenty-metre criterion of 9.3 holds by construction (5.4.9); F51 by F67 and F69; F52 by F69; F53 by the complete schema example of F.5 (eleven region rows with anchors, era regions, keyword regions; it validates under `--fixture`) and F.6; F55 by F72; F57 by F71; F58 by F70; F60 by F73's stop; F61 by the printing-id sidecar and by row K; F62 by 14.4's recost. The round-6 note that the three-one-card fixture claimed three chapter stones where the after-first rule gives two is corrected in 5.4.14.

**Codex's two reminders stand.** The two readings of 14.3 remain the CEO's compromises, not the owner's words, and the confirmation card asks about both (14.6). Reading stones settle neither the whole-product Fan Content Policy classification nor Scryfall's "no new games" clause, and 11.1 stays the owner's gate.

**Confirmation pass (round 7).** Same tool and settings, scoped to F64 to F73 and the sixteen partials on `prd_v4.md` Amendment 4 draft 3 and this document at revision 12. Prompt: `dec950-codex-prompt-round7.md`. Output: `dec950-codex-review-round7.md` (about 1,500 words). The first launch, at 16:35Z, was killed with the CEO run that started it four minutes later, before any output; the relaunch at 17:18Z ran in a process session of its own and finished at 17:27Z.

**Verdicts.** PRD v4 Amendment 4 draft 3: **NO-GO** ("most prior findings close, but attachment availability and geometric containment remain unsound, and the fixture and path-length guarantees still contradict their procedures"). Plan revision 12: **GO WITH CHANGES** ("the recosted sequence and code-review gate are sound; §14.5 must record the remaining partials rather than claim every finding closed"). **The structural ruling:** "one pipeline allocator is a sound replacement for two implementations"; integer pack poses, the independent checkers and the leg-1 Codex code read "preserve useful safeguards without requiring a second allocator"; unnamed operations may be defined in reviewed reference code; what remained was consistency between that permission and 5.4.18's explicit arithmetic restrictions (F74). Codex adds that fixtures detect regressions but do not prove correctness for unrepresented inputs, which is why row K and the code read stay in 9.6.

**Resolution check.** Of the twenty-six items re-checked, twenty are resolved: F65, F67, F68, F69, F70, F71, F72 (Codex recomputed the diameters: Dominaria about 1,121 m, the Blind Eternities about 1,075 m, Rabiah about 271 m, a 600-card site about 229 m), F73, F44, F47, F48, F49, F51, F52, F55, F57, F58, F60, F61, F62. Partly resolved, each closed by a new finding below: F64 and F43 (by F74), F66 and F46 (by F75), F50 (by F77), F53 (by F78).

**New findings F74 to F79.** Two blockers (F75, F76), three majors, one minor. All accepted; none declined. Draft 4 of the amendment folds them in.

| ID | Severity | Finding (short) | Disposition and where it landed in draft 4 |
|---|---|---|---|
| F74 | major | The numerical rules still prohibit operations the procedure requires: r_s = √(36 n ⁄ π) is irrational; isqrt(2 Σ b_s²) needs an integer argument; arc lengths used rounded segment ends before emission, against "rounding once". | Accepted. r_s = max(9,000 mm, isqrt(K_site × n)) with K_site = 11,459,156 mm², a defined constant; b_s = ⌈6 r_s ⁄ 5⌉ + 15,000 mm; widening steps ⌊11 r_s ⁄ 10⌋ and ⌈11 R ⁄ 10⌉, so every radius is an integer (5.4.1, 5.4.4, 5.4.12). Polylines are rounded when built, the one named exception to rounding at emission, and every later step reads the rounded polyline; integer segment lengths, arc lengths and exact on-segment sample points; table directions stand for every unit vector and normal; a list of the code-defined constants and approximations, each pinned by the fixtures (5.4.18 (3), (5), (7), (13)). The reference code keeps the authority of (12) and the leg-1 code read stays. |
| F75 | blocker | The attachment cell can still be blocked: a point of a 5 m cell can be 7.07 m from the anchor, not 3.54 m (the centre-to-corner bound the text used); Codex's witness at r_s = 9 m, direction 119°, has P 9.98 m clear of the blob while the cell's corner is 3.23 m from it, inside the 5 m expansion; a 10 m translation preserves the failure. | Accepted. The approach test tests the **attachment square** itself: the grid cell holding P must lie at least 5 m from the blob as a filled shape, retried over sweep directions and then by widening like the rest of the test; the site's frame sees the same cell as the world because site centres lie on the 10 m lattice and the grid is anchored at the origin. Nothing else can block the square: it reaches at most 3.6 m beyond the bounding disc and every other obstacle lies 10 m from the disc (5.4.6, 5.4.8, 5.4.11). The false centre-to-corner sentence is gone. |
| F76 | blocker | The strip-containment predicate is false for a concave polygon (a strip whose polyline clears a notch's vertices and crosses no edge still enters the notch with its width), and nested shapes have positive vertex-to-edge distances without crossing. | Accepted. 5.4.18 (10) restated on filled shapes: distance is zero on intersection, and two polygons intersect on an edge crossing **or a vertex of one inside the other**; a strip lies inside a polygon when every polyline vertex is inside and every polyline segment lies at least the half width plus the margin from every edge; a strip's distance to a shape is the polyline's distance less the half width. Two negative predicate fixtures (the notch; the nested squares) run in both checkers (5.4.14). |
| F77 | major | The path cut responds to void slots, but placement stops when the cards run out, so later non-void slots can stay empty and an unoccupied tail of up to the path's remaining length defeats the twenty-metre criterion. | Accepted. After placement the site path is **trimmed** to the first vertex at or past max(last occupied slot + ρ, farthest corridor vertex); kept vertices keep their indices; a trim only removes geometry. The checker asserts three gap bounds on the emitted geometry: pad to first occupied slot at most 18 m, between occupied slots at most 18 m, last occupied slot to the end at most 10 m; the layout report lists the largest of each per site (5.4.9, 5.4.10, 5.4.12, 9.3). |
| F78 | major | F.5 uses seven kits and says `--fixture` relaxes the three-kit rule, while 5.4.14 says the flag relaxes row minima and acceptance and nothing else; the region rows lack `sentence` and `sources`, the eras lack `name` and `years`. | Accepted. F.5 uses three kits (temperate, coast, volcanic), names every era, and states an **expansion rule** that a committed script applies to produce the three files, committed under `contract/test-vectors/v4/layout/dominaria-example/` and validated under the ordinary rules with no flag on every run; `--fixture` is not used for the example and 5.4.14's "nothing else" stands. |
| F79 | minor | The Corridor row of 3.1 still says "nearest point" of the path. | Accepted. The row names the path vertex, the nearest vertex with ties by the lower index (3.1). |

**The choice this leaves, per 14.6 of revision 12.** Round 7 still read NO-GO on the whole, so the CEO does not start round 8 on its own authority. The trend across rounds 5, 6 and 7 is 21, 10 and 6 findings, with the structural question settled at round 7 and every remaining defect in the geometric detail that leg 1's code read (9.6) will see in code. The two options for the owner: (a) one more confirmation pass on draft 4, scoped to F74 to F79 and the six partials, about ten minutes of model time and no engineer time, with the state put to the owner again on any blocker; (b) accept draft 4 now as the product contract and leave the allocator's remaining detail to the Codex read of leg 1's first pull request, where the detail lives. The CEO recommends (a), because it costs nothing the project is short of and the last three rounds each found a real defect that would have reached code.

**Confirmation pass (round 8).** Same tool and settings, about six and a half minutes (17:43Z to 17:50Z), scoped to F74 to F79 and the six round-7 partials, on draft 4 (`756c45a`) and this document at revision 13. It ran in a process session of its own on a detached scratch tree (`wt-dec950-r8`) pinned to draft 4, so neither a run failure nor an edit on the amendment branch could reach it. Prompt: `dec950-codex-prompt-round8.md`. Output: `dec950-codex-review-round8.md`. The owner chose this pass on the round-7 card (2026-10-12 17:40Z); on the same card the owner confirmed readings 11.20 and 11.21 as written (they are the owner's decisions, recorded as resolved in draft 5) and left the single-allocator ruling to the CEO (it stands, 8.3.3).

**Verdicts.** PRD v4 Amendment 4 draft 4: **NO-GO** ("the former geometric blockers close, but the new trim does not guarantee its asserted tail bound, and F.5's output directory contradicts ordinary validation"). Plan revision 13: **GO WITH CHANGES** ("the sequence and single-allocator ruling remain sound; correct the resolution counts"). No blocker.

**Resolution check.** Resolved: F74, F75, F76, F79, F64, F43, F66, F46. Partly resolved: F77 and F50 (by F80 and F81), F78 and F53 (by F82). Codex confirmed the arithmetic it was asked to check: K_site = 11,459,156 mm² is the nearest integer to 36,000,000 ⁄ π, 600 stands give r_s = 82,918 mm and b_s = 114,502 mm, and the example's initial Dominaria diameter is 1,120.736 m; a translation by multiples of 10 m moves the grid indices by even counts, so the attachment-square test is the same in the site's and the world's frame, and the square's overreach beyond the bounding disc is 3.571 m, under 3.6 m; the containment predicate rejects the round-7 notch segment (1 m of boundary clearance against the 1.502 m required) and accepts a strip 3 m clear, and the nested squares intersect through the vertex-inside rule; the three gap bounds imply 9.3's criterion; the F.5 eras cover the dataset's 37 codes and 6,271 cards exactly once, with eleven regions on three kits and anchors inside the limits.

**New findings F80 to F84.** Three majors, two minors. All accepted; none declined. Draft 5 of the amendment folds them in.

| ID | Severity | Finding (short) | Disposition and where it landed in draft 5 |
|---|---|---|---|
| F80 | major | A nearby path vertex need not be nearby along the path: on the inner side of a half-turn (radius 10.5 m) a candidate 4 m from its cluster centre can have the turn's exit as its nearest vertex, 10 m away in the plane but 32.9 m ahead along the rounded half-turn, so preserving its corridor forces a tail over 32 m against the asserted 10 m. | Accepted. A fifth candidate test, (e): the arc length of the candidate's path vertex lies within 6 m of the slot's arc length; a point that fails it is not a candidate and never counts toward capacity, so the exhaustion and widening rules apply unchanged (5.4.9). 5.4.10's tail bound now cites it: slot + 6 m + 2.75 m = 8.75 m, under 10 m. |
| F81 | major | The trim endpoint may not exist: a 20 m path with its last occupied slot at 18 m has no vertex at or past 22.5 m. | Accepted. t_end is capped at the path's total arc length; only the slot term can exceed it, since every corridor vertex is a path vertex; the end vertex exists because the last vertex lies at the total length (5.4.10). |
| F82 | major | F.5's files under `layout/dominaria-example/` fail F.0's identity rule, which requires `plane` to match both the directory and a hero slug. | Accepted. The files sit under `layout/dominaria-example/dominaria/` with `"plane": "dominaria"`, validated under the ordinary rules with no exception, as a fixture input and never as the entry's tables (Appendix F.5). |
| F83 | minor | The round-7 record says twenty-one resolved and five partials; the lists hold twenty and six. | Accepted. Corrected in the status paragraph, 14.5, 14.6 and the PRD's §12 draft-4 row. The CEO's 17:38Z comment on DEC-950 carries the same error and is corrected in the round-8 comment. |
| F84 | minor | 5.4.18 (7) bounds a world's diameter at 3 km, but nineteen permitted widenings from Dominaria's R₀ give a 6,854 m diameter. | Accepted. The bound is restated: under 8.8 microradians, so under 60 mm over a diameter under 7 km; and every test is made on the geometry as built, so the deviation changes what is built and never whether it passes (5.4.18 (7)). Corrected again in draft 6: round 9 found the 8.8 microradians over 7 km figure loose (it gives 61.6 mm), see F84 below. |

Codex also asked, outside the findings, that the decision record qualify "the other kits follow by release" as the photographic upgrades of 8.12.6 and "all twenty tables first" with the confirmed second-slice sequence; both qualifications are in the PRD's §12 rows and in 14.1.

**The CEO's reading of the rule, and round 9.** Round 8 names no blocker. 14.6 of revision 13 returned the choice to the owner on a blocker and went to step 2 on a GO or GO WITH CHANGES; a NO-GO on majors alone was not addressed. The CEO applied the gate's purpose (the owner's standing instruction of 2026-10-10: the documents pass Codex before anything is built) and Codex's own closing line ("a narrow document confirmation of F80 to F82 is required before leg 1's code read; remaining implementation choices belong in that code read"): draft 5 fixes all five findings, and a narrow round 9, scoped to F80 to F84 and the four partials, runs at once, at about seven minutes of model time and no engineer time. The owner may stop it on DEC-950. This is one round on the CEO's authority: on a GO or GO WITH CHANGES the sequence goes to 14.6 step 2; on a blocker, or on another NO-GO, the state goes to the owner with the trend (21, 10, 6, 5 findings over rounds 5 to 8) and the choice, not to a round 10.

**Confirmation pass (round 9).** Same tool and settings, about two minutes (17:54Z to 17:56Z), scoped to F80 to F84 and the four round-8 partials (F77, F50, F78, F53), on draft 5 (`e2ac79a`) and this document at revision 14, in a process session of its own on the detached scratch tree `wt-dec950-r8`, which is removed at this revision under the worktree rule. Prompt: `dec950-codex-prompt-round9.md`. Output: `dec950-codex-review-round9.md`. The CEO run that launched it died on the Claude session limit at 17:56Z; the review finished on its own and the next run picked it up.

**Verdicts.** PRD v4 Amendment 4 draft 5: **GO WITH CHANGES** ("F80 to F82 close; F84's example arithmetic is correct, but its universal size claim remains unsupported, alongside two minor wording defects"). Plan revision 14: **GO WITH CHANGES** ("the sequence and resolution counts are correct; the new trend statement still undercounts round 5"). Codex's closing line: "No NO-GO remains ... No further document-review round is required before leg 1's code read; apply these corrections, with remaining implementation detail assessed in that code read." **The Codex gate on Amendment 4 is passed.**

**Resolution check.** Resolved: F80, F81, F82, F83, F77, F50, F78, F53. Partly resolved: F84, closed by the correction below. Codex confirmed the four checks it was asked to make: the half-turn witness selects a vertex about 32.884 m ahead and test (e) rejects it, while on a straight run a candidate's vertex lies at most 4.502 m from its slot along the path; two initial or two consecutive interior void slots cut the path and an underfilled interior cluster exhausts placement, so the leading and interior gaps are at most 18 m and the tail at most 8.75 m; F.0 checks the leaf directory and the hero slug, and 4.16.1 does not forbid a separately validated fixture input; 0.0005° is 8.72664626 microradians, nineteen integer widenings from the example's R₀ give R = 3,427,185 mm, and the displacement over that diameter is 59.816 mm (the looser "8.8 microradians over 7 km" would give 61.6 mm, so the tighter figures were needed).

**Findings.** One partial and three minors. All accepted; none declined. Draft 6 of the amendment folds them in.

| ID | Severity | Finding (short) | Disposition and where it landed in draft 6 |
|---|---|---|---|
| F84 | minor, partly resolved | The example arithmetic holds, but 5.4.4 and 5.4.12 do not make the example a universal maximum: a one-region, one-era fixture holding Dominaria's 6,271 cards gives r_s = 268,067 mm and R₀ = 708,362 mm, and after nineteen widenings a diameter of 8,664.6 m with a displacement of 75.6 mm. | Accepted. 5.4.18 (7) states the deviation as 0.0005° (about 8.73 microradians, about 8.73 mm for each kilometre of segment), labels the 60 mm figure as the schema example's, says that no section states a maximum diameter, and keeps the requirement that every test is made on the geometry as built. The "longest segment the law can build" and "widest world" claims are gone from the PRD and from this record. |
| F85 | minor | 5.4.9 says "four tests, each on geometry inflated by j" and then lists five, one of them an arc-length comparison. | Accepted. 5.4.9 names five tests: four, (a) to (d), on inflated geometry, and (e) on arc length along the path; (e) now follows (d). |
| F86 | minor | The trend "20, 10, 6, 5" undercounts round 5, which produced twenty-one findings (F43 to F63). | Accepted. The round-9 paragraph reads 21, 10, 6, 5 and the round-7 paragraph 21, 10 and 6. The CEO's comments of 17:38Z and 17:54Z on DEC-950 carry the same undercount and are corrected in the round-9 comment. |
| F87 | minor | 11.20 and 11.21 say "no longer a default" and then keep the sentence "Default: that reading". | Accepted. Both items state the owner's decision and carry no default sentence; the reason 11.21's reading was proposed is kept as a reason, not a default. |

**What the gate cost and bought on Amendment 4.** Five Codex passes (rounds 5 to 9), about half an hour of model time, 45 distinct findings (F43 to F87: 21 + 10 + 6 + 5 + 3), all accepted, none declined, plus one structural ruling (one allocator, in the pipeline) that Codex judged sound. The new findings by round were 21, 10, 6, 5 and 3, and the last two rounds found no blocker. The allocator's remaining detail is reviewed where it lives: the Codex read of leg 1's first pull request (9.6). The owner's standing instruction of 2026-10-10 (the PRD and the plan pass Codex before anything is built) is met for Amendment 4.

**Repository review of the documents (DEC-994, 2026-10-12).** The Design System Engineer read PR #124 at `6414401` against the eight-item checklist and returned one B item and six notes. The B item: the F56 row above held an unescaped pipe inside a code span, so GitHub cut the row's disposition cell; the row now writes the locator as the PRD's F.4 does. Three notes are applied in this revision: the F84 row of round 8 points at its round-9 correction, this section's heading names rounds 5 to 9, and the status line's last sentences name Amendment 4. Three notes wait for the next PRD draft and change no decision: about 181 sentences of the amendment's prose run past forty words (the status-line entries are the cheapest to split); 5.4.18 (7) should read "can start from a larger R₀", since most worlds are smaller than the schema example; and 9.1.6 or F.6 should say whether a region named after the set family "Game Night" is exempt from the lint, before anyone drafts the Blind Eternities' product table. The PRD is unchanged at draft 6. The reviewer re-reads items 2 and 6 of the checklist on the new head.

### 14.6 Next steps

1. Done: the Codex gate on Amendment 4 is passed at round 9 (14.5); draft 6 carries the four corrections; this revision records it.
2. The owner's confirmation of this plan revision: accept Amendment 4 draft 6 as the product contract and authorise leg A, the content legs and the two legs of the second slice (9.6). Readings 11.20 and 11.21 and the single-allocator ruling are already decided (14.3, 14.5) and are not asked again. The confirmation card is on DEC-950.
3. The documents pull request (Amendment 4 draft 6 and this plan at revision 16) is open now and reviewed by the Design System Engineer, who therefore drafts no lore table. It merges after the owner's acceptance and the APPROVE. On a rejection, the pull request is closed unmerged and the state comes back to the owner.
4. After acceptance: leg A (the pipeline tooling) and the two content legs that need no tooling to start (the drafting of Dominaria's tables, the temperate kit's photographic asset pass), and the Story Spotlight sidecar; then leg 1 of the second slice with the Codex read of its code, the owner's greybox walk, leg 2, and the owner's judgement on the matrix of 9.6.
