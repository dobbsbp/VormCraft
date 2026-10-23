# SketchUp-Style Direct Modeler — Spec v0.1

## Goal
A free, fast, direct-modeling 3D app that feels like SketchUp, for commercial work, 3D printing and CAD/CAM handoff. Built by Claude Code. No parametric timeline, no constraints: you grab faces and push them.
The SketchUp screenshot is for layout reference only. Use our own icons and assets, and copy nothing from SketchUp.

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
### Circle
- Click the centre, move, click to set the radius, or type the radius and press Enter.
- Segment count can be set (default 24). The true radius is stored for later STEP export.
- Drawn on a face, it splits the face into an outer face with a hole plus an inner circle face.
### Push/Pull
- Hover a face, click, drag along its normal, click to finish, or type a distance and press Enter.
- Flush push-through: if the face reaches a coplanar opposite face of the same solid, delete both faces and keep the side walls, making a through-hole.
- Non-flush push-through: if the extrusion passes through a solid whose far side is not flush, run a boolean subtraction (Manifold) so the cut follows the solid automatically. No manual Intersect Faces step is needed.
- Pushing outward from a face adds material. Pushing inward removes it.
### Offset
- Click a face, drag inward or outward, or type a distance.
- Creates a new edge loop offset from the face boundary, splitting the face.
### Guides (Tape Measure)
- Click an edge and drag to create a parallel guide line at a typed distance.
- Click a point and drag to create a guide point.
- Guides act as snap targets for all drawing tools and can be hidden or deleted in bulk.
### Inference Snapping (applies to all tools)
- Snap to endpoints, midpoints, edges, faces, guide intersections, and the red, green and blue axes.
- Show a visual cue for the active snap.
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
Parametric history, constraints, materials and textures, components and groups (revisit in v2), SKP import.

## Notes for Claude Code
- Read this spec before every task.
- Never use the Three.js mesh as the source of truth.
- Run all tests before finishing a task. Do not break existing tools.
- The reference screenshot is at /docs/reference-toolbar.png.
