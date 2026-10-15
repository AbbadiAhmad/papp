import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import coreEn from '../../../../apps/api/src/core/i18n/locales/en.json';
import surveyEn from '../../locales/en.json';
import { SurveyBuilderPage } from '../../frontend/pages/SurveyBuilderPage';
import type { SurveyDetail } from '../../frontend/api';

vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  useGatedCall: () => async (_code: string, fn: () => Promise<unknown>) => fn(),
}));

const replaceStructure = vi.fn();
const update = vi.fn();
const submitPublic = vi.fn();

vi.mock('../../frontend/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../frontend/api')>();
  return {
    ...original,
    surveyApi: {
      ...original.surveyApi,
      get: vi.fn(),
      update: (...args: unknown[]) => update(...args),
      replaceStructure: (...args: unknown[]) => replaceStructure(...args),
      submitPublic: (...args: unknown[]) => submitPublic(...args),
    },
  };
});

import { surveyApi } from '../../frontend/api';

function detail(overrides: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 'sv-1',
    title: 'Reader survey',
    description: null,
    status: 'draft',
    archivedAt: null,
    requiresLogin: false,
    responseCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ownerUserId: 'u1',
    allowEditAfterSubmit: false,
    oneResponsePerRespondent: true,
    notifyOwnerOnSubmit: true,
    notifyEmails: [],
    opensAt: null,
    closesAt: null,
    closedMessage: null,
    sections: [
      {
        id: 'sec-1',
        orderIndex: 0,
        title: 'Intro',
        questions: [
          { id: 'q1', orderIndex: 0, type: 'short_text', title: 'Your name', required: true },
          {
            id: 'q2',
            orderIndex: 1,
            type: 'single_choice',
            title: 'Colour',
            options: [
              { id: 'o1', orderIndex: 0, value: 'red', label: 'Red' },
              { id: 'o2', orderIndex: 1, value: 'blue', label: 'Blue' },
            ],
          },
        ],
      },
      { id: 'sec-2', orderIndex: 1, title: 'More', questions: [{ id: 'q3', orderIndex: 0, type: 'short_text', title: 'Other thing' }] },
    ],
    logicRules: [],
    ...overrides,
  } as SurveyDetail;
}

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/survey/surveys/sv-1/edit']}>
      <Routes>
        <Route path="/survey/surveys/:surveyId/edit" element={<SurveyBuilderPage />} />
        <Route path="/survey/surveys" element={<div>SURVEY LIST PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const questionTitles = () => screen.getAllByLabelText(/^Question title/).map((el) => (el as HTMLInputElement).value);

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', { ...coreEn, ...surveyEn }, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  update.mockReset();
  replaceStructure.mockReset();
  submitPublic.mockReset();
  vi.mocked(surveyApi.get).mockResolvedValue(detail());
});

afterEach(() => vi.restoreAllMocks());

describe('SurveyBuilderPage: building faster', () => {
  it('duplicates a question right after the original, with a "(copy)" title and its own options', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    expect(questionTitles()).toEqual(['Your name', 'Colour', 'Other thing']);

    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate question' })[1]); // the "Colour" question
    expect(questionTitles()).toEqual(['Your name', 'Colour', 'Colour (copy)', 'Other thing']);
    // the copy carries its own two options (3 option-value boxes for Colour + copy would be 4 in total)
    expect(screen.getAllByLabelText('Option value')).toHaveLength(4);
  });

  it('duplicates a whole section with its questions', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate section' })[0]);
    expect(screen.getAllByLabelText(/^Section title/).map((el) => (el as HTMLInputElement).value)).toEqual(['Intro', 'Intro (copy)', 'More']);
    expect(questionTitles()).toEqual(['Your name', 'Colour', 'Your name', 'Colour', 'Other thing']);
  });

  it('moves a question to the end of another section', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.click(screen.getAllByRole('button', { name: 'Move to another section' })[0]); // "Your name"
    fireEvent.click(await screen.findByRole('menuitem', { name: 'More' }));
    expect(questionTitles()).toEqual(['Colour', 'Other thing', 'Your name']);
  });

  it('drops a rule that would make a moved question show or hide the section it now lives in', async () => {
    vi.mocked(surveyApi.get).mockResolvedValue(
      detail({ logicRules: [{ sourceQuestionId: 'q2', sourceOptionValue: 'red', action: 'show', targetType: 'section', targetId: 'sec-2', orderIndex: 0 }] }),
    );
    replaceStructure.mockImplementation(async (_id: string, payload: { sections: unknown; logicRules: unknown[] }) => ({ ...detail(), ...payload }));
    update.mockResolvedValue(undefined);
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.click(screen.getAllByRole('button', { name: 'Move to another section' })[1]); // "Colour" -> section "More"
    fireEvent.click(await screen.findByRole('menuitem', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(replaceStructure).toHaveBeenCalled());
    expect(replaceStructure.mock.calls[0][1].logicRules).toEqual([]);
  });
});

describe('SurveyBuilderPage: unsaved changes', () => {
  it('shows a badge only after an edit and hides it again after saving', async () => {
    replaceStructure.mockImplementation(async (_id: string, payload: { sections: unknown; logicRules: unknown[] }) => ({ ...detail({ title: 'Reader survey v2' }), ...payload }));
    update.mockResolvedValue(undefined);
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Reader survey v2' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('asks before the Back button leaves with unsaved edits, and stays when declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave without saving?');
    expect(screen.queryByText('SURVEY LIST PAGE')).toBeNull();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('SURVEY LIST PAGE')).toBeInTheDocument();
  });

  it('leaves at once when nothing changed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('SURVEY LIST PAGE')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('SurveyBuilderPage: preview and share', () => {
  it('previews the on-screen (unsaved) survey as a reader, and submitting sends nothing', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.change(screen.getAllByLabelText(/^Question title/)[0], { target: { value: 'Your full name' } }); // unsaved edit
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Preview only/)).toBeInTheDocument();
    expect(within(dialog).getByText('Reader survey')).toBeInTheDocument();
    expect(within(dialog).getByText(/Your full name/)).toBeInTheDocument(); // the unsaved title, not the saved one

    // required "Your full name" must be answered like a real reader, then Next -> second page -> Submit
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('This question is required.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your full name' }), { target: { value: 'Layla' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Submit' }));

    expect(await within(dialog).findByText('Preview finished. Nothing was sent.')).toBeInTheDocument();
    expect(submitPublic).not.toHaveBeenCalled();
    expect(replaceStructure).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('explains what to fix instead of opening a preview of an incomplete survey', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.change(screen.getAllByLabelText(/^Question title/)[2], { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Every question needs a title.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the share panel for this survey and warns while it is still a draft', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Intro');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Link for readers') as HTMLInputElement).value).toBe(`${window.location.origin}/survey/sv-1`);
    expect(within(dialog).getByText(/not published yet/)).toBeInTheDocument();
  });
});
