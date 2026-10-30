# CLAUDE.md

**Read `docs/SPEC.md` before every task.** It is the source of truth for scope, tools and build phases.

## Rules
- The half-edge model in `src/core/model` is the only source of truth. Never treat a Three.js mesh as the model.
- `src/core` must never import Three.js, DOM or Tauri APIs; it must run under plain Node/Vitest.
- Every geometry operation needs Vitest tests before it is done. Run `npm test` and `npm run typecheck` before finishing any task; do not break existing tools.
- Use our own icons and assets; copy nothing from SketchUp.

## Layout
- `src/core` — geometry kernel (half-edge model, ops, booleans, checks). Pure TypeScript.
- `src/view` — Three.js display. `displayData.ts` derives buffers from the model (one face id per triangle, one edge id per line segment); `picking.ts` maps hits back to model ids; `navigation.ts` is pure camera math; `Viewer.ts` is the only DOM/WebGL code. Call `viewer.refresh()` after every model change.
- `src/doc` — `Document` (top-level model, groups, guides, labels, materials, scenes) with snapshots; what gets saved. `doc.versions` (the design's history, `Versions.ts`) is saved too but is not part of undo snapshots. Scenes (`src/doc/Scenes.ts`) are saved views; they talk to the viewport only through the `SceneView` interface (the `Viewer` implements it), so they are testable with a stand-in. `doc.model` is the model being edited (the open group's, else `doc.root`); tools only ever touch `doc.model`. Whole-document work (save, export, bounds, rescale) must use `doc.root` / `doc.allModels()`, not `doc.model`.
- `src/tools` — the tools as plain state machines (`Tool` in `types.ts`), the inference/snapping engine, and `ToolController` (event routing, Measurements box input, atomic commits with rollback). No DOM or Three.js here: tools receive `ToolEvent`s (snapped point, hit face/edge, pick ray) and return a `Preview`.
- `src/io` — export and file format. `tessellate.ts` triangulates for export and re-divides curved surfaces from the stored true radii (`maxDeviation`); `export.ts` writes binary STL (refuses non-watertight models unless `allowOpen`) and OBJ; `fileFormat.ts` is the versioned `.vorm` JSON format (bump `FORMAT_VERSION` and keep reading old versions when it changes; `.benup` files from before the rename must keep opening).
- `src/doc/History.ts` — undo/redo as document snapshots, recorded by `ToolController.apply`.
- `src-tauri` — the Tauri desktop shell: native dialogs, file access (models and autosave backups), the updater, and `launch_file` (a .vorm double-clicked in Explorer); capabilities in `src-tauri/capabilities/default.json`. `src/app/files.ts` hides browser vs desktop file handling; `src/app/backups.ts` the backup folder.
- `src/app` — app shell (toolbar, status bar, Measurements box), icons (our own SVGs), demo model.
- `tests` — Vitest, Node environment. View logic is tested with Three.js math/raycasting, no WebGL.

## Releases and compatibility
- Version: `npm run version:set -- x.y.z` (package.json, Cargo.toml, tauri.conf.json), a `## x.y.z` section in `CHANGELOG.md` (shown in the update prompt), then tag `vx.y.z`; `.github/workflows/release.yml` builds and publishes. See `docs/RELEASING.md`.
- File format changes: bump `FORMAT_VERSION`, keep reading older versions, add `tests/fixtures/format-vN.vorm` and its case in `tests/compatibility.test.ts`. Never edit or delete existing fixtures.
- Never change the app identifier `app.vormcraft.modeler`.
- `src/app/lifecycle.ts` owns settings, autosave/recovery, updates and About; `src/io/versions.ts` the design history.

## Commands
- `npm run dev` — Vite dev server. `npm run build` — typecheck + production build.
- `npm test`, `npm run typecheck`.
- `npm run desktop:dev` — desktop app against the dev server. `npm run desktop:build` — installer in `src-tauri/target/release/bundle/nsis/` (set `CARGO_BUILD_JOBS=2` if memory is tight).

## Adding a tool
- Implement `Tool` in `src/tools`, register it in `ToolController` (+ shortcut) and the palette in `src/app/main.ts`.
- All model changes go through `ctx.apply(change, base?)`: it rolls back on error and supports re-dimensioning the last operation (typing a value after finishing, as in SketchUp).
- Typed values: parse with `src/tools/units.ts` (mm default; cm, m, in, ft accepted).
- Test with hand-built events (`tests/helpers/tools.ts`); test snapping with a real camera projector (`tests/inference.test.ts`).

## Conventions
- Units: millimetres. Z is up (red = X, green = Y, blue = Z).
- Geometric tolerance: `TOL` in `src/core/math/tolerance.ts` (0.001 mm). Compare positions with it, never with `===`.
- Face loops are counter-clockwise about the face normal; hole loops are clockwise. Each directed edge (a→b) belongs to at most one loop, so solids are oriented 2-manifolds.
- Mouse: the left button always belongs to the active tool (Select by default). Right-drag orbits about the point under the cursor; double right-click re-centres the view on the point clicked; middle-drag pans; the wheel zooms toward the cursor; Shift+Z zooms extents. The Orbit/Pan/Zoom tools (O/H/Z) make the left button navigate.
- Booleans go through `src/core/boolean/manifold.ts`. Call `await initBooleanKernel()` once at startup; core ops are synchronous after that.
