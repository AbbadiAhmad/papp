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

function QuestionInput({ question, value, onChange }: { question: FillableQuestion; value: unknown; onChange: (value: unknown) => void }) {
  const { t } = useTranslation();

  switch (question.type) {
    case 'short_text':
      return <TextField fullWidth value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'paragraph':
      return <TextField fullWidth multiline minRows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return (
        <TextField type="date" slotProps={{ inputLabel: { shrink: true } }} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      );
    case 'time':
      return (
        <TextField type="time" slotProps={{ inputLabel: { shrink: true } }} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      );
    case 'single_choice':
      return (
        <RadioGroup value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          {question.options.map((option) => (
            <FormControlLabel key={option.value} value={option.value} control={<Radio />} label={option.label} />
          ))}
        </RadioGroup>
      );
    case 'dropdown':
      return (
        <TextField select fullWidth value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          {question.options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'multi_choice': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <FormGroup>
          {question.options.map((option) => (
            <FormControlLabel
              key={option.value}
              control={
                <Checkbox
                  checked={selected.includes(option.value)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))
                  }
                />
              }
              label={option.label}
            />
          ))}
        </FormGroup>
      );
    }
    case 'linear_scale':
    case 'rating': {
      const min = question.type === 'linear_scale' ? (Number(question.config?.min) || 1) : 1;
      const max = Number(question.config?.max) || 5;
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
  const currentSectionId = trail[trail.length - 1] ?? visibility.pathSectionIds[0] ?? null;
  const currentSection = survey?.sections.find((s) => s.id === currentSectionId) ?? null;
  const nextSectionId =
    survey && currentSectionId ? resolveNextSectionId(survey.sections, survey.logicRules, enumerationAnswers, currentSectionId) : null;
  const pageNumber = Math.max(1, visibility.pathSectionIds.indexOf(currentSectionId ?? '') + 1);

  const isEmptyAnswer = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

  /** Required, currently visible questions of the open page that still have no answer. */
  const findMissingOnPage = (): Set<string> => {
    const result = new Set<string>();
    for (const question of currentSection?.questions ?? []) {
      if (visibility.visibleQuestionIds.has(question.id) && question.required && isEmptyAnswer(answers[question.id])) result.add(question.id);
    }
    return result;
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const handleNext = () => {
    if (!currentSectionId || !nextSectionId) return;
    const pending = findMissingOnPage();
    setMissing(pending);
    if (pending.size > 0) return;
    setTrail([...(trail.length ? trail : [currentSectionId]), nextSectionId]);
    scrollToTop();
  };

  const handleBack = () => {
    if (trail.length < 2) return;
    setMissing(new Set());
    setTrail(trail.slice(0, -1));
    scrollToTop();
  };

  const handleAnswerChange = (questionId: string, value: unknown) => {
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
    if (pending.size > 0) return;
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
                        <QuestionInput question={question} value={answers[question.id]} onChange={(value) => handleAnswerChange(question.id, value)} />
                      </Box>
                      {missing.has(question.id) ? (
                        <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                          {t('survey.take.required_field')}
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
