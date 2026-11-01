# Changelog

What changed in each version of VormCraft. The section for a version is also shown in the app's
update prompt, so it is written for people using the app: plain sentences and "- " bullets, no
bold or other formatting (versions up to 0.2.0 show the notes as plain text).

## Unreleased

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
