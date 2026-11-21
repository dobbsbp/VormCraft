import { isTauri } from './files';

/**
 * The Linux app's graphics chips, found by the shell (src-tauri/src/gpu.rs) from Linux itself,
 * because WebKitGTK hides the real name from WebGL (it reports "Apple GPU").
 */
export interface LinuxCard {
  name: string;
  driver: string;
  pci: string;
  /** WebKit draws with it. */
  in_use: boolean;
  /** The screen starts on it. */
  startup: boolean;
}

export interface LinuxGraphics {
  cards: LinuxCard[];
  /** WebKit's helper processes were found, so `in_use` and `software` can be trusted. */
  checked: boolean;
  /** No graphics device open: WebKit draws in software. */
  software: boolean;
}

/** What the Linux app found, or null elsewhere (or if the shell could not say). */
export async function linuxGraphics(): Promise<LinuxGraphics | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LinuxGraphics | null>('linux_graphics');
  } catch {
    return null;
  }
}

/** One line for About and Settings, e.g. "NVIDIA GeForce RTX 3050 (in use) · Intel Iris Xe Graphics (also in this computer)". */
export function describeLinuxGraphics(g: LinuxGraphics): string {
  const named = (c: LinuxCard) => c.name;
  if (g.cards.length === 0) return g.software ? 'none found (drawing in software)' : 'not known (the system’s web engine hides it)';
  const used = g.checked ? g.cards.filter((c) => c.in_use) : [];
  const others = g.cards.filter((c) => !used.includes(c));
  if (g.checked && g.software) return `none in use (drawing in software) · ${g.cards.map(named).join(', ')} (in this computer)`;
  if (used.length === 0) return `${g.cards.map(named).join(', ')} (which one draws is not known)`;
  const parts = [`${used.map(named).join(' and ')} (in use)`];
  if (others.length) parts.push(`${others.map(named).join(', ')} (also in this computer)`);
  return parts.join(' · ');
}
