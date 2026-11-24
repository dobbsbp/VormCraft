import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

/** What each geometry's bounds tree was built from, to tell when it is out of date. */
const builtFrom = new WeakMap<THREE.BufferGeometry, { position: unknown; index: unknown; groups: number }>();

/**
 * Give a mesh a fast raycast (hover, picking, snapping): a bounds tree over its triangles, so a ray
 * tests a few of them instead of every one, which made busy models slow to hover over. The tree
 * is built on the first ray and again after the geometry's positions, index or draw groups are
 * replaced (`Viewer.refresh` replaces them on every model change). It is built "indirect", so
 * the triangles keep their order and `faceIndex` still indexes `DisplayData.triangleFaces`.
 */
export function useFastRaycast(mesh: THREE.Mesh): void {
  mesh.raycast = function (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const g = this.geometry;
    const position = g.getAttribute('position');
    if (!position || !g.index || g.index.count === 0) return;
    const built = builtFrom.get(g);
    if (!g.boundsTree || !built || built.position !== position || built.index !== g.index || built.groups !== groupsKey(g)) {
      g.boundsTree = new MeshBVH(g, { indirect: true });
      builtFrom.set(g, { position, index: g.index, groups: groupsKey(g) });
    }
    acceleratedRaycast.call(this, raycaster, intersects);
  };
}

/** A key that changes when the draw groups do (the tree has a root per group). */
function groupsKey(g: THREE.BufferGeometry): number {
  let k = g.groups.length;
  for (const gr of g.groups) k = (k * 31 + gr.start * 7 + gr.count) | 0;
  return k;
}
