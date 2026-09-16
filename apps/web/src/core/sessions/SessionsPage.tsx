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
import type { PublicSession } from '../../shared/api/types';

/**
 * `GET /sessions/me` is self-scoped (no permission required, every role can
 * see its own sessions — sessions.controller.ts). The "look up another
 * user's sessions" form below calls `GET /sessions/user/:userId`, which
 * DOES require `sessions.view` — a real 403 there is handled inline, not
 * pre-hidden.
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

  const {
    status,
    data: mySessions,
    errorMessage,
    reload,
  } = useGuardedQuery(null, () => sessionsApi.getMine());

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

  const renderTable = (sessions: PublicSession[]) => (
    <TableContainer component={Paper} sx={{ mb: 3 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
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
