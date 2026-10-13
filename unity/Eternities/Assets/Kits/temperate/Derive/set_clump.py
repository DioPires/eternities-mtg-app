"""Set a clump of sedge from photographed stems (PRD v4 7.6.4, 8.12.1; DEC-1003).

    blender -b --factory-startup --python set_clump.py -- <clump> <source.gltf> <out.fbx>

The tool is Blender 5.2.2 LTS, run from the command line with no window (`cutlib.TOOL`; PRD v4
7.6.4, the derived binary). The source is a scan of ffish.asia / floraZia.com on Sketchfab, as its
glTF with its data and its photographs inside it.

A scan is one to three stems of a plant cut and photographed whole, each a mesh of 58,000 to
300,000 triangles at its own size in metres, beside a colour cube of one centimetre. A plant of a
marsh stands in clumps of many stems. This writes a clump as three meshes, `<clump>_LOD0` to
`<clump>_LOD2`, each lighter than the one before, and beside the model a report of what it kept.
No texture is read or written: the kit draws the clump with each stem's own photograph
(`scan_photograph.py`).

What it does:
- each stem keeps its shape and loses triangles (Blender's collapse decimation, `cutlib.collapsed`);
- the stems of the scan are set side by side in a clump, each turned about its own base and leaned
  out from the clump's middle, the farther out the more. A stem is moved and turned and never
  made larger or smaller: the clump is at the size the scan gives its stems.

What it makes that its source does not hold: where each stem of the clump stands and how it leans.
Both are drawn from a seed. Every vertex is a vertex of the source's, moved, and every UV is the
source's.
"""
import base64
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np

sys.dont_write_bytecode = True                      # no cache folder beside the script, in the kit
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutlib
from cutlib import collapsed, triangles

# One row a level: the triangles a stem keeps, and the most the level draws, as a share of the
# nearest level's triangles. Collapse takes a stem of a scan no lower than 100 to 350 triangles, so
# a farther level also draws fewer stems: those that cost it least first, in the order they were
# set, as many as its share holds. The farthest is a tenth of the nearest (the prop rule).
LEVELS = [(340, 1.0), (150, 0.5), (60, 0.095)]

CLUMPS = {
    # stems: the scan's meshes, each with the name the kit's photograph of it carries
    # (`<name>_diff_scan.jpg`); count: the stems of the clump; across: the width of ground they
    # stand on, in metres; lean: the most a stem at the clump's edge leans out, in degrees;
    # levels: its own, where LEVELS does not suit it.
    # Kasa-suge, two stems of 0.55 and 0.59 m. Under 600 triangles its spikes lose their shape,
    # so its clump has fewer stems.
    "carex_dispalata": {"stems": {"QS1701-W21-1-1": "carex_dispalata_1", "QS1701-W21-2-1": "carex_dispalata_2"},
                        "count": 16, "across": 0.25, "lean": 22, "levels": [(600, 1.0), (150, 0.4), (60, 0.095)]},
    # Maximowicz's sedge, one stem of 0.33 m.
    "carex_maximowiczii": {"stems": {"QS1701-W22-1-3": "carex_maximowiczii"},
                           "count": 28, "across": 0.2, "lean": 25},
}
# A stem's base is where it was cut: the mean of its points within this of its lowest, in metres.
BASE = 0.01
# A scan's mesh is split into pieces wherever its photograph is: each point of a seam is there
# twice. Points closer than this, in metres, are one, so that a stem can lose triangles across its
# seams. The photograph stays on the corners of the triangles, as the source has it.
SAME = 1e-6
SEED = 1003

KINDS = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}


def stem(gltf, data, name):
    """A stem of the scan as positions in metres with z up, UVs and triangles."""
    def read(index):
        accessor = gltf["accessors"][index]
        view = gltf["bufferViews"][accessor["bufferView"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        kind, width = KINDS[accessor["componentType"]], WIDTHS[accessor["type"]]
        count = accessor["count"] * width
        stride = view.get("byteStride", 0)
        if stride and stride != width * np.dtype(kind).itemsize:
            raise SystemExit(f"{name}: an interleaved buffer, which this script does not read")
        return np.frombuffer(data[gltf["buffers"][view["buffer"]]["uri"]], kind, count, start).reshape(-1, width) if width > 1 else \
            np.frombuffer(data[gltf["buffers"][view["buffer"]]["uri"]], kind, count, start)
    node = [node for node in gltf["nodes"] if node.get("name") == name]
    if len(node) != 1 or any(key in node[0] for key in ("matrix", "rotation", "scale", "translation")):
        raise SystemExit(f"the source has {len(node)} nodes named {name}, and a stem is one, in the file's own metres")
    primitives = gltf["meshes"][node[0]["mesh"]]["primitives"]
    if len(primitives) != 1:
        raise SystemExit(f"{name}: a stem is one primitive, and this has {len(primitives)}")
    primitive = primitives[0]
    co = read(primitive["attributes"]["POSITION"]).astype(np.float64)
    co = np.stack([co[:, 0], -co[:, 2], co[:, 1]], 1)          # glTF's y up to z up
    uv = read(primitive["attributes"]["TEXCOORD_0"]).astype(np.float64)
    uv = np.stack([uv[:, 0], 1 - uv[:, 1]], 1)                  # glTF's v down to v up
    faces = read(primitive["indices"]).astype(np.int64).reshape(-1, 3)
    low = co[:, 2].min()
    base = co[co[:, 2] < low + BASE].mean(0)
    base[2] = low
    return co - base, uv, faces


def mesh_of(name, co, uv, faces, material):
    made = bpy.data.meshes.new(name)
    made.vertices.add(len(co)); made.loops.add(faces.size); made.polygons.add(len(faces))
    made.vertices.foreach_set("co", co.astype(np.float32).ravel())
    made.loops.foreach_set("vertex_index", faces.astype(np.int32).ravel())
    made.polygons.foreach_set("loop_start", np.arange(0, faces.size, 3, dtype=np.int32))
    made.polygons.foreach_set("loop_total", np.full(len(faces), 3, dtype=np.int32))
    made.update(calc_edges=True)
    made.uv_layers.new(name="UVMap").data.foreach_set("uv", uv[faces.ravel()].astype(np.float32).ravel())
    made.materials.append(material)
    made.validate()
    seams = bmesh.new()
    seams.from_mesh(made)
    bmesh.ops.remove_doubles(seams, verts=seams.verts, dist=SAME)
    seams.to_mesh(made)
    seams.free()
    held = bpy.data.objects.new(name, made)
    bpy.context.scene.collection.objects.link(held)
    return held


def placed(held, angle, at):
    """A copy of the object turned by the rotation matrix `angle` about its base and moved to `at`."""
    copy = held.copy()
    copy.data = held.data.copy()
    bpy.context.scene.collection.objects.link(copy)
    co = np.empty(len(copy.data.vertices) * 3, np.float32)
    copy.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64) @ angle.T + at
    copy.data.vertices.foreach_set("co", co.astype(np.float32).ravel())
    copy.data.update()
    return copy


def turn(axis, degrees):
    x, y, z = axis / np.linalg.norm(axis)
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


clump, src, out = sys.argv[sys.argv.index("--") + 1:][:3]
cutlib.tool()
spec = CLUMPS[clump]
bpy.ops.wm.read_factory_settings(use_empty=True)

with open(src) as f:
    gltf = json.load(f)
data = {}
for buffer in gltf["buffers"]:
    uri = buffer["uri"]
    if not uri.startswith("data:application/octet-stream;base64,"):
        raise SystemExit(f"{src}: a buffer outside the file, and a scan carries its data inside it")
    data[uri] = base64.b64decode(uri.split(",", 1)[1])

report = {"clump": clump, "source": os.path.basename(src), "blender": bpy.app.version_string, "stems": {}, "levels": []}
held = []                                           # (stem object, the name of its photograph)
for name, photograph in spec["stems"].items():
    co, uv, faces = stem(gltf, data, name)
    material = bpy.data.materials.get(photograph) or bpy.data.materials.new(photograph)
    held.append((mesh_of(name, co, uv, faces, material), photograph))
    report["stems"][name] = {"triangles": len(faces), "metres_high": round(float(co[:, 2].max()), 3)}

# Where each stem of the clump stands, how it is turned and how far it leans: from the seed.
draws = np.random.default_rng(SEED)
stands = []
for index in range(spec["count"]):
    out_to = spec["across"] / 2 * math.sqrt(draws.random())
    towards = draws.random() * 360
    yaw = draws.random() * 360
    lean = spec["lean"] * (out_to / (spec["across"] / 2)) * (0.6 + 0.4 * draws.random())
    way = np.array([math.cos(math.radians(towards)), math.sin(math.radians(towards)), 0])
    angle = turn(np.cross([0, 0, 1], way) if out_to > 0 else np.array([1.0, 0, 0]), lean) @ turn(np.array([0, 0, 1.0]), yaw)
    stands.append((index % len(held), angle, way * out_to))

made, nearest = [], None
for level, (budget, share) in enumerate(spec.get("levels", LEVELS)):
    cut_stems = [collapsed(one, budget, 0) for one, _ in held]
    cost = [triangles(one.data) for one in cut_stems]
    room = math.inf if nearest is None else share * nearest
    drawn, spent = [], 0
    for index in sorted(range(len(stands)), key=lambda index: (cost[stands[index][0]], index)):
        if spent + cost[stands[index][0]] > room:
            break
        drawn.append(stands[index])
        spent += cost[stands[index][0]]
    parts = [placed(cut_stems[which], angle, at) for which, angle, at in drawn]
    for one in cut_stems:
        bpy.data.objects.remove(one)
    joined = cutlib.join(parts, f"{clump}_LOD{level}")
    nearest = nearest or triangles(joined.data)
    report["levels"].append({"level": level, "stems": len(drawn), "stem_triangles": sorted(set(cost)), "triangles": triangles(joined.data),
                             "materials": [slot.material.name for slot in joined.material_slots]})
    made.append(joined)

for one, _ in held:
    bpy.data.objects.remove(one)
cutlib.write(made, out, report)
