import type { ModuleManifestMenuEntry } from '@papp/shared-types';
import type { FrontendModuleManifest } from '../api/types';

export interface ResolvedModuleMenuEntry {
  id: string;
  labelKey: string;
  iconName: string | undefined;
  route: string;
  requiredPermission: string;
}

/**
 * Flattens every installed module's own nested `menu[]` (root DECISIONS.md
 * D78) into the sidebar's flat item list — the SAME flattening every
 * module's own manifest-authoring docs already describe as the accepted
 * limitation ("no nested/parent-child menu UI... every item renders as a
 * single flat row", e.g. `modules/website/DOCUMENTATION.md`), just computed
 * generically instead of by hand:
 *
 *  - A parent entry with exactly ONE child collapses to just the PARENT
 *    (its own label/icon/route/permission) — the child is redundant (same
 *    route, same permission, just a longer path to the same one page).
 *  - A parent entry with TWO OR MORE children is a pure grouping node and
 *    is never rendered directly — only its children are, each inheriting
 *    the nearest ancestor's icon when it has none of its own.
 *  - A leaf entry with no children (and no parent, or a parent handled
 *    above) renders directly.
 *
 * This exactly reproduces the pre-D78 hand-written `MENU_ITEMS` array's
 * visible shape for every module built so far (verified module by module —
 * see root DECISIONS.md D78's own entry) with one deliberate, documented
 * cosmetic difference: `library_catalog`'s single item now reads its
 * ROOT's label ("Library") instead of its child's ("Books") — same route,
 * same icon, same permission gate, just a different label key, since a
 * generic rule has to pick one consistent convention for the "single
 * child collapses to its parent" case.
 */
export function buildModuleMenuEntries(manifests: FrontendModuleManifest[]): ResolvedModuleMenuEntry[] {
  const result: ResolvedModuleMenuEntry[] = [];

  for (const manifest of manifests) {
    const entries = manifest.menu;
    const byId = new Map(entries.map((e) => [e.id, e]));
    const childCountByParentId = new Map<string, number>();
    for (const entry of entries) {
      if (entry.parentId) {
        childCountByParentId.set(entry.parentId, (childCountByParentId.get(entry.parentId) ?? 0) + 1);
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

    for (const entry of entries) {
      const ownChildCount = childCountByParentId.get(entry.id) ?? 0;
      if (ownChildCount >= 2) continue; // pure grouping node — only its children render
      if (entry.parentId && childCountByParentId.get(entry.parentId) === 1) continue; // the lone child of a single-child parent — the parent renders instead

      result.push({
        id: entry.id,
        labelKey: entry.labelKey,
        iconName: resolveInheritedIcon(entry),
        route: entry.route,
        requiredPermission: entry.requiredPermission,
      });
    }
  }

  return result;
}
