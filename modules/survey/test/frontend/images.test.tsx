import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import surveyEn from '../../locales/en.json';
import { ImageField } from '../../frontend/components/ImageField';
import { SurveyRunner } from '../../frontend/components/SurveyRunner';
import { toFillableSurvey } from '../../frontend/previewSurvey';
import type { FillableSurvey } from '../../frontend/api';

/**
 * Pictures on the builder side (upload / describe / remove) and the respondent side (shown with their
 * description as alt text). The server rules are in survey.e2e-spec.ts and media-rules.spec.ts.
 */

const uploadImage = vi.fn();
let failNextUpload: Error | null = null;

vi.mock('../../frontend/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../frontend/api')>();
  return { ...original, surveyApi: {
      ...original.surveyApi,
      uploadImage: async (...args: unknown[]) => {
        if (failNextUpload) {
          const error = failNextUpload;
          failNextUpload = null;
          throw error;
        }
        return uploadImage(...args);
      },
    } };
});

const H = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const Q = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', surveyEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  uploadImage.mockReset();
  failNextUpload = null;
});

const pngFile = (name = 'pic.png', type = 'image/png', size = 10) => new File([new Uint8Array(size)], name, { type });

describe('ImageField (builder)', () => {
  it('uploads a chosen picture and reports it with an empty description to be filled in', async () => {
    uploadImage.mockResolvedValue({ mediaId: H });
    const onChange = vi.fn();
    render(<ImageField surveyId="s1" label="Picture for this question" value={null} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('image-input'), { target: { files: [pngFile()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ mediaId: H, alt: '' }));
    expect(uploadImage).toHaveBeenCalledWith('s1', expect.any(File));
  });

  it('refuses a wrong type or an oversize file without sending anything', async () => {
    const onChange = vi.fn();
    render(<ImageField surveyId="s1" label="Picture" value={null} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('image-input'), { target: { files: [pngFile('x.svg', 'image/svg+xml')] } });
    expect(await screen.findByText('Only PNG, JPEG or WebP pictures are accepted.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('image-input'), { target: { files: [pngFile('big.png', 'image/png', 3 * 1024 * 1024)] } });
    expect(await screen.findByText('This picture is larger than 2 MB. Choose a smaller one.')).toBeInTheDocument();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the picture with its description, lets the owner edit the description, and remove the picture', () => {
    const onChange = vi.fn();
    render(<ImageField surveyId="s1" label="Picture" value={{ mediaId: H, alt: 'Reading room' }} onChange={onChange} />);
    expect(screen.getByRole('img', { name: 'Reading room' })).toHaveAttribute('src', expect.stringContaining(`/api/survey/media/${H}`));
    fireEvent.change(screen.getByRole('textbox', { name: /Describe the picture/ }), { target: { value: 'Quiet room' } });
    expect(onChange).toHaveBeenCalledWith({ mediaId: H, alt: 'Quiet room' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove picture' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('flags a missing description', () => {
    render(<ImageField surveyId="s1" label="Picture" value={{ mediaId: H, alt: '' }} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /Describe the picture/ })).toBeInvalid();
  });

  it('shows the server message when the upload fails', async () => {
    // A plain function, not a spy: this Vitest version reports a rejecting spy's promise as an unhandled error.
    failNextUpload = new Error('A survey can hold at most 100 images');
    render(<ImageField surveyId="s1" label="Picture" value={null} onChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId('image-input'), { target: { files: [pngFile()] } });
    await waitFor(() => expect(document.body.textContent).toContain('A survey can hold at most 100 images'));
  });
});

function survey(): FillableSurvey {
  return {
    id: 's1',
    title: 'Reader survey',
    description: null,
    allowEditAfterSubmit: false,
    requiresLogin: false,
    headerImage: { mediaId: H, alt: 'Library logo' },
    sections: [
      {
        id: 'sec-1',
        title: 'About you',
        description: null,
        navigation: {},
        image: { mediaId: S, alt: 'Reading room' },
        questions: [
          { id: 'q1', type: 'short_text', title: 'Your name', description: null, required: false, config: { image: { mediaId: Q, alt: 'Book cover' } }, options: [] },
          { id: 'q2', type: 'short_text', title: 'Plain question', description: null, required: false, config: {}, options: [] },
        ],
      },
    ],
    logicRules: [],
  } as unknown as FillableSurvey;
}

describe('SurveyRunner (respondent)', () => {
  it('shows the survey, section and question pictures with their descriptions as alt text, loaded lazily', () => {
    render(
      <MemoryRouter>
        <SurveyRunner survey={survey()} answers={{}} onAnswerChange={vi.fn()} onSubmit={vi.fn()} />
      </MemoryRouter>,
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['Library logo', 'Reading room', 'Book cover']);
    for (const img of imgs) expect(img).toHaveAttribute('loading', 'lazy');
    expect(imgs[0]).toHaveAttribute('src', expect.stringContaining(`/api/survey/media/${H}`));
  });

  it('a survey without pictures renders none', () => {
    const plain = survey();
    plain.headerImage = null;
    plain.sections[0].image = null;
    plain.sections[0].questions[0].config = {};
    render(
      <MemoryRouter>
        <SurveyRunner survey={plain} answers={{}} onAnswerChange={vi.fn()} onSubmit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});

describe('preview', () => {
  it('carries the builder pictures into what the preview shows', () => {
    const fillable = toFillableSurvey(
      { id: 's1', title: 'T', settings: { headerImage: { mediaId: H, alt: 'Logo' } } },
      [{ id: 'a', orderIndex: 0, title: 'A', image: { mediaId: S, alt: 'Room' }, questions: [] }],
      [],
    );
    expect(fillable.headerImage).toEqual({ mediaId: H, alt: 'Logo' });
    expect(fillable.sections[0].image).toEqual({ mediaId: S, alt: 'Room' });
  });
});
