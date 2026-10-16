import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyAr from '../../locales/ar.json';
import surveyEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ getAudience: vi.fn(), getSummary: vi.fn(), getDataset: vi.fn() }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), surveyApi: api }));
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'ar', direction: 'rtl' }) }));
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return { ...original, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

import { AudiencePanel } from '../../frontend/components/AudiencePanel';
import { SurveyReportPage } from '../../frontend/pages/SurveyReportPage';

/**
 * docs/TESTING_STRATEGY.md §5 / root D6-D7 for the second-batch screens: in the Arabic (RTL) UI the text is Arabic but
 * every number and date is still Western digits (0-9) on the Gregorian calendar.
 */
const ARABIC_INDIC = /[٠-٩۰-۹]/;

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  i18n.addResourceBundle('ar', 'translation', surveyAr, true, true);
  await i18n.changeLanguage('ar');
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getAudience.mockResolvedValue({
    restricted: true,
    allowedUsers: [],
    invitations: [{ id: 'i1', email: 'a@x.io', status: 'invited', invitedAt: '2026-03-05T10:30:00Z', openedAt: null, respondedAt: null, lastReminderAt: null, reminderCount: 12 }],
  });
  api.getSummary.mockResolvedValue({
    surveyId: 's1',
    totalResponses: 1234,
    daily: [{ date: '2026-03-01', count: 2 }, { date: '2026-03-02', count: 3 }],
    questions: [{ questionId: '11111111-1111-4111-8111-111111111111', title: 'سؤال', type: 'single_choice', totalAnswered: 1234, optionCounts: [{ value: 'a', label: 'أ', count: 1000 }, { value: 'b', label: 'ب', count: 234 }] }],
  });
  api.getDataset.mockResolvedValue({ columns: [], rows: [] });
});

describe('Arabic UI of the second-batch screens', () => {
  it('audience panel: Arabic labels, invitation date and counters in Western digits', async () => {
    const { container } = render(<AudiencePanel surveyId="s1" published restricted emailCopy={false} onSettingsChange={vi.fn()} />);
    expect(await screen.findByText('a@x.io')).toBeInTheDocument();
    expect(screen.getByText('من يستطيع الإجابة')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/12/);
    expect(text).not.toMatch(ARABIC_INDIC);
  });

  it('report: Arabic captions, counts and percentages in Western digits', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/survey/surveys/s1/report']}>
        <Routes>
          <Route path="/survey/surveys/:surveyId/report" element={<SurveyReportPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('الردود في كل يوم')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).toContain('أ: 1000 (81%)');
    expect(text).not.toMatch(ARABIC_INDIC);
  });
});
