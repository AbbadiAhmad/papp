import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';

const api = vi.hoisted(() => ({
  getAudience: vi.fn(),
  addAllowedUser: vi.fn(),
  removeAllowedUser: vi.fn(),
  invite: vi.fn(),
  remind: vi.fn(),
  removeInvitation: vi.fn(),
  getForFilling: vi.fn(),
  getForFillingPublic: vi.fn(),
  submitPublic: vi.fn(),
  submitAuthenticated: vi.fn(),
}));
const auth = vi.hoisted(() => ({ status: 'anonymous' as string }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), surveyApi: api }));
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));
vi.mock('../../../../apps/web/src/app/AuthContext', () => ({ useAuth: () => ({ status: auth.status, mustChangePassword: false }) }));

import { AudiencePanel } from '../../frontend/components/AudiencePanel';
import { TakeSurveyPage } from '../../frontend/pages/TakeSurveyPage';

const audience = (over: Record<string, unknown> = {}) => ({
  restricted: true,
  allowedUsers: [{ userId: 'u1', name: 'Uma', email: 'uma@x.io' }],
  invitations: [
    { id: 'i1', email: 'old@x.io', status: 'invited', invitedAt: '2026-01-01T00:00:00Z', openedAt: null, respondedAt: null, lastReminderAt: null, reminderCount: 0 },
    { id: 'i2', email: 'done@x.io', status: 'responded', invitedAt: '2026-01-01T00:00:00Z', openedAt: null, respondedAt: '2026-01-02T00:00:00Z', lastReminderAt: null, reminderCount: 1 },
  ],
  ...over,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.status = 'anonymous';
  api.getAudience.mockResolvedValue(audience());
});

const panel = (over: Partial<Parameters<typeof AudiencePanel>[0]> = {}) => (
  <AudiencePanel surveyId="s1" published restricted emailCopy={false} onSettingsChange={vi.fn()} {...over} />
);

describe('AudiencePanel', () => {
  it('turns pasted addresses into checked cards and counts what will be sent', async () => {
    render(panel());
    await screen.findByText('Uma · uma@x.io');
    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'New@x.io, bad, new@x.io; old@x.io, two@x.io' } });
    expect(screen.getByText('new@x.io')).toBeInTheDocument();
    expect(screen.getByText('two@x.io')).toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument(); // flagged card
    expect(screen.getByText('2 to invite · 1 not valid · 1 repeated · 1 already invited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send 2 invitation(s)' })).toBeEnabled();
  });

  it('sends only the new valid addresses and keeps the invalid ones in the box', async () => {
    api.invite.mockResolvedValue({ invited: 2, alreadyInvited: 0, invalid: ['bad'], sent: 2, failed: 0 });
    render(panel());
    await screen.findByText('Uma · uma@x.io');
    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'a@x.io, bad, old@x.io, b@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 invitation(s)' }));
    await waitFor(() => expect(api.invite).toHaveBeenCalledWith('s1', ['a@x.io', 'b@x.io']));
    expect(await screen.findByText('2 invitation(s) sent, 0 could not be sent.')).toBeInTheDocument();
    expect((screen.getByLabelText('Email addresses') as HTMLTextAreaElement).value).toBe('bad');
  });

  it('removing a green card removes the address from the box', async () => {
    const { container } = render(panel());
    await screen.findByText('Uma · uma@x.io');
    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'a@x.io, b@x.io' } });
    const chip = screen.getByText('a@x.io').closest('.MuiChip-root')!;
    fireEvent.click(chip.querySelector('.MuiChip-deleteIcon')!);
    expect((screen.getByLabelText('Email addresses') as HTMLTextAreaElement).value).toBe('b@x.io');
    expect(container).toBeTruthy();
  });

  it('cannot send until the survey is published, and says why', async () => {
    render(panel({ published: false }));
    await screen.findByText('Uma · uma@x.io');
    expect(screen.getByText(/Publish the survey first/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email addresses'), { target: { value: 'a@x.io' } });
    expect(screen.getByRole('button', { name: 'Send 1 invitation(s)' })).toBeDisabled();
  });

  it('lists invitations with their status and reminds only those who have not answered', async () => {
    api.remind.mockResolvedValue({ reminded: 1, failed: 0, skipped: 0 });
    render(panel());
    expect(await screen.findByText('old@x.io')).toBeInTheDocument();
    expect(screen.getByText('Invited', { selector: '.MuiChip-label' })).toBeInTheDocument();
    expect(screen.getByText('Answered', { selector: '.MuiChip-label' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remind 1 who have not answered' }));
    await waitFor(() => expect(api.remind).toHaveBeenCalledWith('s1'));
  });

  it('the switches are survey settings; the lists only show when the survey is restricted', async () => {
    const onSettingsChange = vi.fn();
    const { rerender } = render(panel({ restricted: false, onSettingsChange }));
    expect(screen.queryByLabelText('Email addresses')).toBeNull();
    fireEvent.click(screen.getByLabelText('Only chosen people may respond'));
    expect(onSettingsChange).toHaveBeenCalledWith({ restricted: true });
    fireEvent.click(screen.getByLabelText('Email each respondent a copy of their answers'));
    expect(onSettingsChange).toHaveBeenCalledWith({ emailCopy: true });
    rerender(panel({ restricted: true, onSettingsChange }));
    expect(await screen.findByLabelText('Email addresses')).toBeInTheDocument();
  });
});

function renderTake(path = '/survey/s1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/survey/:surveyId" element={<TakeSurveyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const fillable = (extra: Record<string, unknown> = {}) => ({
  survey: {
    id: 's1',
    title: 'Reader survey',
    description: null,
    allowEditAfterSubmit: false,
    requiresLogin: false,
    sections: [{ id: 'sec', title: 'S', description: null, navigation: {}, questions: [{ id: 'q1', type: 'short_text', title: 'Name', description: null, required: false, config: {}, options: [] }] }],
    logicRules: [],
    ...extra,
  },
  existingResponse: null,
});

describe('TakeSurveyPage: restricted surveys, invitation links and emailed copies', () => {
  it('passes the invitation token from the link to the server', async () => {
    api.getForFillingPublic.mockResolvedValue(fillable());
    api.submitPublic.mockResolvedValue({ responseId: 'r', editToken: null });
    renderTake('/survey/s1?invite=TOKEN.SIG');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Ann' } });
    expect(api.getForFillingPublic).toHaveBeenCalledWith('s1', 'TOKEN.SIG');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.submitPublic).toHaveBeenCalled());
    expect(api.submitPublic.mock.calls[0][2]).toMatchObject({ invite: 'TOKEN.SIG' });
  });

  it('says "by invitation only" (not "please log in") when the server refuses a restricted survey', async () => {
    api.getForFillingPublic.mockImplementation(() => Promise.reject(Object.assign(new Error('403'), { isAxiosError: true, response: { status: 403, data: { restricted: true } } })));
    renderTake();
    expect(await screen.findByText(/by invitation only/)).toBeInTheDocument();
    expect(screen.queryByText(/log in/i, { selector: '[role="alert"]' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to login' })).toBeInTheDocument();
  });

  it('offers a copy by email to an anonymous respondent only, checks the address, and sends it along', async () => {
    api.getForFillingPublic.mockResolvedValue(fillable({ emailCopy: true }));
    api.submitPublic.mockResolvedValue({ responseId: 'r', editToken: null });
    renderTake();
    const box = await screen.findByLabelText('Email me a copy of my answers (optional)');
    fireEvent.change(box, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Enter a valid email address for your copy, or leave it empty.')).toBeInTheDocument();
    expect(api.submitPublic).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'me@x.io' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.submitPublic).toHaveBeenCalled());
    expect(api.submitPublic.mock.calls[0][2]).toMatchObject({ copyToEmail: 'me@x.io' });
  });

  it('a person with an invitation link is told the copy goes to the invited address, with no box to type in', async () => {
    api.getForFillingPublic.mockResolvedValue(fillable({ emailCopy: true }));
    renderTake('/survey/s1?invite=T.S');
    expect(await screen.findByText('A copy of your answers will be emailed to you after you submit.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email me a copy of my answers (optional)')).toBeNull();
  });
});
