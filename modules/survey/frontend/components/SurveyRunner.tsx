import { Alert, Box, Button, Checkbox, FormControlLabel, FormGroup, LinearProgress, Link, MenuItem, Radio, RadioGroup, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { mediaUrl, type SurveyImage } from '../api';
import { RichText } from './RichText';
import { useTranslation } from 'react-i18next';
// Raw .ts imports with explicit extensions: see TakeSurveyPage's history (SURVEY-D8) — the backend's compiled `.js`
// siblings live next to these files and Vite would otherwise resolve to them.
import { resolveNextSectionId, resolveVisibility, type EnumerationAnswerValue } from '../../backend/logic-engine.ts';
import {
  encodeOther,
  isEmptyAnswer,
  isOtherAnswer,
  otherText,
  OTHER_OPTION_VALUE,
  MAX_OTHER_LENGTH,
  scaleBounds,
  validateAnswer,
  type QuestionTypeName,
  type RuleProblem,
} from '../../backend/question-rules.ts';
import type { AnswerInput, FillableQuestion, FillableSurvey } from '../api';

type ConfigObject = Record<string, unknown>;

function configOf(question: FillableQuestion): ConfigObject {
  return (question.config ?? {}) as ConfigObject;
}

/** The selection-limit hint shown under a multiple-choice question ("Choose 2 to 3."), or null when there is no limit. */
function selectionHint(config: ConfigObject, t: (key: string, params?: Record<string, unknown>) => string): string | null {
  const min = typeof config.minSelections === 'number' && config.minSelections > 0 ? config.minSelections : null;
  const max = typeof config.maxSelections === 'number' && config.maxSelections > 0 ? config.maxSelections : null;
  if (min !== null && max !== null) return min === max ? t('survey.take.select_exactly', { count: min }) : t('survey.take.select_between', { min, max });
  if (min !== null) return t('survey.take.select_at_least', { min });
  if (max !== null) return t('survey.take.select_at_most', { max });
  return null;
}

function QuestionInput({
  question,
  value,
  onChange,
  onBlur,
  error,
}: {
  question: FillableQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  const config = configOf(question);
  const allowOther = config.allowOther === true;
  const otherLabel = typeof config.otherLabel === 'string' && config.otherLabel.trim() ? config.otherLabel.trim() : t('survey.take.other_default_label');
  const placeholder = typeof config.placeholder === 'string' ? config.placeholder : undefined;
  const validation = typeof config.validation === 'object' && config.validation !== null ? (config.validation as ConfigObject) : null;
  const maxLength = validation && typeof validation.maxLength === 'number' ? validation.maxLength : undefined;
  const textValue = typeof value === 'string' ? value : '';
  const kind = validation?.kind;
  const inputMode = kind === 'number' ? 'decimal' : kind === 'email' ? 'email' : kind === 'url' ? 'url' : undefined;

  const otherInput = (current: string, onText: (text: string) => void) => (
    <TextField
      size="small"
      fullWidth
      sx={{ mt: 0.5 }}
      value={current}
      placeholder={t('survey.take.other_placeholder')}
      onChange={(e) => onText(e.target.value)}
      onBlur={onBlur}
      error={Boolean(error)}
      slotProps={{ htmlInput: { maxLength: MAX_OTHER_LENGTH, 'aria-label': otherLabel } }}
    />
  );

  switch (question.type) {
    case 'short_text':
    case 'paragraph':
      return (
        <TextField
          fullWidth
          multiline={question.type === 'paragraph'}
          minRows={question.type === 'paragraph' ? 3 : undefined}
          value={textValue}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          error={Boolean(error)}
          helperText={maxLength ? `${textValue.length}/${maxLength}` : undefined}
          slotProps={{ htmlInput: { maxLength, inputMode, 'aria-label': question.title } }}
        />
      );
    case 'date':
      return (
        <TextField type="date" slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': question.title } }} value={textValue} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} error={Boolean(error)} />
      );
    case 'time':
      return (
        <TextField type="time" slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': question.title } }} value={textValue} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} error={Boolean(error)} />
      );
    case 'single_choice': {
      const otherSelected = isOtherAnswer(value);
      return (
        <>
          <RadioGroup
            value={otherSelected ? OTHER_OPTION_VALUE : textValue}
            onChange={(e) => onChange(e.target.value === OTHER_OPTION_VALUE ? encodeOther('') : e.target.value)}
          >
            {question.options.map((option) => (
              <FormControlLabel key={option.value} value={option.value} control={<Radio />} label={option.label} />
            ))}
            {allowOther ? <FormControlLabel value={OTHER_OPTION_VALUE} control={<Radio />} label={otherLabel} /> : null}
          </RadioGroup>
          {otherSelected ? otherInput(otherText(value as string), (text) => onChange(encodeOther(text))) : null}
        </>
      );
    }
    case 'dropdown': {
      const otherSelected = isOtherAnswer(value);
      return (
        <>
          <TextField
            select
            fullWidth
            value={otherSelected ? OTHER_OPTION_VALUE : textValue}
            onChange={(e) => onChange(e.target.value === OTHER_OPTION_VALUE ? encodeOther('') : e.target.value)}
            onBlur={onBlur}
            slotProps={{ htmlInput: { 'aria-label': question.title } }}
          >
            {question.options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
            {allowOther ? <MenuItem value={OTHER_OPTION_VALUE}>{otherLabel}</MenuItem> : null}
          </TextField>
          {otherSelected ? otherInput(otherText(value as string), (text) => onChange(encodeOther(text))) : null}
        </>
      );
    }
    case 'multi_choice': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const otherEntry = selected.find(isOtherAnswer);
      const exclusive = typeof config.exclusiveOptionValue === 'string' && config.exclusiveOptionValue ? config.exclusiveOptionValue : null;
      const max = typeof config.maxSelections === 'number' && config.maxSelections > 0 ? config.maxSelections : null;
      const hint = selectionHint(config, t);
      // The exclusive choice stands alone: picking it clears the others, picking another clears it.
      const toggle = (optionValue: string, checked: boolean) => {
        if (!checked) return onChange(selected.filter((v) => v !== optionValue));
        if (optionValue === exclusive) return onChange([optionValue]);
        return onChange([...selected.filter((v) => v !== exclusive), optionValue]);
      };
      const countedSelections = selected.filter((v) => v !== exclusive).length;
      const atMax = max !== null && countedSelections >= max;
      return (
        <>
          {hint ? (
            <Typography variant="caption" color={error ? 'error' : 'text.secondary'} sx={{ display: 'block' }} aria-live="polite">
              {hint} {countedSelections > 0 ? `(${t('survey.take.selected_count', { count: selected.length })})` : ''}
            </Typography>
          ) : null}
          <FormGroup>
            {question.options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <FormControlLabel
                  key={option.value}
                  control={
                    <Checkbox
                      checked={checked}
                      disabled={!checked && atMax && option.value !== exclusive}
                      onChange={(e) => toggle(option.value, e.target.checked)}
                    />
                  }
                  label={option.label}
                />
              );
            })}
            {allowOther ? (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={Boolean(otherEntry)}
                    disabled={!otherEntry && atMax}
                    onChange={(e) =>
                      onChange(e.target.checked ? [...selected.filter((v) => v !== exclusive), encodeOther('')] : selected.filter((v) => !isOtherAnswer(v)))
                    }
                  />
                }
                label={otherLabel}
              />
            ) : null}
          </FormGroup>
          {otherEntry !== undefined
            ? otherInput(otherText(otherEntry), (text) => onChange(selected.map((v) => (isOtherAnswer(v) ? encodeOther(text) : v))))
            : null}
        </>
      );
    }
    case 'linear_scale':
    case 'rating': {
      const { min, max } = scaleBounds(question.type as QuestionTypeName, config);
      const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <ToggleButtonGroup exclusive value={value ?? null} onChange={(_, next) => next !== null && onChange(next)}>
          {options.map((n) => (
            <ToggleButton key={n} value={n}>
              {n}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      );
    }
    default:
      return <Typography color="error">{t('survey.take.unsupported_question_type')}</Typography>;
  }
}

export interface SurveyRunnerProps {
  survey: FillableSurvey;
  answers: Record<string, unknown>;
  onAnswerChange: (questionId: string, value: unknown) => void;
  /** Called with the answers of every visible question once the last page passes its checks. */
  onSubmit: (payload: AnswerInput[]) => void | Promise<void>;
  submitting?: boolean;
  submitError?: string | null;
}

/** A picture from the survey. Lazy-loaded, with the author's description as its alt text. */
function Picture({ image }: { image: SurveyImage | null | undefined }) {
  if (!image) return null;
  return <Box component="img" src={mediaUrl(image.mediaId)} alt={image.alt} loading="lazy" sx={{ display: 'block', maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 1, my: 1 }} />;
}

/**
 * The respondent experience for one survey: title, one page (section) at a time with Next/Back and "go to"
 * routing, live conditional logic, required/format checks next to the field, selection hints. Used by the real
 * respondent page AND by the builder's preview, so what an owner previews is exactly what readers get. It owns
 * only the navigation/validation state; where answers are kept and what Submit does is up to the caller.
 */
export function SurveyRunner({ survey, answers, onAnswerChange, onSubmit, submitting = false, submitError = null }: SurveyRunnerProps) {
  const { t } = useTranslation();

  const enumerationAnswers = useMemo<Record<string, EnumerationAnswerValue>>(() => {
    const result: Record<string, EnumerationAnswerValue> = {};
    for (const section of survey.sections) {
      for (const question of section.questions) {
        if (question.type === 'single_choice' || question.type === 'dropdown' || question.type === 'multi_choice') {
          result[question.id] = answers[question.id] as EnumerationAnswerValue;
        }
      }
    }
    return result;
  }, [survey, answers]);

  const visibility = useMemo(() => resolveVisibility(survey.sections, survey.logicRules, enumerationAnswers), [survey, enumerationAnswers]);

  // `trail` is the sections the respondent has actually visited, so Back
  // returns to exactly where they came from even after a "go to" jump.
  const [trail, setTrail] = useState<string[]>([]);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const currentSectionId = trail[trail.length - 1] ?? visibility.pathSectionIds[0] ?? null;
  const currentSection = survey.sections.find((s) => s.id === currentSectionId) ?? null;
  const nextSectionId = currentSectionId ? resolveNextSectionId(survey.sections, survey.logicRules, enumerationAnswers, currentSectionId) : null;
  const pageNumber = Math.max(1, visibility.pathSectionIds.indexOf(currentSectionId ?? '') + 1);

  /** Required, currently visible questions of the open page that still have no answer. */
  const findMissingOnPage = (): Set<string> => {
    const result = new Set<string>();
    for (const question of currentSection?.questions ?? []) {
      if (visibility.visibleQuestionIds.has(question.id) && question.required && isEmptyAnswer(answers[question.id])) result.add(question.id);
    }
    return result;
  };

  /** Rule problems (format, length, selection limits, "Other"...) of the answered, visible questions on the open page. */
  const problemsOnPage = useMemo(() => {
    const result = new Map<string, RuleProblem>();
    for (const question of currentSection?.questions ?? []) {
      if (!visibility.visibleQuestionIds.has(question.id)) continue;
      const value = answers[question.id];
      if (isEmptyAnswer(value)) continue;
      const problem = validateAnswer(question.type as QuestionTypeName, question.config, question.options.map((o) => o.value), value);
      if (problem) result.set(question.id, problem);
    }
    return result;
  }, [currentSection, visibility, answers]);

  const problemText = (problem: RuleProblem): string => problem.message ?? t(`survey.rules.${problem.code}`, problem.params);
  // While the respondent is still choosing, "choose at least N" / an empty "Other" text are hints, not errors.
  const WAIT_UNTIL_ATTEMPT = ['too_few_selected', 'other_empty'];
  const errorFor = (questionId: string): string | null => {
    const problem = problemsOnPage.get(questionId);
    if (!problem) return null;
    if (attempted || (touched.has(questionId) && !WAIT_UNTIL_ATTEMPT.includes(problem.code))) return problemText(problem);
    return null;
  };
  const markTouched = (questionId: string) => setTouched((prev) => (prev.has(questionId) ? prev : new Set(prev).add(questionId)));

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const handleNext = () => {
    if (!currentSectionId || !nextSectionId) return;
    const pending = findMissingOnPage();
    setMissing(pending);
    setAttempted(true);
    if (pending.size > 0 || problemsOnPage.size > 0) return;
    setAttempted(false);
    setTouched(new Set());
    setTrail([...(trail.length ? trail : [currentSectionId]), nextSectionId]);
    scrollToTop();
  };

  const handleBack = () => {
    if (trail.length < 2) return;
    setMissing(new Set());
    setAttempted(false);
    setTrail(trail.slice(0, -1));
    scrollToTop();
  };

  const handleChange = (question: FillableQuestion, value: unknown) => {
    // Choice answers are deliberate clicks, so their errors may show at once; text waits for the field to lose focus.
    if (question.type !== 'short_text' && question.type !== 'paragraph' && question.type !== 'date' && question.type !== 'time') markTouched(question.id);
    onAnswerChange(question.id, value);
  };

  const handleSubmit = async () => {
    const pending = findMissingOnPage();
    setMissing(pending);
    setAttempted(true);
    if (pending.size > 0 || problemsOnPage.size > 0) return;
    const payload: AnswerInput[] = [];
    for (const section of survey.sections) {
      if (!visibility.visibleSectionIds.has(section.id)) continue;
      for (const question of section.questions) {
        if (!visibility.visibleQuestionIds.has(question.id)) continue;
        const value = answers[question.id];
        if (isEmptyAnswer(value)) continue;
        payload.push({ questionId: question.id, value });
      }
    }
    await onSubmit(payload);
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Picture image={survey.headerImage} />
        <Typography variant="h5">{survey.title}</Typography>
        {survey.description ? (
          <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 1 }}>
            <RichText text={survey.description} component="div" />
          </Typography>
        ) : null}
      </Box>

      {submitError ? <Alert severity="error">{submitError}</Alert> : null}

      {currentSection ? (
        <Stack spacing={2}>
          {survey.sections.length > 1 ? (
            <Box>
              {survey.showProgressBar ? (
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, Math.round((pageNumber / Math.max(visibility.pathSectionIds.length, pageNumber)) * 100))}
                  aria-label={t('survey.take.progress')}
                  sx={{ height: 8, borderRadius: 4, mb: 1 }}
                />
              ) : null}
              <Typography variant="caption" color="text.secondary">
                {t('survey.take.page_of', { current: pageNumber, total: Math.max(visibility.pathSectionIds.length, pageNumber) })}
              </Typography>
              <Typography variant="h6">
                <RichText text={currentSection.title} />
              </Typography>
              <Picture image={currentSection.image} />
              {currentSection.description ? (
                <Typography variant="body2" color="text.secondary" component="div">
                  <RichText text={currentSection.description} component="div" />
                </Typography>
              ) : null}
            </Box>
          ) : currentSection.image || currentSection.description ? (
            // A single-section survey has no page heading, but a picture or text the owner added still shows.
            <Box>
              <Picture image={currentSection.image} />
              {currentSection.description ? (
                <Typography variant="body2" color="text.secondary" component="div">
                  <RichText text={currentSection.description} component="div" />
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {currentSection.questions
            .filter((question) => visibility.visibleQuestionIds.has(question.id))
            .map((question) => (
              <Box key={question.id}>
                <Typography variant="subtitle1" component="div">
                  <RichText text={question.title} />
                  {question.required ? ' *' : ''}
                </Typography>
                {question.description ? (
                  <Typography variant="body2" color="text.secondary" component="div">
                    <RichText text={question.description} component="div" />
                  </Typography>
                ) : null}
                <Picture image={question.config?.image as SurveyImage | undefined} />
                {typeof question.config?.videoUrl === 'string' && question.config.videoUrl ? (
                  <Link href={question.config.videoUrl} target="_blank" rel="noopener noreferrer nofollow" sx={{ display: 'inline-block', my: 0.5 }}>
                    {t('survey.take.watch_video')}
                  </Link>
                ) : null}
                <Box sx={{ mt: 1 }}>
                  <QuestionInput
                    question={question}
                    value={answers[question.id]}
                    onChange={(value) => handleChange(question, value)}
                    onBlur={() => markTouched(question.id)}
                    error={errorFor(question.id)}
                  />
                </Box>
                {missing.has(question.id) && isEmptyAnswer(answers[question.id]) ? (
                  <Typography variant="body2" color="error" sx={{ mt: 0.5 }} role="alert">
                    {t('survey.take.required_field')}
                  </Typography>
                ) : null}
                {errorFor(question.id) ? (
                  <Typography variant="body2" color="error" sx={{ mt: 0.5 }} role="alert">
                    {errorFor(question.id)}
                  </Typography>
                ) : null}
              </Box>
            ))}
        </Stack>
      ) : null}

      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
        <Button onClick={handleBack} disabled={trail.length < 2 || submitting}>
          {t('survey.take.back')}
        </Button>
        {nextSectionId ? (
          <Button variant="contained" onClick={handleNext}>
            {t('survey.take.next')}
          </Button>
        ) : (
          <Button variant="contained" onClick={() => void handleSubmit()} disabled={submitting}>
            {t('survey.take.submit')}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
