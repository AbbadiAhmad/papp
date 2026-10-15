import { AxiosError } from 'axios';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';
import { TakeSurveyPage } from '../../frontend/pages/TakeSurveyPage';
import type { FillableSurvey } from '../../frontend/api';

/** Phase C on the respondent page: not-open / ended / full states, the custom thank-you text, the progress bar. */

const submitPublic = vi.fn();
let authStatus: 'anonymous' | 'authenticated' = 'anonymous';

vi.mock('../../../../apps/web/src/app/AuthContext', () => ({
  useAuth: () => ({ status: authStatus, mustChangePassword: false }),
}));

vi.mock('../../frontend/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../frontend/api')>();
  return {
    ...original,
    surveyApi: {
      ...original.surveyApi,
      getForFillingPublic: vi.fn(),
      getForFilling: vi.fn(),
      submitPublic: (...args: unknown[]) => submitPublic(...args),
    },
  };
});

import { surveyApi } from '../../frontend/api';

function survey(overrides: Partial<FillableSurvey> = {}): FillableSurvey {
  const question = (id: string, title: string) => ({ id, type: 'short_text', title, description: null, required: false, config: {}, options: [] });
  return {
    id: 's1',
    title: 'Reader survey',
    description: null,
    allowEditAfterSubmit: false,
    requiresLogin: false,
    thankYouMessage: null,
    showProgressBar: false,
    isFull: false,
    sections: [
      { id: 'a', title: 'Page one', description: null, navigation: {}, questions: [question('q1', 'First')] },
      { id: 'b', title: 'Page two', description: null, navigation: {}, questions: [question('q2', 'Second')] },
    ],
    logicRules: [],
    ...overrides,
  } as unknown as FillableSurvey;
}

function notFound(data: Record<string, unknown>) {
  return new AxiosError('Not found', '404', undefined, undefined, { status: 404, statusText: 'Not Found', data, headers: {}, config: {} as never });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/survey/s1']}>
      <Routes>
        <Route path="/survey/:surveyId" element={<TakeSurveyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  window.localStorage.clear();
  authStatus = 'anonymous';
  submitPublic.mockReset();
  submitPublic.mockResolvedValue({ responseId: 'r1', editToken: null });
  vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey(), existingResponse: null });
});

describe('unavailable surveys', () => {
  it('says when a survey opens, in the reader\'s language and with the date', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockRejectedValue(notFound({ notOpenYet: true, opensAt: '2030-03-05T10:00:00.000Z' }));
    renderPage();
    expect(await screen.findByText(/This survey opens on .*2030/)).toBeInTheDocument();
  });

  it('falls back to a plain "not open yet" without a date', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockRejectedValue(notFound({ notOpenYet: true, opensAt: null }));
    renderPage();
    expect(await screen.findByText('This survey is not open yet.')).toBeInTheDocument();
  });

  it('shows the owner\'s message for an ended or closed survey', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockRejectedValue(notFound({ closed: true, ended: true, closedMessage: 'We have what we need, thanks!' }));
    renderPage();
    expect(await screen.findByText('We have what we need, thanks!')).toBeInTheDocument();
  });

  it('shows "full" up front when the cap is reached, instead of the form', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey({ isFull: true }), existingResponse: null });
    renderPage();
    expect(await screen.findByText('This survey has reached its maximum number of responses.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });

  it('still opens a full survey for someone who already has a response of their own to edit', async () => {
    authStatus = 'authenticated';
    vi.mocked(surveyApi.getForFilling).mockResolvedValue({ survey: survey({ isFull: true }), existingResponse: { id: 'r0', answers: [{ questionId: 'q1', value: 'mine' }] } });
    renderPage();
    expect(await screen.findByDisplayValue('mine')).toBeInTheDocument();
  });

  it('switches to the "full" message if the last place was taken while the reader filled the form', async () => {
    submitPublic.mockRejectedValue(
      new AxiosError('Conflict', '409', undefined, undefined, { status: 409, statusText: 'Conflict', data: { full: true }, headers: {}, config: {} as never }),
    );
    vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey({ sections: [survey().sections[0]] }), existingResponse: null });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('This survey has reached its maximum number of responses.')).toBeInTheDocument();
  });
});

describe('finishing', () => {
  it('shows the owner\'s thank-you text after submitting, keeping its line breaks', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({
      survey: survey({ thankYouMessage: 'Thank you!\nSee you at the library.', sections: [survey().sections[0]] }),
      existingResponse: null,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    const message = await screen.findByText(/See you at the library/);
    expect(message.textContent).toBe('Thank you!\nSee you at the library.');
    expect(screen.queryByText(/your response has been recorded|تم تسجيل/i)).toBeNull();
  });

  it('uses the default thank-you text when none is set', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey({ sections: [survey().sections[0]] }), existingResponse: null });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitPublic).toHaveBeenCalled());
    expect(await screen.findByText(surveyEn['survey.take.thank_you'])).toBeInTheDocument();
  });

  it('shows a progress bar only when enabled and the survey has several sections', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey({ showProgressBar: true }), existingResponse: null });
    const { unmount } = renderPage();
    const bar = await screen.findByRole('progressbar', { name: 'Survey progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Survey progress' })).toHaveAttribute('aria-valuenow', '100'));
    unmount();

    vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey({ showProgressBar: false }), existingResponse: null });
    renderPage();
    await screen.findByText('Page one');
    expect(screen.queryByRole('progressbar', { name: 'Survey progress' })).toBeNull();
  });

  it('shows no progress bar on a one-section survey even when enabled', async () => {
    vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey({ showProgressBar: true, sections: [survey().sections[0]] }), existingResponse: null });
    renderPage();
    await screen.findByText('First');
    expect(screen.queryByRole('progressbar', { name: 'Survey progress' })).toBeNull();
  });
});
