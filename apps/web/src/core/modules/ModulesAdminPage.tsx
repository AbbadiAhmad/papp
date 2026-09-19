import AddIcon from '@mui/icons-material/Add';
import UpgradeIcon from '@mui/icons-material/Upgrade';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
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
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { modulesApi } from '../../shared/api/modules';
import { useGatedCall, Can } from '../../shared/permissions';
import type { AvailableModuleEntry, ModuleStatus, PublicModuleEntry } from '../../shared/api/types';

const STATUS_COLOR: Record<ModuleStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  installed: 'success',
  installing: 'info',
  upgrading: 'info',
  uninstalling: 'warning',
  disabled: 'default',
  failed: 'error',
};

/**
 * D26 (safe-by-default uninstall, docs/DECISIONS.md): the uninstall
 * confirmation must make the "data is kept unless you also choose
 * drop-data" behavior explicit — module-registry.service.ts's `uninstall()`
 * leaves data tables and `system_settings` rows in place unless the caller
 * separately opts into `dropData: true`, which the UI surfaces as its own
 * unchecked-by-default checkbox, never implied by the plain uninstall button.
 */
export function ModulesAdminPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const { status, data: modules, errorMessage, reload } = useGuardedQuery(() => modulesApi.list());
  const {
    data: availableModules,
    reload: reloadAvailable,
  } = useGuardedQuery(() => modulesApi.listAvailable());

  const [installKey, setInstallKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<PublicModuleEntry | null>(null);
  const [dropData, setDropData] = useState(false);

  const handleInstall = async () => {
    setError(null);
    try {
      await gated('modules.install', () => modulesApi.install(installKey));
      setInstallKey('');
      reload();
      reloadAvailable();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleUpgrade = async (key: string) => {
    setError(null);
    try {
      await gated('modules.upgrade', () => modulesApi.upgrade(key));
      reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleUninstall = async () => {
    if (!uninstallTarget) return;
    setError(null);
    try {
      await gated('modules.uninstall', () => modulesApi.uninstall(uninstallTarget.key, dropData));
      reload();
      reloadAvailable();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setUninstallTarget(null);
      setDropData(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.modules')}
      </Typography>

      <Can permission="modules.install">
        <Alert severity="info" sx={{ mb: 3 }}>
          {t('core.modules.deployment_note')}
        </Alert>
        <Stack direction="row" spacing={2} sx={{ mb: 3, alignItems: 'flex-start' }}>
          <TextField
            select
            label={t('core.modules.install_key')}
            value={installKey}
            onChange={(e) => setInstallKey(e.target.value)}
            size="small"
            sx={{ minWidth: 320 }}
            helperText={
              (availableModules ?? []).length === 0 ? t('core.modules.install_key_empty') : t('core.modules.install_key_help')
            }
            disabled={(availableModules ?? []).length === 0}
          >
            {(availableModules ?? []).map((entry: AvailableModuleEntry) => (
              <MenuItem key={entry.key} value={entry.key}>
                {entry.name} ({entry.key})
              </MenuItem>
            ))}
          </TextField>
          <Button startIcon={<AddIcon />} variant="contained" onClick={handleInstall} disabled={!installKey}>
            {t('core.modules.install')}
          </Button>
        </Stack>
      </Can>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('core.modules.key')}</TableCell>
                <TableCell>{t('core.modules.version')}</TableCell>
                <TableCell>{t('core.modules.status_label')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(modules ?? []).map((entry) => (
                <TableRow key={entry.key} hover>
                  <TableCell>{entry.key}</TableCell>
                  <TableCell>{entry.version}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[entry.status]} label={t(`core.modules.status.${entry.status}`)} />
                  </TableCell>
                  <TableCell align="right">
                    {entry.key !== 'core' ? (
                      <>
                        <Can permission="modules.upgrade">
                          <IconButton size="small" onClick={() => handleUpgrade(entry.key)} aria-label={t('core.modules.upgrade')}>
                            <UpgradeIcon fontSize="small" />
                          </IconButton>
                        </Can>
                        <Can permission="modules.uninstall">
                          <IconButton size="small" onClick={() => setUninstallTarget(entry)} aria-label={t('core.modules.uninstall')}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Can>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      {uninstallTarget ? (
        <Paper sx={{ mt: 3, p: 2, maxWidth: 480 }} variant="outlined">
          <Typography variant="subtitle1" gutterBottom>
            {t('core.modules.uninstall_confirm_title', { key: uninstallTarget.key })}
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('core.modules.uninstall_data_kept_notice')}
          </Alert>
          <FormControlLabel
            control={<Checkbox checked={dropData} onChange={(e) => setDropData(e.target.checked)} />}
            label={t('core.modules.drop_data_checkbox')}
          />
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Button variant="contained" color="error" onClick={handleUninstall}>
              {t('core.modules.uninstall')}
            </Button>
            <Button
              onClick={() => {
                setUninstallTarget(null);
                setDropData(false);
              }}
            >
              {t('core.common.cancel')}
            </Button>
          </Stack>
        </Paper>
      ) : null}
    </Box>
  );
}
