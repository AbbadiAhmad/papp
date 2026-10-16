import type { MenuLayout } from '@papp/shared-types';
import type { ResolvedMenuGroup, ResolvedMenuLeaf, ResolvedMenuNode } from './buildModuleMenuEntries';

/** Label for a node in the active language: the admin's override if set, else the translated default. */
export function labelOf(node: { labelKey: string; labelOverride?: { ar?: string; en?: string } }, language: string, t: (key: string) => string): string {
  const override = language === 'ar' ? node.labelOverride?.ar : node.labelOverride?.en;
  return override?.trim() ? override : t(node.labelKey);
}

/** Mirror of `MENU_ALWAYS_VISIBLE_IDS` in shared-types (the web app only imports types from that package; the api enforces the same rule on save). */
const MENU_ALWAYS_VISIBLE_IDS = ['appearance'];

const UNTITLED_GROUP_KEY = 'core.appearance.untitledGroup';

function flattenLeaves(nodes: ResolvedMenuNode[]): ResolvedMenuLeaf[] {
  return nodes.flatMap((node) => (node.type === 'leaf' ? [node] : node.children));
}

function withOverride<T extends { id: string }>(node: T, layout: MenuLayout): T {
  const override = layout.labels[node.id];
  return override && (override.ar || override.en) ? { ...node, labelOverride: override } : node;
}

/**
 * Applies the admin's menu layout (`appearance.menu_layout`) on top of the
 * manifest-derived default nodes. Pure; never grants anything (each leaf's
 * `requiredPermission` still decides visibility at render time).
 *
 *  - A group flagged `direct` has no heading: its leaves are emitted as plain
 *    top-level links at that position (how a page like Home or Survey stays a
 *    direct link instead of being wrapped in a parent).
 *  - `layout.groups` become the leading groups, in order, holding the leaves
 *    named in `itemIds` (ids that no longer exist, e.g. an uninstalled
 *    module, are ignored). A custom group reusing a default group's id keeps
 *    that group's translated label and icon unless it has its own label.
 *  - Every leaf NOT placed by the layout keeps its default place after the
 *    custom groups, so a newly installed module still shows up.
 *  - `layout.hidden` removes leaves (never the always-visible ones).
 *  - `layout.labels` renames groups and leaves per language.
 *
 * An empty layout returns the defaults (with no overrides) unchanged.
 */
export function applyMenuLayout(defaults: ResolvedMenuNode[], layout: MenuLayout): ResolvedMenuNode[] {
  const leaves = flattenLeaves(defaults);
  const leafById = new Map(leaves.map((l) => [l.id, l]));
  const defaultGroupById = new Map(defaults.filter((n): n is ResolvedMenuGroup => n.type === 'group').map((g) => [g.id, g]));
  const hidden = new Set(layout.hidden.filter((id) => !MENU_ALWAYS_VISIBLE_IDS.includes(id)));
  const placed = new Set<string>();

  const result: ResolvedMenuNode[] = [];

  for (const group of layout.groups) {
    const children: ResolvedMenuLeaf[] = [];
    for (const id of group.itemIds) {
      const leaf = leafById.get(id);
      if (!leaf) continue;
      placed.add(id);
      if (!hidden.has(id)) children.push(withOverride(leaf, layout));
    }
    // `other` with no name is the catch-all the old editor invented around top-level links (Home, Survey...): read it as direct links.
    if (group.direct || (group.id === 'other' && !group.label)) {
      result.push(...children);
      continue;
    }
    const base = defaultGroupById.get(group.id);
    const own = group.label && (group.label.ar || group.label.en) ? group.label : undefined;
    const node: ResolvedMenuGroup = {
      type: 'group',
      id: group.id,
      labelKey: base?.labelKey ?? UNTITLED_GROUP_KEY,
      iconName: group.icon ?? base?.iconName,
      children,
      labelOverride: own,
    };
    result.push(withOverride(node, layout));
  }

  for (const node of defaults) {
    if (node.type === 'leaf') {
      if (!placed.has(node.id) && !hidden.has(node.id)) result.push(withOverride(node, layout));
      continue;
    }
    const remaining = node.children.filter((c) => !placed.has(c.id) && !hidden.has(c.id)).map((c) => withOverride(c, layout));
    if (remaining.length > 0) result.push(withOverride({ ...node, children: remaining }, layout));
  }

  return result;
}

/**
 * Turns the current effective menu into an explicit, editable layout: every
 * group (default or custom) materialised as a custom group with its leaf ids.
 * The editor works on this shape and saves it back, so what the admin sees is
 * exactly what gets stored. Top-level leaves are collected into a trailing
 * "other" group only when the editor needs somewhere to show them.
 */
export function materializeLayout(defaults: ResolvedMenuNode[], layout: MenuLayout): MenuLayout {
  const effective = applyMenuLayout(defaults, { ...layout, hidden: [] });
  const groups: MenuLayout['groups'] = [];
  // Consecutive top-level leaves stay top-level: each run becomes a `direct` box at the same position,
  // so saving the editor never wraps a direct link (Home, Survey...) in an invented parent.
  let run: string[] = [];
  const flushRun = () => {
    if (run.length > 0) groups.push({ id: `direct.${run[0]}`.slice(0, 60), direct: true, itemIds: run });
    run = [];
  };
  for (const node of effective) {
    if (node.type === 'leaf') {
      run.push(node.id);
      continue;
    }
    flushRun();
    const label = layout.groups.find((g) => g.id === node.id)?.label;
    groups.push({ id: node.id, label, icon: node.iconName, itemIds: node.children.map((c) => c.id) });
  }
  flushRun();
  return { groups, hidden: layout.hidden, labels: layout.labels };
}

/** A top-level menu entry with the leaves the current user may actually see (never empty). */
export interface NavEntry {
  node: ResolvedMenuNode;
  leaves: ResolvedMenuLeaf[];
}

/**
 * THE rule every shell shares (sidebar, mobile drawer, tabs, header dropdowns, public-page menu):
 * an entry with no permitted page disappears, and a group left with exactly ONE permitted page is
 * a direct link (see `isRealGroup`/`asDirectLeaf`) rather than a one-item parent. Keeping this in
 * one pure function is what makes a theme's shell a presentation choice only.
 */
export function buildNavEntries(nodes: ResolvedMenuNode[], isVisible: (leaf: ResolvedMenuLeaf) => boolean): NavEntry[] {
  return nodes
    .map((node) => ({ node, leaves: (node.type === 'leaf' ? [node] : node.children).filter(isVisible) }))
    .filter((entry) => entry.leaves.length > 0);
}

/** True only for a group that still has 2+ permitted pages; everything else renders as a plain link. */
export function isRealGroup(entry: NavEntry): entry is NavEntry & { node: ResolvedMenuGroup } {
  return entry.node.type === 'group' && entry.leaves.length > 1;
}

/** The single link a non-group entry stands for: a leaf as is, or a one-page group (group label/icon, that page's route). */
export function asDirectLeaf(entry: NavEntry): ResolvedMenuLeaf {
  if (entry.node.type === 'leaf') return entry.node;
  return { ...entry.leaves[0], id: entry.node.id, labelKey: entry.node.labelKey, labelOverride: entry.node.labelOverride, iconName: entry.node.iconName };
}
