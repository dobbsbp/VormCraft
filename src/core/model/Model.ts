import { makePlane, type Plane } from '../math/plane';
import { TOL } from '../math/tolerance';
import { distance, newellNormal, normalize, type Vec3 } from '../math/vec3';

export type VertexId = number;
export type HalfEdgeId = number;
export type LoopId = number;
export type FaceId = number;
export type CurveId = number;

export interface Vertex {
  readonly id: VertexId;
  pos: Vec3;
}

/**
 * One direction of an edge. Edges are always stored as a twin pair. A half-edge with `loop === null`
 * is a free side (no face on that side), so a pair with both sides free is a wire edge.
 */
export interface HalfEdge {
  readonly id: HalfEdgeId;
  readonly origin: VertexId;
  readonly twin: HalfEdgeId;
  next: HalfEdgeId | null;
  prev: HalfEdgeId | null;
  loop: LoopId | null;
  /** The true curve this edge approximates (e.g. a circle), kept for STEP export. */
  curve: CurveId | null;
}

export interface Loop {
  readonly id: LoopId;
  readonly face: FaceId;
  first: HalfEdgeId;
}

/** A planar polygon face. Outer loop is CCW about `normal`; hole loops are CW about it. */
export interface Face {
  readonly id: FaceId;
  outer: LoopId;
  holes: LoopId[];
  normal: Vec3;
}

export interface CircleCurve {
  readonly id: CurveId;
  readonly kind: 'circle';
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly radius: number;
  /** Segments per full turn (fractional for arcs, whose segments divide only their sweep). */
  readonly segments: number;
}

export type Curve = CircleCurve;

export interface AddFaceOptions {
  normal?: Vec3;
  /** Reuse a specific face id (must not be in use). */
  id?: FaceId;
}

const edgeKey = (a: VertexId, b: VertexId) => `${a}>${b}`;

/**
 * Boundary-representation model built on a half-edge structure. This is the single source of
 * truth for geometry; display meshes are derived from it and never written back.
 */
export class Model {
  readonly vertices = new Map<VertexId, Vertex>();
  readonly halfEdges = new Map<HalfEdgeId, HalfEdge>();
  readonly loops = new Map<LoopId, Loop>();
  readonly faces = new Map<FaceId, Face>();
  readonly curves = new Map<CurveId, Curve>();

  private nextId = 1;
  private readonly edgeIndex = new Map<string, HalfEdgeId>();
  private readonly outgoingIndex = new Map<VertexId, Set<HalfEdgeId>>();

  /** A fresh id, unique across every entity kind in this model. */
  newId(): number {
    return this.nextId++;
  }

  /** Make sure freshly allocated ids are all greater than `id` (used before restoring saved ids). */
  reserveIdsUpTo(id: number): void {
    if (id >= this.nextId) this.nextId = id + 1;
  }

  /** Use the requested id (if free) or a fresh one, keeping future ids above it. */
  private claimId(id?: number): number {
    if (id === undefined) return this.newId();
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid id ${id}`);
    if (this.vertices.has(id) || this.curves.has(id) || this.faces.has(id) || this.halfEdges.has(id) || this.loops.has(id)) throw new Error(`Id ${id} is in use`);
    if (id >= this.nextId) this.nextId = id + 1;
    return id;
  }

  // ---------------------------------------------------------------- vertices

  /** Add a vertex; `id` restores a specific (unused) id, e.g. when loading a file. */
  addVertex(pos: Vec3, id?: VertexId): VertexId {
    id = this.claimId(id);
    this.vertices.set(id, { id, pos });
    this.outgoingIndex.set(id, new Set());
    return id;
  }

  /** Find a vertex within `tol` of `pos`, optionally only among `candidates`. */
  findVertex(pos: Vec3, tol = TOL, candidates?: Iterable<VertexId>): VertexId | undefined {
    let best: VertexId | undefined;
    let bestD = tol;
    const ids = candidates ?? this.vertices.keys();
    for (const id of ids) {
      const d = distance(this.pos(id), pos);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  vertexAt(pos: Vec3, tol = TOL): VertexId {
    return this.findVertex(pos, tol) ?? this.addVertex(pos);
  }

  pos(v: VertexId): Vec3 {
    const vert = this.vertices.get(v);
    if (!vert) throw new Error(`No vertex ${v}`);
    return vert.pos;
  }

  outgoing(v: VertexId): ReadonlySet<HalfEdgeId> {
    return this.outgoingIndex.get(v) ?? new Set();
  }

  removeVertexIfIsolated(v: VertexId): boolean {
    if (!this.vertices.has(v) || this.outgoing(v).size > 0) return false;
    this.vertices.delete(v);
    this.outgoingIndex.delete(v);
    return true;
  }

  // ---------------------------------------------------------------- edges

  he(id: HalfEdgeId): HalfEdge {
    const h = this.halfEdges.get(id);
    if (!h) throw new Error(`No half-edge ${id}`);
    return h;
  }

  dest(id: HalfEdgeId): VertexId {
    return this.he(this.he(id).twin).origin;
  }

  halfEdgeBetween(a: VertexId, b: VertexId): HalfEdgeId | undefined {
    return this.edgeIndex.get(edgeKey(a, b));
  }

  faceOf(id: HalfEdgeId): FaceId | null {
    const loop = this.he(id).loop;
    return loop === null ? null : this.loop(loop).face;
  }

  /** Get or create the edge a–b; returns the half-edge directed a→b. */
  addEdge(a: VertexId, b: VertexId, curve: CurveId | null = null): HalfEdgeId {
    if (a === b) throw new Error('Edge endpoints must differ');
    const existing = this.halfEdgeBetween(a, b);
    if (existing !== undefined) return existing;
    if (!this.vertices.has(a) || !this.vertices.has(b)) throw new Error(`Edge ${a}-${b} references a missing vertex`);
    const id1 = this.newId();
    const id2 = this.newId();
    this.halfEdges.set(id1, { id: id1, origin: a, twin: id2, next: null, prev: null, loop: null, curve });
    this.halfEdges.set(id2, { id: id2, origin: b, twin: id1, next: null, prev: null, loop: null, curve });
    this.edgeIndex.set(edgeKey(a, b), id1);
    this.edgeIndex.set(edgeKey(b, a), id2);
    this.outgoingIndex.get(a)!.add(id1);
    this.outgoingIndex.get(b)!.add(id2);
    return id1;
  }

  /** Delete an edge pair. Both sides must be free. */
  removeEdge(id: HalfEdgeId): void {
    const h = this.he(id);
    const t = this.he(h.twin);
    if (h.loop !== null || t.loop !== null) throw new Error(`Edge ${id} still bounds a face`);
    this.edgeIndex.delete(edgeKey(h.origin, t.origin));
    this.edgeIndex.delete(edgeKey(t.origin, h.origin));
    this.outgoingIndex.get(h.origin)?.delete(h.id);
    this.outgoingIndex.get(t.origin)?.delete(t.id);
    this.halfEdges.delete(h.id);
    this.halfEdges.delete(t.id);
  }

  /** Unique edges as the lower-id half-edge of each pair. */
  *edges(): Iterable<HalfEdgeId> {
    for (const h of this.halfEdges.values()) if (h.id < h.twin) yield h.id;
  }

  setEdgeCurve(a: VertexId, b: VertexId, curve: CurveId | null): void {
    const id = this.halfEdgeBetween(a, b);
    if (id === undefined) throw new Error(`No edge ${a}-${b}`);
    this.he(id).curve = curve;
    this.he(this.he(id).twin).curve = curve;
  }

  /** Remove every edge whose two sides are free, then every vertex left without edges. */
  purgeFree(candidates?: Iterable<HalfEdgeId>): void {
    const touched = new Set<VertexId>();
    for (const id of [...(candidates ?? this.halfEdges.keys())]) {
      const h = this.halfEdges.get(id);
      if (!h || h.loop !== null || this.he(h.twin).loop !== null) continue;
      touched.add(h.origin);
      touched.add(this.he(h.twin).origin);
      this.removeEdge(id);
    }
    const verts = candidates ? touched : new Set(this.vertices.keys());
    for (const v of verts) this.removeVertexIfIsolated(v);
  }

  /**
   * Insert vertex `m` into the edge of half-edge `id` (a→b), producing a→m→b on this side and
   * b→m→a on the twin side. Loops on both sides are updated, so neighbouring faces stay valid.
   */
  splitEdge(id: HalfEdgeId, m: VertexId): void {
    const h1 = this.he(id);
    const h2 = this.he(h1.twin);
    const a = h1.origin;
    const b = h2.origin;
    const curve = h1.curve;
    const sides = [h1, h2].map((h) => ({ loop: h.loop, prev: h.prev, next: h.next, wasFirst: h.loop !== null && this.loop(h.loop).first === h.id }));
    this.detach(h1);
    this.detach(h2);
    this.removeEdge(h1.id);
    const am = this.addEdge(a, m, curve);
    const mb = this.addEdge(m, b, curve);
    const bm = this.he(mb).twin;
    const ma = this.he(am).twin;
    this.relink(sides[0], am, mb);
    this.relink(sides[1], bm, ma);
  }

  private detach(h: HalfEdge): void {
    h.loop = null;
    h.next = null;
    h.prev = null;
  }

  private relink(side: { loop: LoopId | null; prev: HalfEdgeId | null; next: HalfEdgeId | null; wasFirst: boolean }, x: HalfEdgeId, y: HalfEdgeId): void {
    if (side.loop === null) return;
    const hx = this.he(x);
    const hy = this.he(y);
    hx.loop = side.loop;
    hy.loop = side.loop;
    hx.next = y;
    hy.prev = x;
    hx.prev = side.prev;
    hy.next = side.next;
    this.he(side.prev!).next = x;
    this.he(side.next!).prev = y;
    if (side.wasFirst) this.loop(side.loop).first = x;
  }

  // ---------------------------------------------------------------- faces

  loop(id: LoopId): Loop {
    const l = this.loops.get(id);
    if (!l) throw new Error(`No loop ${id}`);
    return l;
  }

  face(id: FaceId): Face {
    const f = this.faces.get(id);
    if (!f) throw new Error(`No face ${id}`);
    return f;
  }

  addCurve(curve: Omit<CircleCurve, 'id'>, id?: CurveId): CurveId {
    id = this.claimId(id);
    this.curves.set(id, { ...curve, id, normal: normalize(curve.normal) });
    return id;
  }

  /**
   * Add a face bounded by vertex loops. The outer loop must be CCW about the normal and holes CW.
   * Fails (without changing the model) if any directed edge already bounds another face.
   */
  addFace(outer: readonly VertexId[], holes: readonly (readonly VertexId[])[] = [], opts: AddFaceOptions = {}): FaceId {
    const all = [outer, ...holes];
    for (const ring of all) {
      if (ring.length < 3) throw new Error('A face loop needs at least 3 vertices');
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a === b) throw new Error('A face loop has a repeated vertex');
        const existing = this.halfEdgeBetween(a, b);
        if (existing !== undefined && this.he(existing).loop !== null) {
          throw new Error(`Directed edge ${a}>${b} already bounds face ${this.faceOf(existing)}`);
        }
      }
    }
    if (opts.id !== undefined && this.faces.has(opts.id)) throw new Error(`Face id ${opts.id} is in use`);
    const id = opts.id ?? this.newId();
    if (opts.id !== undefined && opts.id >= this.nextId) this.nextId = opts.id + 1;
    const normal = opts.normal ? normalize(opts.normal) : newellNormal(outer.map((v) => this.pos(v)));
    const loopIds = all.map((ring) => this.buildLoop(id, ring));
    this.faces.set(id, { id, outer: loopIds[0], holes: loopIds.slice(1), normal });
    return id;
  }

  private buildLoop(face: FaceId, ring: readonly VertexId[]): LoopId {
    const loopId = this.newId();
    const hes = ring.map((a, i) => this.addEdge(a, ring[(i + 1) % ring.length]));
    hes.forEach((id, i) => {
      const h = this.he(id);
      h.loop = loopId;
      h.next = hes[(i + 1) % hes.length];
      h.prev = hes[(i - 1 + hes.length) % hes.length];
    });
    this.loops.set(loopId, { id: loopId, face, first: hes[0] });
    return loopId;
  }

  /** Remove a face. Its edges stay (call `purgeFree` to drop edges left with no face). */
  removeFace(id: FaceId): void {
    const f = this.face(id);
    for (const l of [f.outer, ...f.holes]) {
      for (const h of this.loopHalfEdges(l)) this.detach(this.he(h));
      this.loops.delete(l);
    }
    this.faces.delete(id);
  }

  /** Reverse a face's orientation in place (keeps its id). */
  flipFace(id: FaceId): void {
    const f = this.face(id);
    const rings = this.faceVertexLoops(id).map((r) => [...r].reverse());
    const normal: Vec3 = [-f.normal[0], -f.normal[1], -f.normal[2]];
    this.removeFace(id);
    this.addFace(rings[0], rings.slice(1), { normal, id });
  }

  loopHalfEdges(id: LoopId): HalfEdgeId[] {
    const out: HalfEdgeId[] = [];
    const start = this.loop(id).first;
    let h = start;
    do {
      out.push(h);
      const next = this.he(h).next;
      if (next === null) throw new Error(`Loop ${id} is broken at half-edge ${h}`);
      h = next;
      if (out.length > this.halfEdges.size) throw new Error(`Loop ${id} does not close`);
    } while (h !== start);
    return out;
  }

  loopVertices(id: LoopId): VertexId[] {
    return this.loopHalfEdges(id).map((h) => this.he(h).origin);
  }

  /** [outer, ...holes] as vertex id rings. */
  faceVertexLoops(id: FaceId): VertexId[][] {
    const f = this.face(id);
    return [f.outer, ...f.holes].map((l) => this.loopVertices(l));
  }

  faceHalfEdges(id: FaceId): HalfEdgeId[] {
    const f = this.face(id);
    return [f.outer, ...f.holes].flatMap((l) => this.loopHalfEdges(l));
  }

  facePlane(id: FaceId): Plane {
    const f = this.face(id);
    return makePlane(this.pos(this.he(this.loop(f.outer).first).origin), f.normal);
  }

  /** Faces sharing an edge with this face. */
  adjacentFaces(id: FaceId): Set<FaceId> {
    const out = new Set<FaceId>();
    for (const h of this.faceHalfEdges(id)) {
      const other = this.faceOf(this.he(h).twin);
      if (other !== null && other !== id) out.add(other);
    }
    return out;
  }

  /** All faces edge-connected to `id` (a shell or open surface). */
  connectedFaces(id: FaceId): Set<FaceId> {
    const seen = new Set<FaceId>([id]);
    const stack = [id];
    while (stack.length) {
      for (const n of this.adjacentFaces(stack.pop()!)) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return seen;
  }

  /** True when every edge of these faces has a face from the set on both sides. */
  isClosed(faces: ReadonlySet<FaceId>): boolean {
    for (const f of faces) {
      for (const h of this.faceHalfEdges(f)) {
        const other = this.faceOf(this.he(h).twin);
        if (other === null || !faces.has(other)) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- whole model

  clone(): Model {
    const m = new Model();
    m.nextId = this.nextId;
    for (const [k, v] of this.vertices) m.vertices.set(k, { ...v });
    for (const [k, v] of this.halfEdges) m.halfEdges.set(k, { ...v });
    for (const [k, v] of this.loops) m.loops.set(k, { ...v });
    for (const [k, v] of this.faces) m.faces.set(k, { ...v, holes: [...v.holes] });
    for (const [k, v] of this.curves) m.curves.set(k, { ...v });
    for (const [k, v] of this.edgeIndex) m.edgeIndex.set(k, v);
    for (const [k, v] of this.outgoingIndex) m.outgoingIndex.set(k, new Set(v));
    return m;
  }

  /** Replace this model's contents with a copy of another's (restores a snapshot in place). */
  copyFrom(other: Model): void {
    const c = other.clone();
    this.nextId = c.nextId;
    const maps = [
      [this.vertices, c.vertices],
      [this.halfEdges, c.halfEdges],
      [this.loops, c.loops],
      [this.faces, c.faces],
      [this.curves, c.curves],
      [this.edgeIndex, c.edgeIndex],
      [this.outgoingIndex, c.outgoingIndex],
    ] as [Map<unknown, unknown>, Map<unknown, unknown>][];
    for (const [mine, theirs] of maps) {
      mine.clear();
      for (const [k, v] of theirs) mine.set(k, v);
    }
  }

  /** Check internal consistency; throws with a description of the first problem found. */
  validate(): void {
    for (const h of this.halfEdges.values()) {
      const t = this.halfEdges.get(h.twin);
      if (!t || t.twin !== h.id) throw new Error(`Half-edge ${h.id} has a bad twin`);
      if (t.origin === h.origin) throw new Error(`Half-edge ${h.id} is degenerate`);
      if (this.edgeIndex.get(edgeKey(h.origin, t.origin)) !== h.id) throw new Error(`Half-edge ${h.id} missing from index`);
      if (!this.outgoingIndex.get(h.origin)?.has(h.id)) throw new Error(`Half-edge ${h.id} missing from outgoing index`);
      if (h.loop === null) {
        if (h.next !== null || h.prev !== null) throw new Error(`Free half-edge ${h.id} is linked`);
        continue;
      }
      if (!this.loops.has(h.loop)) throw new Error(`Half-edge ${h.id} references missing loop`);
      const n = this.he(h.next!);
      const p = this.he(h.prev!);
      if (n.prev !== h.id || p.next !== h.id) throw new Error(`Half-edge ${h.id} has inconsistent next/prev`);
      if (n.loop !== h.loop) throw new Error(`Half-edge ${h.id} next is in a different loop`);
      if (n.origin !== t.origin) throw new Error(`Half-edge ${h.id} next does not start at its end`);
    }
    for (const l of this.loops.values()) {
      if (!this.faces.has(l.face)) throw new Error(`Loop ${l.id} references missing face`);
      for (const h of this.loopHalfEdges(l.id)) if (this.he(h).loop !== l.id) throw new Error(`Loop ${l.id} contains foreign half-edge ${h}`);
    }
    for (const f of this.faces.values()) {
      for (const l of [f.outer, ...f.holes]) if (this.loop(l).face !== f.id) throw new Error(`Face ${f.id} loop ${l} points elsewhere`);
    }
  }
}
