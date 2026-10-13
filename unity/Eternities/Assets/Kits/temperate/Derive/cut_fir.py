"""Cut a photographed fir down to levels of detail a world can draw (PRD v4 7.6.4, 8.12.1; DEC-1003).

    blender -b --factory-startup --python cut_fir.py -- <fir> <source.gltf> <out.fbx>

The tool is Blender 5.2.2 LTS, run from the command line with no window (`cutlib.TOOL`; PRD v4
7.6.4, the derived binary). The source is the fir's glTF, with its `.bin` beside it: the FBX that
Poly Haven publishes of the same fir has no texture coordinates.

A fir as published is a trunk and boughs of bark, and its needles: every tuft of needles is a strip
of four or eight triangles of its own, 44,000 to 812,000 tufts a tree, each showing one thin strip
of the twig photograph. The same photograph holds seven sprays photographed whole, which the
published model does not draw. This writes the fir as four meshes, `<fir>_LOD0` to `<fir>_LOD3`,
and beside the model a report of what it kept. No texture is read or written.

What the cut does:
- the trunk and the boughs keep their shape and lose triangles, as a broadleaf's do (`cutlib.cut`);
- the tufts are gathered by place. The space is cut into cells of one size, and the tufts of a
  cell become one card that shows one of the photographed sprays: it lies where the tufts lie,
  along the line they lie along, tipped out from the trunk. A lighter level has larger cells and
  so fewer and larger cards;
- the bare twigs that carry the tufts are not drawn: a spray's photograph has its own.

What it makes that its source does not hold: the cards, their sizes and the normal each is lit
by. Where a card stands and how it lies come from the source's tufts; what it shows is the
source's photograph.
"""
import json
import os
import sys

import bmesh
import bpy
import numpy as np

sys.dont_write_bytecode = True                      # no cache folder beside the script, in the kit
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutlib
from cutlib import cut, triangles

# One row a level: the triangles its wood keeps, and its cards.
LEVELS = [(9000, 20000), (2000, 3500), (450, 650), (130, 120)]

# The sprays in the twig photograph of Poly Haven's firs, each as its rectangle there: from the
# left, from the bottom, to the right, to the top. A spray's stem is at the bottom of its
# rectangle. Measured on `fir_sapling_medium_twigs_alpha_1k.png`: the seven regions of the
# opacity map that are sprays; the others are the bark strip, the single needles and a bare twig.
SPRAYS = [(0.3057, 0.2246, 0.6445, 0.5996), (0.6348, 0.1699, 0.9570, 0.5479), (0.6523, 0.6309, 0.9375, 0.9600),
          (0.1895, 0.6885, 0.4287, 0.9531), (0.4941, 0.6006, 0.6309, 0.7402), (0.5391, 0.7715, 0.5889, 0.9014),
          (0.3867, 0.6172, 0.4590, 0.7109)]
# Left of this in the twig photograph is the bark of the bare twigs.
BARK = 0.14

FIRS = {
    # object: the source's mesh. materials: the source's material, then what it is and the name
    # the kit's photographs of it carry (`<name>_diff_1k.jpg`).
    f"fir_sapling_medium_{fir}": {
        "object": f"fir_sapling_medium_{fir}_LOD0",
        "materials": {"fir_sapling_medium_branches": ("wood", "fir_sapling_medium_branches"),
                      "fir_sapling_medium_branches_dead": ("wood", "fir_sapling_medium_branches"),
                      "fir_sapling_medium_twigs": ("needles", "fir_sapling_medium_twigs")},
    } for fir in "abc"
}
# Two tall firs of one file, 18.8 and 14.0 m. The file's third has a trunk with no texture
# coordinates and is not cut.
FIRS.update({
    f"fir_tree_01_{fir}": {
        "object": f"fir_tree_01_{fir}_LOD0",
        "materials": {"fir_tree_01_bark": ("wood", "fir_tree_01_bark"), "fir_tree_01_dead_branches": ("wood", "fir_tree_01_bark"),
                      f"fir_tree_01_trunk_{fir}": ("wood", f"fir_tree_01_trunk_{fir}"), "fir_tree_01_twig": ("needles", "fir_tree_01_twig")},
        "levels": [(14000, 22000), (3000, 3500), (600, 650), (180, 120)],
    } for fir in "ab"
})

# A cell with fewer tufts than this gets no card.
FEW = 3
# A card is this many times as long as its cell is wide, so that neighbours overlap: a spray's
# photograph is mostly air.
LONG = 2.1
# A card's face is tipped this far from lying flat toward facing out from the trunk, so that a fir
# seen from the ground shows its sprays and not their edges.
TIP = 0.45
SEED = 1003

fir, src, out = sys.argv[sys.argv.index("--") + 1:][:3]
cutlib.tool()
spec = FIRS[fir]

# ---- the source: a glTF read as numbers ----
bpy.ops.wm.read_factory_settings(use_empty=True)
gltf = json.load(open(src))
buffers = [np.memmap(os.path.join(os.path.dirname(src), buffer["uri"]), dtype=np.uint8, mode="r") for buffer in gltf["buffers"]]
KINDS = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}


def read(index):
    accessor = gltf["accessors"][index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    kind, width = np.dtype(KINDS[accessor["componentType"]]), WIDTHS[accessor["type"]]
    if view.get("byteStride", kind.itemsize * width) != kind.itemsize * width:
        raise SystemExit(f"{src}: accessor {index} is interleaved, which this script does not read")
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    raw = buffers[view["buffer"]][start:start + kind.itemsize * width * accessor["count"]]
    return np.frombuffer(raw, dtype=kind).reshape(accessor["count"], width)


node = next(node for node in gltf["nodes"] if node.get("name") == spec["object"])
parts = {}
for primitive in gltf["meshes"][node["mesh"]]["primitives"]:
    name = gltf["materials"][primitive["material"]]["name"]
    if name not in spec["materials"]:
        raise SystemExit(f"{fir}: the source has a material this script has no word for: {name}")
    if "TEXCOORD_0" not in primitive["attributes"]:
        raise SystemExit(f"{fir}: {name} has no texture coordinates in the source")
    there = read(primitive["attributes"]["POSITION"]).astype(np.float64)
    at = read(primitive["attributes"]["TEXCOORD_0"]).astype(np.float64)
    # A glTF is y up with its pictures' rows from the top; here z is up and rows are from the bottom.
    parts[name] = (np.stack([there[:, 0], -there[:, 2], there[:, 1]], 1), np.stack([at[:, 0], 1 - at[:, 1]], 1),
                   read(primitive["indices"]).astype(np.int64).reshape(-1, 3))
ours = {}
for name, (kind, photograph) in spec["materials"].items():
    if photograph not in ours:
        ours[photograph] = bpy.data.materials.new(photograph)
report = {"tree": fir, "source": os.path.basename(src), "blender": bpy.app.version_string,
          "source_triangles": int(sum(len(corners) for _, _, corners in parts.values())), "levels": []}


def wood(name, co, uv, corners, material):
    """A part of the source as an object, with its seams closed so that it can be collapsed."""
    made = bpy.data.meshes.new(name)
    made.vertices.add(len(co)); made.loops.add(3 * len(corners)); made.polygons.add(len(corners))
    made.vertices.foreach_set("co", co.astype(np.float32).ravel())
    made.loops.foreach_set("vertex_index", corners.astype(np.int32).ravel())
    made.polygons.foreach_set("loop_start", np.arange(0, 3 * len(corners), 3, dtype=np.int32))
    made.polygons.foreach_set("loop_total", np.full(len(corners), 3, dtype=np.int32))
    made.update(calc_edges=True)
    made.uv_layers.new(name="UVMap").data.foreach_set("uv", uv[corners].astype(np.float32).ravel())
    made.polygons.foreach_set("use_smooth", np.ones(len(corners), dtype=bool))
    made.materials.append(material)
    made.validate()
    mesh = bmesh.new()
    mesh.from_mesh(made)
    bmesh.ops.remove_doubles(mesh, verts=mesh.verts, dist=1e-5)     # the same point twice, at a seam
    mesh.to_mesh(made)
    mesh.free()
    held = bpy.data.objects.new(name, made)
    bpy.context.scene.collection.objects.link(held)
    return held


woods = [(name, parts[name]) for name, (kind, _) in spec["materials"].items() if kind == "wood" and name in parts]
wood_triangles = sum(len(corners) for _, (_, _, corners) in woods)
needles = [name for name, (kind, _) in spec["materials"].items() if kind == "needles" and name in parts]
if len(needles) != 1:
    raise SystemExit(f"{fir}: one material of needles is what this script cuts, and the source has {len(needles)}")
co, uv, corners = parts[needles[0]]
needle_material = ours[spec["materials"][needles[0]][1]]
tuft = uv[corners][:, :, 0].min(1) >= BARK         # a triangle of a tuft, and not of a bare twig's bark
middle = co[corners[tuft]].mean(1)
report["wood_triangles"] = int(wood_triangles)
report["tuft_triangles"] = int(tuft.sum())
report["bare_twig_triangles"] = int((~tuft).sum())
top = middle[:, 2].max()
draws = np.random.default_rng(SEED)


def gathered(width):
    """The tufts by cell: for each cell with tufts enough, how many it holds and which they are."""
    cell = np.floor(middle / width).astype(np.int64) + 4096
    key = (cell[:, 0] * 8192 + cell[:, 1]) * 8192 + cell[:, 2]
    cells, of, count = np.unique(key, return_inverse=True, return_counts=True)
    return cells, of.ravel(), count


def cards(budget):
    # The narrowest cell, of fourteen tried, that gives no more cards than the budget.
    narrow, wide = 0.01, 4.0
    for _ in range(14):
        width = (narrow + wide) / 2
        if (gathered(width)[2] >= FEW).sum() > budget:
            narrow = width
        else:
            wide = width
    cells, of, count = gathered(wide)
    n = len(cells)
    centre = np.stack([np.bincount(of, weights=middle[:, k], minlength=n) / count for k in range(3)], 1)
    away = middle - centre[of]
    spread = np.zeros((n, 3, 3))
    for i in range(3):
        for j in range(3):
            spread[:, i, j] = np.bincount(of, weights=away[:, i] * away[:, j], minlength=n) / count
    kept = count >= FEW
    centre, spread, count = centre[kept], spread[kept], count[kept]
    k = len(centre)
    size, line = np.linalg.eigh(spread)             # ascending: the last is the line the tufts lie along
    along = line[:, :, 2]
    up = np.array([0.0, 0.0, 1.0])
    outward = centre * np.array([1.0, 1.0, 0.0])
    outward /= np.maximum(np.linalg.norm(outward, axis=1, keepdims=True), 1e-9)
    # Where the tufts lie along no line, or along the trunk, a spray points out and a little down.
    unsure = (size[:, 2] < 2 * size[:, 1]) | (np.abs(along[:, 2]) > 0.8)
    along[unsure] = outward[unsure] - 0.2 * up
    along /= np.maximum(np.linalg.norm(along, axis=1, keepdims=True), 1e-9)
    along *= np.where((along * outward).sum(1) < 0, -1.0, 1.0)[:, None]
    # The card's face: up, tipped out from the trunk and a little to either side, square to its line.
    side = np.cross(up, outward)
    face = (1 - TIP) * up + TIP * outward + (draws.random(k)[:, None] - 0.5) * 0.5 * side
    face -= (face * along).sum(1)[:, None] * along
    face /= np.maximum(np.linalg.norm(face, axis=1, keepdims=True), 1e-9)
    across = np.cross(face, along)
    spray = np.array(SPRAYS)[draws.integers(0, len(SPRAYS), k)]
    # A cell with few tufts gets a smaller card than a full one.
    long = LONG * wide * np.clip((count / np.median(count)) ** (1 / 3), 0.75, 1.2)
    broad = long * (spray[:, 2] - spray[:, 0]) / (spray[:, 3] - spray[:, 1])
    base, tip = centre - 0.5 * long[:, None] * along, centre + 0.5 * long[:, None] * along
    half = 0.5 * broad[:, None] * across
    corner = np.stack([base - half, base + half, tip + half, tip - half], 1)
    corner_uv = np.stack([spray[:, [0, 1]], spray[:, [2, 1]], spray[:, [2, 3]], spray[:, [0, 3]]], 1)
    # Lit as part of the fir's cone: out from the trunk and up.
    cone = outward + 0.6 * up
    cone /= np.linalg.norm(cone, axis=1, keepdims=True)
    normal = cutlib.ROUND * cone + (1 - cutlib.ROUND) * face
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    return cutlib.card_mesh(corner, corner_uv, normal, needle_material), wide, float(np.median(long))


made = []
for level, (wood_budget, card_budget) in enumerate(spec.get("levels", LEVELS)):
    row = {"level": level, "wood_triangles": 0, "closed_edges_m": 0.0}
    held = []
    for name, (there, at, tris) in woods:
        limbs, weld = cut(wood(name, there, at, tris, ours[spec["materials"][name][1]]), wood_budget * len(tris) / wood_triangles)
        row["wood_triangles"] += triangles(limbs.data)
        row["closed_edges_m"] = max(row["closed_edges_m"], round(weld, 4))
        held.append(limbs)
    sprays, width, long = cards(card_budget)
    held.append(sprays)
    row.update({"cards": len(sprays.data.polygons), "cell_m": round(width, 4), "card_long_m": round(long, 3)})
    joined = cutlib.join(held, f"{fir}_LOD{level}")
    row["triangles"] = triangles(joined.data)
    row["materials"] = [slot.material.name for slot in joined.material_slots]
    report["levels"].append(row)
    made.append(joined)

cutlib.write(made, out, report)
