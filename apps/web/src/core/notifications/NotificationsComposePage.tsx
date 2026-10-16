import { Alert, Autocomplete, Box, Button, Checkbox, Chip, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { notificationsApi, type SendNotificationInput } from '../../shared/api/notifications';
import { rolesApi } from '../../shared/api/roles';
import { usersApi } from '../../shared/api/users';
import { useGatedCall } from '../../shared/permissions';
import type { NotificationTargetType, PublicRole, PublicUser } from '../../shared/api/types';

export function NotificationsComposePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gated = useGatedCall();

  const [category, setCategory] = useState('system.announcement');
  const [title, setTitle] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [targetType, setTargetType] = useState<NotificationTargetType>('all_users');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [roles, setRoles] = useState<PublicRole[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [confirmationType, setConfirmationType] = useState('receipt');
  const [allowComment, setAllowComment] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pickers need the lists; a failure just leaves the picker empty (the
  // backend still validates whatever is sent).
  useEffect(() => {
    if (targetType === 'role' && roles.length === 0) {
      rolesApi.list().then(setRoles).catch(() => undefined);
    }
    if (targetType === 'user' && users.length === 0) {
      usersApi.list().then(setUsers).catch(() => undefined);
    }
  }, [targetType, roles.length, users.length]);

  const roleLabel = (role: PublicRole) => t(role.nameI18nKey, { defaultValue: role.code });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const dto: SendNotificationInput = {
        category,
        title,
        bodyMarkdown,
        targetType,
        targetId: targetType === 'user' ? (userId ?? '') : undefined,
        targetIds: targetType === 'role' ? roleIds : undefined,
        ...(requiresConfirmation
          ? { requiresConfirmation: true, confirmationType, confirmationAllowComment: allowComment }
          : {}),
      };
      if (targetType === 'role' && roleIds.length === 0) {
        setError(t('core.notifications.select_roles_required'));
        setSubmitting(false);
        return;
      }
      if (targetType === 'user' && !userId) {
        setError(t('core.notifications.select_user_required'));
        setSubmitting(false);
        return;
      }
      const result = await gated('notifications.send', () => notificationsApi.send(dto));
      setSuccess(t('core.notifications.sent', { recipients: result.recipientCount }));
      setTitle('');
      setBodyMarkdown('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 560 }}>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.notifications.compose')}
      </Typography>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? <Alert severity="success">{success}</Alert> : null}
          <TextField select label={t('core.notifications.category')} value={category} onChange={(e) => setCategory(e.target.value)} required fullWidth>
            <MenuItem value="system.announcement">{t('core.notifications.categories.system.announcement')}</MenuItem>
          </TextField>
          <TextField label={t('core.notifications.title')} value={title} onChange={(e) => setTitle(e.target.value)} required fullWidth />
          <TextField
            label={t('core.notifications.body')}
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            required
            fullWidth
            multiline
            minRows={4}
          />
          <TextField
            select
            label={t('core.notifications.target_type')}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as NotificationTargetType)}
            fullWidth
          >
            <MenuItem value="all_users">{t('core.notifications.target_all_users')}</MenuItem>
            <MenuItem value="role">{t('core.notifications.target_role')}</MenuItem>
            <MenuItem value="user">{t('core.notifications.target_user')}</MenuItem>
          </TextField>
          {targetType === 'role' ? (
            <Autocomplete
              multiple
              disableCloseOnSelect
              options={roles}
              value={roles.filter((r) => roleIds.includes(r.id))}
              getOptionLabel={roleLabel}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_, value) => setRoleIds(value.map((r) => r.id))}
              renderOption={(props, option, { selected }) => (
                <li {...props} key={option.id}>
                  <Checkbox checked={selected} sx={{ marginInlineEnd: 1 }} />
                  {roleLabel(option)}
                </li>
              )}
              renderValue={(value, getItemProps) =>
                value.map((option, index) => {
                  const { key, ...itemProps } = getItemProps({ index });
                  return <Chip {...itemProps} key={key} label={roleLabel(option)} size="small" />;
                })
              }
              renderInput={(params) => <TextField {...params} label={t('core.notifications.roles')} required={roleIds.length === 0} />}
            />
          ) : null}
          {targetType === 'user' ? (
            <Autocomplete
              options={users}
              value={users.find((u) => u.id === userId) ?? null}
              getOptionLabel={(u) => `${u.name} (${u.email})`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_, value) => setUserId(value?.id ?? null)}
              renderInput={(params) => <TextField {...params} label={t('core.notifications.user')} required />}
            />
          ) : null}
          <FormControlLabel
            control={<Checkbox checked={requiresConfirmation} onChange={(e) => setRequiresConfirmation(e.target.checked)} />}
            label={t('core.notifications.requires_confirmation')}
          />
          {requiresConfirmation ? (
            <>
              <Alert severity="info">{t('core.notifications.confirmation_hint')}</Alert>
              <TextField
                select
                label={t('core.notifications.confirmation_type')}
                value={confirmationType}
                onChange={(e) => setConfirmationType(e.target.value)}
                fullWidth
              >
                {['receipt', 'policy_acceptance', 'gdpr_consent'].map((type) => (
                  <MenuItem key={type} value={type}>
                    {t(`core.notifications.confirmation_types.${type}`)}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={<Checkbox checked={allowComment} onChange={(e) => setAllowComment(e.target.checked)} />}
                label={t('core.notifications.confirmation_allow_comment')}
              />
            </>
          ) : null}
          <Stack direction="row" spacing={2}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {t('core.notifications.send')}
            </Button>
            <Button onClick={() => navigate('/notifications')}>{t('core.common.cancel')}</Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
