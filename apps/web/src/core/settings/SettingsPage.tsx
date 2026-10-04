import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { rolesApi } from '../../shared/api/roles';
import { settingsApi } from '../../shared/api/settings';
import { useGatedCall } from '../../shared/permissions';
import type { NotificationTemplate, PasswordPolicy, PublicRole, TokenLifetimes } from '../../shared/api/types';

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.settings')}
      </Typography>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={t('core.settings.password_policy')} />
        <Tab label={t('core.settings.session_timing')} />
        <Tab label={t('core.settings.notification_templates')} />
        <Tab label={t('core.settings.registration')} />
      </Tabs>
      {tab === 0 ? <PasswordPolicyTab /> : null}
      {tab === 1 ? <SessionTimingTab /> : null}
      {tab === 2 ? <NotificationTemplatesTab /> : null}
      {tab === 3 ? <RegistrationTab /> : null}
    </Box>
  );
}

function SavedBanner({ saved }: { saved: boolean }) {
  const { t } = useTranslation();
  if (!saved) return null;
  return (
    <Alert severity="success" sx={{ mb: 2 }}>
      {t('core.settings.saved')}
    </Alert>
  );
}

/**
 * Every tab below follows the same shape: `useGuardedQuery` performs the
 * real `GET` and only renders its editable-form child ONCE `data` is ready
 * (`QueryStateGate` already only reaches its `children` in the 'ready'
 * status). That child then owns its local, editable copy via a plain
 * `useState(initial)` — no effect mirroring a prop into state, because the
 * child only ever mounts once per successful load (see RoleFormDialog's
 * docblock for why that pattern replaces "effect resets state from data").
 */
function PasswordPolicyTab() {
  const { status, data, errorMessage, reload } = useGuardedQuery(() => settingsApi.getPasswordPolicy());
  return (
    <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
      {data ? <PasswordPolicyForm initial={data} /> : null}
    </QueryStateGate>
  );
}

function PasswordPolicyForm({ initial }: { initial: PasswordPolicy }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const updated = await gated('users.settings.update', () => settingsApi.updatePasswordPolicy(form));
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 420 }}>
      <SavedBanner saved={saved} />
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label={t('core.settings.min_length')}
        type="number"
        value={form.minLength}
        onChange={(e) => setForm({ ...form, minLength: Number(e.target.value) })}
      />
      <FormControlLabel
        control={<Checkbox checked={form.requireLetter} onChange={(e) => setForm({ ...form, requireLetter: e.target.checked })} />}
        label={t('core.settings.require_letter')}
      />
      <FormControlLabel
        control={<Checkbox checked={form.requireNumber} onChange={(e) => setForm({ ...form, requireNumber: e.target.checked })} />}
        label={t('core.settings.require_number')}
      />
      <TextField
        label={t('core.settings.max_failed_attempts')}
        type="number"
        value={form.maxFailedAttempts}
        onChange={(e) => setForm({ ...form, maxFailedAttempts: Number(e.target.value) })}
      />
      <TextField
        label={t('core.settings.lockout_minutes')}
        type="number"
        value={form.lockoutMinutes}
        onChange={(e) => setForm({ ...form, lockoutMinutes: Number(e.target.value) })}
      />
      <Box>
        <Button variant="contained" onClick={save}>
          {t('core.common.save')}
        </Button>
      </Box>
    </Stack>
  );
}

function SessionTimingTab() {
  const { status, data, errorMessage, reload } = useGuardedQuery(() => settingsApi.getSessionTiming());
  return (
    <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
      {data ? <SessionTimingForm initial={data} /> : null}
    </QueryStateGate>
  );
}

function SessionTimingForm({ initial }: { initial: TokenLifetimes }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const updated = await gated('users.settings.update', () => settingsApi.updateSessionTiming(form));
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 420 }}>
      <SavedBanner saved={saved} />
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label={t('core.settings.access_token_minutes')}
        type="number"
        value={form.accessTokenMinutes}
        onChange={(e) => setForm({ ...form, accessTokenMinutes: Number(e.target.value) })}
      />
      <TextField
        label={t('core.settings.refresh_token_days')}
        type="number"
        value={form.refreshTokenDays}
        onChange={(e) => setForm({ ...form, refreshTokenDays: Number(e.target.value) })}
      />
      <TextField
        label={t('core.settings.idle_timeout_minutes')}
        type="number"
        value={form.idleTimeoutMinutes}
        onChange={(e) => setForm({ ...form, idleTimeoutMinutes: Number(e.target.value) })}
      />
      <TextField
        label={t('core.settings.absolute_timeout_days')}
        type="number"
        value={form.absoluteTimeoutDays}
        onChange={(e) => setForm({ ...form, absoluteTimeoutDays: Number(e.target.value) })}
      />
      <Box>
        <Button variant="contained" onClick={save}>
          {t('core.common.save')}
        </Button>
      </Box>
    </Stack>
  );
}

const TEMPLATE_KEYS = ['password_reset', 'force_password_change'];

function NotificationTemplatesTab() {
  const { status, data, errorMessage, reload } = useGuardedQuery(() =>
    settingsApi.getNotificationTemplates(),
  );
  return (
    <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
      {data ? <NotificationTemplatesForm initial={data} /> : null}
    </QueryStateGate>
  );
}

function NotificationTemplatesForm({ initial }: { initial: Record<string, NotificationTemplate> }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const updated = await gated('users.settings.update', () => settingsApi.updateNotificationTemplates(form));
      setForm(updated);
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <SavedBanner saved={saved} />
      {error ? <Alert severity="error">{error}</Alert> : null}
      {TEMPLATE_KEYS.map((key) => {
        const template = form[key] ?? { subject: '', bodyMarkdown: '' };
        return (
          <Stack key={key} spacing={1}>
            <Typography variant="subtitle1">{key}</Typography>
            <TextField
              label={t('core.settings.template_subject')}
              value={template.subject}
              onChange={(e) => setForm({ ...form, [key]: { ...template, subject: e.target.value } })}
              fullWidth
            />
            <TextField
              label={t('core.settings.template_body')}
              value={template.bodyMarkdown}
              onChange={(e) => setForm({ ...form, [key]: { ...template, bodyMarkdown: e.target.value } })}
              fullWidth
              multiline
              minRows={3}
            />
          </Stack>
        );
      })}
      <Box>
        <Button variant="contained" onClick={save}>
          {t('core.common.save')}
        </Button>
      </Box>
    </Stack>
  );
}

function RegistrationTab() {
  const { status, data, errorMessage, reload } = useGuardedQuery(() => settingsApi.getRegistration());
  // D91: the role dropdown needs the full role list (any role, not just the
  // four base ones) — a SEPARATE useGuardedQuery, same pattern as
  // ModulesAdminPage's two independent fetches, rather than bundling it
  // into settingsApi.getRegistration()'s own response (that endpoint stays
  // one Users-module setting, not a roles-listing concern).
  const rolesQuery = useGuardedQuery(() => rolesApi.list());

  return (
    <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
      <QueryStateGate status={rolesQuery.status} errorMessage={rolesQuery.errorMessage} onRetry={rolesQuery.reload}>
        {data && rolesQuery.data ? (
          <RegistrationForm
            initialAllow={data.allowSelfRegistration}
            initialRoleCode={data.selfRegistrationRoleCode}
            roles={rolesQuery.data}
          />
        ) : null}
      </QueryStateGate>
    </QueryStateGate>
  );
}

function RegistrationForm({
  initialAllow,
  initialRoleCode,
  roles,
}: {
  initialAllow: boolean;
  initialRoleCode: string | null;
  roles: PublicRole[];
}) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [allow, setAllow] = useState(initialAllow);
  const [roleCode, setRoleCode] = useState(initialRoleCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    setSaved(false);
    // Enabling self-registration with no role picked yet would just move
    // the "not configured" failure from this form to every future
    // registrant's POST /auth/register — catch it here instead, where an
    // admin can actually fix it.
    if (allow && !roleCode) {
      setError(t('core.settings.registration.role_required'));
      return;
    }
    try {
      const updated = await gated('users.settings.update', () =>
        settingsApi.updateRegistration(allow, roleCode || undefined),
      );
      setAllow(updated.allowSelfRegistration);
      setRoleCode(updated.selfRegistrationRoleCode ?? '');
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 480 }}>
      <SavedBanner saved={saved} />
      {error ? <Alert severity="error">{error}</Alert> : null}
      <FormControlLabel
        control={<Checkbox checked={allow} onChange={(e) => setAllow(e.target.checked)} />}
        label={t('core.settings.registration.allow')}
      />
      <FormControl fullWidth>
        <InputLabel id="self-registration-role-label">{t('core.settings.registration.role')}</InputLabel>
        <Select
          labelId="self-registration-role-label"
          label={t('core.settings.registration.role')}
          value={roleCode}
          onChange={(e) => setRoleCode(e.target.value)}
        >
          <MenuItem value="">
            <em>{t('core.settings.registration.role_none')}</em>
          </MenuItem>
          {roles.map((role) => (
            <MenuItem key={role.id} value={role.code}>
              {t(role.nameI18nKey)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Box>
        <Button variant="contained" onClick={save}>
          {t('core.common.save')}
        </Button>
      </Box>
    </Stack>
  );
}
