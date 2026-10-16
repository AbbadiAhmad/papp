import axios from 'axios';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { isValidEmail } from '../../backend/email-list.ts';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../../apps/web/src/app/AuthContext';
import { extractErrorMessage, isForbiddenError, isNotFoundError } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateTime } from '../../../../apps/web/src/shared/format';
import { SurveyRunner } from '../components/SurveyRunner';
import { surveyApi, type AnswerInput, type FillableSurvey } from '../api';

// 'not_found' also covers "exists but not published" — the backend never
// distinguishes the two to an anonymous/authenticated respondent
// (MODULE_SPEC.md §7.2, same rule library_catalog's own public route follows).
type PageState = 'loading' | 'ready' | 'restricted' | 'login_required' | 'not_found' | 'not_open_yet' | 'full' | 'error' | 'submitted';

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
  const { t, i18n } = useTranslation();
  const { surveyId } = useParams<{ surveyId: string }>();
  // A personal invitation link carries ?invite=...; the server checks it, the page only passes it along.
  const [searchParams] = useSearchParams();
  const invite = searchParams.get('invite');
  const [copyEmail, setCopyEmail] = useState('');
  const { status: authStatus, mustChangePassword } = useAuth();
  // A forced-password-change account is technically "authenticated" per
  // AuthContext's own status model, but FillController's
  // MustChangePasswordGuard would 403 it just like an anonymous caller —
  // route it through the public flow instead of the authenticated one.
  const canUseAuthenticatedFlow = authStatus === 'authenticated' && !mustChangePassword;

  const [pageState, setPageState] = useState<PageState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState<string | null>(null);
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

    const load = canUseAuthenticatedFlow ? surveyApi.getForFilling(surveyId, invite) : surveyApi.getForFillingPublic(surveyId, invite);
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
        // Response cap reached: only someone who already has a response of their own may still open it (to edit).
        const hasOwnResponse = Boolean(existingResponse) || (!canUseAuthenticatedFlow && Boolean(readJson<StoredSubmission>(submittedKey)) && loaded.allowEditAfterSubmit);
        if (loaded.isFull && !hasOwnResponse) {
          setClosedMessage(loaded.closedMessage ?? null);
          setPageState('full');
          return;
        }
        setPageState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isNotFoundError(error)) {
          const body = axios.isAxiosError(error)
            ? (error.response?.data as { closed?: boolean; closedMessage?: string | null; notOpenYet?: boolean; opensAt?: string | null } | undefined)
            : undefined;
          if (body?.notOpenYet) {
            setOpensAt(body.opensAt ?? null);
            setPageState('not_open_yet');
            return;
          }
          setClosedMessage(body?.closed ? (body.closedMessage ?? null) : null);
          setPageState('not_found');
          return;
        }
        if (isForbiddenError(error)) {
          // "By invitation only" is a different message from "please log in": a login may not help.
          const restricted = axios.isAxiosError(error) && (error.response?.data as { restricted?: boolean } | undefined)?.restricted === true;
          setPageState(restricted ? 'restricted' : 'login_required');
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
    setSubmitError(null);
    const typedCopy = copyEmail.trim();
    if (typedCopy && !isValidEmail(typedCopy)) {
      setSubmitError(t('survey.take.copy_email_invalid'));
      return;
    }
    setSubmitting(true);
    try {
      if (canUseAuthenticatedFlow) {
        await surveyApi.submitAuthenticated(surveyId, payload, invite);
      } else if (editContext) {
        await surveyApi.editPublic(surveyId, editContext.editToken, payload);
        writeJson(submittedKey, { responseId: '', editToken: editContext.editToken, answers } satisfies StoredSubmission);
      } else {
        const result = await surveyApi.submitPublic(surveyId, payload, { invite, copyToEmail: typedCopy || undefined });
        if (result.editToken) {
          writeJson(submittedKey, { responseId: result.responseId, editToken: result.editToken, answers } satisfies StoredSubmission);
          setReturnedEditToken(result.editToken);
        }
      }

      removeKey(draftKey);
      setPageState('submitted');
    } catch (error) {
      // The last free place may have been taken while this person was filling the form.
      if (axios.isAxiosError(error) && (error.response?.data as { full?: boolean } | undefined)?.full) {
        setPageState('full');
      } else {
        setSubmitError(extractErrorMessage(error));
      }
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
        {pageState === 'not_open_yet' ? (
          <Alert severity="info">{opensAt ? t('survey.take.not_open_yet_on', { date: formatDateTime(opensAt, i18n.language) }) : t('survey.take.not_open_yet')}</Alert>
        ) : null}
        {pageState === 'full' ? <Alert severity="warning">{closedMessage || t('survey.take.full')}</Alert> : null}
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
            <Alert severity="success" sx={{ whiteSpace: 'pre-wrap' }}>
              {survey?.thankYouMessage || t('survey.take.thank_you')}
            </Alert>
            {returnedEditToken && survey?.allowEditAfterSubmit ? (
              <Typography variant="body2" color="text.secondary">
                {t('survey.take.edit_hint')}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {pageState === 'restricted' ? (
          <Stack spacing={2}>
            <Alert severity="warning">{t('survey.take.restricted')}</Alert>
            {authStatus !== 'authenticated' ? (
              <Button variant="contained" href="/login">
                {t('survey.take.go_to_login')}
              </Button>
            ) : null}
          </Stack>
        ) : null}

        {pageState === 'ready' && survey?.emailCopy ? (
          canUseAuthenticatedFlow || invite ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('survey.take.copy_will_be_emailed')}
            </Alert>
          ) : (
            <TextField
              type="email"
              size="small"
              fullWidth
              sx={{ mb: 2 }}
              label={t('survey.take.copy_email')}
              helperText={t('survey.take.copy_email_hint')}
              value={copyEmail}
              onChange={(e) => setCopyEmail(e.target.value)}
            />
          )
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
