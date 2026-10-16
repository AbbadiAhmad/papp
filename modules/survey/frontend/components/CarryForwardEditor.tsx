import { FormControl, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getOptionsFrom, type OptionsFromMode } from '../../backend/piping.ts';
import { toPlainText } from '../../backend/rich-text.ts';

export interface CarryCandidate {
  id: string;
  title: string;
}

interface Props {
  config: Record<string, unknown> | undefined;
  /** Choice questions in EARLIER sections that do not themselves take their choices from another. */
  candidates: CarryCandidate[];
  onConfigChange: (config: Record<string, unknown>) => void;
}

/** "Write my own choices" or "take them from an earlier question" (the ones ticked, or the ones not ticked). */
export function CarryForwardEditor({ config, candidates, onConfigChange }: Props) {
  const { t } = useTranslation();
  const from = getOptionsFrom({ config });
  if (candidates.length === 0 && !from) return null;

  const set = (next: { questionId: string; mode: OptionsFromMode } | null) => {
    const { optionsFrom: _old, ...rest } = config ?? {};
    onConfigChange(next ? { ...rest, optionsFrom: next } : rest);
  };

  return (
    <Stack spacing={1} sx={{ pl: 2, mt: 1 }}>
      <TextField
        select
        size="small"
        label={t('survey.carry.source')}
        value={from?.questionId ?? ''}
        onChange={(e) => set(e.target.value ? { questionId: e.target.value, mode: from?.mode ?? 'selected' } : null)}
        helperText={t('survey.carry.hint')}
      >
        <MenuItem value="">{t('survey.carry.own')}</MenuItem>
        {candidates.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {toPlainText(c.title) || t('survey.carry.untitled')}
          </MenuItem>
        ))}
      </TextField>
      {from ? (
        <FormControl>
          <Typography variant="caption" color="text.secondary" id="carry-mode-label">
            {t('survey.carry.mode')}
          </Typography>
          <RadioGroup row aria-labelledby="carry-mode-label" value={from.mode} onChange={(e) => set({ questionId: from.questionId, mode: e.target.value as OptionsFromMode })}>
            <FormControlLabel value="selected" control={<Radio size="small" />} label={t('survey.carry.selected')} />
            <FormControlLabel value="unselected" control={<Radio size="small" />} label={t('survey.carry.unselected')} />
          </RadioGroup>
        </FormControl>
      ) : null}
    </Stack>
  );
}
