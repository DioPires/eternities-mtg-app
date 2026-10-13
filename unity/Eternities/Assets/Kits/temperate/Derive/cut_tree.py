"""Cut a photographed tree down to levels of detail a world can draw (PRD v4 7.6.4, 8.12.1; DEC-1003).

    blender -b --factory-startup --python cut_tree.py -- <tree> <source model> <out.fbx>

The tool is Blender 5.2.2 LTS, run from the command line with no window (`cutlib.TOOL`; PRD v4
7.6.4, the derived binary).

A tree as Poly Haven publishes it is one mesh of one to four million triangles, with no lighter
level in its file. This writes the same tree as four meshes, `<tree>_LOD0` to `<tree>_LOD3`, each
lighter than the one before, and beside the model a report of what it kept. Nothing is added to
the tree and no texture is read or written: the kit draws the cut model with the source's own
photographs, as downloaded. A bush is cut as a tree is, to three levels.

What the cut does:
- a limb, which is the trunk or a bough, keeps its shape and loses triangles (Blender's collapse
  decimation);
- of the twigs, the longest stay, and those lose triangles the same way;
- every leaf, a small mesh of its own in the source, becomes one flat card with the leaf's own
  piece of the photograph. Of the cards one in so many stays, and the ones that stay are made
  larger, so that the crown covers what it covered. A level's leaves are among the leaves of the
  level before, so a tree keeps its shape as the viewer walks up to it.

What it makes that its source does not hold: the flat card that stands for a leaf, and the
normal a card is lit by, which is the round crown's and not the card's own. Both are worked out
from the source's leaves and from nothing else.

`derive.sh` runs this and holds the result to the file the kit commits. The same source and the
same Blender give the same bytes: `cutlib` fixes the exporter's clock and its object numbers.
"""
import os
import sys

import bpy
import numpy as np

sys.dont_write_bytecode = True                      # no cache folder beside the script, in the kit
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutlib
from cutlib import collapsed, cut, triangles

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
# A small tree, 3.4 m tall and 4.2 m across, that the kit draws smaller, as a shrub: a bush's levels.
TREES["island_tree_02"] = {
    "object": "island_tree_02_LOD0",
    "materials": {"island_tree_02": ("wood", "island_tree_02"), "island_tree_02_branches": ("wood", "island_tree_02_branches"),
                  "island_tree_02_leaves": ("leaves", "island_tree_02_leaves")},
    "levels": [(1600, 1400, 3500), (350, 150, 700), (100, 0, 140)],
}
# Seven bushes of one file, 0.7 to 2.3 m tall. A bush has no limb: its stems are twigs. Its
# stems, twigs and leaves are on one photograph, so they are one material.
TREES.update({
    f"searsia_lucida_{bush}": {
        "object": f"searsia_lucida_{bush}_LOD0",
        "materials": {"searsia_lucida": ("wood", "searsia_lucida"), "searsia_lucida_twigs": ("wood", "searsia_lucida"),
                      "searsia_lucida_leaves": ("leaves", "searsia_lucida")},
        "levels": [(0, 2600, 3500), (0, 450, 700), (0, 0, 140)],
    } for bush in "abcdefg"
})

# A connected part of the wood with this many triangles or more is a limb; a lighter one is a twig.
LIMB = 1000
# A twig is cut to no less than this share of its triangles: under it a twig is a sliver.
TWIG = 0.2
# A kept card is larger than its leaf by the square root of how many leaves it stands for, times
# this: cards overlap more than leaves do.
OVER = 1.15
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


tree, src, out = sys.argv[sys.argv.index("--") + 1:][:3]
cutlib.tool()
spec = TREES[tree]
levels = spec.get("levels", LEVELS)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.fbx_import(filepath=src)
source = bpy.data.objects[spec["object"]]
me = source.data
source.name = me.name = "source"                    # the levels take the tree's name
co, lv, uv, ls, lt, mi = arrays(me)
# Metres, z up, about the tree's own origin: a file of several lays them out in a row, and where
# a tree lies in that row is not where it stands in the world.
co = co @ np.array(source.matrix_world)[:3, :3].T
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
normal = cutlib.ROUND * outward + (1 - cutlib.ROUND) * face
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
    return cutlib.card_mesh(verts, corner_uv[chosen], normal[chosen], leaf_material), size


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
    joined = cutlib.join(parts, f"{tree}_LOD{level}")
    row["triangles"] = triangles(joined.data)
    row["materials"] = [slot.material.name for slot in joined.material_slots]
    report["levels"].append(row)
    made.append(joined)

bpy.data.objects.remove(source)
cutlib.write(made, out, report)
