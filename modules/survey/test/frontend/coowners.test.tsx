import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ listCoOwners: vi.fn(), addCoOwner: vi.fn(), removeCoOwner: vi.fn() }));
const held = vi.hoisted(() => ({ codes: new Set<string>() }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), surveyApi: api }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({ usePermission: (code: string) => held.codes.has(code) }));

import { Allowed } from '../../frontend/components/Allowed';
import { CoOwnersPanel } from '../../frontend/components/CoOwnersPanel';

const owner = { userId: 'o', name: 'Olga Owner', email: 'o@x.io' };
const lists = (coOwners: Array<{ userId: string; name: string; email: string }>) => ({ owner, coOwners });

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  held.codes = new Set();
  api.listCoOwners.mockResolvedValue(lists([{ userId: 'c1', name: 'Cora', email: 'cora@x.io' }]));
});

describe('CoOwnersPanel', () => {
  it('shows the owner and the co-owners, with add/remove only for someone who can manage', async () => {
    const { unmount } = render(<CoOwnersPanel surveyId="s1" canManage={false} />);
    expect(await screen.findByText(/Olga Owner/)).toBeInTheDocument();
    expect(screen.getByText(/Cora/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email of a user')).toBeNull();
    unmount();
    render(<CoOwnersPanel surveyId="s1" canManage />);
    expect(await screen.findByLabelText('Email of a user')).toBeInTheDocument();
  });

  it('adds a co-owner by email and shows the server\'s refusal in words', async () => {
    api.addCoOwner.mockResolvedValueOnce(lists([{ userId: 'c1', name: 'Cora', email: 'cora@x.io' }, { userId: 'c2', name: 'Dan', email: 'dan@x.io' }]));
    render(<CoOwnersPanel surveyId="s1" canManage />);
    const box = await screen.findByLabelText('Email of a user');
    fireEvent.change(box, { target: { value: 'dan@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add co-owner' }));
    expect(await screen.findByText(/Dan/)).toBeInTheDocument();
    expect(api.addCoOwner).toHaveBeenCalledWith('s1', 'dan@x.io');
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('removes a co-owner with the chip\'s delete control', async () => {
    api.removeCoOwner.mockResolvedValueOnce(lists([]));
    const { container } = render(<CoOwnersPanel surveyId="s1" canManage />);
    await screen.findByText(/Cora/);
    fireEvent.click(container.querySelector('.MuiChip-deleteIcon') as Element);
    await waitFor(() => expect(api.removeCoOwner).toHaveBeenCalledWith('s1', 'c1'));
    expect(await screen.findByText('No co-owners yet.')).toBeInTheDocument();
  });
});

describe('Allowed', () => {
  it('shows its children for the permission OR the per-survey right', () => {
    const { rerender, queryByText } = render(<Allowed permission="p">yes</Allowed>);
    expect(queryByText('yes')).toBeNull();
    rerender(<Allowed permission="p" orSurvey>yes</Allowed>);
    expect(queryByText('yes')).not.toBeNull();
    held.codes = new Set(['p']);
    rerender(<Allowed permission="p">yes</Allowed>);
    expect(queryByText('yes')).not.toBeNull();
  });
});
