import { BACKDROP_PRESETS, DEFAULT_BACKDROP, GROUND_KINDS, SKY_KINDS, validBackdrop, type Backdrop, type GroundKind, type SkyKind } from '../doc/Backdrop';
import { DEFAULT_STYLE } from '../doc/Scenes';

const KEY = 'vormcraft.backdrop';

/** This device's sky and ground, and plain background colour (the last ones chosen here). */
export interface BackdropChoice {
  backdrop: Backdrop;
  background: string;
}

export function deviceBackdrop(): BackdropChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<BackdropChoice> | null;
    const background = typeof saved?.background === 'string' && /^#[0-9a-f]{6}$/i.test(saved.background) ? saved.background : DEFAULT_STYLE.background;
    return { backdrop: validBackdrop(saved?.backdrop) ?? DEFAULT_BACKDROP, background };
  } catch {
    return { backdrop: DEFAULT_BACKDROP, background: DEFAULT_STYLE.background };
  }
}

export function rememberBackdrop(choice: BackdropChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // Not remembered.
  }
}

/**
 * Choose the sky and ground (or a plain background colour). The view changes as you choose
 * (`preview`); Cancel puts it back. Resolves to the choice, or null if cancelled.
 */
export function showBackdropDialog(start: BackdropChoice, preview: (choice: BackdropChoice) => void): Promise<BackdropChoice | null> {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal backdrop-dialog';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Sky and ground</h2>
      <div class="presets"></div>
      <label class="row"><input type="checkbox" name="on"> Show sky and ground</label>
      <fieldset class="sky-ground">
        <label class="row">Sky <select name="sky">${SKY_KINDS.map((s) => `<option value="${s.kind}">${s.label}</option>`).join('')}</select>
          <input type="color" name="skyColor" title="The sky overhead"> <input type="color" name="horizonColor" title="The sky at the horizon"></label>
        <label class="row">Ground <select name="ground">${GROUND_KINDS.map((g) => `<option value="${g.kind}">${g.label}</option>`).join('')}</select>
          <input type="color" name="groundColor" title="The ground's colour"></label>
      </fieldset>
      <label class="row plain">Background colour <input type="color" name="background"></label>
      <p class="note">Kept on this device for every design. Scenes can keep their own.</p>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary">OK</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form')!;
  const field = <T extends HTMLElement>(name: string) => form.querySelector<T>(`[name="${name}"]`)!;
  const on = field<HTMLInputElement>('on');
  const sky = field<HTMLSelectElement>('sky');
  const ground = field<HTMLSelectElement>('ground');
  const colors = ['skyColor', 'horizonColor', 'groundColor', 'background'].map((n) => field<HTMLInputElement>(n));
  const [skyColor, horizonColor, groundColor, background] = colors;
  const skyGround = form.querySelector<HTMLFieldSetElement>('.sky-ground')!;
  const plain = form.querySelector<HTMLElement>('.plain')!;

  const fill = (c: BackdropChoice) => {
    on.checked = c.backdrop.on;
    sky.value = c.backdrop.sky;
    ground.value = c.backdrop.ground;
    skyColor.value = c.backdrop.skyColor;
    horizonColor.value = c.backdrop.horizonColor;
    groundColor.value = c.backdrop.groundColor;
    background.value = c.background;
  };
  const read = (): BackdropChoice => ({
    backdrop: { on: on.checked, sky: sky.value as SkyKind, skyColor: skyColor.value, horizonColor: horizonColor.value, ground: ground.value as GroundKind, groundColor: groundColor.value },
    background: background.value,
  });
  const changed = () => {
    skyGround.disabled = !on.checked;
    plain.hidden = on.checked;
    groundColor.hidden = ground.value === 'none';
    preview(read());
  };
  const presets = form.querySelector('.presets')!;
  for (const p of BACKDROP_PRESETS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: p.label });
    b.addEventListener('click', () => {
      fill({ backdrop: p.backdrop, background: read().background });
      changed();
    });
    presets.append(b);
  }
  // A new kind of ground starts with its own colour (grass green, sand yellow…).
  ground.addEventListener('change', () => {
    groundColor.value = GROUND_KINDS.find((g) => g.kind === ground.value)!.color;
  });
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
  fill(start);
  changed();
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: BackdropChoice | null) => {
      if (!v) preview(start);
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(read());
    });
    dlg.showModal();
  });
}
