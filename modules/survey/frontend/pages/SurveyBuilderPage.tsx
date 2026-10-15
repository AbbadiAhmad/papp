import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { validateOptionValues, validateQuestionConfig, type QuestionTypeName } from '../../backend/question-rules.ts';
import { QuestionSettings } from '../components/QuestionSettings';
import { SharePanel } from '../components/SharePanel';
import { SurveyPreviewDialog } from '../components/SurveyPreviewDialog';
import { useUnsavedChangesGuard } from '../components/useUnsavedChangesGuard';
import { toFillableSurvey } from '../previewSurvey';
import { fromLocalInput, toLocalInput } from '../schedule';
import {
  ENUMERATION_QUESTION_TYPES,
  SURVEY_QUESTION_TYPES,
  surveyApi,
  type SurveyDetail,
  type SectionNavigation,
  type SurveyLogicRuleDto,
  type SurveyQuestionDto,
  type FillableSurvey,
  type SurveyQuestionType,
  type SurveySectionDto,
} from '../api';

function newId(): string {
  return crypto.randomUUID();
}

function newOption(orderIndex: number) {
  return { id: newId(), orderIndex, value: '', label: '' };
}

function newQuestion(orderIndex: number): SurveyQuestionDto {
  return { id: newId(), orderIndex, type: 'short_text', title: '', required: false, options: [] };
}

function newSection(orderIndex: number): SurveySectionDto {
  return { id: newId(), orderIndex, title: '', questions: [] };
}

function reindex<T extends { orderIndex: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, orderIndex: index }));
}

/** Navigation with every reference to `sectionId` removed (default -> next section, routes dropped). */
function withoutTarget(navigation: SectionNavigation | undefined, sectionId: string): SectionNavigation | undefined {
  if (!navigation) return navigation;
  return {
    defaultTarget: navigation.defaultTarget === sectionId ? null : navigation.defaultTarget,
    routes: (navigation.routes ?? []).filter((r) => r.target !== sectionId),
  };
}

/** A copy of a question with brand-new ids (options too); logic rules are deliberately not copied. */
function cloneQuestion(question: SurveyQuestionDto, titleSuffix: string): SurveyQuestionDto {
  return { ...question, id: newId(), title: `${question.title}${titleSuffix}`, options: (question.options ?? []).map((o) => ({ ...o, id: newId() })) };
}

/** What counts as "unsaved changes": the survey settings plus the whole structure. */
function snapshotOf(survey: SurveyDetail, sections: SurveySectionDto[], logicRules: SurveyLogicRuleDto[]): string {
  const { title, description, requiresLogin, allowEditAfterSubmit, oneResponsePerRespondent, notifyOwnerOnSubmit, notifyEmails, opensAt, closesAt, closedMessage, responseLimit, settings } = survey;
  return JSON.stringify({ title, description, requiresLogin, allowEditAfterSubmit, oneResponsePerRespondent, notifyOwnerOnSubmit, notifyEmails, opensAt, closesAt, closedMessage, responseLimit, settings, sections, logicRules });
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The whole-canvas structure editor — one `PUT .../structure` save (see
 * SurveysService.replaceStructure's own docblock) rather than granular
 * per-section/question endpoints. Every new section/question/option gets a
 * REAL client-generated UUID the moment it's added (SurveyStructureDto's own
 * comment: no server-side temp-id remapping needed anywhere), which is also
 * what lets a logic rule reference a brand-new same-payload question.
 */
export function SurveyBuilderPage() {
  const { t } = useTranslation();
  const { surveyId } = useParams<{ surveyId: string }>();
  const navigate = useNavigate();
  const gated = useGatedCall();

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [sections, setSections] = useState<SurveySectionDto[]>([]);
  const [logicRules, setLogicRules] = useState<SurveyLogicRuleDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [previewSurvey, setPreviewSurvey] = useState<FillableSurvey | null>(null);
  const [moveMenu, setMoveMenu] = useState<{ anchor: HTMLElement; sectionIndex: number; questionIndex: number } | null>(null);

  useEffect(() => {
    if (!surveyId) return;
    surveyApi
      .get(surveyId)
      .then((data) => {
        const loadedSections = data.sections.length ? data.sections : [newSection(0)];
        setSurvey(data);
        setSections(loadedSections);
        setLogicRules(data.logicRules);
        setSavedSnapshot(snapshotOf(data, loadedSections, data.logicRules));
      })
      .catch((error: unknown) => setLoadError(extractErrorMessage(error)));
  }, [surveyId]);

  const dirty = useMemo(
    () => survey !== null && savedSnapshot !== null && snapshotOf(survey, sections, logicRules) !== savedSnapshot,
    [survey, sections, logicRules, savedSnapshot],
  );
  useUnsavedChangesGuard(dirty, t('survey.builder.unsaved_confirm'));

  if (!surveyId) return null;
  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!survey) return null;

  const allQuestions = sections.flatMap((s) => s.questions);
  const scheduleInvalid = Boolean(survey.opensAt && survey.closesAt && new Date(survey.closesAt).getTime() <= new Date(survey.opensAt).getTime());

  const updateSurveySettings = (patch: Partial<SurveyDetail>) => setSurvey({ ...survey, ...patch });

  const updateSection = (sectionIndex: number, patch: Partial<SurveySectionDto>) => {
    setSections((prev) => prev.map((s, i) => (i === sectionIndex ? { ...s, ...patch } : s)));
  };

  const updateQuestion = (sectionIndex: number, questionIndex: number, patch: Partial<SurveyQuestionDto>) => {
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIndex ? { ...s, questions: s.questions.map((q, j) => (j === questionIndex ? { ...q, ...patch } : q)) } : s,
      ),
    );
  };

  const addSection = () => setSections((prev) => [...prev, newSection(prev.length)]);
  // Rules pointing at a removed section/question are dropped with it — a
  // dangling rule is what made the structure save fail with a 400.
  const dropRulesFor = (ids: string[]) =>
    setLogicRules((prev) => reindex(prev.filter((r) => !ids.includes(r.sourceQuestionId) && !ids.includes(r.targetId))));
  const removeSection = (sectionIndex: number) => {
    const removed = sections[sectionIndex];
    if (removed) dropRulesFor([removed.id, ...removed.questions.map((q) => q.id)]);
    // Navigation pointing at the removed section falls back to "next section".
    setSections((prev) =>
      reindex(prev.filter((_, i) => i !== sectionIndex)).map((s) => ({
        ...s,
        navigation: removed ? withoutTarget(s.navigation, removed.id) : s.navigation,
      })),
    );
  };
  const moveSection = (sectionIndex: number, direction: -1 | 1) =>
    setSections((prev) => reindex(move(prev, sectionIndex, sectionIndex + direction)));

  const addQuestion = (sectionIndex: number) =>
    setSections((prev) =>
      prev.map((s, i) => (i === sectionIndex ? { ...s, questions: [...s.questions, newQuestion(s.questions.length)] } : s)),
    );
  const removeQuestion = (sectionIndex: number, questionIndex: number) => {
    const removed = sections[sectionIndex]?.questions[questionIndex];
    if (removed) dropRulesFor([removed.id]);
    setSections((prev) =>
      prev.map((s, i) => (i === sectionIndex ? { ...s, questions: reindex(s.questions.filter((_, j) => j !== questionIndex)) } : s)),
    );
  };
  const moveQuestion = (sectionIndex: number, questionIndex: number, direction: -1 | 1) =>
    setSections((prev) =>
      prev.map((s, i) => (i === sectionIndex ? { ...s, questions: reindex(move(s.questions, questionIndex, questionIndex + direction)) } : s)),
    );

  const duplicateQuestion = (sectionIndex: number, questionIndex: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIndex
          ? {
              ...s,
              questions: reindex([...s.questions.slice(0, questionIndex + 1), cloneQuestion(s.questions[questionIndex], t('survey.builder.copy_suffix')), ...s.questions.slice(questionIndex + 1)]),
            }
          : s,
      ),
    );
  const duplicateSection = (sectionIndex: number) =>
    setSections((prev) => {
      const original = prev[sectionIndex];
      // Navigation is not copied: its routes point at this section's own questions.
      const copy: SurveySectionDto = {
        ...original,
        id: newId(),
        title: `${original.title}${t('survey.builder.copy_suffix')}`,
        navigation: undefined,
        questions: original.questions.map((q) => cloneQuestion(q, '')),
      };
      return reindex([...prev.slice(0, sectionIndex + 1), copy, ...prev.slice(sectionIndex + 1)]);
    });
  /** Appends the question to the end of another section. Rules that would make it show/hide its new own section are dropped. */
  const moveQuestionToSection = (sectionIndex: number, questionIndex: number, targetSectionId: string) => {
    const question = sections[sectionIndex]?.questions[questionIndex];
    if (!question) return;
    setLogicRules((prev) => reindex(prev.filter((r) => !(r.targetType === 'section' && r.targetId === targetSectionId && r.sourceQuestionId === question.id))));
    setSections((prev) =>
      prev.map((s, i) => {
        if (i === sectionIndex) return { ...s, questions: reindex(s.questions.filter((_, j) => j !== questionIndex)) };
        if (s.id === targetSectionId) return { ...s, questions: reindex([...s.questions, question]) };
        return s;
      }),
    );
  };

  const addOption = (sectionIndex: number, questionIndex: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIndex
          ? {
              ...s,
              questions: s.questions.map((q, j) => (j === questionIndex ? { ...q, options: [...(q.options ?? []), newOption((q.options ?? []).length)] } : q)),
            }
          : s,
      ),
    );
  const updateOption = (sectionIndex: number, questionIndex: number, optionIndex: number, patch: { value?: string; label?: string }) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIndex
          ? {
              ...s,
              questions: s.questions.map((q, j) =>
                j === questionIndex ? { ...q, options: (q.options ?? []).map((o, k) => (k === optionIndex ? { ...o, ...patch } : o)) } : q,
              ),
            }
          : s,
      ),
    );
  const removeOption = (sectionIndex: number, questionIndex: number, optionIndex: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === sectionIndex
          ? {
              ...s,
              questions: s.questions.map((q, j) =>
                j === questionIndex ? { ...q, options: reindex((q.options ?? []).filter((_, k) => k !== optionIndex)) } : q,
              ),
            }
          : s,
      ),
    );

  // --- conditional logic (rendered inside each section) ------------------
  // A condition lives in the section it controls: its target is either that
  // whole section or one of that section's questions. Its source can be any
  // choice question in a DIFFERENT section — a question can never show/hide
  // its own section (the API rejects that too).
  const optionValueOf = (o: { value: string; label: string }) => o.value.trim() || o.label.trim();
  const sourceCandidates = (section: SurveySectionDto) =>
    sections
      .filter((other) => other.id !== section.id)
      .flatMap((other) => other.questions)
      .filter((q) => ENUMERATION_QUESTION_TYPES.includes(q.type) && (q.options ?? []).some((o) => optionValueOf(o)));
  const rulesOfSection = (section: SurveySectionDto) =>
    logicRules
      .map((rule, index) => ({ rule, index }))
      .filter(
        ({ rule }) =>
          (rule.targetType === 'section' && rule.targetId === section.id) ||
          (rule.targetType === 'question' && section.questions.some((q) => q.id === rule.targetId)),
      );

  // --- section navigation ("after this section") --------------------------
  // Default is "continue to the next section"; a route sends the respondent
  // elsewhere for a given answer. Targets are always LATER sections or
  // 'submit', so a survey can never loop.
  const choiceQuestionsOf = (section: SurveySectionDto) =>
    section.questions.filter((q) => ENUMERATION_QUESTION_TYPES.includes(q.type) && (q.options ?? []).some((o) => optionValueOf(o)));
  const laterSections = (sectionIndex: number) => sections.slice(sectionIndex + 1);
  const updateNavigation = (sectionIndex: number, patch: Partial<SectionNavigation>) =>
    updateSection(sectionIndex, { navigation: { ...sections[sectionIndex].navigation, ...patch } });
  const addRoute = (sectionIndex: number) => {
    const section = sections[sectionIndex];
    const source = choiceQuestionsOf(section)[0];
    const option = source?.options?.find((o) => optionValueOf(o));
    if (!source || !option) return;
    updateNavigation(sectionIndex, {
      routes: [
        ...(section.navigation?.routes ?? []),
        { sourceQuestionId: source.id, sourceOptionValue: optionValueOf(option), target: laterSections(sectionIndex)[0]?.id ?? 'submit' },
      ],
    });
  };
  const updateRoute = (sectionIndex: number, routeIndex: number, patch: Partial<NonNullable<SectionNavigation['routes']>[number]>) =>
    updateNavigation(sectionIndex, {
      routes: (sections[sectionIndex].navigation?.routes ?? []).map((r, i) => (i === routeIndex ? { ...r, ...patch } : r)),
    });
  const removeRoute = (sectionIndex: number, routeIndex: number) =>
    updateNavigation(sectionIndex, { routes: (sections[sectionIndex].navigation?.routes ?? []).filter((_, i) => i !== routeIndex) });

  const addLogicRule = (section: SurveySectionDto) => {
    const source = sourceCandidates(section)[0];
    const firstOption = source?.options?.find((o) => optionValueOf(o));
    if (!source || !firstOption) return;
    setLogicRules((prev) => [
      ...prev,
      {
        sourceQuestionId: source.id,
        sourceOptionValue: optionValueOf(firstOption),
        action: 'show',
        targetType: 'section',
        targetId: section.id,
        orderIndex: prev.length,
      },
    ]);
  };
  const updateLogicRule = (index: number, patch: Partial<SurveyLogicRuleDto>) =>
    setLogicRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const removeLogicRule = (index: number) => setLogicRules((prev) => reindex(prev.filter((_, i) => i !== index)));
  const changeRuleSource = (index: number, questionId: string) => {
    const first = allQuestions.find((q) => q.id === questionId)?.options?.find((o) => optionValueOf(o));
    updateLogicRule(index, { sourceQuestionId: questionId, sourceOptionValue: first ? optionValueOf(first) : '' });
  };

  /** Returns the cleaned payload, or an i18n key describing what is incomplete. */
  const buildPayload = (): { sections: SurveySectionDto[]; logicRules: SurveyLogicRuleDto[] } | { errorKey: string; params?: Record<string, unknown> } => {
    const cleanSections: SurveySectionDto[] = [];
    for (const section of sections) {
      if (!section.title.trim()) return { errorKey: 'survey.builder.error_section_title' };
      const questions: SurveyQuestionDto[] = [];
      for (const question of section.questions) {
        if (!question.title.trim()) return { errorKey: 'survey.builder.error_question_title' };
        let options = question.options ?? [];
        if (ENUMERATION_QUESTION_TYPES.includes(question.type)) {
          if (options.length === 0) return { errorKey: 'survey.builder.error_no_options' };
          if (options.some((o) => !optionValueOf(o))) return { errorKey: 'survey.builder.error_option_empty' };
          options = options.map((o) => ({ ...o, value: optionValueOf(o), label: o.label.trim() || optionValueOf(o) }));
        }
        // Drop settings that went stale (an "exclusive" option that was renamed or removed), then
        // check the rest with the same rules the server applies, so the owner gets a translated hint.
        const optionValues = options.map((o) => o.value);
        let config = { ...(question.config ?? {}) };
        if (typeof config.exclusiveOptionValue === 'string' && !optionValues.includes(config.exclusiveOptionValue)) delete config.exclusiveOptionValue;
        const problem =
          (ENUMERATION_QUESTION_TYPES.includes(question.type) ? validateOptionValues(optionValues) : null) ??
          validateQuestionConfig(question.type as QuestionTypeName, config, optionValues);
        if (problem) {
          return { errorKey: `survey.config_rules.${problem.code}`, params: { ...problem.params, title: question.title } };
        }
        questions.push({ ...question, options, config });
      }
      cleanSections.push({ ...section, questions });
    }
    // Navigation: drop anything stale (moved/removed sections, changed options) instead of failing the save.
    const sectionIndexById = new Map(cleanSections.map((s, i) => [s.id, i] as const));
    cleanSections.forEach((section, index) => {
      const validTarget = (target: string | null | undefined) =>
        !target || target === 'submit' || (sectionIndexById.get(target) ?? -1) > index;
      const nav = section.navigation;
      const routes = (nav?.routes ?? []).filter((r) => {
        const source = section.questions.find((q) => q.id === r.sourceQuestionId);
        return validTarget(r.target) && source?.options?.some((o) => o.value === r.sourceOptionValue);
      });
      section.navigation = {
        defaultTarget: validTarget(nav?.defaultTarget) ? (nav?.defaultTarget ?? null) : null,
        routes,
      };
    });
    const questionsById = new Map(cleanSections.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
    const sectionIds = new Set(cleanSections.map((s) => s.id));
    const cleanRules: SurveyLogicRuleDto[] = [];
    for (const rule of logicRules) {
      const source = questionsById.get(rule.sourceQuestionId);
      const targetExists = rule.targetType === 'section' ? sectionIds.has(rule.targetId) : questionsById.has(rule.targetId);
      // A rule whose source/target no longer exists is stale — drop it quietly.
      if (!source || !targetExists) continue;
      if (!(source.options ?? []).some((o) => o.value === rule.sourceOptionValue)) return { errorKey: 'survey.builder.error_rule_incomplete' };
      cleanRules.push({ ...rule, orderIndex: cleanRules.length });
    }
    return { sections: cleanSections, logicRules: cleanRules };
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    if (scheduleInvalid) {
      setSaveError(t('survey.builder.schedule_invalid'));
      setSaving(false);
      return;
    }
    const payload = buildPayload();
    if ('errorKey' in payload) {
      setSaveError(t(payload.errorKey, payload.params));
      setSaving(false);
      return;
    }
    try {
      await gated('survey.surveys.update', () =>
        surveyApi.update(surveyId, {
          title: survey.title,
          description: survey.description ?? undefined,
          requiresLogin: survey.requiresLogin,
          allowEditAfterSubmit: survey.allowEditAfterSubmit,
          oneResponsePerRespondent: survey.oneResponsePerRespondent,
          notifyOwnerOnSubmit: survey.notifyOwnerOnSubmit,
          notifyEmails: survey.notifyEmails,
          opensAt: survey.opensAt,
          closesAt: survey.closesAt,
          closedMessage: survey.closedMessage ?? '',
          responseLimit: survey.responseLimit,
          thankYouMessage: survey.settings?.thankYouMessage ?? '',
          showProgressBar: survey.settings?.showProgressBar === true,
        }),
      );
      const updated = await gated('survey.surveys.update', () => surveyApi.replaceStructure(surveyId, payload));
      setSurvey(updated);
      setSections(updated.sections);
      setLogicRules(updated.logicRules);
      setSavedSnapshot(snapshotOf(updated, updated.sections, updated.logicRules));
      setSnackbar(t('survey.builder.saved'));
    } catch (error) {
      setSaveError(extractErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const openPreview = () => {
    setSaveError(null);
    const payload = buildPayload();
    if ('errorKey' in payload) {
      setSaveError(t(payload.errorKey, payload.params));
      return;
    }
    setPreviewSurvey(toFillableSurvey(survey, payload.sections, payload.logicRules));
  };

  const leave = () => {
    if (!dirty || window.confirm(t('survey.builder.unsaved_confirm'))) navigate('/survey/surveys');
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{survey.title || t('survey.builder.untitled')}</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          {dirty ? (
            <Typography variant="body2" color="warning.main" role="status">
              {t('survey.builder.unsaved_badge')}
            </Typography>
          ) : null}
          <Button onClick={leave}>{t('core.common.back')}</Button>
          <Button onClick={openPreview}>{t('survey.builder.preview')}</Button>
          <Button onClick={() => setShareOpen(true)}>{t('survey.share.button')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {t('core.common.save')}
          </Button>
        </Stack>
      </Stack>

      {saveError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError}
        </Alert>
      ) : null}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          {t('survey.builder.settings')}
        </Typography>
        <Stack spacing={2}>
          <TextField label={t('survey.fields.title')} value={survey.title} onChange={(e) => updateSurveySettings({ title: e.target.value })} required />
          <TextField
            label={t('survey.fields.description')}
            value={survey.description ?? ''}
            onChange={(e) => updateSurveySettings({ description: e.target.value })}
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Checkbox checked={survey.requiresLogin} onChange={(e) => updateSurveySettings({ requiresLogin: e.target.checked })} />}
              label={t('survey.fields.requires_login')}
            />
            <FormControlLabel
              control={
                <Checkbox checked={survey.allowEditAfterSubmit} onChange={(e) => updateSurveySettings({ allowEditAfterSubmit: e.target.checked })} />
              }
              label={t('survey.fields.allow_edit_after_submit')}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={survey.oneResponsePerRespondent}
                  onChange={(e) => updateSurveySettings({ oneResponsePerRespondent: e.target.checked })}
                />
              }
              label={t('survey.fields.one_response_per_respondent')}
            />
            <FormControlLabel
              control={
                <Checkbox checked={survey.notifyOwnerOnSubmit} onChange={(e) => updateSurveySettings({ notifyOwnerOnSubmit: e.target.checked })} />
              }
              label={t('survey.fields.notify_owner_on_submit')}
            />
          </Stack>
          <TextField
            label={t('survey.fields.closed_message')}
            helperText={t('survey.builder.closed_message_hint')}
            value={survey.closedMessage ?? ''}
            onChange={(e) => updateSurveySettings({ closedMessage: e.target.value })}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
          />
          <Typography variant="subtitle2" sx={{ pt: 1 }}>
            {t('survey.builder.availability')}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
            <TextField
              type="datetime-local"
              label={t('survey.fields.opens_at')}
              value={toLocalInput(survey.opensAt)}
              onChange={(e) => updateSurveySettings({ opensAt: fromLocalInput(e.target.value) })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 240 }}
            />
            <TextField
              type="datetime-local"
              label={t('survey.fields.closes_at')}
              value={toLocalInput(survey.closesAt)}
              onChange={(e) => updateSurveySettings({ closesAt: fromLocalInput(e.target.value) })}
              slotProps={{ inputLabel: { shrink: true } }}
              error={scheduleInvalid}
              helperText={scheduleInvalid ? t('survey.builder.schedule_invalid') : undefined}
              sx={{ minWidth: 240 }}
            />
            <TextField
              type="number"
              label={t('survey.fields.response_limit')}
              value={survey.responseLimit ?? ''}
              onChange={(e) => updateSurveySettings({ responseLimit: e.target.value === '' ? null : Number(e.target.value) })}
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              sx={{ width: 240 }}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: '-8px !important' }}>
            {t('survey.builder.availability_hint')}
          </Typography>
          <TextField
            label={t('survey.fields.thank_you_message')}
            helperText={t('survey.builder.thank_you_hint')}
            value={survey.settings?.thankYouMessage ?? ''}
            onChange={(e) => updateSurveySettings({ settings: { ...survey.settings, thankYouMessage: e.target.value } })}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 4000 } }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={survey.settings?.showProgressBar === true}
                onChange={(e) => updateSurveySettings({ settings: { ...survey.settings, showProgressBar: e.target.checked } })}
              />
            }
            label={t('survey.fields.show_progress_bar')}
          />
          <TextField
            label={t('survey.fields.notify_emails')}
            helperText={t('survey.builder.notify_emails_hint')}
            value={survey.notifyEmails.join(', ')}
            onChange={(e) =>
              updateSurveySettings({
                notifyEmails: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Stack>
      </Paper>

      <Stack spacing={2}>
        {sections.map((section, sectionIndex) => (
          <Paper key={section.id} sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <TextField
                label={t('survey.fields.section_title')}
                value={section.title}
                onChange={(e) => updateSection(sectionIndex, { title: e.target.value })}
                fullWidth
                required
              />
              <IconButton disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton disabled={sectionIndex === sections.length - 1} onClick={() => moveSection(sectionIndex, 1)}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton aria-label={t('survey.builder.duplicate_section')} title={t('survey.builder.duplicate_section')} onClick={() => duplicateSection(sectionIndex)}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
              <IconButton disabled={sections.length <= 1} onClick={() => removeSection(sectionIndex)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
            <TextField
              label={t('survey.fields.section_description')}
              value={section.description ?? ''}
              onChange={(e) => updateSection(sectionIndex, { description: e.target.value })}
              fullWidth
              multiline
              minRows={1}
              size="small"
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              sx={{ mb: 1.5 }}
            />

            <Stack spacing={2} sx={{ pl: 2, borderInlineStart: '2px solid', borderColor: 'divider' }}>
              {section.questions.map((question, questionIndex) => (
                <Box key={question.id}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <TextField
                      label={t('survey.fields.question_title')}
                      value={question.title}
                      onChange={(e) => updateQuestion(sectionIndex, questionIndex, { title: e.target.value })}
                      sx={{ flex: 2, minWidth: 200 }}
                      required
                    />
                    <TextField
                      select
                      label={t('survey.fields.question_type')}
                      value={question.type}
                      onChange={(e) =>
                        updateQuestion(sectionIndex, questionIndex, { type: e.target.value as SurveyQuestionType, options: [], config: {} })
                      }
                      sx={{ minWidth: 160 }}
                    >
                      {SURVEY_QUESTION_TYPES.map((type) => (
                        <MenuItem key={type} value={type}>
                          {t(`survey.question_type.${type}`)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={question.required ?? false}
                          onChange={(e) => updateQuestion(sectionIndex, questionIndex, { required: e.target.checked })}
                        />
                      }
                      label={t('survey.fields.required')}
                    />
                    <IconButton disabled={questionIndex === 0} onClick={() => moveQuestion(sectionIndex, questionIndex, -1)}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      disabled={questionIndex === section.questions.length - 1}
                      onClick={() => moveQuestion(sectionIndex, questionIndex, 1)}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label={t('survey.builder.duplicate_question')} title={t('survey.builder.duplicate_question')} onClick={() => duplicateQuestion(sectionIndex, questionIndex)}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                    {sections.length > 1 ? (
                      <IconButton
                        aria-label={t('survey.builder.move_to_section')}
                        title={t('survey.builder.move_to_section')}
                        onClick={(e) => setMoveMenu({ anchor: e.currentTarget, sectionIndex, questionIndex })}
                      >
                        <DriveFileMoveIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                    <IconButton onClick={() => removeQuestion(sectionIndex, questionIndex)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>

                  <TextField
                    label={t('survey.fields.question_hint')}
                    value={question.description ?? ''}
                    onChange={(e) => updateQuestion(sectionIndex, questionIndex, { description: e.target.value })}
                    size="small"
                    fullWidth
                    sx={{ pl: 2, mt: 1 }}
                    slotProps={{ htmlInput: { maxLength: 2000 } }}
                  />

                  {question.type === 'linear_scale' ? (
                    <Stack direction="row" spacing={1} sx={{ pl: 2, mt: 1 }}>
                      <TextField
                        size="small"
                        type="number"
                        label={t('survey.fields.scale_min')}
                        value={(question.config?.min as number | undefined) ?? 1}
                        onChange={(e) => updateQuestion(sectionIndex, questionIndex, { config: { ...question.config, min: Number(e.target.value) } })}
                        sx={{ width: 100 }}
                      />
                      <TextField
                        size="small"
                        type="number"
                        label={t('survey.fields.scale_max')}
                        value={(question.config?.max as number | undefined) ?? 5}
                        onChange={(e) => updateQuestion(sectionIndex, questionIndex, { config: { ...question.config, max: Number(e.target.value) } })}
                        sx={{ width: 100 }}
                      />
                    </Stack>
                  ) : null}

                  {question.type === 'rating' ? (
                    <Stack direction="row" spacing={1} sx={{ pl: 2, mt: 1 }}>
                      <TextField
                        size="small"
                        type="number"
                        label={t('survey.fields.scale_max')}
                        value={(question.config?.max as number | undefined) ?? 5}
                        onChange={(e) => updateQuestion(sectionIndex, questionIndex, { config: { ...question.config, max: Number(e.target.value) } })}
                        sx={{ width: 100 }}
                      />
                    </Stack>
                  ) : null}

                  {ENUMERATION_QUESTION_TYPES.includes(question.type) ? (
                    <Stack spacing={1} sx={{ pl: 2, mt: 1 }}>
                      {(question.options ?? []).map((option, optionIndex) => (
                        <Stack key={option.id} direction="row" spacing={1}>
                          <TextField
                            size="small"
                            label={t('survey.fields.option_value')}
                            value={option.value}
                            onChange={(e) => updateOption(sectionIndex, questionIndex, optionIndex, { value: e.target.value })}
                          />
                          <TextField
                            size="small"
                            label={t('survey.fields.option_label')}
                            value={option.label}
                            onChange={(e) => updateOption(sectionIndex, questionIndex, optionIndex, { label: e.target.value })}
                          />
                          <IconButton size="small" onClick={() => removeOption(sectionIndex, questionIndex, optionIndex)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      ))}
                      <Box>
                        <Button size="small" startIcon={<AddIcon />} onClick={() => addOption(sectionIndex, questionIndex)}>
                          {t('survey.builder.add_option')}
                        </Button>
                      </Box>
                    </Stack>
                  ) : null}

                  <QuestionSettings
                    question={question}
                    onConfigChange={(config) => updateQuestion(sectionIndex, questionIndex, { config })}
                  />
                </Box>
              ))}
              <Box>
                <Button size="small" startIcon={<AddIcon />} onClick={() => addQuestion(sectionIndex)}>
                  {t('survey.builder.add_question')}
                </Button>
              </Box>
            </Stack>

            <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2">{t('survey.builder.logic_rules')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {t('survey.builder.logic_rules_hint')}
              </Typography>
              <Stack spacing={1.5}>
                {rulesOfSection(section).map(({ rule, index }) => {
                  const sourceQuestion = allQuestions.find((q) => q.id === rule.sourceQuestionId);
                  const sources = sourceCandidates(section);
                  const targetKey = `${rule.targetType}:${rule.targetId}`;
                  return (
                    <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                      <TextField
                        select
                        size="small"
                        label={t('survey.fields.logic_source_question')}
                        value={sources.some((q) => q.id === rule.sourceQuestionId) ? rule.sourceQuestionId : ''}
                        onChange={(e) => changeRuleSource(index, e.target.value)}
                        sx={{ minWidth: 180 }}
                      >
                        {sources.map((q) => (
                          <MenuItem key={q.id} value={q.id}>
                            {q.title || t('survey.builder.untitled_question')}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label={t('survey.fields.logic_option_value')}
                        value={(sourceQuestion?.options ?? []).some((o) => optionValueOf(o) === rule.sourceOptionValue) ? rule.sourceOptionValue : ''}
                        onChange={(e) => updateLogicRule(index, { sourceOptionValue: e.target.value })}
                        sx={{ minWidth: 140 }}
                      >
                        {(sourceQuestion?.options ?? [])
                          .filter((o) => optionValueOf(o))
                          .map((o) => (
                            <MenuItem key={o.id} value={optionValueOf(o)}>
                              {o.label || o.value}
                            </MenuItem>
                          ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label={t('survey.fields.logic_action')}
                        value={rule.action}
                        onChange={(e) => updateLogicRule(index, { action: e.target.value as 'show' | 'hide' })}
                        sx={{ minWidth: 110 }}
                      >
                        <MenuItem value="show">{t('survey.builder.action_show')}</MenuItem>
                        <MenuItem value="hide">{t('survey.builder.action_hide')}</MenuItem>
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label={t('survey.fields.logic_target')}
                        value={targetKey}
                        onChange={(e) => {
                          const [targetType, ...rest] = e.target.value.split(':');
                          updateLogicRule(index, { targetType: targetType as 'section' | 'question', targetId: rest.join(':') });
                        }}
                        sx={{ minWidth: 200 }}
                      >
                        <MenuItem value={`section:${section.id}`}>{t('survey.builder.target_this_section')}</MenuItem>
                        {section.questions.map((q) => (
                          <MenuItem key={q.id} value={`question:${q.id}`}>
                            {q.title || t('survey.builder.untitled_question')}
                          </MenuItem>
                        ))}
                      </TextField>
                      <IconButton size="small" onClick={() => removeLogicRule(index)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  );
                })}
                <Box>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => addLogicRule(section)} disabled={sourceCandidates(section).length === 0}>
                    {t('survey.builder.add_logic_rule')}
                  </Button>
                  {sourceCandidates(section).length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ marginInlineStart: 1 }}>
                      {t('survey.builder.logic_needs_source')}
                    </Typography>
                  ) : null}
                </Box>
              </Stack>
            </Box>

            <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2">{t('survey.builder.navigation_title')}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {t('survey.builder.navigation_hint')}
              </Typography>
              <Stack spacing={1.5}>
                {(section.navigation?.routes ?? []).map((route, routeIndex) => {
                  const routeSource = section.questions.find((q) => q.id === route.sourceQuestionId);
                  return (
                    <Stack key={routeIndex} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                      <TextField
                        select
                        size="small"
                        label={t('survey.fields.logic_source_question')}
                        value={choiceQuestionsOf(section).some((q) => q.id === route.sourceQuestionId) ? route.sourceQuestionId : ''}
                        onChange={(e) => {
                          const first = section.questions.find((q) => q.id === e.target.value)?.options?.find((o) => optionValueOf(o));
                          updateRoute(sectionIndex, routeIndex, { sourceQuestionId: e.target.value, sourceOptionValue: first ? optionValueOf(first) : '' });
                        }}
                        sx={{ minWidth: 180 }}
                      >
                        {choiceQuestionsOf(section).map((q) => (
                          <MenuItem key={q.id} value={q.id}>
                            {q.title || t('survey.builder.untitled_question')}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label={t('survey.fields.logic_option_value')}
                        value={(routeSource?.options ?? []).some((o) => optionValueOf(o) === route.sourceOptionValue) ? route.sourceOptionValue : ''}
                        onChange={(e) => updateRoute(sectionIndex, routeIndex, { sourceOptionValue: e.target.value })}
                        sx={{ minWidth: 140 }}
                      >
                        {(routeSource?.options ?? [])
                          .filter((o) => optionValueOf(o))
                          .map((o) => (
                            <MenuItem key={o.id} value={optionValueOf(o)}>
                              {o.label || o.value}
                            </MenuItem>
                          ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label={t('survey.builder.go_to')}
                        value={route.target === 'submit' || laterSections(sectionIndex).some((s) => s.id === route.target) ? route.target : ''}
                        onChange={(e) => updateRoute(sectionIndex, routeIndex, { target: e.target.value })}
                        sx={{ minWidth: 200 }}
                      >
                        {laterSections(sectionIndex).map((s) => (
                          <MenuItem key={s.id} value={s.id}>
                            {s.title || t('survey.builder.untitled_section')}
                          </MenuItem>
                        ))}
                        <MenuItem value="submit">{t('survey.builder.submit_survey')}</MenuItem>
                      </TextField>
                      <IconButton size="small" onClick={() => removeRoute(sectionIndex, routeIndex)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  );
                })}
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                  <TextField
                    select
                    size="small"
                    label={t('survey.builder.otherwise_go_to')}
                    value={
                      section.navigation?.defaultTarget === 'submit' || laterSections(sectionIndex).some((s) => s.id === section.navigation?.defaultTarget)
                        ? (section.navigation?.defaultTarget as string)
                        : 'next'
                    }
                    onChange={(e) => updateNavigation(sectionIndex, { defaultTarget: e.target.value === 'next' ? null : e.target.value })}
                    sx={{ minWidth: 220 }}
                  >
                    <MenuItem value="next">{t('survey.builder.next_section')}</MenuItem>
                    {laterSections(sectionIndex).map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.title || t('survey.builder.untitled_section')}
                      </MenuItem>
                    ))}
                    <MenuItem value="submit">{t('survey.builder.submit_survey')}</MenuItem>
                  </TextField>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => addRoute(sectionIndex)} disabled={choiceQuestionsOf(section).length === 0}>
                    {t('survey.builder.add_route')}
                  </Button>
                  {choiceQuestionsOf(section).length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('survey.builder.route_needs_choice')}
                    </Typography>
                  ) : null}
                </Stack>
              </Stack>
            </Box>
          </Paper>
        ))}
        <Box>
          <Button startIcon={<AddIcon />} onClick={addSection}>
            {t('survey.builder.add_section')}
          </Button>
        </Box>
      </Stack>

      <Menu anchorEl={moveMenu?.anchor} open={moveMenu !== null} onClose={() => setMoveMenu(null)}>
        {moveMenu
          ? sections
              .filter((_, i) => i !== moveMenu.sectionIndex)
              .map((target) => (
                <MenuItem
                  key={target.id}
                  onClick={() => {
                    moveQuestionToSection(moveMenu.sectionIndex, moveMenu.questionIndex, target.id);
                    setMoveMenu(null);
                  }}
                >
                  {target.title || t('survey.builder.untitled_section')}
                </MenuItem>
              ))
          : null}
      </Menu>

      <SharePanel open={shareOpen} onClose={() => setShareOpen(false)} surveyId={survey.id} title={survey.title} published={survey.status === 'published'} />
      <SurveyPreviewDialog open={previewSurvey !== null} onClose={() => setPreviewSurvey(null)} survey={previewSurvey} />

      <Snackbar open={snackbar !== null} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
