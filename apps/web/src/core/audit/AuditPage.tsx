import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../app/LanguageContext';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { formatDateTime } from '../../shared/format';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { auditApi } from '../../shared/api/audit';
import { useGatedCall } from '../../shared/permissions';
import type { AuditQueryParams, PurgeResult } from '../../shared/api/types';

/** Yesterday (UTC) as YYYY-MM-DD — mirrors AuditService.purge's exact boundary (D25: cutoff must be < today UTC). */
function yesterdayUtcIso(): string {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday.toISOString().slice(0, 10);
}

export function AuditPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.audit')}
      </Typography>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={t('core.audit.log_tab')} />
        <Tab label={t('core.audit.purge_tab')} />
      </Tabs>
      {tab === 0 ? <AuditLogViewer /> : <AuditPurgePanel />}
    </Box>
  );
}

function AuditLogViewer() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [filters, setFilters] = useState<AuditQueryParams>({ page: 1, pageSize: 50 });
  const [category, setCategory] = useState('');
  const [entityType, setEntityType] = useState('');

  const { status, data, errorMessage, reload } = useGuardedQuery(() => auditApi.query(filters));

  // useGuardedQuery's own effect already fetches once on mount; this only
  // needs to force a NEW fetch when `filters` changes afterward (its
  // `reload()` reads `filters` fresh via the hook's internal ref, so this
  // effect's only job is to trigger it — literal deps array, no spread).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    reload();
  }, [filters, reload]);

  const applyFilters = () => {
    setFilters({ page: 1, pageSize: 50, category: category || undefined, entityType: entityType || undefined });
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField label={t('core.audit.category')} value={category} onChange={(e) => setCategory(e.target.value)} size="small" />
        <TextField label={t('core.audit.entity_type')} value={entityType} onChange={(e) => setEntityType(e.target.value)} size="small" />
        <Button variant="outlined" onClick={applyFilters}>
          {t('core.common.search')}
        </Button>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('core.audit.occurred_at')}</TableCell>
                <TableCell>{t('core.audit.category')}</TableCell>
                <TableCell>{t('core.audit.entity_type')}</TableCell>
                <TableCell>{t('core.audit.action')}</TableCell>
                <TableCell>{t('core.audit.actor')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.items ?? []).map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell>{formatDateTime(item.occurredAt, language)}</TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell>{item.entityType}</TableCell>
                  <TableCell>{item.action}</TableCell>
                  <TableCell>{item.actorType === 'user' ? (item.actorUserName ?? item.actorUserId ?? '—') : item.actorType}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t('core.audit.total_rows', { total: data.total })}
          </Typography>
        ) : null}
      </QueryStateGate>
    </Box>
  );
}

function AuditPurgePanel() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const maxCutoff = yesterdayUtcIso();
  const [cutoffDate, setCutoffDate] = useState(maxCutoff);
  const [result, setResult] = useState<PurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePurge = async () => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const purgeResult = await gated('audit.purge', () => auditApi.purge(cutoffDate));
      setResult(purgeResult);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t('core.audit.purge_warning')}
      </Alert>
      <Stack spacing={2}>
        <TextField
          label={t('core.audit.cutoff_date')}
          type="date"
          value={cutoffDate}
          onChange={(e) => setCutoffDate(e.target.value)}
          // D25: the cutoff can never be today or later (UTC) — capped in
          // the date picker itself AND re-enforced server-side (defense in
          // depth, matching AuditService.purge's own strict check).
          slotProps={{ htmlInput: { max: maxCutoff } }}
          helperText={t('core.audit.cutoff_help')}
        />
        {error ? <Alert severity="error">{error}</Alert> : null}
        {result ? (
          <Alert severity="success">{t('core.audit.purge_success', { count: result.rowsDeleted, date: result.cutoffDate })}</Alert>
        ) : null}
        <Button variant="contained" color="error" onClick={handlePurge} disabled={busy || cutoffDate > maxCutoff}>
          {t('core.audit.purge_action')}
        </Button>
      </Stack>
    </Box>
  );
}
