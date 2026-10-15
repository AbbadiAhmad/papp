import axios from 'axios';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../../../apps/web/src/app/AuthContext';
import { extractErrorMessage, isForbiddenError, isNotFoundError } from '../../../../apps/web/src/shared/api/httpClient';
import { SurveyRunner } from '../components/SurveyRunner';
import { surveyApi, type AnswerInput, type FillableSurvey } from '../api';

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

  const handleAnswerChange = (questionId: string, value: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      if (!canUseAuthenticatedFlow && !editContext) writeJson(draftKey, next);
      return next;
    });
  };

  const handleSubmit = async (payload: AnswerInput[]) => {
    if (!survey || !surveyId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
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
          <SurveyRunner
            survey={survey}
            answers={answers}
            onAnswerChange={handleAnswerChange}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitError={submitError}
          />
        ) : null}
      </Paper>
    </Box>
  );
}
