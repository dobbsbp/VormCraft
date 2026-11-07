# Changelog

What changed in each version of VormCraft. The section for a version is also shown in the app's
update prompt, so it is written for people using the app: plain sentences and "- " bullets, no
bold or other formatting (versions up to 0.2.0 show the notes as plain text).

## Unreleased

- Lines drawn between corners of boxes (for example two boxes with flush fronts or tops) now close into a face, like any other closed shape of lines.
- Closing an opening: after deleting a face (the end of a box, say), drawing a line over one of its edges fills it again, as in SketchUp. Tracing the edge of a hole in a face fills the hole.
- Rectangle tool: snap the second corner to a point above or beside the first and the rectangle stands upright (up a wall, across an open end). The arrow keys fix the plane: → faces red, ← faces green, ↑ flat.
- Push/Pull works on shapes whose parts touch only along a line or at a corner (for example two boxes drawn corner to corner). The shared line is split where a pushed face stops, parts pulled into each other merge into one solid, and touching parts are selected together as one object. These used to be refused.

## 0.5.0

- Undo after reopening: the last 100 undo steps are saved with the design, so Ctrl+Z still works after you close and open it again. Each step stores only what changed, so files stay small. Files saved this way need this version of VormCraft or newer.
- New logo, for the app, the web app and the toolbar.
- Ctrl+A selects everything in your model (it used to select the page's text and buttons).
- Copying works as in SketchUp: press Ctrl while using Move or Rotate (before or during the move), a + shows on the cursor, and the copy follows the mouse while the original stays. Copy mode ends with the copy.
- Push/Pull: a pull that would leave two parts touching only along an edge is now refused with a clear message, and your model stays as it was.
- Push/Pull with Ctrl makes a new starting face: an edge stays where the face was, so the new sides are separate faces (handy for stacking floors).
- Web version: browsers on Windows usually run on the built-in graphics, even when the computer has a faster graphics card. VormCraft now notices and shows once how to switch the browser to the faster card (Settings → Graphics card shows the steps too).

## 0.4.6

- Arc and Pie: after the radius, the Measurements box asks how many segments to use (type any number and press Enter, or press Enter to keep 12), then the angle.
- Support VormCraft: if you'd like to chip in for the website and upkeep, the heart on the toolbar (or Help → Support VormCraft) shows how: GitHub Sponsors, or QRIS in Indonesia. VormCraft stays free; nothing else changes.

## 0.4.5

- Fixed: arcs drawn from edge to edge of a face (for example across a corner of a box top) could be drawn on the wrong plane and not connect to the model. They now lie on the face and split it.
- Arc tools: the arrow keys choose the plane the arc is drawn on (↑ flat, → upright facing red, ← upright facing green); press the same arrow again to unlock.

## 0.4.4

- Fixed: in the web version on Android, saved files were named "Model.vorm.txt" instead of "Model.vorm" (and OBJ exports ".obj.txt").
- The window and browser tab title now starts with VormCraft, then the file name: "VormCraft — Kitchen shelf", with • while there are unsaved changes, and the date when looking at an older version.
- The web version now lives at https://vormcraft.app (the old address forwards there).

## 0.4.3

- The mouse pointer shows the icon of the tool you are using (for example a paint bucket for Paint Bucket), with a small triangle at the top left marking the exact point that is clicked.

## 0.4.2

- Circle: after clicking the centre, type the number of sides and press Enter (or just Enter to keep 24), then type the radius and press Enter.
- Tools: the bar above the tool icons hides them into a narrow tab, giving more room to model; click the tab to bring them back (also "Show / Hide Tools" in search). VormCraft remembers your choice.
- Mouse: a double middle-click now re-centres the view (it was a double right-click).

## 0.4.1

- Fixed: importing SketchUp, OBJ and STL files in the Windows app failed with a permission error.

## 0.4.0

- Import SketchUp files (.skp): models come in with their groups and components (as groups), paint and textures, smooth surfaces, and optionally their scenes and guides. SketchUp 2018 and later read well; some older files cannot be read yet.
- Import OBJ and STL files: each object becomes a group, flat areas become single faces you can push and pull, and curved surfaces are smoothed. Choose the file's units (with a size preview) and which way is up.
- Import is on the toolbar and on Ctrl+I.
- Mouse: middle-drag now orbits and right-drag pans. Right-click still opens the menu, and a double right-click still re-centres the view.

## 0.3.0

- VormCraft now also runs as a web app: open https://dobbsbp.github.io/VormCraft/ in Chrome or Edge and choose Install to get it in its own window, with its own icon, on tablets, folding phones, Chromebooks and computers.
- The web app works fully offline once it has been opened, and updates itself like the Windows version (it asks before restarting into a new version).
- Smaller screens: the toolbar wraps onto more rows, and panels float over the view instead of squeezing it.
- The same version number and the same .vorm files on Windows and on the web.

## 0.2.1

- Graphics card: VormCraft now uses the faster graphics card on laptops that have two. Choose High performance, Power saving or Let Windows decide in Settings.
- Help button on the toolbar: keyboard and mouse shortcuts (also F1), what's new, check for updates, report a problem, and About.
- Check for Updates now shows that it is checking, and says clearly what it found.
- Update notes are shown neatly formatted.

## 0.2.0

The first Windows release.

- **Groups:** Ctrl+G makes a group that never sticks to anything else; double-click to edit inside it; Explode, Hide/Unhide.
- **Scenes:** save views (camera, hidden groups, style), switch with tabs or Page Up/Down, and play them as a slideshow.
- **Display styles:** Textured, Shaded, Wireframe and X-ray; perspective or parallel projection; background colour.
- **Right-click menu:** Entity Info, Erase, Hide, group commands, Select, Reverse Faces, Flip Along, Soften/Unsoften Edges, Zoom Selection.
- **Autosave:** every minute when something changed, to a backup folder; unsaved work is offered back if VormCraft closes without saving.
- **History:** each design keeps its earlier versions; look at any of them and restore it without losing what came after.
- **Settings:** autosave frequency and backup folder, history size, update checks.
- **Updates:** VormCraft checks for a new version when it starts and installs it with one click.
- **.vorm files** open with a double-click. Files from every earlier version still open; the first save over an older file keeps a backup of it.

## 0.1.0

Drawing, Push/Pull, Offset, Follow Me, Move/Rotate/Scale, materials and textures, guides, text, STL and OBJ export. Run from source only.
