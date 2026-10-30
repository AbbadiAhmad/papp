import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import clubEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ createStage: vi.fn(), updateStage: vi.fn(), removeStage: vi.fn(), getGroup: vi.fn(), getDashboardStats: vi.fn() }));
vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), readingClubApi: api }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({ Can: ({ children }: { children: unknown }) => children }));

import { StagesManagerDialog } from '../../frontend/pages/StagesManagerDialog';

const group = { id: 'g1', name: 'Group A', stages: [{ id: 's1', groupId: 'g1', stageOrder: 1, name: 'First', targetType: 'books', targetAmount: 5, rewardDescription: null }] } as never;

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', clubEn, true, true);
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  api.createStage.mockResolvedValue({});
  api.getGroup.mockResolvedValue(group);
});

describe('StagesManagerDialog — add stage form', () => {
  it('numbers can be cleared and retyped, and are sent as whole numbers', async () => {
    render(<StagesManagerDialog open group={group} onClose={vi.fn()} onChanged={vi.fn()} />);
    const order = screen.getByLabelText('Order') as HTMLInputElement;
    expect(order.value).toBe('2'); // the next free position
    fireEvent.change(order, { target: { value: '' } });
    expect(order.value).toBe(''); // not forced back to 0
    fireEvent.change(order, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Second' } });
    fireEvent.change(screen.getByLabelText('Target amount'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Add stage' })).toBeDisabled(); // empty amount blocks saving
    fireEvent.change(screen.getByLabelText('Target amount'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    await waitFor(() => expect(api.createStage).toHaveBeenCalledWith('g1', expect.objectContaining({ stageOrder: 3, name: 'Second', targetAmount: 10, targetType: 'books' })));
  });
});
