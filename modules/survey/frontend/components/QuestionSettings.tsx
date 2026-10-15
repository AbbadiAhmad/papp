import { Checkbox, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { MAX_MESSAGE_LENGTH, MAX_PLACEHOLDER_LENGTH, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, type ValidationKind } from '../../backend/question-rules.ts';
import type { SurveyQuestionDto } from '../api';

type Config = Record<string, unknown>;

/** `'' | number`-style text fields in, `undefined | number` out: a blank field removes the setting. */
function toOptionalNumber(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Builder controls for the settings stored in a question's `config` (ROADMAP
 * phase A): placeholder + answer format for text questions, selection limits
 * for multiple choice, and the "Other" choice for the three choice types.
 * Pure form fields: it only reports a new `config` upward; the rules are
 * enforced by `question-rules.ts` both when the builder saves and when a
 * respondent submits.
 */
export function QuestionSettings({ question, onConfigChange }: { question: SurveyQuestionDto; onConfigChange: (config: Config) => void }) {
  const { t } = useTranslation();
  const config: Config = (question.config ?? {}) as Config;
  const set = (patch: Config) => {
    const next: Config = { ...config, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === '' || next[key] === false) delete next[key];
    onConfigChange(next);
  };

  const isText = question.type === 'short_text' || question.type === 'paragraph';
  const isChoice = question.type === 'single_choice' || question.type === 'multi_choice' || question.type === 'dropdown';
  const validation = (typeof config.validation === 'object' && config.validation !== null ? config.validation : null) as Config | null;
  const kind = (validation?.kind as ValidationKind | undefined) ?? 'any';
  const setValidation = (patch: Config) => {
    const next: Config = { ...(validation ?? {}), ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === '' || next[key] === false) delete next[key];
    set({ validation: next });
  };
  const changeKind = (value: ValidationKind | 'any') => {
    if (value === 'any') set({ validation: undefined });
    else set({ validation: { kind: value, ...(validation?.message ? { message: validation.message } : {}) } });
  };
  const kinds: Array<ValidationKind | 'any'> = question.type === 'paragraph' ? ['any', 'text'] : ['any', 'text', 'number', 'email', 'url'];
  const optionValues = (question.options ?? []).map((o) => o.value.trim() || o.label.trim()).filter(Boolean);

  return (
    <Stack spacing={1.5} sx={{ pl: 2, mt: 1 }}>
      {isText ? (
        <>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              size="small"
              label={t('survey.fields.placeholder')}
              value={typeof config.placeholder === 'string' ? config.placeholder : ''}
              onChange={(e) => set({ placeholder: e.target.value })}
              slotProps={{ htmlInput: { maxLength: MAX_PLACEHOLDER_LENGTH } }}
              sx={{ minWidth: 220 }}
            />
            <TextField
              select
              size="small"
              label={t('survey.fields.answer_format')}
              value={kind}
              onChange={(e) => changeKind(e.target.value as ValidationKind | 'any')}
              sx={{ minWidth: 200 }}
            >
              {kinds.map((k) => (
                <MenuItem key={k} value={k}>
                  {t(`survey.validation_kind.${k}`)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          {kind === 'text' ? (
            <TextField
              size="small"
              type="number"
              label={t('survey.fields.max_length')}
              value={typeof validation?.maxLength === 'number' ? validation.maxLength : ''}
              onChange={(e) => setValidation({ maxLength: toOptionalNumber(e.target.value) })}
              slotProps={{ htmlInput: { min: 1, max: MAX_TEXT_LENGTH } }}
              sx={{ width: 220 }}
            />
          ) : null}
          {kind === 'number' ? (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
              <TextField
                size="small"
                type="number"
                label={t('survey.fields.number_min')}
                value={typeof validation?.min === 'number' ? validation.min : ''}
                onChange={(e) => setValidation({ min: toOptionalNumber(e.target.value) })}
                sx={{ width: 140 }}
              />
              <TextField
                size="small"
                type="number"
                label={t('survey.fields.number_max')}
                value={typeof validation?.max === 'number' ? validation.max : ''}
                onChange={(e) => setValidation({ max: toOptionalNumber(e.target.value) })}
                sx={{ width: 140 }}
              />
              <FormControlLabel
                control={<Checkbox checked={validation?.integer === true} onChange={(e) => setValidation({ integer: e.target.checked })} />}
                label={t('survey.fields.number_integer')}
              />
            </Stack>
          ) : null}
          {kind !== 'any' ? (
            <TextField
              size="small"
              label={t('survey.fields.validation_message')}
              value={typeof validation?.message === 'string' ? validation.message : ''}
              onChange={(e) => setValidation({ message: e.target.value })}
              slotProps={{ htmlInput: { maxLength: MAX_MESSAGE_LENGTH } }}
              sx={{ maxWidth: 480 }}
            />
          ) : null}
        </>
      ) : null}

      {question.type === 'multi_choice' ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <TextField
            size="small"
            type="number"
            label={t('survey.fields.min_selections')}
            value={typeof config.minSelections === 'number' ? config.minSelections : ''}
            onChange={(e) => set({ minSelections: toOptionalNumber(e.target.value) })}
            slotProps={{ htmlInput: { min: 0 } }}
            sx={{ width: 170 }}
          />
          <TextField
            size="small"
            type="number"
            label={t('survey.fields.max_selections')}
            value={typeof config.maxSelections === 'number' ? config.maxSelections : ''}
            onChange={(e) => set({ maxSelections: toOptionalNumber(e.target.value) })}
            slotProps={{ htmlInput: { min: 0 } }}
            sx={{ width: 170 }}
          />
          <TextField
            select
            size="small"
            label={t('survey.fields.exclusive_option')}
            value={typeof config.exclusiveOptionValue === 'string' ? config.exclusiveOptionValue : ''}
            onChange={(e) => set({ exclusiveOptionValue: e.target.value })}
            sx={{ minWidth: 260 }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="">{t('survey.fields.exclusive_none')}</MenuItem>
            {optionValues.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      ) : null}

      {isChoice ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
          <FormControlLabel
            control={<Checkbox checked={config.allowOther === true} onChange={(e) => set({ allowOther: e.target.checked, otherLabel: e.target.checked ? config.otherLabel : undefined })} />}
            label={t('survey.fields.allow_other')}
          />
          {config.allowOther === true ? (
            <TextField
              size="small"
              label={t('survey.fields.other_label')}
              value={typeof config.otherLabel === 'string' ? config.otherLabel : ''}
              onChange={(e) => set({ otherLabel: e.target.value })}
              slotProps={{ htmlInput: { maxLength: MAX_LABEL_LENGTH } }}
              sx={{ width: 240 }}
            />
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
