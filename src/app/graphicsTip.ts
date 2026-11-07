import { messageDialog } from './dialogs';
import { LINKS } from './help';

/**
 * The web version on Windows: browsers ignore a page's request for the faster graphics card, and
 * Windows usually runs them on the built-in one. Only the person can change that (per browser, in
 * Windows' graphics settings), so VormCraft says how, once.
 */

const DISMISSED_KEY = 'vormcraft.graphicsTip.dismissed';

export type GpuKind = 'software' | 'integrated' | 'dedicated' | 'unknown';

/** What kind of graphics a WebGL renderer name describes. */
export function classifyGpu(renderer: string): GpuKind {
  const r = renderer.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(r)) return 'software';
  if (/nvidia|geforce|quadro|rtx|radeon\s*(\(tm\)\s*)?(rx|pro|r9|r7)\b|intel\(r\) arc\(tm\) a\d|arc a\d/.test(r)) return 'dedicated';
  // Intel's built-in graphics (HD, UHD, Iris, and the Arc built into Core Ultra chips), AMD's
  // built-in Radeon ("Radeon(TM) Graphics", "Vega 8", "780M").
  if (/intel|radeon\s*(\(tm\)\s*)?(graphics|vega|\d{3}m)|vega \d+ graphics/.test(r)) return 'integrated';
  return 'unknown';
}

/** The GPU maker a name or WebGPU vendor string names. */
function vendorOf(name: string): string | null {
  const n = name.toLowerCase();
  if (/nvidia|geforce|quadro/.test(n)) return 'nvidia';
  if (/amd|radeon|ati\b/.test(n)) return 'amd';
  if (/intel/.test(n)) return 'intel';
  return null;
}

const VENDOR_NAMES: Record<string, string> = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };

/**
 * A faster graphics card's maker, when the browser reveals one: WebGPU's high-performance adapter
 * from a different maker than the card WebGL draws with. Null when there is none, or it cannot tell.
 */
export async function fasterCard(renderer: string): Promise<string | null> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(o: object): Promise<{ info?: { vendor?: string } } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
    const fast = adapter?.info?.vendor ? vendorOf(adapter.info.vendor) : null;
    const now = vendorOf(renderer);
    return fast && now && fast !== now ? VENDOR_NAMES[fast] : null;
  } catch {
    return null;
  }
}

function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/OPR\//.test(ua)) return 'Opera';
  return 'Chrome';
}

export const onWindows = (): boolean => /Windows/.test(navigator.userAgent);

/** Windows' graphics settings page; the browser asks before opening it. */
const GRAPHICS_SETTINGS = 'ms-settings:display-advancedgraphics';

function link(href: string, text: string, newTab: boolean): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  if (newTab) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  return a;
}

/** How to switch the browser to the faster card (for the tip and for Settings), with working links. */
export function switchHelp(): HTMLElement {
  const browser = browserName();
  const box = document.createElement('div');
  box.className = 'graphics-help';
  const open = document.createElement('p');
  open.append(link(GRAPHICS_SETTINGS, 'Open Windows graphics settings', false), ' (or Windows Settings → System → Display → Graphics), then:');
  const steps = document.createElement('ol');
  for (const step of [
    `Find ${browser} in the list (or add it with “Add desktop app” / “Browse”).`,
    'Choose Options → High performance, then Save.',
    `Close every ${browser} window and open VormCraft again.`,
  ]) {
    const li = document.createElement('li');
    li.textContent = step;
    steps.append(li);
  }
  const app = document.createElement('p');
  app.append('Or ', link(LINKS.windowsApp, 'get the VormCraft app for Windows', true), ': it lets you choose the graphics card in Settings.');
  box.append(open, steps, app);
  return box;
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Not available (private window etc.): it shows again next time.
  }
}

/** Show the tip over the view when the web version on Windows runs on built-in graphics. */
export async function maybeShowGraphicsTip(container: HTMLElement, renderer: string): Promise<void> {
  if (!onWindows() || classifyGpu(renderer) !== 'integrated' || dismissed()) return;
  const faster = await fasterCard(renderer);
  const tip = document.createElement('div');
  tip.className = 'graphics-tip';
  tip.setAttribute('role', 'status');
  const text = document.createElement('p');
  text.textContent = faster
    ? `VormCraft is drawing with the built-in graphics, but this computer also has a faster ${faster} graphics card. You can let ${browserName()} use it.`
    : `VormCraft is drawing with the built-in graphics. If this computer also has a faster graphics card (NVIDIA or AMD), you can let ${browserName()} use it.`;
  const how = document.createElement('button');
  how.type = 'button';
  how.className = 'primary';
  how.textContent = 'Show me how';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Dismiss';
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  buttons.append(close, how);
  tip.append(text, buttons);
  const done = () => {
    dismiss();
    tip.remove();
  };
  close.addEventListener('click', done);
  how.addEventListener('click', () => {
    done();
    void messageDialog('Use the faster graphics card', 'Windows chooses the graphics card for the whole browser; a web page cannot.', [switchHelp()]);
  });
  container.append(tip);
}
