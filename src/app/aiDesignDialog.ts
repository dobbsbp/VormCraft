import { modelBounds } from '../core/ops/group';
import type { LibraryItem } from '../library';
import { formatLengths } from '../tools/units';
import { renderThumbnail } from '../view/thumbnails';

type LibraryModule = typeof import('../library');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/** Put text on the clipboard; true if it worked. Falls back to selecting `area` and copying. */
async function copyText(text: string, area?: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!area) return false;
    area.focus();
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/** Show "Copied" on a button for a moment. */
function flash(button: HTMLButtonElement, ok: boolean): void {
  const label = button.textContent;
  button.textContent = ok ? 'Copied ✓' : 'Select the text and copy it';
  setTimeout(() => (button.textContent = label), 1800);
}

const DESCRIBE_KEY = 'vormcraft.ai.request';

/**
 * Design with AI: the person describes what they want, copies the template (instructions,
 * examples and their description) and pastes it into their own AI chat. Nothing is sent anywhere
 * by VormCraft. Resolves when closed; true if they chose to import the AI's answer next.
 */
export function showAiTemplateDialog(lib: LibraryModule): Promise<boolean> {
  const dlg = el('dialog', { className: 'modal ai-design' });
  const form = el('form', { method: 'dialog' });
  let request = '';
  try {
    request = localStorage.getItem(DESCRIBE_KEY) ?? '';
  } catch {
    // Not remembered.
  }
  const describe = el('textarea', { rows: 4, placeholder: 'For example: a phone stand for my phone, 75 × 160 × 9 mm in its case, leaning back about 65°, with a gap for the charging cable.', value: request });
  const preview = el('textarea', { className: 'ai-template', rows: 8, readOnly: true, spellcheck: false });
  const copy = el('button', { type: 'button', className: 'primary' }, 'Copy for my AI');
  const next = el('button', { type: 'button' }, 'Import the answer…');
  const close = el('button', { type: 'button' }, 'Close');
  const refresh = () => {
    preview.value = lib.aiTemplate(describe.value);
    try {
      localStorage.setItem(DESCRIBE_KEY, describe.value);
    } catch {
      // Not remembered.
    }
  };
  describe.addEventListener('input', refresh);
  refresh();
  form.append(
    el('h2', {}, 'Design with AI'),
    el('p', {}, 'Describe what you want, then copy the instructions into any AI chat you use. Its answer is a design file VormCraft builds for you.'),
    el(
      'ol',
      { className: 'ai-steps' },
      el('li', {}, 'Describe the object: what it is for, its main sizes, and anything it has to fit.'),
      el('li', {}, 'Copy for my AI, and paste it into your AI chat.'),
      el('li', {}, 'Copy the AI’s whole answer, then Import the answer… here or in the Library.'),
    ),
    el('label', { className: 'field stacked' }, el('span', {}, 'What do you want to make?'), describe),
    el('details', {}, el('summary', {}, 'What gets copied'), preview),
    el('p', { className: 'note' }, 'VormCraft does not send anything anywhere: you choose which AI to paste it into.'),
    el('div', { className: 'buttons' }, close, el('span', { className: 'spacer' }), next, copy),
  );
  dlg.append(form);
  document.body.append(dlg);
  return new Promise((resolve) => {
    const finish = (v: boolean) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    copy.addEventListener('click', async () => flash(copy, await copyText(preview.value, preview)));
    next.addEventListener('click', () => finish(true));
    close.addEventListener('click', () => finish(false));
    dlg.addEventListener('cancel', () => finish(false));
    form.addEventListener('submit', (e) => e.preventDefault());
    dlg.showModal();
    describe.focus();
  });
}

export interface ImportedDesign {
  item: LibraryItem;
  /** Place straight away, or open Customise… first (for designs with settings). */
  customise: boolean;
}

/**
 * Import an AI design: paste the AI's answer (or open a saved file). It is checked and built as
 * it is pasted, with a picture and size, or the problems found and a button to copy them back to
 * the AI. Resolves to the design to place, or null.
 */
export function showAiImportDialog(lib: LibraryModule, openFile?: () => Promise<{ name: string; text: string } | null>): Promise<ImportedDesign | null> {
  const dlg = el('dialog', { className: 'modal ai-design' });
  const form = el('form', { method: 'dialog' });
  const paste = el('textarea', { rows: 9, spellcheck: false, placeholder: 'Paste the AI’s answer here (the whole reply is fine: the design is found in it).' });
  const picture = el('img', { className: 'customise-picture', alt: '', width: 160, height: 160 });
  picture.hidden = true;
  const summary = el('p', { className: 'note' });
  const problems = el('ul', { className: 'ai-problems' });
  const copyProblems = el('button', { type: 'button' }, 'Copy problems for my AI');
  const problemBox = el('div', { className: 'ai-problem-box' }, el('p', { className: 'note error' }, 'VormCraft could not build this design:'), problems, copyProblems);
  problemBox.hidden = true;
  const place = el('button', { type: 'submit', className: 'primary' }, 'Place');
  const customise = el('button', { type: 'button' }, 'Customise…');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const open = el('button', { type: 'button' }, 'Open file…');
  open.hidden = !openFile;
  form.append(
    el('h2', {}, 'Import AI design'),
    el('p', {}, 'Paste the answer from your AI. VormCraft checks it and shows what it makes.'),
    paste,
    el('div', { className: 'ai-result' }, picture, el('div', {}, summary, problemBox)),
    el('div', { className: 'buttons' }, open, el('span', { className: 'spacer' }), cancel, customise, place),
  );
  dlg.append(form);

  let current: LibraryItem | null = null;
  let found: string[] = [];
  const check = () => {
    current = null;
    found = [];
    const text = paste.value.trim();
    picture.hidden = true;
    summary.textContent = text ? '' : 'Nothing pasted yet.';
    if (text) {
      try {
        const design = lib.readBuild(text);
        const item = lib.buildItem(design);
        const parts = item.build();
        current = item;
        const b = modelBounds(parts.map((p) => p.model));
        const size = b ? formatLengths([0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 10) / 10), ' × ') : '';
        const faces = parts.reduce((n, p) => n + p.model.faces.size, 0);
        summary.textContent = `${design.name}: ${size} (width × depth × height), ${parts.length} part${parts.length === 1 ? '' : 's'}, ${faces.toLocaleString('en-GB')} faces${design.params.length ? `, ${design.params.length} setting${design.params.length === 1 ? '' : 's'} you can change with Customise…` : ''}.${design.description ? ` ${design.description}` : ''}`;
        const url = renderThumbnail(
          parts.map((p) => {
            const f = lib.paintFields(p);
            return { model: p.model, color: f.color, opacity: f.opacity };
          }),
          160,
        );
        if (url) {
          picture.src = url;
          picture.hidden = false;
        }
      } catch (err) {
        found = err instanceof lib.BuildError ? err.problems : [err instanceof Error ? err.message : String(err)];
      }
    }
    problems.replaceChildren(...found.slice(0, 12).map((p) => el('li', {}, p)), ...(found.length > 12 ? [el('li', {}, `…and ${found.length - 12} more (all are copied).`)] : []));
    problemBox.hidden = !found.length;
    place.disabled = !current;
    customise.hidden = !current?.params?.length;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  paste.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(check, 350);
  });
  check();

  document.body.append(dlg);
  return new Promise((resolve) => {
    const finish = (v: ImportedDesign | null) => {
      clearTimeout(timer);
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    copyProblems.addEventListener('click', async () => flash(copyProblems, await copyText(lib.problemsForAi(found))));
    open.addEventListener('click', async () => {
      const file = await openFile?.();
      if (!file) return;
      paste.value = file.text;
      check();
    });
    cancel.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    customise.addEventListener('click', () => current && finish({ item: current, customise: true }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(timer);
      check();
      if (current) finish({ item: current, customise: false });
    });
    dlg.showModal();
    paste.focus();
  });
}
