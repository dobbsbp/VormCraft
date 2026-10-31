import { isTauri } from './files';

/** Which graphics card draws the view (desktop only; takes effect when the app restarts). */
export type GraphicsChoice = 'high' | 'low' | 'auto';

export const GRAPHICS_LABELS: Record<GraphicsChoice, string> = {
  high: 'High performance (the faster graphics card, if the computer has two)',
  low: 'Power saving (the built-in graphics; longer battery life)',
  auto: 'Let Windows decide',
};

/** The saved choice, or null where it cannot be chosen (the web version: the browser decides). */
export async function graphicsChoice(): Promise<GraphicsChoice | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<GraphicsChoice>('graphics_preference');
}

export async function setGraphicsChoice(value: GraphicsChoice): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_graphics_preference', { value });
}
