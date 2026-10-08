import { describe, expect, it } from 'vitest';
import type { MenuLayout } from '@papp/shared-types';
import { applyMenuLayout, labelOf, materializeLayout } from '../src/shared/modules/applyMenuLayout';
import type { ResolvedMenuGroup, ResolvedMenuLeaf, ResolvedMenuNode } from '../src/shared/modules/buildModuleMenuEntries';

const leaf = (id: string, permission = `${id}.view`): ResolvedMenuLeaf => ({
  type: 'leaf', id, labelKey: `k.${id}`, iconName: undefined, route: `/${id}`, requiredPermission: permission,
});
const group = (id: string, children: ResolvedMenuLeaf[]): ResolvedMenuGroup => ({
  type: 'group', id, labelKey: `k.${id}`, iconName: 'Group', children,
});
const EMPTY: MenuLayout = { groups: [], hidden: [], labels: {} };

const defaults: ResolvedMenuNode[] = [
  group('platform', [leaf('users'), leaf('roles'), leaf('appearance')]),
  group('library', [leaf('books'), leaf('borrowings')]),
  leaf('survey'),
];
const ids = (nodes: ResolvedMenuNode[]) => nodes.map((n) => (n.type === 'leaf' ? n.id : `${n.id}[${n.children.map((c) => c.id).join(',')}]`));

describe('applyMenuLayout', () => {
  it('an empty layout leaves the default menu untouched', () => {
    expect(ids(applyMenuLayout(defaults, EMPTY))).toEqual(['platform[users,roles,appearance]', 'library[books,borrowings]', 'survey']);
  });

  it('custom groups come first, in order; unplaced leaves keep their default place after them', () => {
    const layout: MenuLayout = { ...EMPTY, groups: [{ id: 'daily', itemIds: ['borrowings', 'books'] }] };
    expect(ids(applyMenuLayout(defaults, layout))).toEqual(['daily[borrowings,books]', 'platform[users,roles,appearance]', 'survey']);
  });

  it('ignores ids that no longer exist (uninstalled module) and drops emptied default groups', () => {
    const layout: MenuLayout = { ...EMPTY, groups: [{ id: 'g', itemIds: ['ghost', 'books', 'borrowings'] }] };
    expect(ids(applyMenuLayout(defaults, layout))).toEqual(['g[books,borrowings]', 'platform[users,roles,appearance]', 'survey']);
  });

  it('hides leaves, but never the always-visible appearance page', () => {
    const layout: MenuLayout = { ...EMPTY, hidden: ['users', 'survey', 'appearance'] };
    expect(ids(applyMenuLayout(defaults, layout))).toEqual(['platform[roles,appearance]', 'library[books,borrowings]']);
  });

  it('keeps each leaf permission untouched (the layout can never grant access)', () => {
    const layout: MenuLayout = { ...EMPTY, groups: [{ id: 'g', itemIds: ['users'] }] };
    const moved = applyMenuLayout(defaults, layout)[0] as ResolvedMenuGroup;
    expect(moved.children[0].requiredPermission).toBe('users.view');
  });

  it('a custom group reusing a default group id keeps its translated label and icon', () => {
    const layout: MenuLayout = { ...EMPTY, groups: [{ id: 'library', itemIds: ['books'] }] };
    const g = applyMenuLayout(defaults, layout)[0] as ResolvedMenuGroup;
    expect(g.labelKey).toBe('k.library');
    expect(g.iconName).toBe('Group');
  });

  it('renames per language and falls back to the translation when the language has no override', () => {
    const layout: MenuLayout = { ...EMPTY, labels: { survey: { ar: 'استبيان' } } };
    const survey = applyMenuLayout(defaults, layout).find((n) => n.id === 'survey')!;
    const t = (k: string) => `T(${k})`;
    expect(labelOf(survey, 'ar', t)).toBe('استبيان');
    expect(labelOf(survey, 'en', t)).toBe('T(k.survey)');
  });
});

describe('materializeLayout', () => {
  it('turns the effective menu into explicit groups, collecting top-level leaves, and round-trips', () => {
    const m = materializeLayout(defaults, EMPTY);
    expect(m.groups.map((g) => [g.id, g.itemIds])).toEqual([
      ['platform', ['users', 'roles', 'appearance']],
      ['library', ['books', 'borrowings']],
      ['other', ['survey']],
    ]);
    expect(ids(applyMenuLayout(defaults, m))).toEqual(['platform[users,roles,appearance]', 'library[books,borrowings]', 'other[survey]']);
  });

  it('shows hidden leaves in the editor and preserves the hidden list', () => {
    const m = materializeLayout(defaults, { ...EMPTY, hidden: ['users'] });
    expect(m.groups[0].itemIds).toContain('users');
    expect(m.hidden).toEqual(['users']);
  });
});
