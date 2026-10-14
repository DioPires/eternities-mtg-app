"""Measure where the things photographed in an opacity map are (PRD v4 7.6.4; DEC-1003).

    blender -b --factory-startup --python sprays.py -- <alpha.png> [from u]

It prints the opaque regions of the map, the largest first: each one's rectangle in texture
coordinates, from the left, from the bottom, to the right, to the top, and how many texels it
covers. `cut_fir.py` carries seven of those rectangles as `SPRAYS`, the sprays in the twig
photograph of Poly Haven's firs: this is how they were measured, on
`Props/fir_sapling_medium_twigs_alpha_1k.png` with 0.14 as `from u`, and how a reviewer measures
them again. Which regions are sprays, and not single needles or a bare twig, is read off the
photograph by eye. It makes no file. It ran on Blender 5.2.2 LTS, the cuts' tool (`cutlib.TOOL`).
"""
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
image = bpy.data.images.load(args[0])
image.colorspace_settings.name = "Non-Color"        # the file's own values, as stored
w, h = image.size
texels = np.empty(w * h * 4, np.float32)
image.pixels.foreach_get(texels)
opaque = texels.reshape(h, w, 4)[:, :, 0] > 0.5     # row 0 is the bottom
opaque[:, :int((float(args[1]) if len(args) > 1 else 0.0) * w)] = False

# A spray of thin needles is one region: grow the opaque texels by six, then name each connected
# region by the highest texel number in it.
grown = opaque.copy()
for _ in range(6):
    wider = grown.copy()
    wider[1:] |= grown[:-1]; wider[:-1] |= grown[1:]; wider[:, 1:] |= grown[:, :-1]; wider[:, :-1] |= grown[:, 1:]
    grown = wider
region = np.where(grown, np.arange(h * w).reshape(h, w), -1)
while True:
    before = region.copy()
    for shift in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        moved = np.roll(region, shift, axis=(0, 1))
        if shift[0] == 1: moved[0] = -1
        if shift[0] == -1: moved[-1] = -1
        if shift[1] == 1: moved[:, 0] = -1
        if shift[1] == -1: moved[:, -1] = -1
        region = np.where(grown & (moved > region), moved, region)
    if np.array_equal(before, region):
        break

names, sizes = np.unique(region[grown], return_counts=True)
rows, columns = np.indices((h, w))
for name, _ in sorted(zip(names, sizes), key=lambda pair: -pair[1])[:14]:
    held = (region == name) & opaque
    if held.sum() >= 400:
        print("region (%.4f, %.4f, %.4f, %.4f) of %d texels" % (
            columns[held].min() / w, rows[held].min() / h, (columns[held].max() + 1) / w, (rows[held].max() + 1) / h, held.sum()))
