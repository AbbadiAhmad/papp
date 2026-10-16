import FilterAltIcon from '@mui/icons-material/FilterAlt';
import { Box, Button, Chip, MenuItem, Stack, TextField } from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FILTERABLE_TYPES, MAX_ANSWER_FILTERS } from '../../backend/report-filter.ts';
import type { QuestionSummary, ReportFilterState } from '../api';

interface Props {
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
  /** The survey's questions (from the report summary); only choice, scale and rating questions can be filtered on. */
  questions: QuestionSummary[];
}

/** Date range and "answer to question X is Y" conditions, shared by the report and the responses list. */
export function ReportFilters({ value, onChange, questions }: Props) {
  const { t } = useTranslation();
  const [questionId, setQuestionId] = useState('');
  const [answer, setAnswer] = useState('');

  const filterable = useMemo(() => questions.filter((q) => (FILTERABLE_TYPES as readonly string[]).includes(q.type)), [questions]);
  const chosen = filterable.find((q) => q.questionId === questionId);
  const isChoice = Boolean(chosen?.optionCounts);
  const labelOf = (c: { questionId: string; value: string }) => {
    const q = questions.find((x) => x.questionId === c.questionId);
    const option = q?.optionCounts?.find((o) => o.value === c.value);
    return `${q?.title ?? '?'}: ${option?.label ?? c.value}`;
  };
  const active = Boolean(value.from || value.to || value.answers.length);
  const rangeInvalid = Boolean(value.from && value.to && value.to < value.from);

  const addCondition = () => {
    if (!questionId || answer === '') return;
    if (value.answers.some((c) => c.questionId === questionId && c.value === answer)) return;
    onChange({ ...value, answers: [...value.answers, { questionId, value: answer }] });
    setAnswer('');
  };

  return (
    <Box component="section" aria-label={t('survey.filters.title')} sx={{ mb: 2 }}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
        <TextField
          size="small"
          type="date"
          label={t('survey.filters.from')}
          value={value.from ?? ''}
          onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
          slotProps={{ inputLabel: { shrink: true } }}
          error={rangeInvalid}
        />
        <TextField
          size="small"
          type="date"
          label={t('survey.filters.to')}
          value={value.to ?? ''}
          onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
          slotProps={{ inputLabel: { shrink: true } }}
          error={rangeInvalid}
          helperText={rangeInvalid ? t('survey.filters.range_invalid') : undefined}
        />
        {filterable.length > 0 && value.answers.length < MAX_ANSWER_FILTERS ? (
          <>
            <TextField
              select
              size="small"
              label={t('survey.filters.question')}
              value={questionId}
              onChange={(e) => {
                setQuestionId(e.target.value);
                setAnswer('');
              }}
              sx={{ minWidth: 200 }}
            >
              {filterable.map((q) => (
                <MenuItem key={q.questionId} value={q.questionId}>
                  {q.title}
                </MenuItem>
              ))}
            </TextField>
            {isChoice ? (
              <TextField select size="small" label={t('survey.filters.answer')} value={answer} onChange={(e) => setAnswer(e.target.value)} sx={{ minWidth: 160 }} disabled={!chosen}>
                {chosen?.optionCounts?.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField size="small" type="number" label={t('survey.filters.number')} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!chosen} sx={{ width: 120 }} />
            )}
            <Button size="small" variant="outlined" startIcon={<FilterAltIcon />} disabled={!questionId || answer === ''} onClick={addCondition} sx={{ mt: 0.5 }}>
              {t('survey.filters.add')}
            </Button>
          </>
        ) : null}
      </Stack>
      {active ? (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1.5, alignItems: 'center' }}>
          {value.answers.map((c) => (
            <Chip key={`${c.questionId}:${c.value}`} size="small" label={labelOf(c)} onDelete={() => onChange({ ...value, answers: value.answers.filter((x) => x !== c) })} />
          ))}
          <Button size="small" onClick={() => onChange({ answers: [] })}>
            {t('survey.filters.clear')}
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}
