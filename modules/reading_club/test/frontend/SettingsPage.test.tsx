import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import clubEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ getMyEventSubscriptions: vi.fn(), setMyEventSubscriptions: vi.fn() }));
vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), readingClubApi: api }));

import { SettingsPage } from '../../frontend/pages/SettingsPage';

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', clubEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getMyEventSubscriptions.mockResolvedValue({ available: ['stage_completed', 'reward_given', 'group_updated'], subscribed: ['reward_given'] });
  api.setMyEventSubscriptions.mockResolvedValue({ subscribed: [] });
});

describe('Club Settings page — notification subscriptions', () => {
  it('lists every available event with the user\'s current choices ticked', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    const reward = await screen.findByLabelText('A reward is handed to a reader');
    await waitFor(() => expect(reward).toBeChecked());
    expect(screen.getByLabelText('A group is updated')).not.toBeChecked();
  });

  it('saves exactly the ticked events', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByLabelText('A reader completes a stage (reward becomes pending)'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setMyEventSubscriptions).toHaveBeenCalledTimes(1));
    expect([...api.setMyEventSubscriptions.mock.calls[0][0]].sort()).toEqual(['reward_given', 'stage_completed']);
    await screen.findByText('Your subscriptions were saved.');
  });
});
