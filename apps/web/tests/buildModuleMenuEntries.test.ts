import { describe, expect, it } from 'vitest';
import { buildModuleMenuEntries } from '../src/shared/modules/buildModuleMenuEntries';
import type { FrontendModuleManifest } from '../src/shared/api/types';

function manifest(key: string, menu: FrontendModuleManifest['menu']): FrontendModuleManifest {
  return { key, basePath: `/${key}`, routes: [], menu };
}

describe('shared/modules/buildModuleMenuEntries: manifest-driven sidebar group/leaf resolution', () => {
  it('collapses a parent with exactly one child into a single LEAF (the child\'s own route/permission)', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'Widgets', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
        { id: 'x.items', labelKey: 'x.menu.items', parentId: 'x.root', order: 1, route: '/x', requiredPermission: 'x.view' },
      ]),
    ]);

    expect(result).toEqual([
      { type: 'leaf', id: 'x.items', labelKey: 'x.menu.items', iconName: 'Widgets', route: '/x', requiredPermission: 'x.view' },
    ]);
  });

  it('renders a childless root entry directly as a leaf with its own icon', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'Poll', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
      ]),
    ]);

    expect(result).toEqual([
      { type: 'leaf', id: 'x.root', labelKey: 'x.menu.root', iconName: 'Poll', route: '/x', requiredPermission: 'x.view' },
    ]);
  });

  it('a parent with 2+ children becomes a real GROUP node containing them as leaves, sorted by order', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'QrCodeScanner', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
        { id: 'x.b', labelKey: 'x.menu.b', icon: 'Paid', parentId: 'x.root', order: 1, route: '/x/b', requiredPermission: 'x.b.view' },
        { id: 'x.a', labelKey: 'x.menu.a', icon: 'Dashboard', parentId: 'x.root', order: 0, route: '/x/a', requiredPermission: 'x.a.view' },
      ]),
    ]);

    expect(result).toEqual([
      {
        type: 'group',
        id: 'x.root',
        labelKey: 'x.menu.root',
        iconName: 'QrCodeScanner',
        children: [
          { type: 'leaf', id: 'x.a', labelKey: 'x.menu.a', iconName: 'Dashboard', route: '/x/a', requiredPermission: 'x.a.view' },
          { type: 'leaf', id: 'x.b', labelKey: 'x.menu.b', iconName: 'Paid', route: '/x/b', requiredPermission: 'x.b.view' },
        ],
      },
    ]);
  });

  it('a group child with no icon of its own inherits the nearest ancestor icon that has one', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'Public', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
        { id: 'x.a', labelKey: 'x.menu.a', parentId: 'x.root', order: 0, route: '/x/a', requiredPermission: 'x.a.view' },
        { id: 'x.b', labelKey: 'x.menu.b', parentId: 'x.root', order: 1, route: '/x/b', requiredPermission: 'x.b.view' },
      ]),
    ]);

    expect(result).toHaveLength(1);
    const group = result[0];
    if (group.type !== 'group') throw new Error('expected a group node');
    expect(group.children.map((c) => c.iconName)).toEqual(['Public', 'Public']);
  });

  it('resolves across multiple modules independently, in the order the modules were given', () => {
    const result = buildModuleMenuEntries([
      manifest('a', [{ id: 'a.root', labelKey: 'a.menu.root', icon: 'Poll', parentId: null, order: 1, route: '/a', requiredPermission: 'a.view' }]),
      manifest('b', [{ id: 'b.root', labelKey: 'b.menu.root', icon: 'Widgets', parentId: null, order: 1, route: '/b', requiredPermission: 'b.view' }]),
    ]);

    expect(result.map((r) => r.id)).toEqual(['a.root', 'b.root']);
  });
});
