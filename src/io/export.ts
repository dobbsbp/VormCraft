import { checkWatertight, type WatertightReport } from '../core/check/watertight';
import { cross, length, sub, type Vec3 } from '../core/math/vec3';
import type { Model } from '../core/model/Model';
import { tessellate, type ExportMesh, type TessellationOptions } from './tessellate';

export interface ExportOptions extends TessellationOptions {
  /** Export even if the model is not watertight (STL only; OBJ never checks). */
  allowOpen?: boolean;
}

/** Thrown when the model fails the pre-export watertight check. */
export class NotWatertightError extends Error {
  constructor(readonly report: WatertightReport) {
    const parts = [
      report.openEdges.length ? `${report.openEdges.length} open edge${report.openEdges.length === 1 ? '' : 's'}` : '',
      report.degenerateFaces.length ? `${report.degenerateFaces.length} zero-area face${report.degenerateFaces.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    super(report.openEdges.length || report.degenerateFaces.length ? `The model is not watertight: ${parts.join(', ')}.` : 'The model is empty.');
  }
}

function vertex(mesh: ExportMesh, i: number): Vec3 {
  return [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
}

/**
 * Binary STL (millimetres). Runs the watertight check first and refuses an open model unless
 * `allowOpen` is set. Curves are re-divided to `maxDeviation` if given.
 */
export function exportStl(model: Model, opts: ExportOptions = {}): { data: ArrayBuffer; triangles: number; report: WatertightReport } {
  const report = checkWatertight(model);
  if (!report.watertight && !opts.allowOpen) throw new NotWatertightError(report);
  const mesh = tessellate(model, model.faces.keys(), opts);
  const n = mesh.triangles.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  const header = 'Benup binary STL, units: mm';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0x20);
  view.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(mesh, mesh.triangles[t * 3 + k]));
    const nrm = cross(sub(b, a), sub(c, a));
    const len = length(nrm) || 1;
    for (const x of [nrm[0] / len, nrm[1] / len, nrm[2] / len, ...a, ...b, ...c]) {
      view.setFloat32(o, x, true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return { data: buf, triangles: n, report };
}

/** Wavefront OBJ (triangles, millimetres, shared vertices). */
export function exportObj(model: Model, opts: TessellationOptions = {}, name = 'model'): string {
  const mesh = tessellate(model, model.faces.keys(), opts);
  const fmt = (x: number) => String(Math.round(x * 1e6) / 1e6);
  const lines = ['# Benup OBJ export', '# units: mm', `o ${name.replace(/\s+/g, '_')}`];
  for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${fmt(mesh.positions[i])} ${fmt(mesh.positions[i + 1])} ${fmt(mesh.positions[i + 2])}`);
  for (let i = 0; i < mesh.triangles.length; i += 3) lines.push(`f ${mesh.triangles[i] + 1} ${mesh.triangles[i + 1] + 1} ${mesh.triangles[i + 2] + 1}`);
  return lines.join('\n') + '\n';
}
