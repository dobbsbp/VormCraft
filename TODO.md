# TODO

Unfinished work and known bugs. Newest notes at the top of each section. Move an item to
CHANGELOG.md when it ships.

## Known bugs
- **Follow Me lathe leaves its path's face inside the solid.** Turning a profile around a drawn
  circle keeps the circle's disc face, hidden inside the ring.
  - A box selection then catches that face.
  - Merge Shapes now skips flat faces and says so, but the stray face is still there. It should
    be removed when the path was only used as a path.
- **Labels are missed by some selections.** Ctrl+A (Select All) and the Lasso do not select text
  labels; box selection, click, right-click and the Eraser do.
- **Triangulation fallback is not guaranteed.** `triangulate2D` nudges points and retries earcut
  (up to 3 times) when a face's triangles do not use every point. A face where all attempts fail
  would still be left open. No case is known, but nothing reports it.
- **3D Text silently swaps fonts.** If the chosen font is not installed, the browser uses its
  default sans-serif without saying so.

## Rough edges (UX)
- A box drawn on a face becomes part of that face (a bump), not a solid of its own. Merge Shapes
  explains this, but it still surprises people. A "make this a solid/group" hint or command could
  help.
- The toolbar wraps to two rows below about 1300 px wide.
- When the top bar is hidden, its tab is small (14 px tall) and may be hard to find.
- The floating Materials window has not been checked on small screens (below 900 px), nor beside
  Viewer mode.
- Library placement does not line items up with a clicked wall or face. Wall items come in at
  their usual height, centred on the click, and need a Move to sit against a wall.
- Library preview pictures are kept in localStorage (about 10–20 KB each). Fine for 49 items;
  move them to IndexedDB if the library grows a lot.

## Unfinished / planned
- **Library:**
  - My Library: save a selection as your own item with tags, stored locally and optionally on
    Drive. Wanted only after seeing how the Library works.
  - More categories: Building (doors, windows, stairs, railings), Office, Outdoor.
  - Size versions for more items.
- **Components** (linked copies). Library items and SketchUp imports are full copies today, so
  files grow quickly.
- Locking groups.
- **Views:** dimensions, section planes, tags/layers, shadows (scenes should save these too).
- A field-of-view control.
- **Export:**
  - STEP (true curves, through OpenCascade).
  - OBJ with materials.
- **SketchUp import gaps:**
  - Some pre-2018 files cannot be read (OpenSKP).
  - Layers/tags, texts, dimensions, section planes and positioned texture mapping are not
    imported.
  - Architecture models keep about 15 % of faces on edges of their own.
- **Touch:** editing with touch (Viewer mode covers looking at models). A native Android app if the
  web app is not enough.
- **Windows:** the installer is unsigned (SmartScreen warning); a code-signing certificate could
  come later.
- **Donations:** add Ko-fi (through PayPal) beside GitHub Sponsors and QRIS.
- **Google Drive:** Google plans billing above 400M API units per day later in 2026, with 90 days'
  notice. Watch usage if VormCraft grows.
