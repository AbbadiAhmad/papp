import type { ModuleManifestMenuEntry } from '@papp/shared-types';
import type { FrontendModuleManifest } from '../api/types';

export interface ResolvedMenuLeaf {
  type: 'leaf';
  id: string;
  labelKey: string;
  iconName: string | undefined;
  route: string;
  requiredPermission: string;
  /** Admin rename from the appearance menu layout; wins over `labelKey` when set for the active language. */
  labelOverride?: { ar?: string; en?: string };
}

export interface ResolvedMenuGroup {
  type: 'group';
  id: string;
  labelKey: string;
  iconName: string | undefined;
  children: ResolvedMenuLeaf[];
  labelOverride?: { ar?: string; en?: string };
}

export type ResolvedMenuNode = ResolvedMenuLeaf | ResolvedMenuGroup;

/**
 * Turns each installed module's own nested `menu[]` (root DECISIONS.md D78,
 * restructured by the user's explicit request into real, foldable sidebar
 * groups instead of D78's original full flatten) into sidebar nodes:
 *
 *  - A root entry with ZERO or exactly ONE child renders as a single LEAF
 *    (the root's own label/icon/route/permission if childless, or the
 *    root's label+icon paired with the CHILD's route/permission if it has
 *    one — the child is redundant as its own row, same route either way).
 *  - A root entry with TWO OR MORE children becomes a real GROUP node: a
 *    foldable heading (the root's own label/icon) containing its children
 *    as leaves, each inheriting the nearest ancestor's icon when it has
 *    none of its own. The group itself carries no `requiredPermission` —
 *    `PageLayout.tsx` decides its visibility from whether any child is
 *    currently visible (see `NavGroup`), never a separate check.
 *
 * This exactly reproduces the pre-restructure "1 or 0 children collapses"
 * rule while replacing the old "2+ children silently vanishes the parent"
 * rule with a real, user-visible, collapsible group.
 */
export function buildModuleMenuEntries(manifests: FrontendModuleManifest[]): ResolvedMenuNode[] {
  const result: ResolvedMenuNode[] = [];

  for (const manifest of manifests) {
    const entries = manifest.menu;
    const byId = new Map(entries.map((e) => [e.id, e]));
    const childrenByParentId = new Map<string, ModuleManifestMenuEntry[]>();
    for (const entry of entries) {
      if (entry.parentId) {
        const siblings = childrenByParentId.get(entry.parentId) ?? [];
        siblings.push(entry);
        childrenByParentId.set(entry.parentId, siblings);
      }
    }

    const resolveInheritedIcon = (entry: ModuleManifestMenuEntry): string | undefined => {
      let current: ModuleManifestMenuEntry | undefined = entry;
      while (current) {
        if (current.icon) return current.icon;
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return undefined;
    };

    const toLeaf = (entry: ModuleManifestMenuEntry): ResolvedMenuLeaf => ({
      type: 'leaf',
      id: entry.id,
      labelKey: entry.labelKey,
      iconName: resolveInheritedIcon(entry),
      route: entry.route,
      requiredPermission: entry.requiredPermission,
    });

    for (const entry of entries) {
      if (entry.parentId) continue; // only ever visited as a child of its root, never at the top level itself
      const children = (childrenByParentId.get(entry.id) ?? []).slice().sort((a, b) => a.order - b.order);

      if (children.length === 0) {
        result.push(toLeaf(entry));
      } else if (children.length === 1) {
        result.push(toLeaf(children[0]));
      } else {
        result.push({
          type: 'group',
          id: entry.id,
          labelKey: entry.labelKey,
          iconName: resolveInheritedIcon(entry),
          children: children.map(toLeaf),
        });
      }
    }
  }

  return result;
}
