import { TOL } from './tolerance';
import { distance, type Vec3 } from './vec3';

/** Point lookup by proximity, for snapping vertices that should coincide. */
export class SpatialHash<T> {
  private readonly cells = new Map<string, { p: Vec3; value: T }[]>();

  constructor(private readonly tol = TOL) {}

  private key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  private cell(p: Vec3): [number, number, number] {
    const s = this.tol * 4;
    return [Math.floor(p[0] / s), Math.floor(p[1] / s), Math.floor(p[2] / s)];
  }

  insert(p: Vec3, value: T): void {
    const k = this.key(...this.cell(p));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push({ p, value });
  }

  /** The closest stored value within tolerance, if any. */
  find(p: Vec3): T | undefined {
    const [cx, cy, cz] = this.cell(p);
    let best: T | undefined;
    let bestD = this.tol;
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = cz - 1; z <= cz + 1; z++) {
          for (const e of this.cells.get(this.key(x, y, z)) ?? []) {
            const d = distance(e.p, p);
            if (d <= bestD) {
              bestD = d;
              best = e.value;
            }
          }
        }
    return best;
  }
}
