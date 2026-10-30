import type { ToolController } from '../tools/ToolController';

/**
 * Scene slideshow: goes to each scene in turn (the camera gliding for the transition time), stays
 * for the delay, and loops until stopped.
 */
export class ScenePlayer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  onChange: () => void = () => {};

  constructor(private readonly controller: ToolController) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  play(): void {
    if (this.playing) return;
    if (this.controller.doc.scenes.items.length < 1) {
      this.controller.notify('Add scenes first, then play them as a slideshow');
      return;
    }
    this.step();
    this.onChange();
  }

  stop(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.controller.notify('Slideshow stopped');
    this.onChange();
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  private step(): void {
    const { transition, delay } = this.controller.doc.scenes;
    this.controller.stepScene(1);
    const name = this.controller.currentScene !== null ? this.controller.doc.scenes.get(this.controller.currentScene)?.name : undefined;
    if (name) this.controller.notify(`Slideshow: ${name} (Esc or a click stops it)`);
    // At least a moment per scene, so a zero transition and delay do not spin.
    this.timer = setTimeout(() => this.step(), Math.max(250, (transition + delay) * 1000));
  }
}
