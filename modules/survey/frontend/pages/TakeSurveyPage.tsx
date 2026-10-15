import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../../../apps/web/src/app/AuthContext';
import { extractErrorMessage, isForbiddenError, isNotFoundError } from '../../../../apps/web/src/shared/api/httpClient';
// Raw .ts import — Vite bundles this exactly like any other module file
// (see logic-engine.ts's own docblock: framework-free by design so both
// the backend's compiled sibling and this frontend import share one
// evaluator, never two independently-drifting copies). The explicit `.ts`
// extension is load-bearing: `logic-engine.js` (the backend's own compiled
// CommonJS sibling, D56) lives right next to it, and Vite's default
// `resolve.extensions` order checks `.js` before `.ts` — an extensionless
// specifier here silently resolves to that CJS build instead of this real
// ESM source, which throws at runtime ("does not provide an export named
// 'resolveVisibility'") the moment this page's code actually executes in a
// browser (found via a live dev-server + Playwright check, root DECISIONS.md
// D78 — `npm run build`'s Rollup-based resolution didn't surface it, only
// `vite`'s dev-server did).
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
import { surveyApi, type AnswerInput, type FillableQuestion, type FillableSurvey } from '../api';

// 'not_found' also covers "exists but not published" — the backend never
// distinguishes the two to an anonymous/authenticated respondent
// (MODULE_SPEC.md §7.2, same rule library_catalog's own public route follows).
type PageState = 'loading' | 'ready' | 'login_required' | 'not_found' | 'error' | 'submitted';

const DRAFT_KEY_PREFIX = 'papp:survey-draft:';
const SUBMITTED_KEY_PREFIX = 'papp:survey-submitted:';

interface StoredSubmission {
  responseId: string;
  editToken: string;
  answers: Record<string, unknown>;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing / blocked storage — the draft/edit convenience is
    // simply unavailable; the survey itself still works via one atomic submit.
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

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

/**
 * The one canonical `/survey/:surveyId` respondent-facing route — public
 * AND authenticated, same URL (docs/DECISIONS.md). Picks which endpoint
 * pair to call from `useAuth()`'s real status; no draft/partial-response
 * row exists ANYWHERE server-side (in-progress answers live only in
 * component state + localStorage, this browser only) — the "abandoned
 * mid-way / session expired -> never stored" requirement is satisfied by
 * construction, not a cleanup job.
 */
export function TakeSurveyPage() {
  const { t } = useTranslation();
  const { surveyId } = useParams<{ surveyId: string }>();
  const { status: authStatus, mustChangePassword } = useAuth();
  // A forced-password-change account is technically "authenticated" per
  // AuthContext's own status model, but FillController's
  // MustChangePasswordGuard would 403 it just like an anonymous caller —
  // route it through the public flow instead of the authenticated one.
  const canUseAuthenticatedFlow = authStatus === 'authenticated' && !mustChangePassword;

  const [pageState, setPageState] = useState<PageState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [survey, setSurvey] = useState<FillableSurvey | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editContext, setEditContext] = useState<{ editToken: string } | null>(null);
  const [returnedEditToken, setReturnedEditToken] = useState<string | null>(null);

  const draftKey = `${DRAFT_KEY_PREFIX}${surveyId}`;
  const submittedKey = `${SUBMITTED_KEY_PREFIX}${surveyId}`;

  useEffect(() => {
    if (!surveyId || authStatus === 'initializing') return;
    let cancelled = false;

    const load = canUseAuthenticatedFlow ? surveyApi.getForFilling(surveyId) : surveyApi.getForFillingPublic(surveyId);
    load
      .then(({ survey: loaded, existingResponse }) => {
        if (cancelled) return;
        if (loaded.requiresLogin && !canUseAuthenticatedFlow) {
          setPageState('login_required');
          return;
        }
        setSurvey(loaded);

        if (existingResponse) {
          // Authenticated path — server is the authoritative source.
          const prefill: Record<string, unknown> = {};
          for (const a of existingResponse.answers) prefill[a.questionId] = a.value;
          setAnswers(prefill);
        } else if (!canUseAuthenticatedFlow) {
          const stored = readJson<StoredSubmission>(submittedKey);
          if (stored && loaded.allowEditAfterSubmit) {
            setAnswers(stored.answers);
            setEditContext({ editToken: stored.editToken });
          } else {
            const draft = readJson<Record<string, unknown>>(draftKey);
            if (draft) setAnswers(draft);
          }
        } else {
          const draft = readJson<Record<string, unknown>>(draftKey);
          if (draft) setAnswers(draft);
        }
        setPageState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isNotFoundError(error)) {
          const body = axios.isAxiosError(error) ? (error.response?.data as { closed?: boolean; closedMessage?: string | null } | undefined) : undefined;
          setClosedMessage(body?.closed ? (body.closedMessage ?? null) : null);
          setPageState('not_found');
          return;
        }
        if (isForbiddenError(error)) {
          setPageState('login_required');
          return;
        }
        setPageState('error');
        setErrorMessage(extractErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId, authStatus]);

  const enumerationAnswers = useMemo<Record<string, EnumerationAnswerValue>>(() => {
    if (!survey) return {};
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

  const visibility = useMemo(() => {
    if (!survey) return { visibleSectionIds: new Set<string>(), visibleQuestionIds: new Set<string>(), pathSectionIds: [] as string[] };
    return resolveVisibility(survey.sections, survey.logicRules, enumerationAnswers);
  }, [survey, enumerationAnswers]);

  // --- paged navigation ----------------------------------------------------
  // `trail` is the sections the respondent has actually visited, so Back
  // returns to exactly where they came from even after a "go to" jump.
  const [trail, setTrail] = useState<string[]>([]);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const currentSectionId = trail[trail.length - 1] ?? visibility.pathSectionIds[0] ?? null;
  const currentSection = survey?.sections.find((s) => s.id === currentSectionId) ?? null;
  const nextSectionId =
    survey && currentSectionId ? resolveNextSectionId(survey.sections, survey.logicRules, enumerationAnswers, currentSectionId) : null;
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

  const handleAnswerChange = (questionId: string, value: unknown, type?: string) => {
    // Choice answers are deliberate clicks, so their errors may show at once; text waits for the field to lose focus.
    if (type && type !== 'short_text' && type !== 'paragraph' && type !== 'date' && type !== 'time') markTouched(questionId);
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      if (!canUseAuthenticatedFlow && !editContext) writeJson(draftKey, next);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!survey || !surveyId) return;
    const pending = findMissingOnPage();
    setMissing(pending);
    setAttempted(true);
    if (pending.size > 0 || problemsOnPage.size > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: AnswerInput[] = [];
      for (const section of survey.sections) {
        if (!visibility.visibleSectionIds.has(section.id)) continue;
        for (const question of section.questions) {
          if (!visibility.visibleQuestionIds.has(question.id)) continue;
          const value = answers[question.id];
          if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
          payload.push({ questionId: question.id, value });
        }
      }

      if (canUseAuthenticatedFlow) {
        await surveyApi.submitAuthenticated(surveyId, payload);
      } else if (editContext) {
        await surveyApi.editPublic(surveyId, editContext.editToken, payload);
        writeJson(submittedKey, { responseId: '', editToken: editContext.editToken, answers } satisfies StoredSubmission);
      } else {
        const result = await surveyApi.submitPublic(surveyId, payload);
        if (result.editToken) {
          writeJson(submittedKey, { responseId: result.responseId, editToken: result.editToken, answers } satisfies StoredSubmission);
          setReturnedEditToken(result.editToken);
        }
      }

      removeKey(draftKey);
      setPageState('submitted');
    } catch (error) {
      setSubmitError(extractErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!surveyId) return null;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 2, sm: 4 } }}>
      <Paper sx={{ p: 4, maxWidth: 640, width: '100%' }} elevation={3}>
        {pageState === 'loading' ? (
          <Stack sx={{ alignItems: 'center', p: 4 }}>
            <CircularProgress />
          </Stack>
        ) : null}

        {pageState === 'not_found' ? <Alert severity="warning">{closedMessage || t('survey.take.not_found')}</Alert> : null}
        {pageState === 'error' ? <Alert severity="error">{errorMessage ?? t('core.common.error')}</Alert> : null}
        {pageState === 'login_required' ? (
          <Stack spacing={2}>
            <Alert severity="info">{t('survey.take.login_required')}</Alert>
            <Button variant="contained" href="/login">
              {t('survey.take.go_to_login')}
            </Button>
          </Stack>
        ) : null}

        {pageState === 'submitted' ? (
          <Stack spacing={2}>
            <Alert severity="success">{t('survey.take.thank_you')}</Alert>
            {returnedEditToken && survey?.allowEditAfterSubmit ? (
              <Typography variant="body2" color="text.secondary">
                {t('survey.take.edit_hint')}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {pageState === 'ready' && survey ? (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h5">{survey.title}</Typography>
              {survey.description ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {survey.description}
                </Typography>
              ) : null}
            </Box>

            {submitError ? <Alert severity="error">{submitError}</Alert> : null}

            {currentSection ? (
              <Stack spacing={2}>
                {survey.sections.length > 1 ? (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('survey.take.page_of', { current: pageNumber, total: Math.max(visibility.pathSectionIds.length, pageNumber) })}
                    </Typography>
                    <Typography variant="h6">{currentSection.title}</Typography>
                    {currentSection.description ? (
                      <Typography variant="body2" color="text.secondary">
                        {currentSection.description}
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}
                {currentSection.questions
                  .filter((question) => visibility.visibleQuestionIds.has(question.id))
                  .map((question) => (
                    <Box key={question.id}>
                      <Typography variant="subtitle1">
                        {question.title}
                        {question.required ? ' *' : ''}
                      </Typography>
                      {question.description ? (
                        <Typography variant="body2" color="text.secondary">
                          {question.description}
                        </Typography>
                      ) : null}
                      <Box sx={{ mt: 1 }}>
                        <QuestionInput
                          question={question}
                          value={answers[question.id]}
                          onChange={(value) => handleAnswerChange(question.id, value, question.type)}
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
                <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
                  {t('survey.take.submit')}
                </Button>
              )}
            </Stack>
          </Stack>
        ) : null}
      </Paper>
    </Box>
  );
}
