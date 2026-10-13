import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getMenuLayout: vi.fn() }));
vi.mock('../src/shared/api/appearance', async (importOriginal) => ({ ...(await importOriginal<object>()), appearanceApi: api }));
vi.mock('../src/app/AuthContext', () => ({ useAuth: () => ({ status: 'authenticated' }) }));

import { MenuLayoutProvider, useMenuLayout } from '../src/app/AppearanceContext';

function Probe() {
  const { layout } = useMenuLayout();
  // Mirrors what applyMenuLayout does first — this is the call that used to throw.
  return <span>{`hidden:${layout.hidden.filter(Boolean).length} groups:${layout.groups.length}`}</span>;
}

beforeEach(() => vi.clearAllMocks());

describe('MenuLayoutProvider', () => {
  it('falls back to the default layout when the API returns a malformed body (regression: layout.hidden undefined crashed the sidebar)', async () => {
    api.getMenuLayout.mockResolvedValue('<!doctype html><html></html>');
    render(<MenuLayoutProvider><Probe /></MenuLayoutProvider>);
    await waitFor(() => expect(api.getMenuLayout).toHaveBeenCalled());
    expect(await screen.findByText('hidden:0 groups:0')).toBeInTheDocument();
  });

  it('falls back when the body is an object missing `hidden`', async () => {
    api.getMenuLayout.mockResolvedValue({ groups: [{ id: 'g', itemIds: ['x'] }] });
    render(<MenuLayoutProvider><Probe /></MenuLayoutProvider>);
    await waitFor(() => expect(api.getMenuLayout).toHaveBeenCalled());
    expect(await screen.findByText('hidden:0 groups:0')).toBeInTheDocument();
  });

  it('uses a valid layout as-is', async () => {
    api.getMenuLayout.mockResolvedValue({ groups: [{ id: 'g', itemIds: ['x'] }], hidden: ['y'], labels: {} });
    render(<MenuLayoutProvider><Probe /></MenuLayoutProvider>);
    expect(await screen.findByText('hidden:1 groups:1')).toBeInTheDocument();
  });
});
