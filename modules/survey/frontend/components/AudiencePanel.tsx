import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import MailIcon from '@mui/icons-material/MailOutlined';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SendIcon from '@mui/icons-material/Send';
import { Alert, Box, Button, Chip, FormControlLabel, IconButton, Paper, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseEmailList } from '../../backend/email-list.ts';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';
import { formatDateTime } from '../../../../apps/web/src/shared/format';
import { surveyApi, type AudienceInfo } from '../api';

interface Props {
  surveyId: string;
  /** Invitations can only be sent for a published survey. */
  published: boolean;
  restricted: boolean;
  emailCopy: boolean;
  onSettingsChange: (patch: { restricted?: boolean; emailCopy?: boolean }) => void;
}

/**
 * Who may answer, invitations and reminders, and the emailed copy (SURVEY-D22). The two switches are survey
 * settings saved with the builder's Save button; the lists below act at once, like the co-owners panel.
 * Pasted addresses become cards that are checked as you type: valid ones can be removed before sending, invalid
 * ones are flagged, repeats and people already invited are set aside.
 */
export function AudiencePanel({ surveyId, published, restricted, emailCopy, onSettingsChange }: Props) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [audience, setAudience] = useState<AudienceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [text, setText] = useState('');

  const load = useCallback(() => {
    surveyApi
      .getAudience(surveyId)
      .then(setAudience)
      .catch((err: unknown) => setError(extractErrorMessage(err)));
  }, [surveyId]);
  useEffect(load, [load]);

  const parsed = useMemo(() => parseEmailList(text), [text]);
  const alreadyInvited = useMemo(() => new Set((audience?.invitations ?? []).map((i) => i.email)), [audience]);
  const toSend = parsed.valid.filter((e) => !alreadyInvited.has(e));

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeFromText = (email: string) =>
    setText(
      parseEmailList(text)
        .valid.filter((e) => e !== email)
        .join(', '),
    );

  const send = () =>
    run(async () => {
      const result = await surveyApi.invite(surveyId, toSend);
      setText(result.invalid.join(', '));
      setNotice(t('survey.audience.sent', { sent: result.sent, failed: result.failed }));
      load();
    });

  const remind = () =>
    run(async () => {
      const result = await surveyApi.remind(surveyId);
      setNotice(t('survey.audience.reminded', { count: result.reminded, skipped: result.skipped }));
      load();
    });

  const addUser = () =>
    run(async () => {
      await surveyApi.addAllowedUser(surveyId, userEmail.trim());
      setUserEmail('');
      load();
    });

  const waiting = (audience?.invitations ?? []).filter((i) => i.status !== 'responded').length;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" component="h3" gutterBottom>
        {t('survey.audience.title')}
      </Typography>
      <Stack spacing={1}>
        <FormControlLabel
          control={<Switch checked={restricted} onChange={(e) => onSettingsChange({ restricted: e.target.checked })} />}
          label={t('survey.audience.restricted')}
        />
        <Typography variant="body2" color="text.secondary">
          {t('survey.audience.restricted_hint')}
        </Typography>
        <FormControlLabel
          control={<Switch checked={emailCopy} onChange={(e) => onSettingsChange({ emailCopy: e.target.checked })} />}
          label={t('survey.audience.email_copy')}
        />
        <Typography variant="body2" color="text.secondary">
          {t('survey.audience.email_copy_hint')}
        </Typography>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert severity="success" sx={{ mt: 2 }}>
          {notice}
        </Alert>
      ) : null}

      {restricted ? (
        <Stack spacing={3} sx={{ mt: 2 }}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t('survey.audience.users_title')}
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 1 }}>
              {(audience?.allowedUsers ?? []).map((u) => (
                <Chip key={u.userId} label={`${u.name} · ${u.email}`} onDelete={() => void run(async () => { await surveyApi.removeAllowedUser(surveyId, u.userId); load(); })} />
              ))}
              {audience && audience.allowedUsers.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('survey.audience.users_none')}
                </Typography>
              ) : null}
            </Stack>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                type="email"
                label={t('survey.audience.user_email')}
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (userEmail.trim()) void addUser();
                  }
                }}
                sx={{ minWidth: 260 }}
              />
              <Button startIcon={<PersonAddIcon />} variant="outlined" disabled={busy || !userEmail.trim()} onClick={() => void addUser()}>
                {t('survey.audience.add_user')}
              </Button>
            </Box>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t('survey.audience.invite_title')}
            </Typography>
            {!published ? (
              <Alert severity="info" sx={{ mb: 1 }}>
                {t('survey.audience.publish_first')}
              </Alert>
            ) : null}
            <TextField
              label={t('survey.audience.invite_emails')}
              helperText={t('survey.audience.invite_hint')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
            {parsed.valid.length + parsed.invalid.length > 0 ? (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1 }} aria-label={t('survey.audience.cards')}>
                {parsed.valid.map((email) =>
                  alreadyInvited.has(email) ? (
                    <Tooltip key={email} title={t('survey.audience.already_invited')}>
                      <Chip size="small" variant="outlined" label={email} />
                    </Tooltip>
                  ) : (
                    <Chip key={email} size="small" color="success" variant="outlined" label={email} onDelete={() => removeFromText(email)} />
                  ),
                )}
                {parsed.invalid.map((bad, i) => (
                  <Tooltip key={`${bad}-${i}`} title={t('survey.audience.not_an_email')}>
                    <Chip size="small" color="error" label={bad} />
                  </Tooltip>
                ))}
              </Stack>
            ) : null}
            {parsed.valid.length + parsed.invalid.length > 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t('survey.audience.summary', { valid: toSend.length, invalid: parsed.invalid.length, repeated: parsed.duplicates.length, invited: parsed.valid.length - toSend.length })}
              </Typography>
            ) : null}
            <Box sx={{ mt: 1 }}>
              <Button startIcon={<SendIcon />} variant="contained" disabled={busy || !published || toSend.length === 0} onClick={() => void send()}>
                {t('survey.audience.send', { count: toSend.length })}
              </Button>
            </Box>
          </Box>

          <Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle2">{t('survey.audience.invitations_title', { count: audience?.invitations.length ?? 0 })}</Typography>
              <Button startIcon={<MailIcon />} size="small" disabled={busy || !published || waiting === 0} onClick={() => void remind()}>
                {t('survey.audience.remind', { count: waiting })}
              </Button>
            </Stack>
            {audience && audience.invitations.length > 0 ? (
              <Paginated items={audience.invitations} initialPageSize={10}>
                {(rows) => (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('survey.audience.col_email')}</TableCell>
                        <TableCell>{t('survey.audience.col_status')}</TableCell>
                        <TableCell>{t('survey.audience.col_invited')}</TableCell>
                        <TableCell>{t('survey.audience.col_reminders')}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.email}</TableCell>
                          <TableCell>
                            <Chip size="small" color={i.status === 'responded' ? 'success' : i.status === 'opened' ? 'info' : 'default'} label={t(`survey.audience.status.${i.status}`)} />
                          </TableCell>
                          <TableCell>{formatDateTime(i.invitedAt, language)}</TableCell>
                          <TableCell>{i.reminderCount}</TableCell>
                          <TableCell align="right">
                            <IconButton size="small" aria-label={t('survey.audience.remove_invitation')} onClick={() => void run(async () => { await surveyApi.removeInvitation(surveyId, i.id); load(); })}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Paginated>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t('survey.audience.invitations_none')}
              </Typography>
            )}
          </Box>
        </Stack>
      ) : null}
    </Paper>
  );
}
