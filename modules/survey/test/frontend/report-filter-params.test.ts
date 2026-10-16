import { describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn(async () => ({ data: [] })));
vi.mock('../../../../apps/web/src/shared/api/httpClient', async (importOriginal) => ({ ...(await importOriginal<object>()), apiClient: { get } }));

import { surveyApi } from '../../frontend/api';

describe('report filter query string', () => {
  it('sends dates and repeated a=<question>:<answer> keys (the form the server reads)', async () => {
    await surveyApi.getSummary('s1', { from: '2026-03-01', to: '2026-03-31', answers: [{ questionId: 'q1', value: 'fic' }, { questionId: 'q2', value: '5' }] });
    const [url, config] = get.mock.calls[0] as unknown as [string, { params: URLSearchParams }];
    expect(url).toBe('/api/survey/surveys/s1/report/summary');
    expect(config.params.toString()).toBe('from=2026-03-01&to=2026-03-31&a=q1%3Afic&a=q2%3A5');
  });
  it('sends nothing when there is no filter, for every report call', async () => {
    get.mockClear();
    await surveyApi.listResponses('s1');
    await surveyApi.getDataset('s1', { answers: [] });
    for (const call of get.mock.calls as unknown as Array<[string, { params: URLSearchParams }]>) expect(call[1].params.toString()).toBe('');
  });
});
