# Changelog

What changed in each version of VormCraft. The section for a version is also shown in the app's
update prompt, so it is written for people using the app: plain sentences and "- " bullets, no
bold or other formatting (versions up to 0.2.0 show the notes as plain text).

## 0.5.10

- 3D Text (in the tools): type some words, pick a font, letter height and how far to push them out, and place them as solid letters, standing up or lying flat. They can be painted, pushed, cut and 3D printed like any shape.
- Text labels are easy to erase now: press Delete after placing or clicking one with the Text tool, click it with the Eraser, drag a box round it, or right-click it and choose Erase.
- The Materials window floats over the view (drag it by its title) and can stay open with the other panels. Colours and textures have tabs of their own, sorted into groups, with more of each: Cream, Grey, Maroon, Terracotta, Olive, Mint, Sky Blue, frosted and tinted glass, Dark Wood, Marble, Paving, Gravel, Brushed Metal and Fabric.
- The outline of a Library item while you place it is now thin and black instead of blue.
- Arrange the tools your way: drag a tool in the palette to a new place, and right-click the palette to move it to the right side of the view or put the tools back in order. Your layout is remembered.
- The top bar can be hidden for more room (the arrows at its right end); the small tab left at the top brings it back.
- The design's name now shows next to the logo (with • while it has unsaved changes), and Viewer mode is the blue eye button beside it.

## 0.5.9

- Library (toolbar): 49 household objects at real sizes to place in your model: furniture, kitchen units and appliances, bathroom fittings, electronics, lighting and decor. Search by name or other words (couch, fridge, telly; typos are fine), narrow by room or kind, pick a size (a bed in Single to King, a TV from 43" to 75"), click it, then click in the model. Arrow keys turn it before you place it. Each object comes in as a group, with a group for each paint so parts are easy to recolour.
- The toolbar fits on one row again: the six standard views and the four face styles are now one button each, with a menu.
- Fixed: in some layouts (holes lined up in a row, such as four legs under a table top) a face could be left with a gap in its triangles, so later push/pulls or merges on it failed.

## 0.5.8

- Merge Shapes: solids now merge even when flat faces are selected with them (such as the circle left inside a Follow Me ring), and when it cannot merge, it says why instead of being greyed out.
- The toolbar's STL and OBJ buttons are now one Export button (STL for 3D printing, or OBJ), with an outward arrow so it no longer looks like Import.

## 0.5.7

- Google Drive saving now works with any Google account: Google has verified VormCraft. The "in testing" warning is gone.

## 0.5.6

- Viewer mode for phones, foldables and tablets: tap the eye (Viewer) next to the logo. The tools are put away. One finger pans; two fingers pinch to zoom and move to orbit, at the same time; a flick keeps the view gliding; double-tap centres on a point. Exit viewer, Zoom to fit, Open, Google Drive and a resolution setting (the gear, if moving the model is slow) are in the corner.
- Merge Shapes in the right-click menu: select two or more shapes (Shift-click) and right-click. Overlapping flat faces in one plane merge into one face. For solids and groups you choose Unify (one solid, with the faces inside removed) or Keep shapes (put together in one group, unchanged).

## 0.5.5

- Push/Pull: a face pushed level with the face next to it now merges with it (pull a step up to the height beside it and the line between them goes). Hold Ctrl to keep the edges.
- Push/Pull on an open surface: pushing a bump back now shortens its walls instead of leaving overlapping faces. Pushed back flush, the bump disappears into the surface; pushed further, it becomes a dent.

## 0.5.4

- New pages on vormcraft.app: About (vormcraft.app/about), Privacy Policy (vormcraft.app/privacy) and Terms of Use (vormcraft.app/terms). The Help menu links to the Privacy Policy and Terms of Use. You can now reach VormCraft at info@vormcraft.app.

## 0.5.3

- Points: with Select, click where two or more lines meet (a box's corner, say) to select that point; Shift adds or removes points. Then use Move to move it: the faces around it stretch, or fold where they can no longer stay flat. Arrow keys hold the move on the red, green or blue axis, and you can type a distance or dx,dy,dz. Delete erases the lines that meet at a point. Entity Info shows a point's position.
- Google Drive saving, in the Windows app and on vormcraft.app: use the cloud button in the toolbar to connect your Google account, then save, open, and (if you like) autosave a copy to Google Drive. In the Windows app, signing in opens Google's page in your browser, and VormCraft stays signed in between sessions (kept safely in Windows Credential Manager) until you disconnect. Google is still verifying VormCraft: until it has, only accounts on VormCraft's test list can sign in, and others see "Access blocked" from Google. It will work for everyone once Google has verified VormCraft. Don't need it? Hide the button in Settings → Google Drive.

## 0.5.2

- Erasing the line between two flat faces in the same plane (a square and a triangle drawn against it, say) joins them into one face, as in SketchUp, instead of deleting both.
- Erase an edge of a box and draw it again: the faces on both sides come back and the box is closed again.
- Fixed: a face closed by lines could get a second copy of a line it shares with a neighbouring face ("doubled" lines). Lines are shared between faces; only where an edge already has a face on each side (a box's corner) does a new face touch it with a copy of its own, and erasing that line joins the flat faces on either side.
- Fixed: lines on the ground (or any plane) did not close into faces when a shape with an open bottom, such as a box with its bottom deleted, stood on that plane. Drawing or tracing a line now fills every closed shape it completes, on both sides of the line.
- Lines joining the corners of flat shapes now close the face between them even when the shapes face opposite ways (one drawn from below, or reversed): the flat shape is turned round to match, as in SketchUp. Solids are never turned round.
- Rotating, moving or scaling part of a shape (a box's top face, say) no longer stops with "That would bend a face out of flat". The faces connected to it adjust: any that can no longer lie flat fold into flat pieces along new lines, as in SketchUp. Twisting a box's top, lifting one corner or pushing an edge sideways now just works.

## 0.5.1

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
