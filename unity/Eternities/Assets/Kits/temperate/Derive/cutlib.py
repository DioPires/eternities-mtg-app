"""What the kit's cutting scripts share (PRD v4 7.6.4, the derived binary; DEC-1003): the tool they
run on, the collapse of a limb to a budget of triangles, the card that stands for a leaf or a
spray, and the writing of a model whose bytes are the same on every run."""
import datetime
import hashlib
import json
import os
import sys

import bmesh
import bpy
import numpy as np

# The tool and the version whose bytes the kit commits. Another version may cut the same tree into
# other bytes: the report names the version that ran, and `derive.sh` says when they differ.
TOOL = "5.2.2 LTS"
# The longest edge of a bough, in metres, that is closed before the bough is collapsed.
WELD = 4.0
# A card is lit as part of a round crown and only a little as the flat thing it is.
ROUND = 0.75


def tool():
    if bpy.app.version_string != TOOL:
        print(f"this is Blender {bpy.app.version_string}; the kit's files are Blender {TOOL}'s", file=sys.stderr)


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


def card_mesh(corners, corner_uv, normal, material):
    """Cards as an object: four vertices and one quad a card, with its piece of the photograph,
    each lit by the normal given for it."""
    k = len(corners)
    made = bpy.data.meshes.new("cards")
    made.vertices.add(4 * k); made.loops.add(4 * k); made.polygons.add(k)
    made.vertices.foreach_set("co", corners.reshape(-1, 3).astype(np.float32).ravel())
    made.loops.foreach_set("vertex_index", np.arange(4 * k, dtype=np.int32))
    made.polygons.foreach_set("loop_start", np.arange(0, 4 * k, 4, dtype=np.int32))
    made.polygons.foreach_set("loop_total", np.full(k, 4, dtype=np.int32))
    made.update(calc_edges=True)
    made.uv_layers.new(name="UVMap").data.foreach_set("uv", corner_uv.reshape(-1, 2).astype(np.float32).ravel())
    made.normals_split_custom_set_from_vertices(np.repeat(normal, 4, axis=0).astype(np.float32).tolist())
    made.materials.append(material)
    made.validate()
    held = bpy.data.objects.new("cards", made)
    bpy.context.scene.collection.objects.link(held)
    return held


def join(parts, name):
    """The parts as one object of that name."""
    only(parts)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = joined.data.name = name
    return joined


def write(made, out, report):
    """The levels as a model at `out`, and the report beside it. The first level's size is the
    prop's."""
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
