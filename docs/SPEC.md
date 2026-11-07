# SketchUp-Style Direct Modeler — Spec v0.1

## Goal
A free, fast, direct-modeling 3D app that feels like SketchUp, for commercial work, 3D printing and CAD/CAM handoff. Built by Claude Code. No parametric timeline, no constraints: you grab faces and push them.
Use our own icons and assets, and copy nothing from SketchUp.

## Tech Stack
- Language: TypeScript (strict mode)
- Rendering and picking: Three.js, for display only. The Three.js mesh is never the model.
- Model: custom half-edge structure. Faces are true polygons and can have holes (inner loops). Triangulate only for display, and tag every triangle with the ID of its source face.
- Booleans: Manifold (WebAssembly) for cutting through solids
- Later: OpenCascade (WebAssembly) for true curves and STEP export
- Desktop app: Tauri
- Tests: Vitest. The geometry core must be fully testable without any graphics.

## Core Principles
1. Every tool accepts typed input (dimensions box): type a value, press Enter.
2. Drawing tools snap to the face under the cursor and draw on that face's plane.
3. New edges drawn on a face split that face automatically.
4. Every geometry operation has automated tests before it is considered done.

## Tools (v1)
### Select
- Click to select a face or edge. Shift to add or remove. Drag a box to select several.
- Double-click a face to select it together with its bounding edges.
### Rectangle
- Click a start corner, move, click the second corner.
- While drawing, type width,length and press Enter for exact size.
- Draws on the face under the cursor, or on the ground plane. Splits the host face.
- Snapping the second corner to a point on the model off the drawing plane turns the rectangle upright, into the red/green/blue plane holding both corners (as in SketchUp). Arrow keys fix the plane instead (→ faces red, ← green, ↑ flat); press again to unlock. A rectangle drawn exactly over an opening fills it; one along an edge that already has a face on each side gets corners of its own (it touches there).
### Closing openings
- Drawing a line over an edge of an opening (a face on one side, nothing on the other, as after deleting a box's end, or a hole in a face) follows the opening's outline and, if it closes and lies flat, fills it with a face. The back of a flat surface (faces lying in the outline's plane all round, not a hole) is not an opening.
- Lines closing a loop against existing solids: edges that already have a face on each side (a box's corners) may bound the new face too; it gets its own vertices there (it touches the solids, see "touching parts") and the drawn lines become its edges. A loop over an existing face is never filled again.
### Circle
- Click the centre, move, click to set the radius, or type the radius and press Enter.
- After the centre click the Measurements box asks for the number of sides first (default 24): type it and press Enter (or press Enter to keep it), then type the radius and press Enter. "32s" sets the sides at any time.
- Segment count can be set (default 24). The true radius is stored for later STEP export.
- Drawn on a face, it splits the face into an outer face with a hole plus an inner circle face.
### Arcs (2-Point, 3-Point, Arc, Pie)
- The drawing plane comes from the face under the first click; at the second click, if that plane does not hold the second point, a face holding both points is used instead (the face the chord crosses, else the one under the cursor), so an arc from edge to edge of a face lies on that face and splits it.
- Arc and Pie: click the centre, then click the start or type the radius and press Enter. The Measurements box then asks for the number of segments (default 12): type it and press Enter (or press Enter to keep it), then type the angle in degrees and press Enter, or click the end. A click skips the segments question. "16s" sets the segments at any time.
- Arrow keys fix the plane instead (→ faces red, ← green, ↑ blue); press again to unlock. 3-Point arcs take their plane from their three points.
### Push/Pull
- Hover a face, click, drag along its normal, click to finish, or type a distance and press Enter.
- Flush push-through: if the face reaches a coplanar opposite face of the same solid, delete both faces and keep the side walls, making a through-hole.
- Non-flush push-through: if the extrusion passes through a solid whose far side is not flush, run a boolean subtraction (Manifold) so the cut follows the solid automatically. No manual Intersect Faces step is needed.
- Pushing outward from a face adds material. Pushing inward removes it.
- Parts touching only along an edge or at a point: each part keeps its own vertices (copies at the same spot), so every part stays a proper 2-manifold solid. The boolean rebuild keeps result vertices that Manifold treats as different apart, even at the same spot. Touching parts count as one object (`connectedFaces` follows shared and coincident vertices: selection, push/pull, Follow Me); the watertight check counts them as separate shells. A push/pull next to a contact includes the touching parts, so a shared line is split where a face stops, and parts pulled into each other merge into one solid. Faces back to back (which cannot be represented) are still refused.
- Ctrl (new starting face): the new side walls stay separate faces, leaving an edge loop where the face was, instead of merging with neighbouring faces they line up with. On a closed solid, pulling out is an ordinary (boolean) pull, so whatever the new part touches is joined properly, after which the face's old outline is drawn back where it lies on a face, as if drawn by hand; pushing in is unchanged. The model has no internal faces, so unlike SketchUp the original face itself is not kept. The mode ends with the push.
### Move and Rotate
- Ctrl switches copy mode (a + on the cursor): the copy follows the mouse and the original stays. It ends with the copy, as in SketchUp; typing "3x" or "/3" afterwards makes an array. Pressing Ctrl switches at once; if another key follows while it is held (Ctrl+Z…), it was a shortcut and the switch is taken back.
### Select All
- Ctrl+A selects everything in the model (in the open group when editing one), never the page's text; the app's labels and buttons cannot be text-selected.
### Offset
- Click a face, drag inward or outward, or type a distance.
- Creates a new edge loop offset from the face boundary, splitting the face.
### Guides (Tape Measure)
- Click an edge and drag to create a parallel guide line at a typed distance.
- Click a point and drag to create a guide point.
- Guides act as snap targets for all drawing tools and can be hidden or deleted in bulk.
### Right-click menu
- Right-click (press and release without dragging; right-drag still pans) selects what is under the cursor unless it is already selected, then opens a menu for the selection. Items that do not apply are greyed out.
- Entity Info, Erase, Hide (groups), Unhide All · Edit Group, Close Group, Explode, Make Group · Select ▸ (Bounding Edges, Connected Faces, All Connected, All with Same Material, Select All, Select None) · Reverse Faces, Flip Along ▸ (Red/Green/Blue, about the selection's centre), Soften / Unsoften Edges (selected edges, or edges between selected faces), Zoom Selection.
- Entity Info panel: a group's name (editable), contents, size and paint; faces' area and paint; edges' length and smoothing.
- Not included: Lock, Make Component, Unglue, Reset Scale/Skew, Intersect Faces (no components or locking yet; booleans already cut automatically).
### Inference Snapping (applies to all tools)
- Snap to endpoints, midpoints, edges, faces, guide intersections, and the red, green and blue axes.
- Show a visual cue for the active snap.
### Follow Me
- Select the path (connected edges, or a face to follow its edge), then click the profile face. The profile is swept along the path with mitred corners.
- A free-standing profile becomes a new solid; a closed path turns it right round (lathe). A profile drawn on a solid cuts a groove or chamfer along the path.
- Curved profiles and paths give smooth (soft-edged) surfaces, with true curves kept where the path has arcs.
### Materials (Paint Bucket)
- Paint faces with a colour (optionally see-through) or a texture image tiled at a real-world size. Materials are saved in the document.
- Click paints a face (a whole curved surface; all selected faces if the clicked face is selected). Shift: every face with the same paint. Ctrl: connected faces with the same paint. Alt: pick up a face's paint.
- Paint follows the geometry: faces split from a painted face, and pushed or moved faces, keep their paint.
- Materials panel: materials in the model, a library of colours and textures (our own artwork), and an editor (name, colour, opacity, texture image and tile size).
### Groups
- Select geometry and press Ctrl+G (Make Group): it moves into a group with geometry of its own, so it never sticks to or merges with anything outside it. Selected groups go inside the new group (groups can hold groups).
- A group selects, moves, rotates, scales, copies, erases and paints as one piece. Painting a group colours its faces that have no paint of their own.
- Double-click a group to edit its contents with every tool; the rest of the model is faded. Esc (with nothing selected), a click outside it, or the Close badge closes it.
- Explode Group (Search) puts a group's geometry back into the geometry around it, joining it up where it touches.
- Groups are saved in the file and included in STL and OBJ export.
### View: styles, projection, hiding
- Face styles: Textured, Shaded (colours only), Wireframe (edges only, faces not pickable), X-ray (see-through faces; edges behind them stay pickable). Back edges (K) and the background colour are part of the style.
- Perspective or parallel projection (toolbar). Parallel keeps the scene the same size on screen when switched on; zoom, pan and zoom window work in both.
- Hide selected groups / Unhide all (Search). Hidden groups are not drawn, picked, snapped to or box-selected; they are still saved and exported.
### Scenes
- A scene is a saved view: camera (position, target, field of view, projection, parallel view height), hidden groups, and style (face style, back edges, guides, background). Scenes are saved in the file; adding, updating, deleting, renaming and reordering them are undo steps, going to one is not.
- Each scene has checkboxes for what it restores (camera, hidden groups, style). Going to a scene changes style and hidden groups at once and glides the camera there (ease-in-out, transition time configurable, default 1 s).
- Scenes panel: list (click to go, double-click to rename, arrows to reorder, ✕ to delete), Add scene, Update (overwrite with the current view, keeping name and place), Play/Stop, timings. Tabs along the top of the viewport go to a scene in one click; Page Up / Page Down step through them.
- Slideshow: plays the scenes in order, gliding for the transition time and staying for the delay, looping until Esc or a click.
- Not yet captured (the features do not exist yet): tags/layers, section planes, sun/shadows, fog.
### Autosave, history and settings
- Autosave every N minutes (default 1) when the design changed: records a version and writes a recovery copy (`<name>-<hash>.autosave.vorm`) to the backup folder (default: the app's local data folder; browser: IndexedDB). The design's own file is never written by autosave. The copy is removed when the design is saved or its changes discarded; copies left at startup are offered back (newest first) and deleted after N days (default 14).
- History: versions of the whole document (gzip, base64, textures stored once by hash) recorded at each autosave, save, open (if the file has none) and restore; identical states are not recorded twice. Thinned: all from the last day, newest per hour for a week, newest per day before that; trimmed to a size limit (default 25 MB). Saved in the .vorm file (format 5); a damaged history never stops the design opening.
- Looking at a version is read-only (tools, undo and redo are refused; Esc or Back to now returns). Restoring records the current design first, then replaces the document as one undo step.
- Settings (stored on the computer, kept across updates): autosave on/off and minutes, backup folder, keep-for days, history on/off and size limit, check for updates at startup.
### Undo saved with the design
- Format 6 keeps the newest 100 undo steps (at most 8 MB compressed) in the file when history is on, so Undo works after reopening. Each step is a line diff (`src/io/lineDiff.ts`) from the step after it, over the design written one record per line (`linedJson`), gzipped; a step that changed nearly everything is stored whole. Steps are rebuilt only when undone to. A hash of the design ties the steps to it: a file changed outside VormCraft opens without them. Steps already encoded are reused on the next save.
### Desktop app, updates and compatibility
- Windows installer (NSIS, per-user, no admin), built by GitHub Actions from a version tag; `.vorm` files open with a double-click. Updates: the Tauri updater reads `latest.json` from the newest GitHub Release, checks at startup (Settings) and on request, shows the CHANGELOG notes, installs and restarts. Updates are signed; the private key is a repository secret. The app identifier `app.vormcraft.modeler` must never change (settings live under it).
- Graphics: WebGL through WebView2 (Direct3D 11); asks for the high-performance GPU, warns when only a software renderer is available, redraws after a graphics driver reset. About shows the version and GPU.
- Web version on Windows: browsers ignore the page's high-performance request and Windows usually gives them the built-in GPU. On built-in graphics (classified from the WebGL renderer name; WebGPU's high-performance adapter names a faster card's maker when it differs) a dismissible tip shows once how to set the browser to High performance in Windows' graphics settings; Settings → Graphics card shows the steps too.
- Every older file format keeps opening (sample file per format version in `tests/fixtures`, tested). Files from a newer version are refused with an offer to update. The first save over an older-format file keeps a copy of the original.
### Google Drive (web version; being tested)
- `src/app/drive`: `driveApi.ts` (Drive REST v3 with fetch, `drive.file` permission only: VormCraft sees only files it created; retries 429/5xx/rate limits with backoff, new token after 401, uploads over 5 MB resumable in 8 MB pieces), `googleAuth.ts` (web sign-in through Google Identity Services; token in memory only), `driveSession.ts` (account, the VormCraft folder at the top of My Drive, designs, autosaved copies in VormCraft/Autosave, clash check by head revision), `driveAutosave.ts` (upload timing), `driveCommands.ts` (menu and commands), `driveDialog.ts` (Open list).
- The design's own Drive file is written only by Save (Ctrl+S saves back to the Drive file a design was opened from or saved to). Before writing, the file's revision is compared with the one opened or last saved; if it changed elsewhere: Replace (Drive keeps the old one in its own version history) or Keep both (saved as "Name (2)").
- Autosave a copy to Google Drive (each person switches it on; off by default): one file per design in VormCraft/Autosave, replaced each time, uploaded after a 20 s pause, at least every 2 minutes while changes keep coming, one upload at a time, at once when the tab is hidden. The local recovery copy is kept as before.
- While Google has the app in testing, the Drive button shows only on localhost (or with localStorage `vormcraft.drive.preview` = "1"). The web sign-in token lasts an hour; renewing it needs a click (browsers block pop-ups otherwise), so the status bar asks for it. The Windows app's sign-in comes later.
### Web version
- The same app, built from the same tag, published on GitHub Pages after the Windows release. Installable (manifest, icons, own window with no browser bars); works offline: a service worker (generated by `scripts/offline.ts`) stores every file of the build and serves it (ignoring Vary, so module scripts match). A new version downloads in the background; the app shows its notes (`version.json`) and asks before switching. Desktop Chrome/Edge open .vorm files through `launchQueue`.
- Web differences: Save downloads the file; autosave copies live in IndexedDB (persistent storage requested); the browser chooses the graphics card. Same version number and file format as the desktop app.
- Smaller screens: the toolbar wraps, side panels float over the view below 900 px wide, smaller buttons below 520 px.
### Import
- OBJ (text: v/f with v/vt/vn and negative indices; objects, else groups, become separate groups) and STL (binary or text, detected). Units chosen on import (mm, cm, m, in, ft; live size preview), Y-up or Z-up, remembered per format.
- Mesh to model (`src/core/ops/importMesh.ts`): corners welded; polygons with no area dropped; non-flat polygons fanned; neighbouring coplanar polygons with consistent winding merged into one face (outer loop + holes; if the outline is ambiguous the pieces are added singly); polygons that cannot join a valid 2-manifold (flipped, more than two faces on an edge) skipped and counted; collinear vertices removed; edges between faces under 20° softened (optional).
- Each object is added as a group in the current context (one undo step), selected and zoomed to. Files over 300,000 polygons ask first.
- SketchUp (.skp): read by OpenSKP (MIT, pinned to 1.4.0, reviewed; read in a Web Worker, `src/app/skpWorker.ts`), converted by `src/io/skpImport.ts`. The file becomes one group; each placed group/component becomes a nested group with its transform baked in (13-number placement: row-major 3×3, translation, overall scale; inches → mm). Faces keep loops/holes and paint (front, else back); soft/smooth/hidden edges are soft; arcs become true curves where the placement keeps them circles; mirrored placements reverse loops. A face that clashes with its neighbours is turned round, else given vertices of its own, else skipped; counts are reported. Materials (colour, opacity, textures sized from inches, images shrunk to 1024 px), group paint, hidden placements, scenes (camera only) and root guides come in; layers/tags, texts, dimensions, section planes and positioned texture mapping do not. A file with no placed geometry says so; over 300,000 placed faces warns first.
### Export
- STL (binary): watertight check before export, with adjustable curve resolution.
- OBJ
- Later: STEP via OpenCascade

## Build Phases
- **Phase 1: Geometry Core (no graphics)** — Half-edge model, faces with holes, face splitting, extrude, flush push-through, Manifold boolean subtraction, watertight check. Example tests: a rectangle extruded to a box gives 6 faces; a circle pushed flush through a box gives a through-hole and a watertight solid; an angled cut-through gives a watertight solid.
- **Phase 2: Display and Picking** — Three.js scene, orbit, pan and zoom, triangulation with face IDs, hover highlighting.
- **Phase 3: Tools** — Add Select, Rectangle, Push/Pull, Circle, Guides and Offset one at a time, each with typed input and tests. Then add inference snapping.
- **Phase 4: Export and App** — STL and OBJ export, save and open in our own file format, undo and redo, Tauri desktop build.

## Out of Scope (v1)
Parametric history, constraints, components (revisit in v2), exporting SKP or materials.

## Notes for Claude Code
- Read this spec before every task.
- Never use the Three.js mesh as the source of truth.
- Run all tests before finishing a task. Do not break existing tools.
