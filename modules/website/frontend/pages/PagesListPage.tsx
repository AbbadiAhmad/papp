import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import HomeIcon from '@mui/icons-material/Home';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { websiteApi, type PageStatus, type WebsitePage } from '../api';

const STATUS_COLOR: Record<PageStatus, 'success' | 'default'> = { published: 'success', draft: 'default' };

export function PagesListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gated = useGatedCall();
  const { status, data: pages, errorMessage, reload } = useGuardedQuery(() => websiteApi.listPages());

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WebsitePage | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('website.pages.delete', () => websiteApi.removePage(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const togglePublish = async (page: WebsitePage) => {
    try {
      if (page.status === 'published') {
        await gated('website.pages.publish', () => websiteApi.unpublishPage(page.id));
      } else {
        await gated('website.pages.publish', () => websiteApi.publishPage(page.id));
      }
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

  const setHomepage = async (page: WebsitePage) => {
    try {
      await gated('website.pages.update', () => websiteApi.updatePage(page.id, { isHomepage: true }));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h2">
          {t('website.menu.pages')}
        </Typography>
        <Can permission="website.pages.create">
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
            {t('website.pages.create_button')}
          </Button>
        </Can>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('website.pages.title')}</TableCell>
                <TableCell>{t('website.pages.slug')}</TableCell>
                <TableCell>{t('website.pages.status')}</TableCell>
                <TableCell>{t('website.pages.homepage')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(pages ?? []).map((page) => (
                <TableRow key={page.id} hover>
                  <TableCell>
                    <RouterLink to={`/site/admin/pages/${page.id}`}>{page.title}</RouterLink>
                  </TableCell>
                  <TableCell>/{page.slug}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[page.status]} label={t(`website.pages.status_${page.status}`)} />
                  </TableCell>
                  <TableCell>
                    {page.isHomepage ? (
                      <Chip size="small" icon={<HomeIcon />} label={t('website.pages.homepage')} />
                    ) : (
                      <Can permission="website.pages.update">
                        <Button size="small" onClick={() => setHomepage(page)}>
                          {t('website.pages.set_as_homepage')}
                        </Button>
                      </Can>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Can permission="website.pages.publish">
                      <Button size="small" onClick={() => togglePublish(page)}>
                        {page.status === 'published' ? t('website.pages.unpublish') : t('website.pages.publish')}
                      </Button>
                    </Can>
                    <Tooltip title={t('core.common.edit')}>
                      <IconButton size="small" onClick={() => navigate(`/site/admin/pages/${page.id}`)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Can permission="website.pages.delete">
                      <Tooltip title={t('core.common.delete')}>
                        <IconButton size="small" onClick={() => setPendingDelete(page)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      <CreatePageDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(page) => {
          setCreateOpen(false);
          navigate(`/site/admin/pages/${page.id}`);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('website.pages.delete_title')}
        description={t('website.pages.delete_confirm', { title: pendingDelete?.title ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}

function CreatePageDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (page: WebsitePage) => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const page = await gated('website.pages.create', () => websiteApi.createPage({ slug, title }));
      setSlug('');
      setTitle('');
      onCreated(page);
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('website.pages.create_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('website.pages.title')} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          <TextField
            label={t('website.pages.slug')}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            required
            helperText={t('website.pages.slug_help')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !slug.trim() || !title.trim()}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
