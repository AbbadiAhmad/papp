import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { templateApi, type CreateItemInput, type TemplateItem, type TemplateItemStatus, type UpdateItemInput } from '../api';
import { TemplateItemFormDialog } from './TemplateItemFormDialog';

const STATUS_COLOR: Record<TemplateItemStatus, 'success' | 'default'> = { active: 'success', archived: 'default' };

/**
 * Demonstrates the module's own `template.defaults` setting (manifest.json
 * `settings[0]`) being read/edited end to end — see
 * modules/template/backend/settings.service.ts's own docblock for why this
 * lives here rather than the (nonexistent) generic core Settings screen.
 */
function DefaultsPanel() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [defaultStatus, setDefaultStatus] = useState<TemplateItemStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    templateApi
      .getDefaults()
      .then((d) => setDefaultStatus(d.defaultStatus))
      .catch(() => undefined);
  }, []);

  const handleChange = async (value: TemplateItemStatus) => {
    setSaving(true);
    setError(null);
    try {
      const result = await gated('template.settings.update', () => templateApi.updateDefaults({ defaultStatus: value }));
      setDefaultStatus(result.defaultStatus);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (defaultStatus === null) return null;

  return (
    <Can permission="template.settings.view">
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Can permission="template.settings.update">
            <TextField
              select
              size="small"
              label={t('template.settings.defaults_label')}
              value={defaultStatus}
              onChange={(e) => handleChange(e.target.value as TemplateItemStatus)}
              disabled={saving}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="active">{t('template.status.active')}</MenuItem>
              <MenuItem value="archived">{t('template.status.archived')}</MenuItem>
            </TextField>
          </Can>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </Paper>
    </Can>
  );
}

export function TemplateItemsListPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const { status, data: items, errorMessage, reload } = useGuardedQuery('template.items.view', () => templateApi.list());

  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TemplateItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TemplateItem | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const openCreate = () => {
    setEditingItem(null);
    setFormOpen(true);
  };
  const openEdit = (item: TemplateItem) => {
    setEditingItem(item);
    setFormOpen(true);
  };

  const handleSubmit = async (dto: CreateItemInput | UpdateItemInput) => {
    if (editingItem) {
      await gated('template.items.update', () => templateApi.update(editingItem.id, dto));
    } else {
      await gated('template.items.create', () => templateApi.create(dto as CreateItemInput));
    }
    reload();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('template.items.delete', () => templateApi.remove(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const copyPublicLink = async (item: TemplateItem) => {
    const url = `${window.location.origin}/template/public/items/${item.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setSnackbar(t('template.items.link_copied'));
    } catch {
      setSnackbar(url);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{t('template.menu.root')}</Typography>
        <Can permission="template.items.create">
          <Button startIcon={<AddIcon />} variant="contained" onClick={openCreate}>
            {t('template.items.create_button')}
          </Button>
        </Can>
      </Stack>

      <DefaultsPanel />

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('template.fields.title')}</TableCell>
                <TableCell>{t('template.fields.status')}</TableCell>
                <TableCell>{t('template.fields.created_at')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(items ?? []).map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell>{item.title}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[item.status]} label={t(`template.status.${item.status}`)} />
                  </TableCell>
                  <TableCell>{formatDateOnly(item.createdAt, language)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('template.items.copy_link')}>
                      <IconButton size="small" onClick={() => copyPublicLink(item)}>
                        <LinkIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Can permission="template.items.update">
                      <IconButton size="small" onClick={() => openEdit(item)} aria-label={t('core.common.edit')}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Can>
                    <Can permission="template.items.delete">
                      <IconButton size="small" onClick={() => setPendingDelete(item)} aria-label={t('core.common.delete')}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      <TemplateItemFormDialog open={formOpen} item={editingItem} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('template.items.delete_title')}
        description={t('template.items.delete_confirm', { title: pendingDelete?.title ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
