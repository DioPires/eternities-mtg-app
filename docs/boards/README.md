# Reference boards

A board is a list of links for one kit or one hero plane. It shows what the place should look like
before anyone builds it. This file is the format. The owner fills the boards on their own time;
`dominaria.md` and `temperate.md` are the first two, and they are empty templates.

## The format

1. **One board per kit or hero plane.** The file is `docs/boards/<slug>.md`. For a hero plane the
   slug is the plane's slug in Appendix A (`pipeline/data/appendix_a.json`; the hero entries are
   PRD v4 Appendix C.1). For a kit it is the kit's name (PRD v4 5.6.1).
2. **One link and one sentence per entry.** The sentence says what to take from the link: a colour,
   a shape, a kind of light.
3. **Three kinds of link.** A Scryfall printing link, for card art: the art is linked and never
   copied (PRD v4 4.15.2, Appendix E.8). A photo link, for a place or a sky. A link to a CC0 sky or
   texture.
4. **A copy is the exception.** An image may be copied into `docs/boards/<slug>/` only if it is CC0
   or made by the owner.
5. **Every copy has a source row.** The board ends with a table that has one row per copied image:
   URL, author, licence, date.
6. **Nothing on a board ships in a build.** An asset that ships is supplied and credited under PRD
   v4 8.12, not here.
7. **A board is not data.** It is not an Appendix C field, and the pipeline never reads it (PRD v4
   4.12).
8. **A board informs. It gates nothing.** Boards inform the hero set-pieces (PRD v4 8.12.3) and the
   tuning of theme rows. They do not change the slice's acceptance (PRD v4 9.5).

## The headings of a board

Every board has the same four headings. The first three hold entries. The last holds the source
table and stays empty until an image is copied.

```markdown
# <Plane or kit name>

## Card art

- [<card>, <set name>](https://scryfall.com/card/<set>/<number>/<name>): <what to take from it>.

## Places and skies

- [<what the photo shows>](<photo URL>): <what to take from it>.

## CC0 skies and textures

- [<asset name>](<asset URL>): <what to take from it>.

## Copied images

| File | URL | Author | Licence | Date |
|---|---|---|---|---|
| `<slug>/<file>` | <source URL> | <author> | CC0 or owner-made | <date copied> |
```
