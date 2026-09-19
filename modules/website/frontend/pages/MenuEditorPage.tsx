import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import { Alert, Box, Button, IconButton, Paper, Snackbar, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { websiteApi, type MenuItemInput, type MenuLocation, type WebsiteMenuItem } from '../api';

export function MenuEditorPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MenuLocation>('header');

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('website.menu.menus')}
      </Typography>
      <Tabs value={tab} onChange={(_, v: MenuLocation) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="header" label={t('website.menus.header')} />
        <Tab value="footer" label={t('website.menus.footer')} />
      </Tabs>
      <MenuLocationEditor key={tab} location={tab} />
    </Box>
  );
}

function MenuLocationEditor({ location }: { location: MenuLocation }) {
  const { status, data, errorMessage, reload } = useGuardedQuery(() => websiteApi.listMenu(location));

  return (
    <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
      {data ? <MenuItemsForm location={location} initial={data} onSaved={reload} /> : null}
    </QueryStateGate>
  );
}

function MenuItemsForm({ location, initial, onSaved }: { location: MenuLocation; initial: WebsiteMenuItem[]; onSaved: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), location, label: '', urlOrSlug: '', orderIndex: prev.length, parentId: null },
    ]);
  };

  const updateItem = (id: string, patch: Partial<WebsiteMenuItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id).map((item, i) => ({ ...item, orderIndex: i })));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, i) => ({ ...item, orderIndex: i }));
    });
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const input: MenuItemInput[] = items.map((item) => ({
        id: item.id,
        label: item.label,
        urlOrSlug: item.urlOrSlug,
        orderIndex: item.orderIndex,
        parentId: item.parentId ?? undefined,
      }));
      await gated('website.menus.update', () => websiteApi.replaceMenu(location, input));
      setSnackbar(t('core.settings.saved'));
      onSaved();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Stack spacing={2}>
        {items.map((item, index) => (
          <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <TextField
                label={t('website.menus.label')}
                value={item.label}
                onChange={(e) => updateItem(item.id, { label: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label={t('website.menus.url_or_slug')}
                value={item.urlOrSlug}
                onChange={(e) => updateItem(item.id, { urlOrSlug: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
              />
              <IconButton size="small" onClick={() => moveItem(index, -1)} disabled={index === 0}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => removeItem(item.id)} aria-label={t('core.common.delete')}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button startIcon={<AddIcon />} onClick={addItem}>
          {t('website.menus.add_item')}
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {t('core.common.save')}
        </Button>
      </Stack>

      <Snackbar open={snackbar !== null} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
