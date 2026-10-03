import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { backupApi } from '../../shared/api/backup';
import { useGatedCall } from '../../shared/permissions';

export function BackupPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const { status, data, errorMessage, reload } = useGuardedQuery(() => backupApi.getInfo());

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await gated('backup.export', () => backupApi.exportBackup());
    } catch (err) {
      setExportError(extractErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.backup')}
      </Typography>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {data ? (
          <Stack spacing={3}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={4} sx={{ flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('core.backup.platformVersion')}
                  </Typography>
                  <Typography variant="body1">{data.platformVersion}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('core.backup.schemaFingerprint')}
                  </Typography>
                  <Typography variant="body1" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {data.schemaFingerprint.slice(0, 12)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('core.backup.backupConfigured')}
                  </Typography>
                  <Typography variant="body1">
                    {data.backupConfigured ? t('core.common.yes') : t('core.common.no')}
                  </Typography>
                </Box>
              </Stack>
            </Paper>

            {!data.backupConfigured ? <Alert severity="info">{t('core.backup.notConfiguredHint')}</Alert> : null}

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" component="h3" gutterBottom>
                {t('core.backup.exportSection')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('core.backup.exportHint')}
              </Typography>
              {exportError ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {exportError}
                </Alert>
              ) : null}
              <Button variant="contained" onClick={handleExport} disabled={!data.backupConfigured || exporting}>
                {exporting ? t('core.backup.exporting') : t('core.backup.exportButton')}
              </Button>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" component="h3" gutterBottom>
                {t('core.backup.restoreSection')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('core.backup.restoreCliNotice')}
              </Typography>
              <Box component="code" sx={{ display: 'block', p: 1, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace' }}>
                ./scripts/manageDB.sh restore &lt;backup-file&gt;
              </Box>
            </Paper>
          </Stack>
        ) : null}
      </QueryStateGate>
    </Box>
  );
}
