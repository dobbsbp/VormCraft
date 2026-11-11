import { add, sub, type Vec3 } from '../core/math/vec3';
import { facesWithCurveEdges, isSoftEdge } from '../core/model/surfaces';
import { Model } from '../core/model/Model';
import { applyAffine, rotation, type Affine } from '../core/ops/transform';
import { modelBounds, transformModel } from '../core/ops/group';
import type { Document } from '../doc/Document';
import type { GroupId } from '../doc/Groups';
import type { MaterialFields } from '../doc/Materials';
import type { InferenceHints, Preview, Snap, Tool, ToolContext, ToolEvent } from './types';
import { lineColor } from './LineTool';

/** Something to place, such as a library item: parts with a paint each. */
export interface Placeable {
  name: string;
  parts: readonly { name: string; model: Model; paint?: MaterialFields }[];
  /** Hangs from the point it is placed at (a pendant light), instead of standing on it. */
  hangs?: boolean;
}

/** The point of a placeable that goes where it is placed: the middle of its base (or of its top, if it hangs). */
export function placeAnchor(p: Placeable): Vec3 {
  const b = modelBounds(p.parts.map((x) => x.model));
  if (!b) return [0, 0, 0];
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, p.hangs ? b.max[2] : b.min[2]];
}

/** Where a placeable's geometry goes: turned `angle` about its anchor, the anchor moved to `at`. */
export function placement(p: Placeable, at: Vec3, angle: number): Affine {
  const anchor = placeAnchor(p);
  const turn = rotation(anchor, [0, 0, 1], angle);
  return { m: turn.m, t: add(turn.t, sub(at, anchor)) };
}

/**
 * Add a placeable to the document as one group (one group per part inside it when it has several
 * parts), in the group being edited. Paints are matched by name and colour with the document's
 * materials, else added. Returns the new group.
 */
export function insertPlaceable(doc: Document, p: Placeable, a: Affine): GroupId {
  const paintIds = new Map<string, string>();
  const paint = (m: MaterialFields | undefined): string | undefined => {
    if (!m) return undefined;
    const key = `${m.name}|${m.color}|${m.opacity}`;
    let id = paintIds.get(key);
    if (id === undefined) {
      const same = [...doc.materials.items.values()].find((x) => x.name === m.name && x.color.toLowerCase() === m.color.toLowerCase() && x.opacity === m.opacity && !x.texture);
      id = same ? same.id : doc.materials.add({ ...m, name: doc.materials.uniqueName(m.name) });
      paintIds.set(key, id);
    }
    return id;
  };
  const placed = (m: Model): Model => {
    const copy = m.clone();
    transformModel(copy, a);
    return copy;
  };
  if (p.parts.length === 1) return doc.groups.add(placed(p.parts[0].model), doc.editing, { name: p.name, material: paint(p.parts[0].paint) });
  const outer = doc.groups.add(new Model(), doc.editing, { name: p.name });
  for (const part of p.parts) doc.groups.add(placed(part.model), outer, { name: part.name, material: paint(part.paint) });
  return outer;
}

/**
 * Place: the chosen item follows the cursor (its base on the point under it, snapped like any
 * tool) and a click puts it there as a group. Arrow keys turn it by 90°; typing an angle turns it
 * exactly. Esc cancels. After placing, the new group is selected and Select comes back.
 */
export class PlaceTool implements Tool {
  readonly id = 'place';
  readonly name = 'Place';
  private item: Placeable | null = null;
  /** The item's visible edges as segment pairs, in its own coordinates. */
  private segments: Vec3[] = [];
  private angle = 0;
  private at: Vec3 | null = null;
  private snap: Snap | null = null;

  constructor(
    private readonly ctx: ToolContext,
    private readonly onPlaced: (group: GroupId) => void,
    private readonly onCancel: () => void,
  ) {}

  /** Start placing an item. */
  start(item: Placeable): void {
    this.item = item;
    this.angle = 0;
    this.at = null;
    this.segments = [];
    for (const part of item.parts) {
      const m = part.model;
      const curved = facesWithCurveEdges(m);
      for (const e of m.edges()) {
        if (isSoftEdge(m, e, curved)) continue;
        this.segments.push(m.pos(m.he(e).origin), m.pos(m.dest(e)));
      }
    }
  }

  get placing(): Placeable | null {
    return this.item;
  }

  hint(): string {
    if (!this.item) return 'Choose an item in the Library to place it.';
    return `Click to place the ${this.item.name.toLowerCase()}${this.item.hangs ? ' (it hangs from the point clicked)' : ''}. Arrow keys turn it 90°; type an angle to turn it exactly. Esc cancels.`;
  }

  vcbLabel(): string {
    return 'Angle';
  }

  vcbValue(): string {
    return this.item ? `${Math.round((this.angle * 180) / Math.PI) % 360}°` : '';
  }

  inference(): InferenceHints {
    return {};
  }

  pointerMove(e: ToolEvent): void {
    this.snap = e.snap;
    this.at = e.snap?.point ?? null;
  }

  pointerDown(e: ToolEvent): void {
    const item = this.item;
    const at = e.snap?.point;
    if (!item || !at) return;
    let group: GroupId | null = null;
    this.ctx.apply(
      () => {
        group = insertPlaceable(this.ctx.doc, item, placement(item, at, this.angle));
      },
      undefined,
      `Place ${item.name}`,
    );
    this.item = null;
    this.at = null;
    if (group !== null) this.onPlaced(group);
  }

  lockAxis(): string | null {
    if (!this.item) return null;
    this.angle = (this.angle + Math.PI / 2) % (2 * Math.PI);
    return `Turned to ${Math.round((this.angle * 180) / Math.PI)}°`;
  }

  typed(text: string): void {
    if (!this.item) throw new Error('Choose an item in the Library first');
    const deg = Number(text.replace(/°|deg/gi, '').trim());
    if (!Number.isFinite(deg)) throw new Error('Type an angle in degrees, e.g. 45');
    this.angle = ((((deg % 360) + 360) % 360) * Math.PI) / 180;
  }

  cancel(): void {
    const had = this.item !== null;
    this.item = null;
    this.at = null;
    if (had) this.onCancel();
  }

  reset(): void {
    this.cancel();
  }

  preview(): Preview {
    if (!this.item || !this.at) return {};
    const a = placement(this.item, this.at, this.angle);
    return {
      lines: [
        { points: this.segments.map((p) => applyAffine(a, p)), color: 'preview', width: 1 },
        { points: [this.at, add(this.at, [0, 0, this.item.hangs ? -60 : 60])], color: lineColor(this.snap), width: 1.5 },
      ],
    };
  }
}
