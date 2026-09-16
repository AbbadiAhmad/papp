import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import {
  ENUMERATION_QUESTION_TYPES,
  SURVEY_QUESTION_TYPES,
  surveyApi,
  type SurveyDetail,
  type SurveyLogicRuleDto,
  type SurveyQuestionDto,
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

  useEffect(() => {
    if (!surveyId) return;
    surveyApi
      .get(surveyId)
      .then((data) => {
        setSurvey(data);
        setSections(data.sections.length ? data.sections : [newSection(0)]);
        setLogicRules(data.logicRules);
      })
      .catch((error: unknown) => setLoadError(extractErrorMessage(error)));
  }, [surveyId]);

  if (!surveyId) return null;
  if (loadError) return <Alert severity="error">{loadError}</Alert>;
  if (!survey) return null;

  const allQuestions = sections.flatMap((s) => s.questions);
  const enumerationQuestions = allQuestions.filter((q) => ENUMERATION_QUESTION_TYPES.includes(q.type));

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
  const removeSection = (sectionIndex: number) =>
    setSections((prev) => reindex(prev.filter((_, i) => i !== sectionIndex)));
  const moveSection = (sectionIndex: number, direction: -1 | 1) =>
    setSections((prev) => reindex(move(prev, sectionIndex, sectionIndex + direction)));

  const addQuestion = (sectionIndex: number) =>
    setSections((prev) =>
      prev.map((s, i) => (i === sectionIndex ? { ...s, questions: [...s.questions, newQuestion(s.questions.length)] } : s)),
    );
  const removeQuestion = (sectionIndex: number, questionIndex: number) =>
    setSections((prev) =>
      prev.map((s, i) => (i === sectionIndex ? { ...s, questions: reindex(s.questions.filter((_, j) => j !== questionIndex)) } : s)),
    );
  const moveQuestion = (sectionIndex: number, questionIndex: number, direction: -1 | 1) =>
    setSections((prev) =>
      prev.map((s, i) => (i === sectionIndex ? { ...s, questions: reindex(move(s.questions, questionIndex, questionIndex + direction)) } : s)),
    );

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

  const addLogicRule = () => {
    const source = enumerationQuestions[0];
    if (!source) return;
    const firstOption = source.options?.[0];
    const targetQuestion = allQuestions.find((q) => q.id !== source.id);
    setLogicRules((prev) => [
      ...prev,
      {
        sourceQuestionId: source.id,
        sourceOptionValue: firstOption?.value ?? '',
        action: 'show',
        targetType: 'question',
        targetId: targetQuestion?.id ?? sections[0]?.id ?? '',
        orderIndex: prev.length,
      },
    ]);
  };
  const updateLogicRule = (index: number, patch: Partial<SurveyLogicRuleDto>) =>
    setLogicRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const removeLogicRule = (index: number) => setLogicRules((prev) => reindex(prev.filter((_, i) => i !== index)));

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
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
        }),
      );
      const updated = await gated('survey.surveys.update', () => surveyApi.replaceStructure(surveyId, { sections, logicRules }));
      setSurvey(updated);
      setSections(updated.sections);
      setLogicRules(updated.logicRules);
      setSnackbar(t('survey.builder.saved'));
    } catch (error) {
      setSaveError(extractErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{survey.title || t('survey.builder.untitled')}</Typography>
        <Stack direction="row" spacing={1}>
          <Button onClick={() => navigate('/survey/surveys')}>{t('core.common.back')}</Button>
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
              <IconButton disabled={sections.length <= 1} onClick={() => removeSection(sectionIndex)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>

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
                        updateQuestion(sectionIndex, questionIndex, { type: e.target.value as SurveyQuestionType, options: [] })
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
                    <IconButton onClick={() => removeQuestion(sectionIndex, questionIndex)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>

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
                </Box>
              ))}
              <Box>
                <Button size="small" startIcon={<AddIcon />} onClick={() => addQuestion(sectionIndex)}>
                  {t('survey.builder.add_question')}
                </Button>
              </Box>
            </Stack>
          </Paper>
        ))}
        <Box>
          <Button startIcon={<AddIcon />} onClick={addSection}>
            {t('survey.builder.add_section')}
          </Button>
        </Box>
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          {t('survey.builder.logic_rules')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('survey.builder.logic_rules_hint')}
        </Typography>
        <Stack spacing={2}>
          {logicRules.map((rule, index) => {
            const sourceQuestion = allQuestions.find((q) => q.id === rule.sourceQuestionId);
            return (
              <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  select
                  size="small"
                  label={t('survey.fields.logic_source_question')}
                  value={rule.sourceQuestionId}
                  onChange={(e) => updateLogicRule(index, { sourceQuestionId: e.target.value, sourceOptionValue: '' })}
                  sx={{ minWidth: 180 }}
                >
                  {enumerationQuestions.map((q) => (
                    <MenuItem key={q.id} value={q.id}>
                      {q.title || t('survey.builder.untitled_question')}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('survey.fields.logic_option_value')}
                  value={rule.sourceOptionValue}
                  onChange={(e) => updateLogicRule(index, { sourceOptionValue: e.target.value })}
                  sx={{ minWidth: 140 }}
                >
                  {(sourceQuestion?.options ?? []).map((o) => (
                    <MenuItem key={o.id} value={o.value}>
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
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="show">{t('survey.builder.action_show')}</MenuItem>
                  <MenuItem value="hide">{t('survey.builder.action_hide')}</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('survey.fields.logic_target_type')}
                  value={rule.targetType}
                  onChange={(e) => updateLogicRule(index, { targetType: e.target.value as 'section' | 'question', targetId: '' })}
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="section">{t('survey.builder.target_section')}</MenuItem>
                  <MenuItem value="question">{t('survey.builder.target_question')}</MenuItem>
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('survey.fields.logic_target')}
                  value={rule.targetId}
                  onChange={(e) => updateLogicRule(index, { targetId: e.target.value })}
                  sx={{ minWidth: 180 }}
                >
                  {(rule.targetType === 'section' ? sections : allQuestions)
                    .filter((entry) => entry.id !== rule.sourceQuestionId)
                    .map((entry) => (
                      <MenuItem key={entry.id} value={entry.id}>
                        {entry.title || t('survey.builder.untitled_question')}
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
            <Button size="small" startIcon={<AddIcon />} onClick={addLogicRule} disabled={enumerationQuestions.length === 0}>
              {t('survey.builder.add_logic_rule')}
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Snackbar open={snackbar !== null} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
