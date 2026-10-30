import type { Model } from '../core/model/Model';
import type { Document } from '../doc/Document';
import type { GroupId } from '../doc/Groups';

/** The geometry of a group and of every group inside it. */
export function groupModels(doc: Document, id: GroupId): Model[] {
  return doc.groups.subtree(id).map((g) => g.model);
}

/** The visible groups directly inside the group being edited, each with all of its geometry. */
export function contextGroups(doc: Document): { id: GroupId; models: Model[] }[] {
  return doc.groups
    .children(doc.editing)
    .filter((g) => !g.hidden)
    .map((g) => ({ id: g.id, models: doc.groups.subtree(g.id).filter((x) => !doc.groups.isHidden(x.id)).map((x) => x.model) }));
}
