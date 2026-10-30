import type { FaceId, Model } from '../model/Model';

/**
 * Reverse faces (turn them inside out): all at once, so a whole solid or surface can be turned
 * round. Reversing only some faces of a closed solid would make neighbouring faces run the same
 * way along a shared edge, which is refused (the model is left as it was).
 */
export function reverseFaces(model: Model, faces: Iterable<FaceId>): void {
  const rebuilt = [...new Set(faces)]
    .filter((f) => model.faces.has(f))
    .map((f) => {
      const face = model.face(f);
      return { id: f, normal: [-face.normal[0], -face.normal[1], -face.normal[2]] as [number, number, number], material: face.material, rings: model.faceVertexLoops(f).map((r) => [...r].reverse()) };
    });
  for (const r of rebuilt) model.removeFace(r.id);
  const added: FaceId[] = [];
  try {
    for (const r of rebuilt) added.push(model.addFace(r.rings[0], r.rings.slice(1), { normal: r.normal, id: r.id, material: r.material }));
  } catch {
    // Put everything back the way it was.
    for (const f of added) model.removeFace(f);
    for (const r of rebuilt) {
      const back = { normal: [-r.normal[0], -r.normal[1], -r.normal[2]] as [number, number, number], id: r.id, material: r.material };
      const rings = r.rings.map((ring) => [...ring].reverse());
      model.addFace(rings[0], rings.slice(1), back);
    }
    throw new Error('Those faces are part of a closed solid: select all of its faces to reverse it');
  }
}
