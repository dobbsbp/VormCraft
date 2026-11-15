import { add, scale, sub, type Vec3 } from '../core/math/vec3';
import { facesWithCurveEdges, isSoftEdge } from '../core/model/surfaces';
import { Model, type FaceId } from '../core/model/Model';
import { applyAffine, composeAffine, IDENTITY, rotation, translation, type Affine } from '../core/ops/transform';
import { modelBounds, transformModel } from '../core/ops/group';
import type { Document } from '../doc/Document';
import { cutOpening } from '../core/ops/opening';
import type { GroupId } from '../doc/Groups';
import type { MaterialFields } from '../doc/Materials';
import type { InferenceHints, Preview, Snap, Tool, ToolContext, ToolEvent } from './types';
import { lineColor } from './LineTool';
import { formatLength } from './units';

/** Something to place, such as a library item: parts with a paint each. */
export interface Placeable {
  name: string;
  parts: readonly { name: string; model: Model; paint?: MaterialFields }[];
  /** Hangs from the point it is placed at (a pendant light), instead of standing on it. */
  hangs?: boolean;
  /**
   * Set for Library items (the item and size): placed as a component, and placing the same item
   * again adds another copy of that component instead of all its geometry again.
   */
  source?: string;
  /**
   * Doors and windows: placed on a wall, the item turns to face out of it, sits in the middle of
   * its thickness `sill` above the floor, and cuts this opening through it.
   */
  opening?: { width: number; height: number; sill: number };
}

/** A wall face under the cursor: whose geometry it is, the face, and the opening's bottom middle on it. */
interface WallSpot {
  owner: GroupId | null;
  face: FaceId;
  normal: Vec3;
  bottom: Vec3;
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

/** The turn that makes an item's front (towards -Y) face along `n` (out of a wall). */
export function facing(n: Vec3): number {
  return Math.atan2(n[0], -n[1]);
}

/** While pointing at a wall, the outline is drawn half a frame into it (the wall's thickness is worked out on the click). */
const FRAME_PREVIEW_DEPTH = 50;

/**
 * Add a placeable to the document as one group (one group per part inside it when it has several
 * parts), in the group being edited. Paints are matched by name and colour with the document's
 * materials, else added. Returns the new group.
 */
export function insertPlaceable(doc: Document, p: Placeable, a: Affine): GroupId {
  if (p.source !== undefined) {
    // The component's own coordinates start at the item's lowest corner.
    const corner = translation(modelBounds(p.parts.map((x) => x.model))?.min ?? [0, 0, 0]);
    const inside = doc.editing !== null && doc.groups.instanceOf(doc.editing);
    const def = inside ? undefined : [...doc.groups.components.values()].find((c) => c.source === p.source);
    if (def) return doc.groups.addInstance(def.id, doc.editing, composeAffine(a, corner));
    const id = insertPlaceable(doc, { ...p, source: undefined }, IDENTITY);
    if (inside) {
      doc.groups.transform(id, a);
      return id;
    }
    doc.groups.makeComponent(id, { name: p.name, source: p.source });
    doc.groups.transform(id, a);
    return id;
  }
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
  /** A door or window over a wall: where it would go in. */
  private wall: WallSpot | null = null;

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
    const what = this.item.name.toLowerCase();
    if (this.item.opening)
      return this.wall
        ? `Click to put the ${what} in this wall: it cuts its own opening ${this.item.opening.sill ? `${formatLength(this.item.opening.sill)} above the floor` : 'from the floor'}. Esc cancels.`
        : `Point at a wall to put the ${what} in it (it cuts its own opening), or click elsewhere to stand it on its own. Esc cancels.`;
    return `Click to place the ${what}${this.item.hangs ? ' (it hangs from the point clicked)' : ''}. Arrow keys turn it 90°; type an angle to turn it exactly. Esc cancels.`;
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
    this.wall = this.wallSpot(e);
    this.at = this.wall?.bottom ?? e.snap?.point ?? null;
  }

  pointerDown(e: ToolEvent): void {
    const item = this.item;
    const wall = this.wallSpot(e);
    const at = e.snap?.point;
    if (!item || (!at && !wall)) return;
    let group: GroupId | null = null;
    this.ctx.apply(
      () => {
        const doc = this.ctx.doc;
        if (wall && item.opening) {
          const t = cutOpening(doc.modelOf(wall.owner), wall.face, { width: item.opening.width, height: item.opening.height, bottom: wall.bottom });
          // A wall inside a component: its other copies get the opening too.
          if (wall.owner !== null) doc.groups.syncFrom(wall.owner);
          group = insertPlaceable(doc, item, placement(item, add(wall.bottom, scale(wall.normal, -t / 2)), facing(wall.normal)));
        } else group = insertPlaceable(doc, item, placement(item, at!, this.angle));
      },
      undefined,
      `Place ${item.name}`,
    );
    this.wall = null;
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

  /** For a door or window: the upright face under the cursor, with where the opening's bottom would go. */
  private wallSpot(e: ToolEvent): WallSpot | null {
    const sill = this.item?.opening?.sill;
    if (sill === undefined) return null;
    const doc = this.ctx.doc;
    const hit =
      e.face !== null && e.facePoint ? { owner: doc.editing, face: e.face, point: e.facePoint } : e.otherFace ? { owner: e.otherFace.owner, face: e.otherFace.face, point: e.otherFace.point } : null;
    if (!hit) return null;
    const model = doc.modelOf(hit.owner);
    if (!model.faces.has(hit.face)) return null;
    const normal = model.face(hit.face).normal;
    if (Math.abs(normal[2]) > 1e-6) return null;
    const floor = Math.min(...model.faceVertexLoops(hit.face)[0].map((v) => model.pos(v)[2]));
    return { owner: hit.owner, face: hit.face, normal, bottom: [hit.point[0], hit.point[1], floor + sill] };
  }

  preview(): Preview {
    if (!this.item || !this.at) return {};
    const a = this.wall ? placement(this.item, add(this.at, scale(this.wall.normal, -FRAME_PREVIEW_DEPTH)), facing(this.wall.normal)) : placement(this.item, this.at, this.angle);
    return {
      lines: [
        { points: this.segments.map((p) => applyAffine(a, p)), color: 'preview', width: 1 },
        { points: [this.at, add(this.at, [0, 0, this.item.hangs ? -60 : 60])], color: lineColor(this.snap), width: 1.5 },
      ],
    };
  }
}
