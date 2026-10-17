import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';
import { SurveyRunner } from '../../frontend/components/SurveyRunner';
import type { FillableSurvey } from '../../frontend/api';

const GENRES = '11111111-1111-4111-8111-111111111111';
const FAV = '22222222-2222-4222-8222-222222222222';
const NAME = '33333333-3333-4333-8333-333333333333';

function survey(): FillableSurvey {
  const opts = ['fiction', 'history', 'poetry'].map((v) => ({ value: v, label: v.toUpperCase() }));
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
          { id: NAME, type: 'short_text', title: 'Your name', description: null, required: false, config: {}, options: [] },
          { id: GENRES, type: 'multi_choice', title: 'Pick genres', description: null, required: false, config: {}, options: opts },
        ],
      },
      {
        id: 'sec-2',
        title: `Hello {{q:${NAME}}}`,
        description: `You like {{q:${GENRES}}}.`,
        navigation: {},
        questions: [
          { id: FAV, type: 'single_choice', title: 'Favourite of those', description: null, required: false, config: { optionsFrom: { questionId: GENRES, mode: 'selected' } }, options: [] },
        ],
      },
    ],
    logicRules: [],
  } as unknown as FillableSurvey;
}

function Harness({ onAnswers }: { onAnswers?: (a: Record<string, unknown>) => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  return (
    <MemoryRouter>
      <SurveyRunner
        survey={survey()}
        answers={answers}
        onAnswerChange={(id, value) =>
          setAnswers((prev) => {
            const next = { ...prev, [id]: value };
            onAnswers?.(next);
            return next;
          })
        }
        onSubmit={async () => undefined}
      />
    </MemoryRouter>
  );
}

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

describe('piping and carry-forward on the respondent page', () => {
  it('shows the earlier answer in the next page\'s text and offers only the ticked choices', async () => {
    render(<Harness />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your name' }), { target: { value: 'Layla' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'FICTION' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'POETRY' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/Hello Layla/)).toBeInTheDocument();
    expect(screen.getByText('You like FICTION, POETRY.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'FICTION' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'POETRY' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'HISTORY' })).toBeNull();
  });

  it('a name containing markup is shown as typed, never formatted', async () => {
    const { container } = render(<Harness />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your name' }), { target: { value: '**Bob** [x](https://evil.io)' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'HISTORY' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText(/Hello/);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('a[href="https://evil.io"]')).toBeNull();
    expect(container.textContent).toContain('Hello **Bob** [x](https://evil.io)');
  });

  it('skips the carried question when nothing was ticked, and shows … for unanswered pipes', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/Hello …/)).toBeInTheDocument();
    expect(screen.queryByText('Favourite of those')).toBeNull();
  });

  it('drops a carried answer when the reader goes back and unticks its source', async () => {
    let latest: Record<string, unknown> = {};
    render(<Harness onAnswers={(a) => (latest = a)} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'FICTION' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'POETRY' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'POETRY' }));
    expect(latest[FAV]).toBe('poetry');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'POETRY' })); // untick
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('radio', { name: 'FICTION' });
    await waitFor(() => expect(latest[FAV]).toBeUndefined());
  });
});
