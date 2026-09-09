/**
 * The layer the bloom source pass draws, and nothing else does.
 *
 * PRD 5.3.20 asks for a *selective* bloom and PRD 9.3 says what selective has to mean in practice:
 * "bloom never washes out a label or the focused card". Review finding R4 is that the shipped
 * chain's `SelectiveBloom` selection was inert — it built a depth pass and a mask pass every frame
 * and then bloomed everything anyway, cards included.
 *
 * A layer replaces all of it. The star field and the nebulae enable this layer as well as layer 0;
 * cards, thumbnails and planets never do. The bloom source pass points the camera at this layer
 * alone, so the selection is enforced by the same mechanism that already keeps the id buffer's
 * points out of the picture (`../picking/idPicker`'s `PICK_LAYER`), costs one draw call per object
 * that opted in, and cannot fall out of step with a selection array.
 *
 * Its own module so that `../starfield/starFieldObjects` and `../background` can opt in without
 * importing the chain that reads it.
 */
export const BLOOM_LAYER = 2
