"""Cut a photographed tree down to levels of detail a world can draw (PRD v4 7.6.4, 8.12.1; DEC-1003).

    blender -b --factory-startup --python cut_tree.py -- <tree> <source model> <out.fbx>

A tree as Poly Haven publishes it is one mesh of one to four million triangles, with no lighter
level in its file. This writes the same tree as four meshes, `<tree>_LOD0` to `<tree>_LOD3`, each
lighter than the one before, and beside the model a report of what it kept. Nothing is added to
the tree and no texture is read or written: the kit draws the cut model with the source's own
photographs, as downloaded.

What the cut does:
- a limb, which is the trunk or a bough, keeps its shape and loses triangles (Blender's collapse
  decimation);
- of the twigs, the longest stay, and those lose triangles the same way;
- every leaf, a small mesh of its own in the source, becomes one flat card with the leaf's own
  piece of the photograph. Of the cards one in so many stays, and the ones that stay are made
  larger, so that the crown covers what it covered. A level's leaves are among the leaves of the
  level before, so a tree keeps its shape as the viewer walks up to it.

`derive.sh` runs this and holds the result to the file the kit commits. The same source and the
same Blender give the same bytes: the exporter's clock and its object numbers are fixed below.
"""
import datetime
import hashlib
import json
import os
import sys

import bmesh
import bpy
import numpy as np

# One row a level: the triangles its limbs keep, the triangles its twigs keep, and its leaf cards.
LEVELS = [(9000, 7000, 21500), (2000, 800, 3800), (450, 0, 750), (130, 0, 150)]

TREES = {
    # object: the source's mesh. materials: the source's material, then what it is and the name
    # the kit's photographs of it carry (`<name>_diff_1k.jpg`). levels: its own, where LEVELS
    # does not suit it.
    "island_tree_01": {
        "object": "island_tree_01_LOD0",
        "materials": {"island_tree_01": ("wood", "island_tree_01"), "island_tree_01_branches": ("wood", "island_tree_01_branches"),
                      "island_tree_01_leaves": ("leaves", "island_tree_01_leaves")},
    },
    "tree_small_02": {
        "object": "tree_small_02_LOD0",
        "materials": {"tree_small_02_trunk": ("wood", "tree_small_02"), "tree_small_02_branches": ("wood", "tree_small_02_branch"),
                      "tree_small_02_leaves": ("leaves", "tree_small_02_leaves")},
    },
    "jacaranda_tree": {
        "object": "jacaranda_tree_LOD0",
        "materials": {"jacaranda_tree_trunk": ("wood", "jacaranda_tree_trunk"), "jacaranda_tree_branches": ("wood", "jacaranda_tree_branches"),
                      "jacaranda_tree_leaves": ("leaves", "jacaranda_tree_leaves")},
        "levels": [(13000, 3000, 21500), (3000, 400, 3300), (700, 0, 600), (220, 0, 110)],
    },
}

# A connected part of the wood with this many triangles or more is a limb; a lighter one is a twig.
LIMB = 1000
# A twig is cut to no less than this share of its triangles: under it a twig is a sliver.
TWIG = 0.2
# The longest edge of a bough, in metres, that is closed before the bough is collapsed.
WELD = 4.0
# A kept card is larger than its leaf by the square root of how many leaves it stands for, times
# this: cards overlap more than leaves do.
OVER = 1.15
# A card is lit as part of a round crown and only a little as the flat thing it is.
ROUND = 0.75
SEED = 1003


def arrays(me):
    """Positions; per loop its vertex and its place in the photograph; per polygon its first
    loop, its loop count and its material."""
    nv, nl, npoly = len(me.vertices), len(me.loops), len(me.polygons)
    co = np.empty(nv * 3, np.float32); me.vertices.foreach_get("co", co)
    lv = np.empty(nl, np.int32); me.loops.foreach_get("vertex_index", lv)
    uv = np.empty(nl * 2, np.float32); me.uv_layers[0].data.foreach_get("uv", uv)
    ls = np.empty(npoly, np.int32); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(npoly, np.int32); me.polygons.foreach_get("loop_total", lt)
    mi = np.empty(npoly, np.int32); me.polygons.foreach_get("material_index", mi)
    return co.reshape(-1, 3).astype(np.float64), lv, uv.reshape(-1, 2).astype(np.float64), ls, lt, mi


def components(nv, lv, ls, lt, keep_loop):
    """The connected part of every vertex, as the lowest vertex index in it, over the loops kept:
    the lowest label spreads along the polygons' edges until nothing changes."""
    nxt = np.arange(len(lv)) + 1
    nxt[ls + lt - 1] = ls
    a, b = lv[keep_loop], lv[nxt][keep_loop]
    label = np.arange(nv)
    while True:
        low = np.minimum(label[a], label[b])
        before = label.copy()
        np.minimum.at(label, a, low)
        np.minimum.at(label, b, low)
        while True:
            jumped = label[label]
            if np.array_equal(jumped, label):
                break
            label = jumped
        if np.array_equal(before, label):
            return label


def triangles(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def only(objects):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def reproducible():
    """Blender's FBX exporter writes the hour into a file and numbers its objects by Python's
    hash of their names, which differs from one run to the next. Both are fixed here, so that
    the same tree is the same file."""
    import io_scene_fbx.export_fbx_bin as writer
    import io_scene_fbx.fbx_utils as utils

    class Fixed(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 1, 1)

    class Clock:
        datetime = Fixed

    def numbered(taken, key):
        number = int.from_bytes(hashlib.sha256(repr(key).encode()).digest()[:8], "big") % 10 ** 9
        while number in taken:
            number += 1
        return utils.UUID(number)

    writer.datetime = Clock
    utils._key_to_uuid = numbered
    utils._keys_to_uuids.clear()
    utils._uuids_to_keys.clear()


tree, src, out = sys.argv[sys.argv.index("--") + 1:][:3]
spec = TREES[tree]
levels = spec.get("levels", LEVELS)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.fbx_import(filepath=src)
source = bpy.data.objects[spec["object"]]
me = source.data
source.name = me.name = "source"                    # the levels take the tree's name
co, lv, uv, ls, lt, mi = arrays(me)
place = np.array(source.matrix_world)
co = co @ place[:3, :3].T + place[:3, 3]            # metres, z up, as the tree stands
lp = np.repeat(np.arange(len(ls)), lt)              # a loop's polygon
tri = lt - 2                                        # a polygon's triangles
theirs = [m.name for m in me.materials]
unknown = sorted(set(theirs) - set(spec["materials"]))
if unknown:
    raise SystemExit(f"{tree}: the source has materials this script has no word for: {unknown}")
for material in me.materials:
    material.name = "source " + material.name     # so that ours can carry the photographs' names
ours = {}
for name in theirs:
    kind, photograph = spec["materials"][name]
    if photograph not in ours:
        ours[photograph] = bpy.data.materials.new(photograph)
report = {"tree": tree, "source": os.path.basename(src), "blender": bpy.app.version_string,
          "source_triangles": int(tri.sum()), "levels": []}


def submesh(name, poly_mask, material):
    """The polygons chosen as an object of their own, with the one material."""
    polys = np.flatnonzero(poly_mask)
    total = lt[polys]
    start = np.cumsum(total) - total
    loops = np.repeat(ls[polys] - start, total) + np.arange(total.sum())
    used, index = np.unique(lv[loops], return_inverse=True)
    made = bpy.data.meshes.new(name)
    made.vertices.add(len(used)); made.loops.add(len(loops)); made.polygons.add(len(polys))
    made.vertices.foreach_set("co", co[used].astype(np.float32).ravel())
    made.loops.foreach_set("vertex_index", index.astype(np.int32))
    made.polygons.foreach_set("loop_start", start.astype(np.int32))
    made.polygons.foreach_set("loop_total", total.astype(np.int32))
    made.update(calc_edges=True)
    made.uv_layers.new(name="UVMap").data.foreach_set("uv", uv[loops].astype(np.float32).ravel())
    made.polygons.foreach_set("use_smooth", np.ones(len(polys), dtype=bool))
    made.materials.append(material)
    made.validate()
    held = bpy.data.objects.new(name, made)
    bpy.context.scene.collection.objects.link(held)
    return held


def collapsed(held, budget, weld):
    """A copy with about `budget` triangles: its edges shorter than `weld` metres closed, then
    Blender's collapse. Only an edge is closed, never two vertices that merely lie near each
    other: that stretches a skin between two boughs."""
    copy = held.copy()
    copy.data = held.data.copy()
    bpy.context.scene.collection.objects.link(copy)
    if weld > 0:
        mesh = bmesh.new()
        mesh.from_mesh(copy.data)
        bmesh.ops.dissolve_degenerate(mesh, dist=weld, edges=mesh.edges)
        mesh.to_mesh(copy.data)
        mesh.free()
    have = triangles(copy.data)
    if have > budget:
        only([copy])
        collapse = copy.modifiers.new("cut", "DECIMATE")
        collapse.ratio = budget / have
        collapse.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier="cut")
    return copy


def cut(held, budget):
    """The object with about `budget` triangles, in place of the one given, and the length of
    edge that was closed first. Collapse alone stops short on boughs made of many thin tubes: it
    will not take a side from a tube of four. Then the edges shorter than a length are closed
    first, which closes the thinnest tubes, and the length is the shortest of twelve tried that
    lets the collapse reach the budget."""
    best, weld = collapsed(held, budget, 0), 0.0
    if triangles(best.data) > 1.1 * budget:
        bpy.data.objects.remove(best)
        best, weld = collapsed(held, budget, WELD), WELD
        near = 0.0
        for _ in range(12):
            middle = (near + weld) / 2
            tried = collapsed(held, budget, middle)
            if triangles(tried.data) > 1.1 * budget:
                near = middle
                bpy.data.objects.remove(tried)
            else:
                bpy.data.objects.remove(best)
                best, weld = tried, middle
    bpy.data.objects.remove(held)
    return best, weld


# ---- the wood: limbs and twigs, by material ----
wood = []                                           # (material, limb polygons, twig polygons, a twig polygon's twig)
twig_length, twig_triangles = [], []
for index, name in enumerate(theirs):
    kind, photograph = spec["materials"][name]
    if kind != "wood" or not (mi == index).any():
        continue
    of = mi == index
    label = components(len(co), lv, ls, lt, of[lp])
    part = label[lv[ls]]                            # a polygon's part
    ids, first = np.unique(part[of], return_index=True)
    which = np.searchsorted(ids, part[of])
    weight = np.bincount(which, weights=tri[of], minlength=len(ids))
    used = np.zeros(len(co), bool); used[lv[of[lp]]] = True
    vid = np.searchsorted(ids, label[used])
    lo = np.full((len(ids), 3), np.inf); hi = np.full((len(ids), 3), -np.inf)
    np.minimum.at(lo, vid, co[used]); np.maximum.at(hi, vid, co[used])
    # A source may hold a limb twice over, one copy on the other: the second is not drawn.
    seen, twice = {}, np.zeros(len(ids), bool)
    for i in np.flatnonzero(weight >= LIMB):
        key = (int(weight[i]),) + tuple(np.round(np.concatenate([lo[i], hi[i]]), 3))
        twice[i] = key in seen
        seen[key] = True
    limb = (weight >= LIMB) & ~twice
    twig = weight < LIMB
    poly_limb = np.zeros(len(ls), bool); poly_limb[of] = limb[which]
    poly_twig = np.full(len(ls), -1); poly_twig[of] = np.where(twig[which], which + len(twig_length), -1)
    twig_length.extend(np.linalg.norm(hi - lo, axis=1)); twig_triangles.extend(weight)
    wood.append((ours[photograph], poly_limb, poly_twig, int(twice.sum())))
twig_length, twig_triangles = np.array(twig_length), np.array(twig_triangles)
limb_triangles = sum(int(tri[poly_limb].sum()) for _, poly_limb, _, _ in wood)
is_twig = np.zeros(len(twig_length), bool)
for _, _, poly_twig, _ in wood:
    is_twig[np.unique(poly_twig[poly_twig >= 0])] = True
longest = np.argsort(-np.where(is_twig, twig_length, -1), kind="stable")[: int(is_twig.sum())]
report["limb_triangles"] = limb_triangles
report["limbs_held_twice"] = sum(twice for _, _, _, twice in wood)
report["twigs"] = int(is_twig.sum())

# ---- the leaves, each as a card ----
leaf_index = [i for i, name in enumerate(theirs) if spec["materials"][name][0] == "leaves"]
if len(leaf_index) != 1:
    raise SystemExit(f"{tree}: one material of leaves is what this script cuts, and the source has {len(leaf_index)}")
of = mi == leaf_index[0]
leaf_material = ours[spec["materials"][theirs[leaf_index[0]]][1]]
label = components(len(co), lv, ls, lt, of[lp])
sel = of[lp]
ids = np.unique(label[lv[sel]])
lid = np.searchsorted(ids, label[lv[sel]])
n = len(ids)
p, t = co[lv[sel]], uv[sel]
count = np.bincount(lid, minlength=n).astype(np.float64)
tmean = np.stack([np.bincount(lid, weights=t[:, k], minlength=n) / count for k in range(2)], 1)
x = np.concatenate([t - tmean[lid], np.ones((len(t), 1))], 1)          # a loop's [u, v, 1]
m = np.zeros((n, 3, 3)); b = np.zeros((n, 3, 3))
for i in range(3):
    for j in range(3):
        m[:, i, j] = np.bincount(lid, weights=x[:, i] * x[:, j], minlength=n)
        b[:, i, j] = np.bincount(lid, weights=x[:, i] * p[:, j], minlength=n)
good = np.abs(np.linalg.det(m)) > 1e-12
a = np.zeros((n, 3, 3))
a[good] = np.linalg.solve(m[good], b[good])                            # a point ~ u a[0] + v a[1] + a[2]
off = np.linalg.norm(np.einsum("ni,nij->nj", x, a[lid]) - p, axis=1)
tlo = np.full((n, 2), np.inf); thi = np.full((n, 2), -np.inf)
np.minimum.at(tlo, lid, t); np.maximum.at(thi, lid, t)
corner_uv = np.stack([np.stack([tlo[:, 0], tlo[:, 1]], 1), np.stack([thi[:, 0], tlo[:, 1]], 1),
                      np.stack([thi[:, 0], thi[:, 1]], 1), np.stack([tlo[:, 0], thi[:, 1]], 1)], 1)       # n, 4, 2
rel = corner_uv - tmean[:, None, :]
corners = rel[:, :, 0, None] * a[:, None, 0, :] + rel[:, :, 1, None] * a[:, None, 1, :] + a[:, None, 2, :]
centre = corners.mean(1)
across = np.linalg.norm(corners[:, 2] - corners[:, 0], axis=1)
worst = np.zeros(n); np.maximum.at(worst, lid, off)
face = np.cross(a[:, 0], a[:, 1])
face /= np.maximum(np.linalg.norm(face, axis=1, keepdims=True), 1e-12)
crown = centre[good].mean(0) - np.array([0, 0, 0.6 * (centre[good, 2].max() - centre[good, 2].min())])
outward = centre - crown
outward /= np.maximum(np.linalg.norm(outward, axis=1, keepdims=True), 1e-12)
face *= np.where((face * outward).sum(1) < 0, -1.0, 1.0)[:, None]
normal = ROUND * outward + (1 - ROUND) * face
normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-12)
order = np.random.default_rng(SEED).permutation(np.flatnonzero(good))
report["leaves"] = int(n)
report["leaves_not_flat"] = int((~good).sum())
report["leaf_fit_mm"] = [round(float(v) * 1000, 1) for v in np.percentile(off, [50, 99])]
report["leaf_fit_share_of_card"] = [round(float(v), 3) for v in np.percentile(worst[good] / np.maximum(across[good], 1e-9), [50, 90, 99])]


def cards(kept):
    chosen = order[:kept]
    size = 1.0 if kept >= len(order) else OVER * (len(order) / kept) ** 0.5
    verts = centre[chosen, None, :] + size * (corners[chosen] - centre[chosen, None, :])
    k = len(chosen)
    made = bpy.data.meshes.new("leaves")
    made.vertices.add(4 * k); made.loops.add(4 * k); made.polygons.add(k)
    made.vertices.foreach_set("co", verts.reshape(-1, 3).astype(np.float32).ravel())
    made.loops.foreach_set("vertex_index", np.arange(4 * k, dtype=np.int32))
    made.polygons.foreach_set("loop_start", np.arange(0, 4 * k, 4, dtype=np.int32))
    made.polygons.foreach_set("loop_total", np.full(k, 4, dtype=np.int32))
    made.update(calc_edges=True)
    made.uv_layers.new(name="UVMap").data.foreach_set("uv", corner_uv[chosen].reshape(-1, 2).astype(np.float32).ravel())
    made.normals_split_custom_set_from_vertices(np.repeat(normal[chosen], 4, axis=0).astype(np.float32).tolist())
    made.materials.append(leaf_material)
    made.validate()
    held = bpy.data.objects.new("leaves", made)
    bpy.context.scene.collection.objects.link(held)
    return held, size


# ---- the levels ----
made = []
for level, (limb_budget, twig_budget, card_budget) in enumerate(levels):
    row = {"level": level, "limb_triangles": 0, "twigs": 0, "twig_triangles": 0}
    parts = []
    # The longest twigs, as many as the budget carries at a fifth of their triangles each.
    carried = np.cumsum(twig_triangles[longest]) * TWIG <= twig_budget
    taken = np.zeros(len(twig_length), bool); taken[longest[carried]] = True
    taken_triangles = float(twig_triangles[taken].sum())
    row["closed_edges_m"] = 0.0
    for material, poly_limb, poly_twig, _ in wood:
        if poly_limb.any():
            limbs, weld = cut(submesh("limbs", poly_limb, material), limb_budget * int(tri[poly_limb].sum()) / limb_triangles)
            row["limb_triangles"] += triangles(limbs.data)
            row["closed_edges_m"] = max(row["closed_edges_m"], round(weld, 4))
            parts.append(limbs)
        poly_taken = (poly_twig >= 0) & taken[np.maximum(poly_twig, 0)]
        if poly_taken.any():
            twigs = collapsed(submesh("twigs", poly_taken, material), twig_budget * int(tri[poly_taken].sum()) / taken_triangles, 0)
            row["twig_triangles"] += triangles(twigs.data)
            parts.append(twigs)
    row["twigs"] = int(taken.sum())
    leaves, size = cards(min(card_budget, len(order)))
    parts.append(leaves)
    row.update({"leaf_cards": len(leaves.data.polygons), "card_size": round(float(size), 3)})
    only(parts)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = f"{tree}_LOD{level}"
    joined.data.name = joined.name
    row["triangles"] = triangles(joined.data)
    row["materials"] = [slot.material.name for slot in joined.material_slots]
    report["levels"].append(row)
    made.append(joined)

bpy.data.objects.remove(source)
nearest = np.empty(len(made[0].data.vertices) * 3, np.float32)
made[0].data.vertices.foreach_get("co", nearest)
low, high = nearest.reshape(-1, 3).min(0), nearest.reshape(-1, 3).max(0)
report["metres"] = [round(float(s), 3) for s in high - low]          # across, deep and high
report["under_its_base_m"] = round(float(-low[2]), 3)

reproducible()
only(made)
bpy.ops.export_scene.fbx(filepath=out, use_selection=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y",
                         bake_space_transform=True, mesh_smooth_type="OFF", add_leaf_bones=False, bake_anim=False,
                         path_mode="STRIP", embed_textures=False, object_types={"MESH"})
report["bytes"] = os.path.getsize(out)
with open(os.path.splitext(out)[0] + ".json", "w") as f:
    json.dump(report, f, indent=1)
    f.write("\n")
print("cut", json.dumps(report))
