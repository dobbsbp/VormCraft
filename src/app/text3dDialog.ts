import { rotation } from '../core/ops/transform';
import { transformModel } from '../core/ops/group';
import { nestOutlines, simplifyRing, textModel, traceOutlines } from '../core/ops/text3d';
import type { Placeable } from '../tools/PlaceTool';
import { formatLength, parseLength } from '../tools/units';

export interface Text3DChoice {
  text: string;
  font: string;
  bold: boolean;
  italic: boolean;
  /** Height of a capital letter, mm. */
  height: number;
  /** How far the letters are pushed out, mm (0: flat faces). */
  depth: number;
  /** Standing up facing the front, or lying flat on the ground. */
  upright: boolean;
}

/** Fonts found on most computers; the text is drawn with the computer's own copy. */
const FONTS = ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];
const KEY = 'vormcraft.text3d';
const DEFAULT: Text3DChoice = { text: 'VormCraft', font: 'Arial', bold: true, italic: false, height: 100, depth: 20, upright: true };

function remembered(): Text3DChoice {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Text3DChoice>) };
  } catch {
    return DEFAULT;
  }
}

/**
 * Ask for 3D text: the words, font, letter height, how far to push the letters out and whether
 * they stand up or lie flat. Remembers the choices. Resolves to them, or null if cancelled.
 */
export function showText3DDialog(): Promise<Text3DChoice | null> {
  const start = remembered();
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>3D Text</h2>
      <label class="row stacked">Text<textarea name="text" rows="2" required></textarea></label>
      <label class="row">Font <select name="font">${FONTS.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></label>
      <label class="row"><input type="checkbox" name="bold"> Bold</label>
      <label class="row"><input type="checkbox" name="italic"> Italic</label>
      <label class="row">Letter height <input name="height" size="8"></label>
      <label class="row">Push out by <input name="depth" size="8"> <span class="note">0 leaves flat letters</span></label>
      <fieldset>
        <legend>Letters</legend>
        <label class="row"><input type="radio" name="upright" value="1"> Stand up, facing the front</label>
        <label class="row"><input type="radio" name="upright" value="0"> Lie flat on the ground</label>
      </fieldset>
      <p class="note error" hidden></p>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary">Place</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form')!;
  const field = <T extends HTMLElement>(name: string) => form.querySelector<T>(`[name="${name}"]`)!;
  field<HTMLTextAreaElement>('text').value = start.text;
  field<HTMLSelectElement>('font').value = FONTS.includes(start.font) ? start.font : 'Arial';
  field<HTMLInputElement>('bold').checked = start.bold;
  field<HTMLInputElement>('italic').checked = start.italic;
  field<HTMLInputElement>('height').value = formatLength(start.height);
  field<HTMLInputElement>('depth').value = formatLength(start.depth);
  form.querySelector<HTMLInputElement>(`input[name="upright"][value="${start.upright ? 1 : 0}"]`)!.checked = true;
  const error = form.querySelector<HTMLElement>('.error')!;
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: Text3DChoice | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const height = parseLength(field<HTMLInputElement>('height').value);
      const depth = parseLength(field<HTMLInputElement>('depth').value);
      const text = field<HTMLTextAreaElement>('text').value.replace(/\s+$/, '');
      const problem = !text.trim() ? 'Type some text' : !(height && height > 0) ? 'Type a letter height, e.g. 100 or 10cm' : depth === undefined || depth < 0 ? 'Type how far to push the letters out (0 for flat letters)' : null;
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      const choice: Text3DChoice = {
        text,
        font: field<HTMLSelectElement>('font').value,
        bold: field<HTMLInputElement>('bold').checked,
        italic: field<HTMLInputElement>('italic').checked,
        height: height!,
        depth: depth!,
        upright: form.querySelector<HTMLInputElement>('input[name="upright"]:checked')?.value === '1',
      };
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

/**
 * The text as something to place: drawn large with the chosen font, traced, made into letters
 * pushed out by the depth, and stood up (facing -Y) if asked. Unpainted, so it takes any paint.
 */
export function text3dPlaceable(c: Text3DChoice): Placeable {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const px = 200;
  const font = `${c.italic ? 'italic ' : ''}${c.bold ? 'bold ' : ''}${px}px "${c.font}", sans-serif`;
  g.font = font;
  const capPx = g.measureText('H').actualBoundingBoxAscent || px * 0.7;
  const lines = c.text.split('\n');
  const lineHeight = px * 1.25;
  const pad = Math.ceil(px * 0.25);
  const width = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + pad * 2;
  const height = Math.ceil(lineHeight * lines.length) + pad * 2;
  if (width * height > 40_000_000) throw new Error('That text is too long for 3D Text: try fewer words or lines');
  canvas.width = width;
  canvas.height = height;
  g.font = font;
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  lines.forEach((l, i) => g.fillText(l, pad, pad + px + i * lineHeight));
  const rgba = g.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  const regions = nestOutlines(
    traceOutlines({ width, height, data: alpha }).map((r) => simplifyRing(r, 0.35)),
    2,
  );
  if (!regions.length) throw new Error('Nothing to make: the text has no letters that can be drawn');
  const model = textModel(regions, c.height / capPx, c.depth);
  // Stand up: the letters' "up" becomes blue (Z) and they are pushed out towards the front (-Y).
  if (c.upright) transformModel(model, rotation([0, 0, 0], [1, 0, 0], Math.PI / 2));
  const short = c.text.replace(/\s+/g, ' ').trim();
  return { name: `Text "${short.length > 30 ? `${short.slice(0, 29)}…` : short}"`, parts: [{ name: 'Text', model }] };
}
