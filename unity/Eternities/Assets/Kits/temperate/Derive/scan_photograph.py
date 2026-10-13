"""Take a scan's photograph out of its glTF, byte for byte (PRD v4 7.6.4, 8.12.1; DEC-1003).

    blender -b --factory-startup --python scan_photograph.py -- <image> <source.gltf> <out.jpg>

The tool is Blender 5.2.2 LTS, run from the command line with no window (`cutlib.TOOL`), as every
script of the kit's `Derive/` is; this one uses Python alone.

A scan of ffish.asia / floraZia.com carries its photographs inside its glTF, each a JPEG file of
its own in the glTF's data. This writes the one named as the file it is: the same bytes, with no
pixel read, decoded or written again. So the photograph the kit draws a clump with is the one the
scan's author published, at its full size; Unity's importer makes it smaller for the build, as it
does every texture of the kit.
"""
import base64
import json
import os
import sys

sys.dont_write_bytecode = True                      # no cache folder beside the script, in the kit
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutlib

image, src, out = sys.argv[sys.argv.index("--") + 1:][:3]
cutlib.tool()
with open(src) as f:
    gltf = json.load(f)
named = [one for one in gltf["images"] if one.get("name") == image]
if len(named) != 1 or "bufferView" not in named[0] or named[0].get("mimeType") != "image/jpeg":
    raise SystemExit(f"{src}: {len(named)} images named {image}, and a photograph is one JPEG in the file's data")
view = gltf["bufferViews"][named[0]["bufferView"]]
uri = gltf["buffers"][view["buffer"]]["uri"]
if not uri.startswith("data:application/octet-stream;base64,"):
    raise SystemExit(f"{src}: a buffer outside the file, and a scan carries its data inside it")
start = view.get("byteOffset", 0)
photograph = base64.b64decode(uri.split(",", 1)[1])[start:start + view["byteLength"]]
if photograph[:3] != b"\xff\xd8\xff" or photograph[-2:] != b"\xff\xd9":
    raise SystemExit(f"{src}: {image} is not a whole JPEG file")
with open(out, "wb") as f:
    f.write(photograph)

# The report, as the kit's other scripts write one: the photograph's size in pixels from its frame
# header, which is read and not decoded.
at = 2
while photograph[at] == 0xFF and photograph[at + 1] not in (0xC0, 0xC1, 0xC2):
    at += 2 + int.from_bytes(photograph[at + 2:at + 4], "big")
high, wide = int.from_bytes(photograph[at + 5:at + 7], "big"), int.from_bytes(photograph[at + 7:at + 9], "big")
report = {"image": image, "source": os.path.basename(src), "blender": cutlib.bpy.app.version_string, "pixels": [wide, high], "bytes": len(photograph)}
with open(os.path.splitext(out)[0] + ".json", "w") as f:
    json.dump(report, f, indent=1)
    f.write("\n")
print("cut", json.dumps(report))
