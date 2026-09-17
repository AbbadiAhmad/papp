import { describe, expect, it } from 'vitest';
import { buildModuleMenuEntries } from '../src/shared/modules/buildModuleMenuEntries';
import type { FrontendModuleManifest } from '../src/shared/api/types';

function manifest(key: string, menu: FrontendModuleManifest['menu']): FrontendModuleManifest {
  return { key, basePath: `/${key}`, routes: [], menu };
}

describe('shared/modules/buildModuleMenuEntries: generic manifest-driven sidebar flattening', () => {
  it('collapses a parent with exactly one child into a single entry (the parent\'s own label/icon/route)', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'Widgets', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
        { id: 'x.items', labelKey: 'x.menu.items', parentId: 'x.root', order: 1, route: '/x', requiredPermission: 'x.view' },
      ]),
    ]);

    expect(result).toEqual([
      { id: 'x.root', labelKey: 'x.menu.root', iconName: 'Widgets', route: '/x', requiredPermission: 'x.view' },
    ]);
  });

  it('renders a childless root entry directly with its own icon', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'Poll', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
      ]),
    ]);

    expect(result).toEqual([
      { id: 'x.root', labelKey: 'x.menu.root', iconName: 'Poll', route: '/x', requiredPermission: 'x.view' },
    ]);
  });

  it('a parent with 2+ children never renders itself — only the children render, each with its own icon', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'QrCodeScanner', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
        { id: 'x.a', labelKey: 'x.menu.a', icon: 'Dashboard', parentId: 'x.root', order: 0, route: '/x/a', requiredPermission: 'x.a.view' },
        { id: 'x.b', labelKey: 'x.menu.b', icon: 'Paid', parentId: 'x.root', order: 1, route: '/x/b', requiredPermission: 'x.b.view' },
      ]),
    ]);

    expect(result).toEqual([
      { id: 'x.a', labelKey: 'x.menu.a', iconName: 'Dashboard', route: '/x/a', requiredPermission: 'x.a.view' },
      { id: 'x.b', labelKey: 'x.menu.b', iconName: 'Paid', route: '/x/b', requiredPermission: 'x.b.view' },
    ]);
  });

  it('a child with no icon of its own inherits the nearest ancestor icon that has one', () => {
    const result = buildModuleMenuEntries([
      manifest('x', [
        { id: 'x.root', labelKey: 'x.menu.root', icon: 'Public', parentId: null, order: 1, route: '/x', requiredPermission: 'x.view' },
        { id: 'x.a', labelKey: 'x.menu.a', parentId: 'x.root', order: 0, route: '/x/a', requiredPermission: 'x.a.view' },
        { id: 'x.b', labelKey: 'x.menu.b', parentId: 'x.root', order: 1, route: '/x/b', requiredPermission: 'x.b.view' },
      ]),
    ]);

    expect(result.map((r) => r.iconName)).toEqual(['Public', 'Public']);
  });

  it('flattens across multiple modules independently, in the order the modules were given', () => {
    const result = buildModuleMenuEntries([
      manifest('a', [{ id: 'a.root', labelKey: 'a.menu.root', icon: 'Poll', parentId: null, order: 1, route: '/a', requiredPermission: 'a.view' }]),
      manifest('b', [{ id: 'b.root', labelKey: 'b.menu.root', icon: 'Widgets', parentId: null, order: 1, route: '/b', requiredPermission: 'b.view' }]),
    ]);

    expect(result.map((r) => r.id)).toEqual(['a.root', 'b.root']);
  });
});
