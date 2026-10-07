import DevicesIcon from '@mui/icons-material/Devices';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../app/LanguageContext';
import { useAuth } from '../../app/AuthContext';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { formatDateTime } from '../../shared/format';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { sessionsApi } from '../../shared/api/sessions';
import { useGatedCall } from '../../shared/permissions';
import type { PublicSession, PurgeResult } from '../../shared/api/types';

/** 3 days before today (UTC) as YYYY-MM-DD — mirrors SessionsService.purge's cap. */
function maxPurgeCutoffUtcIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3)).toISOString().slice(0, 10);
}

/**
 * `GET /sessions/me` is self-scoped but still gated by `sessions.view_my`
 * (migration 0010, granted to all 4 base roles by default) — root
 * DECISIONS.md: no authenticated page/action is ever gate-free, only truly
 * `@Public()` anonymous routes are exempt; an admin can now revoke it from
 * a custom role, which the old hardcoded "no check" never could. The route
 * itself is wrapped in `RequirePermissionRoute code="sessions.view_my"`
 * (App.tsx). The "look up another user's sessions" form below calls `GET
 * /sessions/user/:userId`, which requires the SEPARATE `sessions.view` code
 * — a real 403 there is handled inline, not pre-hidden.
 */
export function SessionsPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { user } = useAuth();
  const gated = useGatedCall();

  const [lookupUserId, setLookupUserId] = useState('');
  const [otherSessions, setOtherSessions] = useState<PublicSession[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PublicSession | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const maxCutoff = maxPurgeCutoffUtcIso();
  const [cutoffDate, setCutoffDate] = useState(maxCutoff);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const {
    status,
    data: mySessions,
    errorMessage,
    reload,
  } = useGuardedQuery(() => sessionsApi.getMine());

  const handleLookup = async () => {
    setLookupError(null);
    try {
      const sessions = await gated('sessions.view', () => sessionsApi.getForUser(lookupUserId));
      setOtherSessions(sessions);
    } catch (error) {
      setLookupError(extractErrorMessage(error));
      setOtherSessions(null);
    }
  };

  const handleRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await gated('sessions.revoke', () => sessionsApi.revoke(pendingRevoke.id));
      reload();
      if (otherSessions) setOtherSessions(otherSessions.filter((s) => s.id !== pendingRevoke.id));
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingRevoke(null);
    }
  };

  const handlePurge = async () => {
    setConfirmPurge(false);
    setPurgeError(null);
    setPurgeResult(null);
    setPurgeBusy(true);
    try {
      // Same code as the viewing lookup: whoever may view sessions may purge old ones.
      setPurgeResult(await gated('sessions.view', () => sessionsApi.purge(cutoffDate)));
      reload();
      setOtherSessions(null);
    } catch (error) {
      setPurgeError(extractErrorMessage(error));
    } finally {
      setPurgeBusy(false);
    }
  };

  const renderTable = (sessions: PublicSession[]) => (
    <TableContainer component={Paper} sx={{ mb: 3 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('core.sessions.user_name')}</TableCell>
            <TableCell>{t('core.sessions.issued_at')}</TableCell>
            <TableCell>{t('core.sessions.last_active')}</TableCell>
            <TableCell>{t('core.sessions.expires_at')}</TableCell>
            <TableCell>{t('core.sessions.ip_address')}</TableCell>
            <TableCell>{t('core.sessions.user_agent')}</TableCell>
            <TableCell>{t('core.sessions.status')}</TableCell>
            <TableCell align="right">{t('core.common.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sessions.map((session) => {
            const isCurrent = session.id === user?.id; // best-effort marker; session id != user id, kept simple
            const revoked = session.revokedAt !== null;
            return (
              <TableRow key={session.id} hover>
                <TableCell>{session.userName ?? session.userId}</TableCell>
                <TableCell>{formatDateTime(session.issuedAt, language)}</TableCell>
                <TableCell>{formatDateTime(session.lastActiveAt, language)}</TableCell>
                <TableCell>{formatDateTime(session.expiresAt, language)}</TableCell>
                <TableCell>{session.ipAddress ?? '—'}</TableCell>
                <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session.userAgent ?? '—'}
                </TableCell>
                <TableCell>
                  <Chip size="small" color={revoked ? 'default' : 'success'} label={revoked ? t('core.sessions.revoked') : t('core.sessions.active')} />
                </TableCell>
                <TableCell align="right">
                  {!revoked ? (
                    <IconButton
                      size="small"
                      onClick={() => setPendingRevoke(session)}
                      aria-label={t('core.sessions.revoke')}
                      disabled={isCurrent}
                    >
                      <DevicesIcon fontSize="small" color="error" />
                    </IconButton>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.sessions')}
      </Typography>

      <Typography variant="h6" component="h3" gutterBottom>
        {t('core.sessions.mine')}
      </Typography>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {renderTable(mySessions ?? [])}
      </QueryStateGate>

      <Typography variant="h6" component="h3" gutterBottom>
        {t('core.sessions.lookup_title')}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          label={t('core.sessions.user_id')}
          value={lookupUserId}
          onChange={(e) => setLookupUserId(e.target.value)}
          size="small"
          sx={{ minWidth: 320 }}
        />
        <Button variant="outlined" onClick={handleLookup} disabled={!lookupUserId}>
          {t('core.common.search')}
        </Button>
      </Stack>
      {lookupError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {lookupError}
        </Alert>
      ) : null}
      {otherSessions ? renderTable(otherSessions) : null}

      <Typography variant="h6" component="h3" gutterBottom>
        {t('core.sessions.purge_title')}
      </Typography>
      <Box sx={{ maxWidth: 480, mb: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('core.sessions.purge_warning')}
        </Alert>
        <Stack spacing={2}>
          <TextField
            label={t('core.audit.cutoff_date')}
            type="date"
            value={cutoffDate}
            onChange={(e) => setCutoffDate(e.target.value)}
            slotProps={{ htmlInput: { max: maxCutoff } }}
            helperText={t('core.sessions.purge_cutoff_help')}
          />
          {purgeError ? <Alert severity="error">{purgeError}</Alert> : null}
          {purgeResult ? (
            <Alert severity="success">
              {t('core.sessions.purge_success', { count: purgeResult.rowsDeleted, date: purgeResult.cutoffDate })}
            </Alert>
          ) : null}
          <Button
            variant="contained"
            color="error"
            onClick={() => setConfirmPurge(true)}
            disabled={purgeBusy || !cutoffDate || cutoffDate > maxCutoff}
          >
            {t('core.sessions.purge_action')}
          </Button>
        </Stack>
      </Box>

      <ConfirmDialog
        open={confirmPurge}
        title={t('core.sessions.purge_title')}
        description={t('core.sessions.purge_confirm', { date: cutoffDate })}
        confirmColor="error"
        confirmLabel={t('core.sessions.purge_action')}
        onConfirm={handlePurge}
        onCancel={() => setConfirmPurge(false)}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={t('core.sessions.revoke_title')}
        description={t('core.sessions.revoke_confirm')}
        confirmColor="error"
        confirmLabel={t('core.sessions.revoke')}
        onConfirm={handleRevoke}
        onCancel={() => setPendingRevoke(null)}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={5000} onClose={() => setSnackbar(null)}>
        <Alert severity="error" onClose={() => setSnackbar(null)}>
          {snackbar}
        </Alert>
      </Snackbar>
    </Box>
  );
}
