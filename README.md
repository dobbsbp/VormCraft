# VormCraft

**A free, fast, direct 3D modeler: draw a shape, grab a face, push it.**

VormCraft is a push/pull 3D modeling program for woodworking, architecture sketches, 3D printing and CAD/CAM handoff. There is no parametric timeline and no constraint solver. You draw on faces, push and pull them, and the model follows. It works much like SketchUp, but it is free and open source.

![VormCraft with grouped, painted objects, scene tabs along the top and the Scenes panel open](docs/screenshot.jpg)

> **Status:** early and under active development. The modeling core is solid and well tested, and new features are added as the program gets used.

## Download

**Windows:** get the installer (`VormCraft_x.y.z_x64-setup.exe`) from the [Releases](../../releases) page. It installs for your user account (no administrator rights needed) and makes `.vorm` files open with a double-click. Windows 11 has everything it needs; on Windows 10 the installer fetches Microsoft's WebView2 if it is missing.

The installer is not code-signed yet, so the first time Windows may say "Windows protected your PC": click **More info → Run anyway**.

VormCraft checks for a new version when it starts and installs it with one click (**Install and restart**). You can also use **Check for Updates** in the Help menu (the ? button).

**Everywhere else (Android tablets and folding phones, Chromebooks, Mac, Linux):** open **https://dobbsbp.github.io/VormCraft/** in Chrome or Edge and choose **Install** (Chrome menu → *Add to home screen* / *Install app*). It then opens in its own window like any app, works fully offline, and updates itself, asking before it restarts into a new version. Your models never leave your device. A keyboard and mouse are recommended. In the web version, Save downloads the `.vorm` file (instead of saving over it), and autosave copies are kept in the app's own storage.

Both versions have the same version number and open the same `.vorm` files.

---

## Features

### Drawing
- **Line**, **Rectangle**, **Rotated Rectangle**, **Circle**, **Polygon**, **2-Point Arc**, **3-Point Arc**, **Arc**, **Pie**
- Draw on any face, or on the ground. New edges split the face they are drawn on automatically.
- Every tool takes typed input. Type a length, `width,length` or a radius and press Enter, for example `1200,600`, `2.5m`, `3'6"`. Lengths are in millimetres by default; cm, m, in and ft are also accepted.
- **Circle**: click the centre, type the number of sides and press Enter (or just Enter for 24), then type the radius and press Enter. Or click to set the radius.

### Modeling
- **Push/Pull**: extrude a face out to add material, or in to remove it.
  - Push a shape flush to the far side and you get a clean through-hole.
  - Push through a solid whose far side isn't flush and it is cut with a real boolean operation. No manual "intersect faces" step is needed.
  - Double-click a face to repeat the last distance.
- **Offset**: copy a face's outline inward or outward, or offset a chain of edges.
- **Follow Me**: sweep a profile along a path, for mouldings, pipes, grooves, chamfers and lathed (turned) shapes.
- **Move** and **Rotate**: tap Ctrl to make copies, then type a count (`5x` or `/5`) to make arrays. **Scale** resizes selected geometry; negative factors mirror.
- **Eraser**, **Tape Measure** (measure, place guides, rescale the model) and **Text** labels.
- **Reverse Faces**, **Flip Along** red/green/blue, and **Soften/Unsoften Edges** (from the right-click menu).
- Curves keep their true radius, so circles and arcs export smoothly at any resolution.

### Groups
- Select geometry and press **Ctrl+G** to make a group. A group keeps its geometry to itself, so it never sticks to or merges with anything it touches, and groups can hold other groups.
- A group selects, moves, rotates, scales, copies, flips and paints as one piece.
- Double-click a group to edit what's inside it; the rest of the model fades while you work. Press Esc (or click outside it) to close it.
- **Explode** turns a group back into loose geometry; **Hide** and **Unhide All** hide and show groups.
- Rename groups and see their size and contents in **Entity Info**.

### Right-click menu
Right-click anything to select it and get a menu for it:
- **Entity Info**: a panel with a group's name (editable), contents, size and paint; faces' area and paint; edges' length and smoothing.
- **Erase**, **Hide**, **Unhide All**
- **Edit Group**, **Close Group**, **Explode**, **Make Group**
- **Select ▸** bounding edges, connected faces, all connected, all with the same material, all, none
- **Reverse Faces**, **Flip Along ▸** red/green/blue, **Soften / Unsoften Edges**, **Zoom Selection**

### Scenes and view styles
- **Scenes** save a view: the camera, which groups are hidden, and the display style. Tabs along the top of the viewport jump between them with a smooth camera glide; **Page Down / Page Up** step through them.
- **Play** runs the scenes as a looping slideshow, with adjustable transition and pause times.
- Choose per scene what it restores (camera, hidden groups, style), overwrite a scene with **Update**, and rename, reorder or delete scenes in the Scenes panel.
- Display styles: **Textured**, **Shaded**, **Wireframe** and **X-ray**, plus back edges and a background colour.
- **Perspective** or **parallel** projection.

### Materials
- **Paint Bucket**: plain colours, see-through colours such as glass, or tiled textures at real-world size.
- Built-in library of colours and textures (brick, wood planks, tiles, concrete, grass), or use your own image.
- Paint follows the geometry: split, pushed and moved faces keep their paint. Painting a group colours all of its unpainted faces.

### Inference snapping
- Snaps to endpoints, midpoints, edges, faces, guide intersections and the red, green and blue axes, with a visual cue for each. Groups' corners and edges snap too.
- Arrow keys lock to an axis (→ red, ← green, ↑ blue, ↓ parallel or perpendicular to the last edge).

### Autosave and history
- **Autosave** every minute (when something changed) to a backup folder. Your own file only changes when you save. If VormCraft closes without saving, it offers your work back next time.
- **History:** every design keeps its earlier versions (recorded at each autosave and save, compressed, inside the `.vorm` file). Open **History**, click a version to look at it, then **Restore this version** or go **Back to now**. Restoring never loses anything: what you had stays in the list, and Undo works too.
- Older versions are thinned out over time (everything from the last day, one per hour for a week, then one per day) and the history has a size limit.
- **Save a Copy Without History** for sending a design to someone.
- **Settings** (gear button): autosave on/off and how often, the backup folder, how long unrecovered backups are kept, history on/off and its size limit, the graphics card, update checks.

### Graphics and help
- Uses the graphics card through WebGL (Direct3D 11 on Windows). On laptops with two graphics chips, the Windows app uses the faster one by default; **Settings → Graphics card** switches between High performance, Power saving and Let Windows decide. If a computer can only draw without the graphics card, VormCraft says so.
- **Help** (the ? button): Keyboard and Mouse reference (also **F1**), What's New, Check for Updates, Report a Problem or Idea, and About (version and graphics card in use).

### Files and export
- Saves to its own `.vorm` file format, including groups, materials, scenes and history. Files from every earlier version keep opening (each format version is tested), including `.benup` files from before the rename. The first save over an older-format file keeps a backup of the original.
- **Import SketchUp (.skp) files** (Ctrl+I, or the Import button). The file comes in as a group, with its groups and components inside it as groups of their own (each placement of a component becomes its own copy, as VormCraft has no components yet), keeping faces and holes, true circles and arcs, soft edges, paint (colours, transparency and textures at their real size), and, if you choose, its scenes and guides. Faces that SketchUp allows but VormCraft's solids do not are turned round or kept on edges of their own, and the import reports how many. Files are read by [OpenSKP](https://github.com/iamahsanmehmood/openskp), an independent open-source reader; SketchUp 2018 and later read well, some older files cannot be read yet.
- **Import OBJ and STL** (Ctrl+I, or the Import button). Each object comes in as a group; flat areas are joined back into single faces (a triangulated box becomes six faces you can push and pull) and curved surfaces are smoothed. You choose the file's units (with a live size preview) and whether Y or Z is up. Broken or duplicate triangles are left out and counted.
- **STL** (binary) export with a watertight check and adjustable curve resolution, for 3D printing.
- **OBJ** export.
- Unlimited undo and redo.
- **Search** (Shift+S) finds any tool or command by name.

### Navigation

| Action | Mouse |
| --- | --- |
| Use the active tool | Left button |
| Context menu | Right-click |
| Orbit | Middle-drag (about the point under the cursor) |
| Re-centre the view | Double middle-click |
| Pan | Right-drag |
| Zoom | Mouse wheel (toward the cursor) |
| Zoom extents | Shift+Z |

Standard views (top, front, iso, …), Zoom Window, Previous View, display styles and projection are on the toolbar.

---

## Keyboard shortcuts

| Key | Tool | Key | Tool |
| --- | --- | --- | --- |
| Space | Select | Shift+Space | Lasso Select |
| L | Line | A | 2-Point Arc |
| R | Rectangle | Shift+A | Pie |
| Shift+R | Rotated Rectangle | P | Push/Pull |
| C | Circle | Shift+P | Follow Me |
| Shift+C | Polygon | F | Offset |
| M | Move | Q | Rotate |
| S | Scale | E | Eraser |
| T | Tape Measure | B | Paint Bucket |
| O / H / Z | Orbit / Pan / Zoom | Shift+W | Zoom Window |
| Shift+Z | Zoom Extents | Shift+V | Previous View |
| K | Back Edges | Shift+S | Search commands |
| Ctrl+G | Make Group | Esc | Cancel / clear selection / close group |
| Ctrl+I | Import SketchUp, OBJ or STL | | |
| Delete | Erase selection | Page Down / Page Up | Next / previous scene |
| Ctrl+Z / Ctrl+Y | Undo / Redo | Ctrl+N / O / S | New / Open / Save |
| Ctrl+Shift+S | Save As | Esc | Leave an earlier version (History) |
| F1 | Keyboard and mouse reference | | |

---

## Running from source

You need [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```bash
git clone https://github.com/dobbsbp/VormCraft.git
cd VormCraft
npm install
npm run dev          # then open the address it prints (http://localhost:5173)
```

Other commands:

```bash
npm test             # run the test suite (Vitest)
npm run typecheck    # TypeScript strict type check
npm run build        # type check + production web build in dist/
```

### Desktop app (Windows)

The desktop version uses [Tauri](https://tauri.app/) and needs the [Rust toolchain](https://www.rust-lang.org/tools/install) as well as Node.js.

```bash
npm run desktop:dev      # desktop window against the dev server
npm run desktop:build    # installer in src-tauri/target/release/bundle/nsis/
```

Releases are built by GitHub Actions when a version tag is pushed: see [docs/RELEASING.md](docs/RELEASING.md).

---

## How it works

VormCraft's own geometry kernel is the source of truth. The 3D view only displays it.

| Folder | What's in it |
| --- | --- |
| `src/core` | The geometry kernel: a half-edge boundary representation with true polygon faces and holes, modeling operations (push/pull, offset, follow me, imprinting, cleanup), booleans through [Manifold](https://github.com/elalish/manifold), and watertight checks. Plain TypeScript with no graphics, so it is fully testable. |
| `src/view` | [Three.js](https://threejs.org/) display: triangulation for drawing, picking that maps every triangle and line back to its model face or edge, display styles, camera navigation (perspective and parallel). |
| `src/tools` | Every tool as a plain state machine, plus the inference/snapping engine, the right-click menu, and the controller that turns each operation into one atomic, undoable step. |
| `src/doc` | The document (top-level geometry, groups, guides, labels, materials, scenes), snapshots and undo history. |
| `src/io` | The `.vorm` file format, STL and OBJ export, and tessellation of curved surfaces from their true radii. |
| `src/app` | The app shell: toolbar, panels (Materials, Scenes, Entity Info), context menu, dialogs, icons. |
| `src-tauri` | The Tauri desktop shell: native file dialogs and file access, the updater, opening double-clicked `.vorm` files, and the graphics card choice. |
| `public`, `scripts/offline.ts` | The web app: its manifest and icons, and the build step that makes it work offline and update itself. |
| `tests` | Vitest tests covering the kernel, tools, groups, scenes, history, autosave, snapping, display data, and every file format version ever saved. |

Units are millimetres, and Z is up (red = X, green = Y, blue = Z). The full design spec is in [docs/SPEC.md](docs/SPEC.md).

---

## Roadmap

Features are added as real use calls for them. Ideas on the list:

- Dimensions, section planes, tags/layers, shadows (scenes will save these too)
- Components (reusable, linked copies) and locking groups
- A field-of-view control
- STEP export (true curves, through OpenCascade)
- Exporting materials with OBJ
- A native Android app (if the web app's saving is not enough on phones and tablets)

Bug reports and suggestions are welcome in [Issues](../../issues).

---

## License

[MIT](LICENSE). Free to use, change and share, including commercially. VormCraft includes open-source libraries under their own licences: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

VormCraft is an independent project and is not affiliated with or endorsed by Trimble or SketchUp.
