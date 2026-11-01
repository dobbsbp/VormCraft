import type { SkpStats } from '../io/skpImport';

export interface SkpChoice {
  scenes: boolean;
  guides: boolean;
}

/** Above this many faces (after every component copy is placed) VormCraft gets slow. */
export const LARGE_SKP = 300_000;

const KEY = 'vormcraft.import.skp';

/**
 * What a SketchUp file holds and what to bring in. Units need no question (SketchUp files are
 * exact); a very large model gets a warning. Resolves to the choice, or null if cancelled.
 */
export function showSkpDialog(fileName: string, stats: SkpStats): Promise<SkpChoice | null> {
  let start: SkpChoice = { scenes: true, guides: true };
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
  if (stats.placedFaces > LARGE_SKP) {
    const w = dlg.querySelector<HTMLElement>('.warning')!;
    w.hidden = false;
    w.textContent = `This is a large model: VormCraft has no components yet, so every copy of a component becomes geometry of its own (${n(stats.definitionFaces)} faces drawn, ${n(stats.placedFaces)} once placed). Importing may take a while and make VormCraft slow.`;
    form.querySelector('button[value="ok"]')!.textContent = 'Import anyway';
  }
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
      const choice = { scenes: box('scenes').checked, guides: box('guides').checked };
      try {
        localStorage.setItem(KEY, JSON.stringify(choice));
      } catch {
        // Not remembered.
      }
      finish(choice);
    });
    dlg.showModal();
  });
}
