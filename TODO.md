# TODO

Unfinished work and known bugs. Newest notes at the top of each section. Move an item to
CHANGELOG.md when it ships.

## Known bugs
- **Follow Me's path face over a frame or plate:** the outline face of a picture frame (or a
  plate under a bowl) stays where it is, partly under the new solid. It is outside the solid, so
  it is kept, but where it lies under the frame the two faces overlap.
- **Labels are missed by some selections.** Ctrl+A (Select All) and the Lasso do not select text
  labels; box selection, click, right-click and the Eraser do.
- **Triangulation fallback is not guaranteed.** `triangulate2D` nudges points and retries earcut
  (up to 3 times) when a face's triangles do not use every point. A face where all attempts fail
  would still be left open. No case is known, but nothing reports it.
- **3D Text silently swaps fonts.** If the chosen font is not installed, the browser uses its
  default sans-serif without saying so.

- **Inside-out solids already in files** (from older versions, imports or Reverse Faces) are only
  reported (Entity Info), not fixed automatically. Push/Pull and Merge Shapes do not join them.

## Rough edges (UX)
- AI designs: a design file cannot be dropped on the window yet (paste or Open file…); a JSON
  Schema of the build format could be offered for AIs with structured output; the template has
  not yet been tried on many different AIs.
- Customised Library items cannot be customised again once placed: Entity Info could offer
  Customise… for a component whose `source` has settings, rebuilding every copy. The settings
  chosen are kept only while the app is open.
- Dimensions keep their own ends: moving the geometry on its own leaves them behind (move them
  together, or redraw). Zoom Extents does not count dimensions and labels.
- After Ctrl+H the line under the cursor stays highlighted until the mouse moves.
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
- **After 1.0, from the code review of 0.9.0 (November 2026):**
  - Desktop file access is allowed everywhere (`"path": "**"` for every `fs:` permission in
    `src-tauri/capabilities/default.json`). Narrow it: files picked in a dialog are allowed by
    Tauri anyway; the backup folder, a double-clicked `.vorm` and the older-format backup beside
    an opened file need their own handling (narrow Rust commands or runtime scopes). Test in the
    installed app on Windows and Linux.
  - Desktop Drive sign-in hands the client secret and the refresh token to the page
    (`google.rs` → `desktopAuth.ts`). Move the code exchange and token refresh into
    `google.rs`, so the page only ever holds short-lived access tokens.
  - Every `viewer.refresh()` rebuilds the display data of every group, even untouched ones
    (`Viewer.rebuildLayers`). Cache each group's display data and buffers, rebuilt only when that
    group changes. Needs a change counter on `Model` that every change bumps (missing one would
    show stale geometry), and the inherited material and faded state in the cache key.
  - Smaller items from the review not done yet: GPU buffers not freed when `refresh()` replaces
    attributes; Manifold objects not freed when a boolean throws; tessellated STL export not
    checked for open edges after refining curves; binary STL and DXF coordinates not checked for
    NaN; `booleanInPlace` rolls back only on `NonManifoldResult`; DXF block and SKP placement
    totals have no cap; gzipped undo and history entries have no size cap; web Save cannot tell
    a cancelled download; a recovered Drive design forgets its Drive file; Drive autosave can
    write into a file in the bin; old Library preview pictures are never removed; Drive
    `pageToken` not URL-encoded; preferences writes to localStorage not wrapped in try/catch.
- **Linux:**
  - Follow up: let Linux users choose the graphics card (Settings → Graphics card is Windows-only
    for now). On laptops with two graphics chips this means starting WebKitGTK with `DRI_PRIME=1`
    (AMD/Intel) or `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia` (Nvidia), set in
    `src-tauri/src/lib.rs` before the window opens, like the Nvidia DMA-BUF workaround there.
  - Try the ARM64 AppImage on a real computer (a Raspberry Pi 5 or an ARM laptop): x86_64 was
    tried on Pop!_OS (0.6.0-beta.2, with the right graphics chip in About), ARM64 only built.
- **Google Drive folders:**
  - Folders made on the Google Drive website are invisible to VormCraft (`drive.file`). Google
    Picker could let people choose one to grant access; left out for now (more Google code and a
    look from verification).
  - Dragging a design onto a folder to move it (today: ⋯ → Move to…).
- **Library:**
  - My Library: save a selection as your own item with tags, stored locally and optionally on
    Drive. Wanted only after seeing how the Library works.
  - More categories: Building (stairs, railings), Office, Outdoor.
  - Size versions for more items.
- **Components:** components inside components (nested ones become plain groups today);
  SketchUp imports still come in as full copies; a component browser listing them.
- **Section planes:** snapping still reaches points on the cut-away side.
- **Walls and openings:** doors and windows do not stay glued to their opening (moving one leaves
  the hole); walls drawn into each other are not joined (Merge Shapes can unify them); the wall
  thickness and height are not remembered between sessions.
- Locking groups.
- **Views:** tags/layers, sun and shadows (scenes should save these too).
- **Settings sync:** automatic (today Save and Load are by hand); two devices saving at the same moment could overwrite one another.
- A field-of-view control.
- **Export:**
  - STEP (true curves, through OpenCascade).
  - OBJ with materials.
- **DXF import:**
  - Keep splines as true curves in the file (a new curve type, `.vorm` format 9), so their detail
    can be changed after import and exports divide them again, as circles are.
  - Small gaps (Rhino Make2D leaves ends up to about 0.05 mm apart) stop outlines closing into
    faces: an option to join ends closer than a set gap.
  - Hatches, MLEADERs, ACIS solids (3DSOLID/BODY/REGION) and attribute values are left out.
  - STEP/IGES import (OpenCascade compiled for the web) for real 3D CAD models, to look at later.
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
