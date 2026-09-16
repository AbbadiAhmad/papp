import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../shared/api/httpClient';
import type { CreateRoleInput, UpdateRoleInput } from '../../shared/api/roles';
import type { PublicRole } from '../../shared/api/types';

interface Props {
  open: boolean;
  role: PublicRole | null;
  onClose: () => void;
  onSubmit: (dto: CreateRoleInput | UpdateRoleInput) => Promise<void>;
}

/**
 * `RoleFormFields` is only ever mounted while `open` is true, and remounts
 * (fresh `useState` initial values, no reset effect needed) whenever the
 * target role changes — via the `key` below. This is the "reset state by
 * changing key" pattern React's docs recommend in place of an effect that
 * mirrors a prop into local state (see this Developer agent's report: a
 * newer eslint-plugin-react-hooks rule flags synchronous `setState` calls
 * reachable from an effect, which that mirroring pattern always trips).
 */
export function RoleFormDialog({ open, role, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const isEdit = role !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? t('core.roles.edit_title') : t('core.roles.create_title')}</DialogTitle>
      {open ? <RoleFormFields key={role?.id ?? 'new'} role={role} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function RoleFormFields({
  role,
  onClose,
  onSubmit,
}: {
  role: PublicRole | null;
  onClose: () => void;
  onSubmit: (dto: CreateRoleInput | UpdateRoleInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const isEdit = role !== null;
  const [code, setCode] = useState(role?.code ?? '');
  const [nameI18nKey, setNameI18nKey] = useState(role?.nameI18nKey ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        await onSubmit({ nameI18nKey } satisfies UpdateRoleInput);
      } else {
        await onSubmit({ code, nameI18nKey } satisfies CreateRoleInput);
      }
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label={t('core.roles.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            fullWidth
            disabled={isEdit}
            helperText={t('core.roles.code_help')}
          />
          <TextField
            label={t('core.roles.name_i18n_key')}
            value={nameI18nKey}
            onChange={(e) => setNameI18nKey(e.target.value)}
            required
            fullWidth
            helperText={t('core.roles.name_i18n_key_help')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </>
  );
}
