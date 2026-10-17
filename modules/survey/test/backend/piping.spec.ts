import { describe, expect, it } from '@jest/globals';
import { answerText, escapeMarkup, getOptionsFrom, pipeText, resolveOptions, tokenIds, validatePiping, type PipeQuestion, type PipeSection } from '../../backend/piping';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const opts = [
  { value: 'fic', label: 'Fiction' },
  { value: 'his', label: 'History' },
  { value: 'poe', label: 'Poetry' },
];
const q = (id: string, type: string, extra: Partial<PipeQuestion> = {}): PipeQuestion => ({ id, type, options: type.includes('choice') || type === 'dropdown' ? opts : [], ...extra });
const byId = (...questions: PipeQuestion[]) => new Map(questions.map((x) => [x.id, x]));

describe('tokens and escaping', () => {
  it('finds every referenced question id', () => {
    expect(tokenIds(`Hi {{q:${A}}}, and {{q:${B.toUpperCase()}}}!`)).toEqual([A, B]);
    expect(tokenIds('no tokens {{q:not-an-id}}')).toEqual([]);
    expect(tokenIds(null)).toEqual([]);
  });
  it('escapes every character the text markup treats specially', () => {
    expect(escapeMarkup('a*b_c[d](e){f}$g\\h')).toBe('a\\*b_c\\[d\\](e)\\{f\\}\\$g\\\\h');
  });
});

describe('answerText / pipeText', () => {
  it('uses option labels for choices, joins multiple answers, shows Other text', () => {
    expect(answerText(q(A, 'single_choice'), 'his')).toBe('History');
    expect(answerText(q(A, 'multi_choice'), ['fic', 'poe', '__other__:Comics'])).toBe('Fiction, Poetry, Comics');
    expect(answerText(q(A, 'short_text'), 'Layla')).toBe('Layla');
    expect(answerText(q(A, 'rating'), 4)).toBe('4');
    expect(answerText(q(A, 'short_text'), undefined)).toBe('');
  });
  it('replaces tokens, escaping the answer and showing … when there is none', () => {
    const questions = byId(q(A, 'short_text'), q(B, 'single_choice'));
    const answers: Record<string, unknown> = { [A]: '**evil** [x](https://x.io) {red|y}', [B]: 'fic' };
    expect(pipeText(`Dear {{q:${A}}}`, questions, (id) => answers[id])).toBe('Dear \\*\\*evil\\*\\* \\[x\\](https://x.io) \\{red|y\\}');
    expect(pipeText(`You chose {{q:${B}}}`, questions, (id) => answers[id])).toBe('You chose Fiction');
    expect(pipeText(`Unknown {{q:${C}}} and unanswered {{q:${A}}}`, questions, () => undefined)).toBe('Unknown … and unanswered …');
    expect(pipeText('', questions, () => undefined)).toBe('');
  });
});

describe('resolveOptions (carry-forward)', () => {
  const source = q(A, 'multi_choice');
  const target = (mode: 'selected' | 'unselected') => q(B, 'single_choice', { options: [], config: { optionsFrom: { questionId: A, mode } } });
  it('offers the chosen or the not-chosen options of the source', () => {
    const answers: Record<string, unknown> = { [A]: ['fic', 'poe'] };
    expect(resolveOptions(target('selected'), byId(source, target('selected')), (id) => answers[id])?.map((o) => o.value)).toEqual(['fic', 'poe']);
    expect(resolveOptions(target('unselected'), byId(source, target('unselected')), (id) => answers[id])?.map((o) => o.value)).toEqual(['his']);
  });
  it('never carries "Other", and offers nothing / everything when the source is unanswered', () => {
    const answers: Record<string, unknown> = { [A]: ['__other__:Comics', 'his'] };
    expect(resolveOptions(target('selected'), byId(source, target('selected')), (id) => answers[id])?.map((o) => o.value)).toEqual(['his']);
    expect(resolveOptions(target('selected'), byId(source, target('selected')), () => undefined)).toEqual([]);
    expect(resolveOptions(target('unselected'), byId(source, target('unselected')), () => undefined)?.length).toBe(3);
  });
  it('is null for a question without carry-forward, and tolerates a bad setting', () => {
    expect(resolveOptions(q(B, 'single_choice'), byId(q(B, 'single_choice')), () => undefined)).toBeNull();
    expect(getOptionsFrom({ config: { optionsFrom: { questionId: A, mode: 'sideways' } } })).toBeNull();
    expect(getOptionsFrom({ config: { optionsFrom: 'x' } })).toBeNull();
  });
});

describe('validatePiping', () => {
  const s = (id: string, questions: PipeQuestion[], extra: Partial<PipeSection> = {}): PipeSection => ({ id, title: id, questions, ...extra });
  it('accepts tokens and carry-forward from earlier sections', () => {
    const sections = [
      s('s1', [q(A, 'multi_choice', { title: 'Genres' })]),
      s('s2', [q(B, 'single_choice', { title: `Favourite of {{q:${A}}}`, options: [], config: { optionsFrom: { questionId: A, mode: 'selected' } } })], { description: `You said {{q:${A}}}` }),
    ];
    expect(validatePiping(sections)).toBeNull();
  });
  it('rejects tokens that point at the same or a later section, or at nothing', () => {
    expect(validatePiping([s('s1', [q(A, 'short_text'), q(B, 'short_text', { title: `{{q:${A}}}` })])])).toMatch(/earlier section/);
    expect(validatePiping([s('s1', [q(B, 'short_text', { title: `{{q:${A}}}` })]), s('s2', [q(A, 'short_text')])])).toMatch(/earlier section/);
    expect(validatePiping([s('s1', [q(B, 'short_text', { title: `{{q:${C}}}` })])])).toMatch(/no longer exists/);
    expect(validatePiping([s('s1', [q(A, 'short_text')], { title: `{{q:${A}}}` })])).toMatch(/earlier section/);
  });
  it('rejects bad carry-forward: wrong type, missing / same-section / non-choice source, chains, logic sources', () => {
    const carry = (type: string, from: string) => q(B, type, { title: 'T', options: [], config: { optionsFrom: { questionId: from, mode: 'selected' } } });
    expect(validatePiping([s('s1', [q(A, 'multi_choice')]), s('s2', [carry('short_text', A)])])).toMatch(/only choice questions/);
    expect(validatePiping([s('s1', [q(A, 'multi_choice')]), s('s2', [carry('single_choice', C)])])).toMatch(/no longer exists/);
    expect(validatePiping([s('s1', [q(A, 'multi_choice'), carry('single_choice', A)])])).toMatch(/earlier section/);
    expect(validatePiping([s('s1', [q(A, 'short_text')]), s('s2', [carry('single_choice', A)])])).toMatch(/choice question/);
    const chained = q(A, 'single_choice', { options: [], config: { optionsFrom: { questionId: C, mode: 'selected' } } });
    expect(validatePiping([s('s0', [q(C, 'multi_choice')]), s('s1', [chained]), s('s2', [carry('single_choice', A)])])).toMatch(/cannot come from a question that itself/);
    expect(validatePiping([s('s1', [q(A, 'multi_choice')]), s('s2', [carry('single_choice', A)])], new Set([B]))).toMatch(/show\/hide/);
    expect(validatePiping([s('s1', [q(A, 'multi_choice')]), s('s2', [q(B, 'single_choice', { title: 'T', options: [], config: { optionsFrom: { questionId: A, mode: 'x' } } })])])).toMatch(/not valid/);
  });
});
