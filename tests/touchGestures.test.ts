import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Navigator } from '../src/view/navigation';
import { Glide, twoFingerStep } from '../src/view/touchGestures';

describe('two-finger gestures', () => {
  it('a pinch with the middle still only zooms; spreading zooms in, pinching zooms out', () => {
    const out = twoFingerStep(
      [
        [100, 100],
        [200, 100],
      ],
      [
        [50, 100],
        [250, 100],
      ],
    );
    expect(out.orbit).toEqual([0, 0]);
    expect(out.zoomSteps).toBeGreaterThan(0);
    const back = twoFingerStep(
      [
        [50, 100],
        [250, 100],
      ],
      [
        [100, 100],
        [200, 100],
      ],
    );
    expect(back.zoomSteps).toBeCloseTo(-out.zoomSteps);
  });

  it('spreading the fingers to twice as far apart makes the model look twice as big', () => {
    const nav = new Navigator(new THREE.PerspectiveCamera(35, 1, 1, 1e5));
    nav.camera.position.set(0, -1000, 0);
    nav.lookAt(new THREE.Vector3(0, 0, 0));
    const { zoomSteps } = twoFingerStep(
      [
        [100, 100],
        [200, 100],
      ],
      [
        [50, 100],
        [250, 100],
      ],
    );
    nav.zoomToward(new THREE.Vector3(0, 0, 0), zoomSteps);
    expect(nav.camera.position.length()).toBeCloseTo(500);
  });

  it('moving both fingers together only orbits; doing both at once does both', () => {
    const slide = twoFingerStep(
      [
        [100, 100],
        [200, 100],
      ],
      [
        [130, 80],
        [230, 80],
      ],
    );
    expect(slide.zoomSteps).toBeCloseTo(0);
    expect(slide.orbit).toEqual([30, -20]);
    const both = twoFingerStep(
      [
        [100, 100],
        [200, 100],
      ],
      [
        [110, 120],
        [290, 120],
      ],
    );
    expect(both.zoomSteps).toBeGreaterThan(0);
    expect(both.orbit).toEqual([50, 20]);
  });

  it('fingers on top of each other do not zoom wildly', () => {
    const s = twoFingerStep(
      [
        [100, 100],
        [100, 100],
      ],
      [
        [100, 100],
        [140, 100],
      ],
    );
    expect(s.zoomSteps).toBe(0);
  });
});

describe('glide after a flick', () => {
  it('keeps moving the same way, slows down and stops', () => {
    const g = new Glide();
    for (let t = 0; t <= 80; t += 16) g.move(16, -8, t); // 1 px/ms right, 0.5 up
    expect(g.release(85)).toBe(true);
    let t = 85;
    let total = 0;
    let last = Infinity;
    let frames = 0;
    for (let d = g.step((t += 16)); d; d = g.step((t += 16))) {
      expect(d[0]).toBeGreaterThan(0);
      expect(d[1]).toBeLessThan(0);
      expect(d[0]).toBeLessThanOrEqual(last);
      last = d[0];
      total += d[0];
      frames++;
    }
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(200);
    // Speed 1 px/ms with a 325 ms slow-down carries on about 325 px.
    expect(total).toBeGreaterThan(250);
    expect(total).toBeLessThan(330);
    expect(g.gliding).toBe(false);
  });

  it('no glide after a slow drag, or after the fingers rested before lifting', () => {
    const slow = new Glide();
    for (let t = 0; t <= 80; t += 16) slow.move(0.1, 0, t);
    expect(slow.release(85)).toBe(false);
    const rested = new Glide();
    for (let t = 0; t <= 80; t += 16) rested.move(16, 0, t);
    expect(rested.release(400)).toBe(false);
  });
});
