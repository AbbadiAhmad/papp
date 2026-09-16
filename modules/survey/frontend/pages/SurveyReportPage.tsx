import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { surveyApi, type QuestionSummary, type SurveyDataset } from '../api';

const NUMERIC_QUESTION_TYPES = new Set(['linear_scale', 'rating']);
const TOTAL_COLUMN_KEY = '__total__';

function QuestionSummaryCard({ summary }: { summary: QuestionSummary }) {
  const { t } = useTranslation();

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1">{summary.title}</Typography>
      <Typography variant="caption" color="text.secondary">
        {t('survey.report.answered_count', { count: summary.totalAnswered })}
      </Typography>

      {summary.optionCounts ? (
        <Box sx={{ height: 220, mt: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.optionCounts}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#1976d2" />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      ) : null}

      {summary.numeric ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('survey.report.average')}: {summary.numeric.average.toFixed(2)} ({t('survey.report.min')}: {summary.numeric.min}, {t('survey.report.max')}: {summary.numeric.max})
          </Typography>
          <Box sx={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.numeric.distribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="value" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#2e7d32" />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      ) : null}

      {summary.sampleAnswers ? (
        <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 200, overflowY: 'auto' }}>
          {summary.sampleAnswers.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('survey.report.no_answers')}
            </Typography>
          ) : (
            summary.sampleAnswers.map((answer, index) => (
              <Typography key={index} variant="body2">
                {answer}
              </Typography>
            ))
          )}
        </Stack>
      ) : null}
    </Paper>
  );
}

function pivotValueForRow(answers: Record<string, unknown>, questionId: string): string[] {
  const value = answers[questionId];
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [String(value)];
}

/**
 * The "in addition to dynamic pivot reports" half of the original request —
 * a bespoke rows/columns/aggregation picker over the flattened dataset
 * (`GET .../report/dataset`), not a pivot-table library (out of scope at
 * this size: one row-field, one optional column-field, count or average of
 * a numeric-question value). A multi_choice answer contributes to EVERY
 * option it selected (an "exploded" group membership), matching how a
 * respondent picking two options should count toward both.
 */
function PivotTable({ dataset }: { dataset: SurveyDataset }) {
  const { t } = useTranslation();
  const numericColumns = dataset.columns.filter((c) => NUMERIC_QUESTION_TYPES.has(c.type));
  const [rowField, setRowField] = useState(dataset.columns[0]?.questionId ?? '');
  const [columnField, setColumnField] = useState<string>(TOTAL_COLUMN_KEY);
  const [valueField, setValueField] = useState<string>('');

  const pivot = useMemo(() => {
    if (!rowField) return null;
    const rowKeys = new Set<string>();
    const columnKeys = new Set<string>([TOTAL_COLUMN_KEY]);
    const cells = new Map<string, { sum: number; count: number }>();

    for (const row of dataset.rows) {
      const rowValues = pivotValueForRow(row.answers, rowField);
      const columnValues = columnField === TOTAL_COLUMN_KEY ? [TOTAL_COLUMN_KEY] : pivotValueForRow(row.answers, columnField);
      const numericValue = valueField ? Number(row.answers[valueField]) : 1;
      const hasNumericValue = valueField ? Number.isFinite(numericValue) : true;
      if (!hasNumericValue || rowValues.length === 0 || columnValues.length === 0) continue;

      for (const rv of rowValues) {
        rowKeys.add(rv);
        for (const cv of columnValues.length ? columnValues : [TOTAL_COLUMN_KEY]) {
          columnKeys.add(cv);
          const key = `${rv}::${cv}`;
          const cell = cells.get(key) ?? { sum: 0, count: 0 };
          cell.sum += valueField ? numericValue : 1;
          cell.count += 1;
          cells.set(key, cell);
        }
      }
    }

    return { rowKeys: [...rowKeys].sort(), columnKeys: [...columnKeys].sort(), cells };
  }, [dataset, rowField, columnField, valueField]);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>
        {t('survey.report.pivot_title')}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <TextField select size="small" label={t('survey.report.pivot_rows')} value={rowField} onChange={(e) => setRowField(e.target.value)} sx={{ minWidth: 180 }}>
          {dataset.columns.map((c) => (
            <MenuItem key={c.questionId} value={c.questionId}>
              {c.title}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('survey.report.pivot_columns')}
          value={columnField}
          onChange={(e) => setColumnField(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value={TOTAL_COLUMN_KEY}>{t('survey.report.pivot_no_split')}</MenuItem>
          {dataset.columns
            .filter((c) => c.questionId !== rowField)
            .map((c) => (
              <MenuItem key={c.questionId} value={c.questionId}>
                {c.title}
              </MenuItem>
            ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('survey.report.pivot_value')}
          value={valueField}
          onChange={(e) => setValueField(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t('survey.report.pivot_count')}</MenuItem>
          {numericColumns.map((c) => (
            <MenuItem key={c.questionId} value={c.questionId}>
              {t('survey.report.pivot_average_of', { title: c.title })}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {pivot && pivot.rowKeys.length > 0 ? (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                {pivot.columnKeys.map((col) => (
                  <TableCell key={col}>{col === TOTAL_COLUMN_KEY ? t('survey.report.pivot_total') : col}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {pivot.rowKeys.map((row) => (
                <TableRow key={row}>
                  <TableCell component="th" scope="row">
                    {row}
                  </TableCell>
                  {pivot.columnKeys.map((col) => {
                    const cell = pivot.cells.get(`${row}::${col}`);
                    const display = cell ? (valueField ? (cell.sum / cell.count).toFixed(2) : cell.count) : '—';
                    return <TableCell key={col}>{display}</TableCell>;
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t('survey.report.no_data')}
        </Typography>
      )}
    </Paper>
  );
}

export function SurveyReportPage() {
  const { t } = useTranslation();
  const { surveyId } = useParams<{ surveyId: string }>();
  const navigate = useNavigate();
  const { status, data: summary, errorMessage, reload } = useGuardedQuery('survey.responses.view', () =>
    surveyApi.getSummary(surveyId as string),
  );
  const [dataset, setDataset] = useState<SurveyDataset | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);

  useEffect(() => {
    if (!surveyId) return;
    surveyApi
      .getDataset(surveyId)
      .then(setDataset)
      .catch((error: unknown) => setDatasetError(extractErrorMessage(error)));
  }, [surveyId]);

  if (!surveyId) return null;

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{t('survey.report.title')}</Typography>
        <Stack direction="row" spacing={1}>
          <Button onClick={() => navigate(`/survey/surveys/${surveyId}/responses`)}>{t('survey.list.responses')}</Button>
          <Button onClick={() => navigate('/survey/surveys')}>{t('core.common.back')}</Button>
        </Stack>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {t('survey.report.total_responses', { count: summary?.totalResponses ?? 0 })}
        </Typography>
        <Stack spacing={2} sx={{ mb: 3 }}>
          {(summary?.questions ?? []).map((q) => (
            <QuestionSummaryCard key={q.questionId} summary={q} />
          ))}
        </Stack>

        {datasetError ? <Alert severity="error">{datasetError}</Alert> : null}
        {dataset && dataset.columns.length > 0 ? <PivotTable dataset={dataset} /> : null}
      </QueryStateGate>
    </Box>
  );
}
