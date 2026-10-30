import type { ToolController } from './ToolController';

/** One line of the right-click menu: a command, a submenu, or a separator. */
export type MenuEntry =
  | { label: string; run?: () => void; disabled?: boolean; shortcut?: string; items?: MenuEntry[] }
  | 'separator';

/** What the menu needs from the app (things the controller cannot do on its own). */
export interface MenuHost {
  entityInfo(): void;
}

/**
 * The right-click menu for the current selection (already updated to what was right-clicked).
 * Entries that do not apply are shown greyed out, so the menu keeps its shape.
 */
export function contextMenuItems(c: ToolController, host: MenuHost): MenuEntry[] {
  const sel = c.selection;
  const { doc } = c;
  const geometry = sel.faces.size + sel.edges.size;
  const anything = sel.size > 0;
  const groups = sel.groups.size;
  const onlyGroups = groups > 0 && geometry === 0 && sel.guides.size === 0 && sel.labels.size === 0;
  const anyHidden = [...doc.groups.items.values()].some((g) => g.hidden);
  const shapes = geometry + groups > 0;

  const entries: MenuEntry[] = [
    { label: 'Entity Info', run: () => host.entityInfo() },
    { label: 'Erase', run: () => c.deleteSelection(), disabled: !anything, shortcut: 'Delete' },
    { label: 'Hide', run: () => c.hideSelection(), disabled: !onlyGroups },
  ];
  if (anyHidden) entries.push({ label: 'Unhide All', run: () => c.unhideAll() });
  entries.push('separator');

  if (groups === 1 && geometry === 0) {
    const [id] = sel.groups;
    entries.push({ label: 'Edit Group', run: () => c.enterGroup(id) });
  }
  if (doc.editing !== null) entries.push({ label: 'Close Group', run: () => c.exitGroup(), shortcut: 'Esc' });
  entries.push(
    { label: 'Explode', run: () => c.explodeSelection(), disabled: groups === 0 },
    { label: 'Make Group', run: () => c.makeGroup(), disabled: !shapes, shortcut: 'Ctrl+G' },
    'separator',
    {
      label: 'Select',
      items: [
        { label: 'Bounding Edges', run: () => c.selectBoundingEdges(), disabled: sel.faces.size === 0 },
        { label: 'Connected Faces', run: () => c.selectConnectedFaces(), disabled: geometry === 0 },
        { label: 'All Connected', run: () => c.selectAllConnected(), disabled: geometry === 0 },
        { label: 'All with Same Material', run: () => c.selectSameMaterial(), disabled: sel.faces.size === 0 },
        'separator',
        { label: 'Select All', run: () => c.selectAll() },
        { label: 'Select None', run: () => sel.clear(), disabled: !anything },
      ],
    },
    'separator',
    { label: 'Reverse Faces', run: () => c.reverseSelectedFaces(), disabled: sel.faces.size === 0 },
    {
      label: 'Flip Along',
      disabled: !shapes,
      items: [
        { label: 'Red Direction', run: () => c.flipSelection(0) },
        { label: 'Green Direction', run: () => c.flipSelection(1) },
        { label: 'Blue Direction', run: () => c.flipSelection(2) },
      ],
    },
    { label: 'Soften Edges', run: () => c.softenSelection(true), disabled: !c.canSoften() },
    { label: 'Unsoften Edges', run: () => c.softenSelection(false), disabled: !c.canSoften() },
    { label: 'Zoom Selection', run: () => c.zoomSelection(), disabled: !anything },
  );
  return entries;
}
