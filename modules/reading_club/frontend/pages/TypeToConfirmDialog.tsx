import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, TextField, DialogTitle } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Stronger confirmation than the plain `ConfirmDialog` (which this module
 * uses everywhere else) — the delete button stays disabled until the
 * typed text matches `expectedText` exactly. Used for group/stage deletion
 * only (READING_CLUB-D16): deletion is no longer blocked by history, so
 * this is the UX-only safety net that replaces the removed hard block —
 * never a second block, just a harder-to-fat-finger confirm.
 */
export function TypeToConfirmDialog({
  open,
  title,
  description,
  warning,
  expectedText,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  warning?: string | null;
  expectedText: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const matches = typed === expectedText;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: warning ? 1 : 2 }}>{description}</DialogContentText>
        {warning ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {warning}
          </Alert>
        ) : null}
        <TextField
          autoFocus
          fullWidth
          label={t('reading_club.groups.type_to_confirm_label', { name: expectedText })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('core.common.cancel')}</Button>
        <Button onClick={onConfirm} color="error" variant="contained" disabled={!matches}>
          {confirmLabel ?? t('core.common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
