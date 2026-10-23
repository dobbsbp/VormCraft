# CLAUDE.md

**Read `docs/SPEC.md` before every task.** It is the source of truth for scope, tools and build phases.

## Rules
- The half-edge model in `src/core/model` is the only source of truth. Never treat a Three.js mesh as the model.
- `src/core` must never import Three.js, DOM or Tauri APIs; it must run under plain Node/Vitest.
- Every geometry operation needs Vitest tests before it is done. Run `npm test` and `npm run typecheck` before finishing any task; do not break existing tools.
- `docs/reference-toolbar.png` is a layout reference only. Use our own icons and assets.

## Layout
- `src/core` — geometry kernel (half-edge model, ops, booleans, checks). Pure TypeScript.
- `src/view` — Three.js display. `displayData.ts` derives buffers from the model (one face id per triangle, one edge id per line segment); `picking.ts` maps hits back to model ids; `navigation.ts` is pure camera math; `Viewer.ts` is the only DOM/WebGL code. Call `viewer.refresh()` after every model change.
- `src/doc` — `Document` (model + guides) with snapshots; what gets saved.
- `src/tools` — the tools as plain state machines (`Tool` in `types.ts`), the inference/snapping engine, and `ToolController` (event routing, Measurements box input, atomic commits with rollback). No DOM or Three.js here: tools receive `ToolEvent`s (snapped point, hit face/edge, pick ray) and return a `Preview`.
- `src/io` — export and file format. `tessellate.ts` triangulates for export and re-divides curved surfaces from the stored true radii (`maxDeviation`); `export.ts` writes binary STL (refuses non-watertight models unless `allowOpen`) and OBJ; `fileFormat.ts` is the versioned `.benup` JSON format (bump `FORMAT_VERSION` and keep reading old versions when it changes).
- `src/doc/History.ts` — undo/redo as document snapshots, recorded by `ToolController.apply`.
- `src-tauri` — the Tauri desktop shell (native dialogs + file access only; capabilities in `src-tauri/capabilities/default.json`). `src/app/files.ts` hides browser vs desktop file handling.
- `src/app` — app shell (toolbar, status bar, Measurements box), icons (our own SVGs), demo model.
- `tests` — Vitest, Node environment. View logic is tested with Three.js math/raycasting, no WebGL.

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
- Mouse: the left button always belongs to the active tool (Select by default). Right-drag orbits about the point under the cursor; middle-drag pans; the wheel zooms toward the cursor; Shift+Z zooms extents. The Orbit/Pan/Zoom tools (O/H/Z) make the left button navigate.
- Booleans go through `src/core/boolean/manifold.ts`. Call `await initBooleanKernel()` once at startup; core ops are synchronous after that.
