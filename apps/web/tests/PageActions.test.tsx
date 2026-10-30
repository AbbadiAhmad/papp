import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ phone: false, allowed: new Set<string>(['a.export', 'a.add']) }));
vi.mock('../src/shared/permissions', () => ({ useHasPermission: () => (code: string) => state.allowed.has(code) }));
vi.mock('@mui/material', async (importOriginal) => ({ ...(await importOriginal<object>()), useMediaQuery: () => state.phone }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { PageActions } from '../src/shared/ui/kit';

const onExport = vi.fn();
const onImport = vi.fn();
const onAdd = vi.fn();
const actions = [
  { key: 'export', label: 'Export', onClick: onExport, permission: 'a.export' },
  { key: 'import', label: 'Import', onClick: onImport, permission: 'a.import' },
  { key: 'add', label: 'Add', onClick: onAdd, permission: 'a.add', primary: true },
];
const renderIt = () => render(<MemoryRouter><PageActions actions={actions} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  state.phone = false;
});

describe('PageActions', () => {
  it('desktop: shows a button for every action the user may use, none for the others', () => {
    renderIt();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  });

  it('phone: only the primary action is a button; the rest sit in a menu and still work', () => {
    state.phone = true;
    renderIt();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'core.common.actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: 'Import' })).toBeNull(); // not permitted
  });

  it('phone: no menu button at all when only the primary action is allowed', () => {
    state.phone = true;
    state.allowed = new Set(['a.add']);
    renderIt();
    expect(screen.queryByRole('button', { name: 'core.common.actions' })).toBeNull();
    state.allowed = new Set(['a.export', 'a.add']);
  });
});
