import { BadRequestException } from '@nestjs/common';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AppearanceController } from '../../src/core/appearance/appearance.controller';
import { ThemesService } from '../../src/core/appearance/themes.service';

const PALETTE = {
  primary: '#3b78d8', primaryContrast: '#ffffff', secondary: '#c2701f', background: '#eef4fc', surface: '#ffffff',
  text: '#16284a', textMuted: '#5d6f8f', border: '#dbe5f3', hero: '#dcebfb', headerBg: '#27559f', headerText: '#ffffff',
  success: '#1f7a3f', warning: '#8a5a00', error: '#a3262a', info: '#2459a8',
};
const pack = (key: string, extra: Record<string, unknown> = {}) => ({
  key, version: '1.0.0', name: { ar: 'س', en: 'S' }, shell: 'tabs', radius: 12,
  fonts: { ar: 'Cairo, sans-serif', en: 'Nunito, sans-serif' }, light: PALETTE, ...extra,
});

describe('ThemesService + AppearanceController', () => {
  let dir: string;
  const settingsStore = new Map<string, unknown>();
  const settings = {
    get: jest.fn(async (k: string) => settingsStore.get(k)),
    set: jest.fn(async (k: string, v: unknown, _by?: string) => void settingsStore.set(k, v)),
  };
  const user = { userId: 'u1' } as never;
  let controller: AppearanceController;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'themes-'));
    process.env.THEMES_DIR = dir;
    settingsStore.clear();
    settingsStore.set('appearance.active_theme', 'default');
    settingsStore.set('appearance.menu_layout', { groups: [], hidden: [], labels: {} });
    settings.set.mockClear();
    controller = new AppearanceController(settings as never, new ThemesService());
  });
  afterEach(async () => {
    delete process.env.THEMES_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  async function install(folder: string, content: unknown) {
    await mkdir(join(dir, folder));
    await writeFile(join(dir, folder, 'theme.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }

  it('lists valid packs and skips invalid JSON, bad colors and key/folder mismatches', async () => {
    await install('good_one', pack('good_one'));
    await install('bad_json', '{ nope');
    await install('bad_color', pack('bad_color', { light: { ...PALETTE, primary: 'blue' } }));
    await install('wrong_dir', pack('other_key'));
    const { themes } = await controller.listThemes();
    expect(themes.map((t) => t.key)).toEqual(['good_one']);
  });

  it('a missing themes directory means zero themes, not an error', async () => {
    process.env.THEMES_DIR = join(dir, 'does-not-exist');
    await expect(controller.listThemes()).resolves.toEqual({ activeKey: 'default', themes: [] });
  });

  it('setActiveTheme persists an installed pack through SettingsService (audited there) and "default"', async () => {
    await install('good_one', pack('good_one'));
    await controller.setActiveTheme({ key: 'good_one' }, user);
    expect(settings.set).toHaveBeenCalledWith('appearance.active_theme', 'good_one', 'u1');
    await controller.setActiveTheme({ key: 'default' }, user);
    expect(settings.set).toHaveBeenLastCalledWith('appearance.active_theme', 'default', 'u1');
  });

  it('setActiveTheme rejects unknown keys and path-traversal attempts', async () => {
    await expect(controller.setActiveTheme({ key: 'ghost' }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.setActiveTheme({ key: '../etc' }, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('getActive falls back to the built-in look when the active pack was removed from disk', async () => {
    settingsStore.set('appearance.active_theme', 'removed_pack');
    await expect(controller.getActive()).resolves.toEqual({ key: 'default', theme: null });
    await install('removed_pack', pack('removed_pack'));
    expect((await controller.getActive()).theme?.key).toBe('removed_pack');
  });

  it('setMenuLayout accepts a valid layout', async () => {
    const layout = { groups: [{ id: 'g1', itemIds: ['users', 'roles'] }], hidden: ['audit'], labels: { users: { ar: 'س' } } };
    await expect(controller.setMenuLayout(layout, user)).resolves.toEqual(layout);
    expect(settings.set).toHaveBeenCalledWith('appearance.menu_layout', layout, 'u1');
  });

  it.each([
    ['hiding the appearance page (lock-out)', { groups: [], hidden: ['appearance'], labels: {} }],
    ['an entry in two groups', { groups: [{ id: 'a', itemIds: ['x'] }, { id: 'b', itemIds: ['x'] }], hidden: [], labels: {} }],
    ['duplicate group ids', { groups: [{ id: 'a', itemIds: [] }, { id: 'a', itemIds: [] }], hidden: [], labels: {} }],
    ['a malformed body', { groups: 'nope' }],
  ])('setMenuLayout rejects %s', async (_name, body) => {
    await expect(controller.setMenuLayout(body, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('getMenuLayout returns the default order if the stored row is corrupt', async () => {
    settingsStore.set('appearance.menu_layout', { garbage: true });
    await expect(controller.getMenuLayout()).resolves.toEqual({ groups: [], hidden: [], labels: {} });
  });

  it('serves only the header picture a valid pack declares, never an arbitrary file', async () => {
    await install('pic_pack', pack('pic_pack', { headerImage: 'header.svg' }));
    await writeFile(join(dir, 'pic_pack', 'header.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(dir, 'pic_pack', 'secret.txt'), 'nope');
    const themes = new ThemesService();
    const ok = await themes.readHeaderImage('pic_pack', 'header.svg');
    expect(ok?.contentType).toBe('image/svg+xml');
    expect(ok?.data.toString()).toContain('<svg');
    await expect(themes.readHeaderImage('pic_pack', 'secret.txt')).resolves.toBeNull(); // not the declared file
    await expect(themes.readHeaderImage('pic_pack', '../theme.json')).resolves.toBeNull();
    await expect(themes.readHeaderImage('../pic_pack', 'header.svg')).resolves.toBeNull();
    await expect(themes.readHeaderImage('good_one', 'header.svg')).resolves.toBeNull(); // unknown pack
  });

  it('rejects a pack whose headerImage is a path or URL instead of a plain file name', async () => {
    await install('bad_pic', pack('bad_pic', { headerImage: '../../etc/passwd' }));
    await install('url_pic', pack('url_pic', { headerImage: 'https://evil.example/x.png' }));
    const { themes } = await controller.listThemes();
    expect(themes).toEqual([]);
  });

  it('rejects a playful flag that is not a boolean', async () => {
    await install('bad_flag', pack('bad_flag', { playful: 'yes' }));
    await install('ok_flag', pack('ok_flag', { playful: true }));
    const { themes } = await controller.listThemes();
    expect(themes.map((t) => t.key)).toEqual(['ok_flag']);
  });
});
