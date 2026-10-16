import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ getSummary: vi.fn(), getDataset: vi.fn() }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), surveyApi: api }));
// recharts measures its container; jsdom has no layout, so the charts themselves are not under test here (the text lists are).
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return { ...original, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div> };
});

import { ReportFilters } from '../../frontend/components/ReportFilters';
import { optionShares, SurveyReportPage } from '../../frontend/pages/SurveyReportPage';
import type { QuestionSummary } from '../../frontend/api';

const FAV = '11111111-1111-4111-8111-111111111111';
const STARS = '22222222-2222-4222-8222-222222222222';
const questions = (): QuestionSummary[] => [
  { questionId: FAV, title: 'Favourite', type: 'single_choice', totalAnswered: 4, optionCounts: [{ value: 'fic', label: 'Fiction', count: 3 }, { value: 'his', label: 'History', count: 1 }] },
  { questionId: STARS, title: 'Stars', type: 'rating', totalAnswered: 4, numeric: { average: 3.5, min: 2, max: 5, distribution: [{ value: 2, count: 1 }], trend: [{ date: '2026-03-01', average: 4, count: 2 }, { date: '2026-03-04', average: 2, count: 1 }] } },
  { questionId: '33333333-3333-4333-8333-333333333333', title: 'Name', type: 'short_text', totalAnswered: 4, sampleAnswers: ['Ann'] },
];
const summary = (over: Record<string, unknown> = {}) => ({
  surveyId: 's1',
  totalResponses: 4,
  daily: [{ date: '2026-03-01', count: 2 }, { date: '2026-03-02', count: 0 }, { date: '2026-03-03', count: 2 }],
  questions: questions(),
  ...over,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getSummary.mockResolvedValue(summary());
  api.getDataset.mockResolvedValue({ columns: [], rows: [] });
});

describe('optionShares', () => {
  it('turns counts into percentages that add up, and copes with no answers', () => {
    expect(optionShares([{ value: 'a', label: 'A', count: 1 }, { value: 'b', label: 'B', count: 2 }]).map((o) => o.percent)).toEqual([33.3, 66.7]);
    expect(optionShares([{ value: 'a', label: 'A', count: 0 }])[0].percent).toBe(0);
  });
});

describe('ReportFilters', () => {
  it('only offers choice, scale and rating questions, and adds a condition as a removable chip', () => {
    const onChange = vi.fn();
    render(<ReportFilters value={{ answers: [] }} onChange={onChange} questions={questions()} />);
    fireEvent.mouseDown(screen.getByLabelText('Question'));
    const list = within(screen.getByRole('listbox'));
    expect(list.getByText('Favourite')).toBeInTheDocument();
    expect(list.getByText('Stars')).toBeInTheDocument();
    expect(list.queryByText('Name')).toBeNull();
    fireEvent.click(list.getByText('Favourite'));
    fireEvent.mouseDown(screen.getByLabelText('Answer'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('History'));
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(onChange).toHaveBeenCalledWith({ answers: [{ questionId: FAV, value: 'his' }] });
  });

  it('shows active conditions as chips, removes one, and clears everything', () => {
    const onChange = vi.fn();
    const value = { from: '2026-03-01', answers: [{ questionId: FAV, value: 'his' }] };
    const { container } = render(<ReportFilters value={value} onChange={onChange} questions={questions()} />);
    expect(screen.getByText('Favourite: History')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.MuiChip-deleteIcon')!);
    expect(onChange).toHaveBeenCalledWith({ from: '2026-03-01', answers: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(onChange).toHaveBeenLastCalledWith({ answers: [] });
  });

  it('flags an end date before the start date', () => {
    render(<ReportFilters value={{ from: '2026-03-05', to: '2026-03-01', answers: [] }} onChange={vi.fn()} questions={questions()} />);
    expect(screen.getByText('The end date is before the start date.')).toBeInTheDocument();
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/survey/surveys/s1/report']}>
      <Routes>
        <Route path="/survey/surveys/:surveyId/report" element={<SurveyReportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SurveyReportPage', () => {
  it('shows the totals, the per-day trend and a text list of each choice with its share', async () => {
    renderPage();
    expect(await screen.findByText('Responses per day')).toBeInTheDocument();
    const counts = screen.getByRole('list', { name: 'Answer counts' });
    expect(within(counts).getByText(/Fiction: 3 \(75%\)/)).toBeInTheDocument();
    expect(within(counts).getByText(/History: 1 \(25%\)/)).toBeInTheDocument();
    expect(screen.getByText('Average over time')).toBeInTheDocument();
    expect(api.getSummary).toHaveBeenCalledWith('s1', { answers: [] });
  });

  it('offers bars, pie and a share bar for a choice question', async () => {
    renderPage();
    const group = await screen.findByRole('group', { name: 'Chart type' });
    const pie = within(group).getByRole('button', { name: 'Pie' });
    fireEvent.click(pie);
    expect(pie).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'Share bar' }));
    expect(within(group).getByRole('button', { name: 'Share bar' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Bars' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reloads the numbers with the chosen filter, keeping the old ones on screen meanwhile', async () => {
    renderPage();
    await screen.findByText('Responses per day');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } });
    await waitFor(() => expect(api.getSummary).toHaveBeenLastCalledWith('s1', { from: '2026-03-01', answers: [] }));
    expect(api.getDataset).toHaveBeenLastCalledWith('s1', { from: '2026-03-01', answers: [] });
    expect(screen.getByText('Responses per day')).toBeInTheDocument();
  });

  it('does not ask the server for a range that ends before it starts', async () => {
    renderPage();
    await screen.findByText('Responses per day');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-05' } });
    await waitFor(() => expect(api.getSummary).toHaveBeenLastCalledWith('s1', { from: '2026-03-05', answers: [] }));
    api.getSummary.mockClear();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-01' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.getSummary).not.toHaveBeenCalled();
  });
});
