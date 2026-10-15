import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';
import { TakeSurveyPage } from '../../frontend/pages/TakeSurveyPage';
import type { FillableSurvey } from '../../frontend/api';

/**
 * Drives the REAL respondent page (rules, hints, "Other", selection limits)
 * with only the network and the auth context replaced. The rules themselves
 * are unit-tested in test/backend/question-rules.spec.ts; this proves the
 * page wires them to the right messages and blocks Next/Submit.
 */

const submitPublic = vi.fn();

vi.mock('../../../../apps/web/src/app/AuthContext', () => ({
  useAuth: () => ({ status: 'anonymous', mustChangePassword: false }),
}));

vi.mock('../../frontend/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../frontend/api')>();
  return {
    ...original,
    surveyApi: {
      ...original.surveyApi,
      getForFillingPublic: vi.fn(),
      submitPublic: (...args: unknown[]) => submitPublic(...args),
    },
  };
});

import { surveyApi } from '../../frontend/api';

function survey(): FillableSurvey {
  const q = (id: string, type: string, title: string, config: Record<string, unknown>, options: string[] = [], required = false) => ({
    id,
    type,
    title,
    description: null,
    required,
    config,
    options: options.map((o) => ({ value: o, label: o.toUpperCase() })),
  });
  return {
    id: 's1',
    title: 'Reader survey',
    description: null,
    allowEditAfterSubmit: false,
    requiresLogin: false,
    sections: [
      {
        id: 'sec-1',
        title: 'About you',
        description: null,
        navigation: {},
        questions: [
          q('q-email', 'short_text', 'Your email', { validation: { kind: 'email' } }),
          q('q-age', 'short_text', 'Your age', { validation: { kind: 'number', integer: true, min: 5, max: 99, message: 'Age must be between 5 and 99' } }),
          q('q-pick', 'multi_choice', 'Pick your genres', { minSelections: 1, maxSelections: 2, exclusiveOptionValue: 'none', allowOther: true }, ['fiction', 'history', 'poetry', 'none']),
          q('q-fav', 'single_choice', 'Favourite section', { allowOther: true, otherLabel: 'Something else' }, ['kids', 'adults']),
          q('q-name', 'short_text', 'Your name', {}, [], true),
        ],
      },
    ],
    logicRules: [],
  } as unknown as FillableSurvey;
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

const textbox = (name: string) => screen.getByRole('textbox', { name });

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  window.localStorage.clear();
  submitPublic.mockReset();
  submitPublic.mockResolvedValue({ responseId: 'r1', editToken: null });
  vi.mocked(surveyApi.getForFillingPublic).mockResolvedValue({ survey: survey(), existingResponse: null });
});

describe('TakeSurveyPage: validation messages', () => {
  it('shows the format message for a bad email once the field loses focus, and clears it when fixed', async () => {
    renderPage();
    const email = await screen.findByRole('textbox', { name: 'Your email' });
    fireEvent.change(email, { target: { value: 'reader@' } });
    expect(screen.queryByText('Enter a valid email address.')).toBeNull(); // not while still typing
    fireEvent.blur(email);
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    fireEvent.change(email, { target: { value: 'reader@example.com' } });
    await waitFor(() => expect(screen.queryByText('Enter a valid email address.')).toBeNull());
  });

  it("shows the owner's custom message instead of the default one", async () => {
    renderPage();
    const age = await screen.findByRole('textbox', { name: 'Your age' });
    fireEvent.change(age, { target: { value: '120' } });
    fireEvent.blur(age);
    expect(await screen.findByText('Age must be between 5 and 99')).toBeInTheDocument();
    expect(screen.queryByText('The value must be at most 99.')).toBeNull();
  });

  it('blocks Submit while an answer is invalid or a required question is empty, and sends nothing', async () => {
    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your email' }), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('This question is required.')).toBeInTheDocument();
    expect(submitPublic).not.toHaveBeenCalled();
  });
});

describe('TakeSurveyPage: selection limits', () => {
  it('shows the range hint, disables the remaining boxes at the maximum, and re-enables them when one is cleared', async () => {
    renderPage();
    expect(await screen.findByText(/Choose 1 to 2\./)).toBeInTheDocument();
    const fiction = screen.getByRole('checkbox', { name: 'FICTION' });
    const history = screen.getByRole('checkbox', { name: 'HISTORY' });
    const poetry = screen.getByRole('checkbox', { name: 'POETRY' });
    fireEvent.click(fiction);
    fireEvent.click(history);
    expect(poetry).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'NONE' })).not.toBeDisabled(); // the exclusive choice is exempt
    fireEvent.click(history);
    expect(poetry).not.toBeDisabled();
  });

  it('an exclusive "none" choice clears the other selections, and choosing another clears it', async () => {
    renderPage();
    const fiction = await screen.findByRole('checkbox', { name: 'FICTION' });
    const none = screen.getByRole('checkbox', { name: 'NONE' });
    fireEvent.click(fiction);
    fireEvent.click(none);
    expect(none).toBeChecked();
    expect(fiction).not.toBeChecked();
    fireEvent.click(fiction);
    expect(none).not.toBeChecked();
    expect(fiction).toBeChecked();
  });
});

describe('TakeSurveyPage: "Other" choice', () => {
  it('shows a text box when Other is chosen, rejects an empty one, and submits the encoded text', async () => {
    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your name' }), { target: { value: 'Layla' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    const other = await screen.findByRole('textbox', { name: 'Something else' });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Type your answer for "Other".')).toBeInTheDocument();
    expect(submitPublic).not.toHaveBeenCalled();

    fireEvent.change(other, { target: { value: 'Comics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitPublic).toHaveBeenCalledTimes(1));
    const payload = submitPublic.mock.calls[0][1] as Array<{ questionId: string; value: unknown }>;
    expect(payload).toContainEqual({ questionId: 'q-fav', value: '__other__:Comics' });
    expect(payload).toContainEqual({ questionId: 'q-name', value: 'Layla' });
  });

  it('a multiple-choice "Other" counts towards the maximum', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'FICTION' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    expect(screen.getByRole('checkbox', { name: 'POETRY' })).toBeDisabled();
  });
});
