import type { FaceId, HalfEdgeId, Model } from '../core/model/Model';
import { faceWithinSolid } from '../core/check/solid';
import { followMe, followMeSpiral, roundPathAxis, type SpiralOptions } from '../core/ops/followMe';
import type { DocumentSnapshot } from '../doc/Document';
import { edgeId } from './Selection';
import type { Preview, Tool, ToolContext, ToolEvent, ToolTips } from './types';
import { formatLength, parseLength } from './units';

/**
 * Follow Me: select the path first (edges, or a face to follow its outline, e.g. a circle for a
 * lathe), then click the profile face: it is swept along the path with mitred corners. A profile
 * on a solid cuts into it (a groove or chamfer along the path). Right after sweeping a profile
 * round a circle, typing "turns, rise" (and how much wider each turn) makes it a spiral instead.
 */
export class FollowMeTool implements Tool {
  readonly id = 'followMe';
  readonly name = 'Follow Me';
  private hover: FaceId | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    if (this.spiral) return 'For a spiral, type the turns and the rise per turn (e.g. 5, 40mm), and how much wider each turn if you like (5, 40mm, 10mm). Or click another profile.';
    return this.hasPath()
      ? 'Click the profile face to sweep it along the selected path.'
      : 'Select the path first (edges, or a face to follow its edge, e.g. a big circle), then click the profile (e.g. a small circle standing upright on its edge: press → or ← while drawing it).';
  }

  tips(): ToolTips {
    return SPIRAL_TIPS;
  }

  vcbLabel(): string {
    return this.spiral ? 'Spiral' : '';
  }

  vcbValue(): string {
    const o = this.spiral?.made;
    if (!o) return '';
    return [`${o.turns}`, formatLength(o.rise), ...(o.grow ? [formatLength(o.grow)] : [])].join(', ');
  }

  /**
   * The last sweep round a circle, which typing can turn into a spiral: the document before it,
   * the profile and path, and the spiral made from it, if any.
   */
  private spiral: { base: DocumentSnapshot; profile: FaceId; path: HalfEdgeId[]; pathFaces: FaceId[]; made: SpiralOptions | null } | null = null;

  inference() {
    return {};
  }

  private hasPath(): boolean {
    return this.ctx.selection.edges.size > 0 || this.ctx.selection.faces.size > 0;
  }

  /**
   * The path: the selected edges, plus the outer edges of selected faces other than the profile.
   * A profile selected along with its own edges (double-click) does not make them path; but a
   * selected face's outline stays whole, even where the profile shares an edge with it (a fillet
   * drawn at the corner of a box's top follows the whole top outline).
   */
  private path(profile: FaceId): HalfEdgeId[] {
    const model = this.ctx.doc.model;
    const own = new Set(model.faceHalfEdges(profile).map((h) => edgeId(model, h)));
    const edges = new Set<HalfEdgeId>([...this.ctx.selection.edges].filter((e) => !own.has(e)));
    for (const f of this.ctx.selection.faces) {
      if (f === profile || !model.faces.has(f)) continue;
      for (const h of model.loopHalfEdges(model.face(f).outer)) edges.add(edgeId(model, h));
    }
    return [...edges];
  }

  /**
   * One loose line selected: the whole chain of loose lines joined to it end to end (as drawn with
   * the Line tool), stopping where lines branch. Returns the chain if it is longer than the line.
   */
  private chainFrom(line: HalfEdgeId): HalfEdgeId[] | null {
    const model = this.ctx.doc.model;
    const loose = (h: HalfEdgeId) => model.he(h).loop === null && model.he(model.he(h).twin).loop === null;
    if (!loose(line)) return null;
    const chain = new Set<HalfEdgeId>([edgeId(model, line)]);
    for (const start of [model.he(line).origin, model.dest(line)]) {
      let at = start;
      for (;;) {
        const out = [...model.outgoing(at)];
        if (out.length !== 2) break;
        const next = out.find((h) => !chain.has(edgeId(model, h)));
        if (next === undefined || !loose(next)) break;
        chain.add(edgeId(model, next));
        at = model.dest(next);
      }
    }
    return chain.size > 1 ? [...chain] : null;
  }

  pointerMove(e: ToolEvent): void {
    this.hover = e.face;
  }

  pointerDown(e: ToolEvent): void {
    if (e.face === null) return;
    let path = this.path(e.face);
    if (!path.length) throw new Error('Select the path first: the edges to follow (or a face to follow its edge)');
    const profile = e.face;
    // One loose line selected: follow every line joined to it end to end (Shift: just that line).
    const whole = path.length === 1 && !this.ctx.selection.faces.size && !e.shift ? this.chainFrom(path[0]) : null;
    if (whole) path = whole;
    const pathFaces = [...this.ctx.selection.faces].filter((f) => f !== profile);
    // A free-standing profile round a circle can be made a spiral by typing afterwards.
    const model = this.ctx.doc.model;
    const round = model.adjacentFaces(profile).size === 0 && roundPathAxis(model, path) !== null;
    const base = this.ctx.apply(() => this.sweep(pathFaces, (m) => followMe(m, profile, path).faces));
    this.spiral = round ? { base, profile, path, pathFaces, made: null } : null;
    this.hover = null;
    this.said = whole ? `Followed the ${whole.length} lines joined to the one selected (hold Shift when clicking the profile to follow only the selected line)` : null;
  }

  /**
   * Sweep, then remove a path face left inside the new solid or on its surface (the disc in the
   * middle of a sphere, under a dome or a cylinder): it is in the way. One outside it (a ring's
   * disc) stays.
   */
  private sweep(pathFaces: FaceId[], make: (model: Model) => FaceId[]): void {
    const model = this.ctx.doc.model;
    const faces = make(model);
    const made = new Set<FaceId>();
    for (const f of faces) if (model.faces.has(f) && !made.has(f)) for (const g of model.connectedFaces(f, false)) made.add(g);
    if (!model.isClosed(made)) return;
    for (const f of pathFaces) {
      if (!model.faces.has(f) || made.has(f) || model.isClosed(model.connectedFaces(f, false)) || !faceWithinSolid(model, f, made)) continue;
      const edges = model.faceHalfEdges(f);
      model.removeFace(f);
      model.purgeFree(edges);
    }
  }

  /** What the last sweep did that is worth saying. */
  private said: string | null = null;

  notice(): string | null {
    const said = this.said;
    this.said = null;
    return said;
  }

  /** "turns, rise" or "turns, rise, wider": the last sweep round a circle becomes a spiral. */
  typed(text: string): void {
    const s = this.spiral;
    if (!s) throw new Error('To make a spiral, sweep a profile round a circle first (select the circle, click the profile), then type the turns and the rise per turn');
    const parts = text.split(',').map((p) => p.trim());
    const turns = Number(parts[0]);
    const rise = parts[1] === undefined || parts[1] === '' ? undefined : parseLength(parts[1]);
    const grow = parts[2] === undefined || parts[2] === '' ? 0 : parseLength(parts[2]);
    if (parts.length > 3 || !Number.isFinite(turns) || rise === undefined || grow === undefined) {
      throw new Error('Type the turns and the rise per turn, e.g. 5, 40mm (and how much wider each turn: 5, 40mm, 10mm)');
    }
    const opts: SpiralOptions = { turns, rise, grow };
    this.ctx.apply(() => this.sweep(s.pathFaces, (m) => followMeSpiral(m, s.profile, s.path, opts).faces), s.base, 'Spiral');
    s.made = opts;
  }

  cancel(): void {}

  reset(): void {
    this.spiral = null;
  }

  preview(): Preview {
    return this.hover !== null && this.ctx.doc.model.faces.has(this.hover) ? { faces: [this.hover] } : {};
  }
}

/** How to make a spring or coil: it starts as a ring, which is not easy to guess. */
const SPIRAL_TIPS: ToolTips = {
  label: 'Spiral tips',
  title: 'Making a spiral (a spring or coil)',
  text: `A spiral starts as a ring. Then you type how it winds.

1. Draw a flat circle with the Circle tool. The coil winds round it.
2. Draw a small circle standing upright on its edge: with the Circle tool, press → or ← to stand it upright, click on the big circle's edge (look for "Endpoint"), and type its radius.
3. Choose Select and click the big flat circle.
4. Choose Follow Me and click the small circle. You get a ring.
5. Straight away, type the turns and the rise per turn, then press Enter.

What to type:
• 5, 30cm: a spring of 5 turns, each 30 cm higher than the last.
• 3, 0, 25cm: a flat coil, each turn 25 cm further out.
• 6, 25cm, -12cm: a cone-shaped spring, each turn 12 cm narrower.
• 0.5, 50cm: half a turn, like a curved ramp or handrail.

Type again to change it. Undo goes back to before the ring.

Good to know:
• Each turn must climb at least as much as the small circle is tall, or the coils would run into each other. If not, it tells you the least it can be.
• Any upright shape works: a square makes a square spring.
• A smaller small circle, or a bigger flat one, gives a finer coil.`,
};
