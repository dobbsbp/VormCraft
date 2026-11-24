import type { SkpStats } from '../io/skpImport';

export interface SkpChoice {
  scenes: boolean;
  guides: boolean;
  /** Groups and components not to bring in (`HeavyDefinition.id`). */
  leaveOut: number[];
}

/** Above this many faces (after every component copy is placed) VormCraft gets slow. */
export const LARGE_SKP = 300_000;
/**
 * Above this many faces the import runs out of memory and takes the app down with it (a file of
 * 1.5 million faces needed about 3 GB just to build), so it is refused until enough is left out.
 */
export const MAX_SKP = 600_000;

const KEY = 'vormcraft.import.skp';

/**
 * What a SketchUp file holds and what to bring in. Units need no question (SketchUp files are
 * exact); a very large model gets a warning, and the groups and components placed most often can
 * be left out (`suggested` ticked to start with). `count` gives the faces left with some left out.
 * Resolves to the choice, or null if cancelled.
 */
export function showSkpDialog(fileName: string, stats: SkpStats, count: (leaveOut: number[]) => number, suggested: number[]): Promise<SkpChoice | null> {
  let start = { scenes: true, guides: true };
  try {
    start = { ...start, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    // Defaults.
  }
  const n = (x: number) => x.toLocaleString();
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p class="note summary pre"></p>
      <p class="check bad warning" hidden></p>
      <div class="heavy" hidden>
        <p class="note">These are placed so often that they make up most of the model. Leave out:</p>
        <div class="rows"></div>
        <p class="note total"></p>
      </div>
      <label class="row"><input type="checkbox" name="scenes"> Bring in its scenes (camera views)</label>
      <label class="row"><input type="checkbox" name="guides"> Bring in its guides</label>
      <p class="note">The file comes in as a group, with its groups and components inside as groups of their own, with their paint. Layers/tags are not brought in.</p>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary">Import</button>
      </div>
    </form>`;
  dlg.querySelector('h2')!.textContent = `Import ${fileName.split(/[\\/]/).pop()}`;
  const year = /^\{?(\d+)\./.exec(stats.version)?.[1];
  dlg.querySelector('.summary')!.textContent = [
    `SketchUp ${year ? `20${year.padStart(2, '0')}` : stats.version} file${stats.units ? `, drawn in ${stats.units.toLowerCase()}s` : ''}.`,
    `${n(stats.placedFaces)} faces in ${n(stats.placements)} placed groups and components; ${n(stats.materials)} materials, ${n(stats.scenes)} scenes, ${n(stats.guides)} guides.`,
  ].join('\n');
  const form = dlg.querySelector('form')!;
  const box = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  box('scenes').checked = start.scenes;
  box('scenes').disabled = stats.scenes === 0;
  box('guides').checked = start.guides;
  box('guides').disabled = stats.guides === 0;
  const ok = form.querySelector<HTMLButtonElement>('button[value="ok"]')!;
  const warning = dlg.querySelector<HTMLElement>('.warning')!;
  const heavyBoxes: { id: number; box: HTMLInputElement }[] = [];
  if (stats.placedFaces > LARGE_SKP && stats.heavy.length) {
    const panel = dlg.querySelector<HTMLElement>('.heavy')!;
    panel.hidden = false;
    for (const h of stats.heavy) {
      const label = document.createElement('label');
      label.className = 'row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = suggested.includes(h.id);
      label.append(box, ` ${h.name}: ${n(h.copies)} copies, ${n(h.faces)} faces`);
      panel.querySelector('.rows')!.append(label);
      heavyBoxes.push({ id: h.id, box });
    }
  }
  const leaveOut = () => heavyBoxes.filter((h) => h.box.checked).map((h) => h.id);
  const update = () => {
    const faces = heavyBoxes.length ? count(leaveOut()) : stats.placedFaces;
    const total = dlg.querySelector<HTMLElement>('.heavy .total')!;
    total.textContent = `The model comes in with ${n(faces)} faces.`;
    warning.hidden = faces <= LARGE_SKP;
    ok.disabled = faces > MAX_SKP;
    ok.textContent = faces > LARGE_SKP ? 'Import anyway' : 'Import';
    if (faces > MAX_SKP) {
      warning.textContent = `This model is too large to import: ${n(faces)} faces once every copy of its components is placed (${n(stats.definitionFaces)} drawn), and VormCraft can hold about ${n(MAX_SKP)}.${heavyBoxes.length ? ' Leave out more of the parts above.' : ''}`;
    } else {
      warning.textContent = `This is a large model: every copy of a SketchUp component is imported as geometry of its own (${n(stats.definitionFaces)} faces drawn, ${n(faces)} once placed). Importing may take a while and make VormCraft slow.`;
    }
  };
  for (const h of heavyBoxes) h.box.addEventListener('change', update);
  update();
  document.body.append(dlg);
  return new Promise((resolve) => {
    const finish = (v: SkpChoice | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      const choice = { scenes: box('scenes').checked, guides: box('guides').checked };
      try {
        localStorage.setItem(KEY, JSON.stringify(choice));
      } catch {
        // Not remembered.
      }
      finish({ ...choice, leaveOut: leaveOut() });
    });
    dlg.showModal();
  });
}
