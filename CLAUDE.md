# CLAUDE.md

VormCraft is a free, SketchUp-style direct modeler (push/pull) for Windows and the web, built with
TypeScript, Three.js, Manifold, Tauri and Vitest.
- Repo: github.com/dobbsbp/VormCraft (public, MIT).
- Web app: https://vormcraft.app.
- Files: `.vorm`.

**Read `docs/SPEC.md` before every task.** It is the source of truth for scope, tools and behaviour.
`README.md` is the public feature list; keep it current when adding features.
Unfinished work and known bugs live in `TODO.md`.

## Current state (0.5.12, November 2026)
- Released for Windows (NSIS installer, auto-update) and the web (installable PWA, works offline).
  Both are built by GitHub Actions from a version tag.
- **Modelling tools:** Line, Rectangle (and Rotated), Circle, Polygon, Arcs/Pie, Push/Pull with
  boolean cuts and merging, Offset, Follow Me, Move/Rotate/Scale (with copies and arrays), Points
  editing, Eraser, Tape Measure/guides, Text labels, Dimensions, 3D Text, Paint Bucket.
- **Groups and right-click menu:** groups, and Merge Shapes (union) in the right-click menu.
- **Hiding:** groups and lines (Ctrl+H), Show Hidden Lines, Unhide / Unhide All.
- **Units:** per design (mm, cm, m, in, ft, feet and inches), chosen on New, changed in Design
  Properties (click the design's name).
- **View and workspace:**
  - scenes and a slideshow; face styles; perspective or parallel projection;
  - Viewer mode for touch screens;
  - the Library (49 household objects);
  - a movable, customisable tool palette (tools can be left out, under ⋯) and a hideable top bar;
  - a Views button that cycles the standard views;
  - sky and ground behind the model (per device; scenes can keep their own).
- **Checks:** Entity Info shows volumes and whether shapes are proper solids; tests refuse changes
  that break solids.
- **Files:**
  - save/open `.vorm` (format 7, with design history and undo saved inside);
  - autosave and recovery;
  - Google Drive save, open and autosave, and each device's settings saved/loaded by hand
    (`VormCraft settings.json`; Google-verified; `drive.file` scope only);
  - import SKP/OBJ/STL; export STL/OBJ.
- About 605 Vitest tests; `npm test`, `npm run typecheck` and the build must stay clean, with no
  warnings.

## Rules
- The half-edge model in `src/core/model` is the only source of truth. Never treat a Three.js mesh
  as the model.
- `src/core` and `src/library` must never import Three.js, DOM or Tauri APIs; they must run under
  plain Node/Vitest.
  - `src/tools` has no DOM or Three.js either.
- Every geometry operation needs Vitest tests before it is done.
  - No change may break a solid by accident (open it, turn it inside out, or leave two pressed face
    to face): the test harness refuses such changes through `ToolController.onSolidsWorse`.
    Erase and the Eraser may open solids on purpose.
  - Run `npm test` and `npm run typecheck` before finishing any task.
  - Do not break existing tools.
- Use our own icons, textures and models (SVG and canvas artwork in code).
  - Copy nothing from SketchUp; never re-add SketchUp screenshots or artwork (one was purged from
    the history).
  - Library items are made for VormCraft only: no outside or CC0 models unless the maintainer asks.
- Keep THIRD_PARTY_NOTICES.md current when adding a shipped library.

## Architecture
- `src/core`: the geometry kernel, pure TypeScript.
  - Half-edge model (`model/`): faces with holes, curves (true circles), soft edges.
  - Operations (`ops/`):
    - drawing, imprint, push/pull, offset, Follow Me, transform (with auto-fold), points;
    - erase, cleanup, groups, mesh import, Merge Shapes;
    - 3D text outline tracing (`text3d.ts`).
  - Booleans through Manifold (`boolean/manifold.ts`); `triangulate.ts`; watertight checks
    (`check/`).
- `src/view`: Three.js display. `Viewer.ts` is the only DOM/WebGL code; call `viewer.refresh()`
  after every model change.
  - `displayData.ts` derives buffers from the model (one face id per triangle, one edge id per
    line segment).
  - `picking.ts` maps hits back to model ids.
  - `navigation.ts`: pure camera maths.
  - `touchGestures.ts`: Viewer-mode gesture maths.
  - `thumbnails.ts`: Library preview pictures, drawn by a small renderer of its own.
- `src/doc`: `Document` (root model, groups, guides, labels, materials, scenes) with snapshots,
  which is what gets saved.
  - `doc.model` is the model being edited (the open group's, else `doc.root`); tools only ever
    touch `doc.model`.
  - Whole-document work (save, export, bounds, rescale) must use `doc.root` / `doc.allModels()`.
  - `History.ts`: undo/redo as snapshots.
  - `Versions.ts`: the design history; saved, but not part of undo.
  - Scenes talk to the view only through the `SceneView` interface.
- `src/tools`: tools as plain state machines (`Tool` in `types.ts`).
  - They receive `ToolEvent`s (snapped point, hit face/edge, pick ray) and return a `Preview`.
  - `ToolController` routes events and the Measurements box, and applies changes atomically with
    rollback.
  - Also here: `inference.ts` (snapping), `contextMenu.ts` (right-click menu entries) and
    `PlaceTool.ts`, which places Library items and 3D Text (outline follows the cursor, arrow keys
    turn it).
- `src/library`: the object library, every item built by code.
  - `kit.ts`: boxes, prisms, cylinders and lathes, joined by a Manifold union per part.
  - `catalog.ts`: item type, rooms, `LIBRARY_VERSION`.
  - `household.ts`: the items.
  - `search.ts`: search with typos and synonyms.
  - Tested in `tests/library.test.ts`.
- `src/io`:
  - `fileFormat.ts`: the versioned `.vorm` JSON format.
  - `tessellate.ts`: re-divides curved surfaces from their true radii for export.
  - `export.ts`: STL (refuses non-watertight models unless `allowOpen`) and OBJ.
  - `meshFiles.ts`: OBJ/STL readers.
  - `skpImport.ts`: SketchUp import.
  - `versions.ts`, `lineDiff.ts`: history and undo saved in the file.
- `src/app`: the app shell. `main.ts` builds the toolbar, palette (`TOOLS`), Search commands and
  panels.
  - Panels: Materials (a floating window), Scenes, Entity Info, History, Library.
  - Dialogs, `icons.ts` (our own SVGs), `keymap.ts`, `viewerMode.ts`.
  - `lifecycle.ts`: settings, autosave/recovery, updates, About.
  - `files.ts`: hides browser vs desktop file handling.
  - `drive/`: Google Drive.
  - `materialLibrary.ts`: colours and textures drawn in code.
  - `text3dDialog.ts`: draws the text on a canvas, then calls the core tracer.
  - `toolOrder.ts`: palette order.
- `src-tauri`: the desktop shell.
  - Native dialogs, file access, the updater, `launch_file` (a `.vorm` double-clicked in Explorer).
  - `google.rs`: the loopback sign-in for Drive.
  - Capabilities in `capabilities/default.json`.
- Web: `scripts/offline.ts` (Vite plugin: service worker and `version.json`),
  `src/app/webApp.ts`, `public/manifest.webmanifest`.
  - `public/about|privacy|terms` are the site pages Google verification relies on.
  - Keep the privacy policy true to what the app does.
- `tests`: Vitest in a Node environment. View logic is tested with Three.js maths, no WebGL.
  - Tools are tested with hand-built events (`tests/helpers/tools.ts`).

## Conventions
- **Units and axes:** millimetres; Z is up (red = X, green = Y, blue = Z). Library items stand on
  z = 0, centred, front facing -Y.
- **Tolerance:** `TOL` in `src/core/math/tolerance.ts` (0.001 mm). Compare positions with it,
  never with `===`.
- **Loop orientation:** face loops are counter-clockwise about the face normal; hole loops are
  clockwise.
  - Each directed edge belongs to at most one loop, so solids are oriented 2-manifolds.
  - Touching parts keep their own vertex copies.
- **Booleans:** go through `src/core/boolean/manifold.ts`. Call `await initBooleanKernel()` once at
  startup (and in tests' `beforeAll`).
- **Model changes:** all go through `ctx.apply(change, base?, label?)`. It is one undo step, rolls
  back on error, and supports re-dimensioning the last operation by typing afterwards.
- **Typed values:** parse with `src/tools/units.ts` (mm default; cm, m, in, ft accepted).
- **Mouse:**
  - The left button belongs to the active tool.
  - Middle-drag orbits; right-drag pans; a right-click without dragging opens the context menu.
  - Double middle-click re-centres; the wheel zooms to the cursor; Shift+Z zooms extents.
- **Viewer mode gestures (decided by the maintainer after blind tests; do not change):** one finger
  pans; two fingers pinch-zoom and orbit at the same time; flicks glide. Never auto-enter Viewer
  mode.
- **Per-device settings** live in localStorage under `vormcraft.*`; wrap every access in
  try/catch.
- **User-facing text:** plain, short sentences in British spelling (colour, centre).
  - CHANGELOG sections are shown in the update prompt: plain sentences and `- ` bullets, no
    formatting.
- **Code:** match the surrounding style. Doc comments explain why; keep comment density like the
  file around it.

## Key decisions
- **Releases:** builds come from GitHub Actions only. The Windows installer is unsigned (SmartScreen
  warning accepted), installs per user, and updates through the Tauri updater from GitHub Releases.
- **Identity and keys:**
  - Never change the app identifier `app.vormcraft.modeler`.
  - The update signing key and the Google desktop client JSON are secrets.
    - They live only on the maintainer's PC and in repository secrets.
    - Never commit or print them.
- **Old files:** every older `.vorm` format, and `.benup` files from before the rename, must keep
  opening (fixtures in `tests/fixtures`).
- **SketchUp import:** uses `openskp` pinned to exactly 1.4.0, after a code review. Review again
  before any upgrade. Trimble's SDK was rejected.
- **Google Drive:** `drive.file` scope only. The design's own file is written only on Save; the
  autosave copy to Drive is opt-in. `DRIVE_IN_TESTING` is false: the app is verified.
- **Library:** light and fast (plain colours, ≤ 600 faces per item), made by our own code. My
  Library (saving your own items) comes later.
- **3D Text:** uses the computer's own fonts, traced from a canvas; no bundled font files.
- **Mobile:** touch is for viewing (Viewer mode); touch editing is deferred. Native Android is a
  later option.

## Working with the maintainer
- **Outward actions need a go-ahead each time:** push, tags, releases, repo settings, secrets,
  publishing.
  - "Commit, push and release" means do all of it, then watch the run unless told not to.
- **Accounts and sign-ups:** never enter credentials or bank details, and never create accounts;
  the maintainer does sign-ups and console work.
- **GitHub account:**
  - Use the `dobbsbp` gh account (`gh auth switch -h github.com -u dobbsbp`), never `BenPong17`.
  - Push with `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main`,
    and the tag the same way.
  - Commits are authored by Ben Dobbs and end with the Co-Authored-By line from the session.
- **Dev server:** this PC is short on memory. Only start or restart `npm run dev` when asked.
  - For checks, use `npm run build` and the preview server on localhost:5317, which serves `dist`.
  - The service worker caches old builds: test with a fresh browser profile, or Ctrl+Shift+R.

## Releases and compatibility
- **Steps:**
  1. `npm run version:set -- x.y.z` (writes package.json, Cargo.toml and tauri.conf.json).
  2. Rename `## Unreleased` in CHANGELOG.md to `## x.y.z`. Check it has no BOM: avoid PowerShell
     `Set-Content`, and use sed or Python.
  3. Check the notes with `node scripts/release-notes.mjs x.y.z`.
  4. Run the tests, typecheck and build.
  5. Commit, using a message file (`git commit -F`).
  6. Tag `vx.y.z` and push.
- **What the workflow does:** `.github/workflows/release.yml` builds the Windows release, then
  publishes the web app to Pages.
  - If only the Pages deploy fails, use Actions → Release → Run workflow (`workflow_dispatch`
    deploys the web app only).
  - See `docs/RELEASING.md`.
- **File format changes:**
  - Bump `FORMAT_VERSION` (now 7) and keep reading older versions.
  - Add `tests/fixtures/format-vN.vorm` and its case in `tests/compatibility.test.ts`.
  - Never edit or delete existing fixtures.
- **Library items:** when they change shape, bump `LIBRARY_VERSION` so cached preview pictures are
  drawn again.

## Commands
- `npm run dev`: the Vite dev server. `npm run build`: typecheck plus production build.
  `npx vite preview --port 5317`: serve `dist` (the Google OAuth origin for local Drive tests).
- `npm test`, `npm run typecheck`.
- `npm run desktop:dev`: the desktop app against the dev server. `npm run desktop:build`: the
  installer (set `CARGO_BUILD_JOBS=2` if memory is tight).

## Adding a tool
- Implement `Tool` in `src/tools` and register it in `ToolController`, adding a shortcut in
  `keymap.ts` if it has one.
- Add it to `TOOLS` in `src/app/main.ts`. Tools added later go to the end of saved palette orders
  automatically.
- If an action only opens a dialog and then places something (like 3D Text), handle its id in
  `main.ts`'s `setTool` and hand the result to `controller.place()`.
- Update SPEC, README, CHANGELOG (`## Unreleased`) and the tests.
