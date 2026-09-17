import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import type { CreateItemInput, TemplateItem, TemplateItemStatus, UpdateItemInput } from '../api';

interface Props {
  open: boolean;
  item: TemplateItem | null;
  onClose: () => void;
  onSubmit: (dto: CreateItemInput | UpdateItemInput) => Promise<void>;
}

/** Mirrors modules/library_catalog/frontend/pages/BookFormDialog.tsx's own mount/remount-by-key pattern. */
export function TemplateItemFormDialog({ open, item, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const isEdit = item !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? t('template.items.edit_title') : t('template.items.create_title')}</DialogTitle>
      {open ? <FormFields key={item?.id ?? 'new'} item={item} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function FormFields({ item, onClose, onSubmit }: { item: TemplateItem | null; onClose: () => void; onSubmit: Props['onSubmit'] }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [status, setStatus] = useState<TemplateItemStatus | ''>(item?.status ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ title, description: description || undefined, status: status || undefined });
      onClose();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('template.fields.title')} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          <TextField
            label={t('template.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />
          <TextField
            select
            label={t('template.fields.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as TemplateItemStatus)}
            helperText={status ? undefined : t('template.items.status_default_hint')}
          >
            <MenuItem value="active">{t('template.status.active')}</MenuItem>
            <MenuItem value="archived">{t('template.status.archived')}</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !title.trim()}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </>
  );
}
