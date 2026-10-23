import { drawCircle, drawRectangle, findFaceAt, GROUND_PLANE, Model, pushPull, type Vec3 } from '../core';

/** A small machined plate (through-hole, pocket, boss) so the viewport has something to show. */
export function buildDemoModel(): Model {
  const m = new Model();
  const up: Vec3 = [0, 0, 1];
  const topAt = (x: number, y: number, z: number) => {
    const f = findFaceAt(m, [x, y, z], up);
    if (f === undefined) throw new Error(`No top face at ${x},${y},${z}`);
    return f;
  };

  pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 300, 200).inner!, 40);

  let top = topAt(70, 100, 40);
  pushPull(m, drawCircle(m, m.facePlane(top), [70, 100, 40], 30, 32, top).inner!, -40);

  top = topAt(150, 60, 40);
  pushPull(m, drawRectangle(m, m.facePlane(top), [140, 50, 40], 120, 100, top).inner!, -15);

  const floor = topAt(200, 100, 25);
  pushPull(m, drawCircle(m, m.facePlane(floor), [200, 100, 25], 22, 32, floor).inner!, 45);
  return m;
}
