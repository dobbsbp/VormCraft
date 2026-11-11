/** A tool as the Customise list shows it. */
export interface ToolEntry<T extends string> {
  id: T;
  label: string;
  icon: string;
}

/**
 * Choose the tools in the palette: a tick box per tool, with presets. Tools in `keep` are always
 * there. Resolves to the tools to show, or null if cancelled.
 */
export function showCustomiseToolsDialog<T extends string>(tools: readonly ToolEntry<T>[], shown: ReadonlySet<T>, keep: readonly T[], presets: { label: string; tools: readonly T[] }[]): Promise<T[] | null> {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal customise-tools';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Customise tools</h2>
      <p class="note">Ticked tools are in the palette. Tools you leave out still work from their keys and Search, and are one click away under ⋯ (More tools).</p>
      <div class="presets"></div>
      <div class="tool-list"></div>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary">OK</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form')!;
  const list = form.querySelector('.tool-list')!;
  const boxes = new Map<T, HTMLInputElement>();
  for (const t of tools) {
    const row = document.createElement('label');
    row.className = 'row';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: shown.has(t.id) || keep.includes(t.id), disabled: keep.includes(t.id) });
    const icon = document.createElement('span');
    icon.className = 'tool-icon';
    icon.innerHTML = t.icon;
    row.append(box, icon, document.createTextNode(keep.includes(t.id) ? `${t.label} (always there)` : t.label));
    list.append(row);
    boxes.set(t.id, box);
  }
  const presetRow = form.querySelector('.presets')!;
  for (const p of presets) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: p.label });
    b.addEventListener('click', () => {
      for (const [id, box] of boxes) box.checked = keep.includes(id) || p.tools.includes(id);
    });
    presetRow.append(b);
  }
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: T[] | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(tools.filter((t) => boxes.get(t.id)!.checked).map((t) => t.id));
    });
    dlg.showModal();
  });
}
