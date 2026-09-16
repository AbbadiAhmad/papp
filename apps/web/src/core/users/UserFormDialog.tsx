import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../shared/api/httpClient';
import type { CreateUserInput, UpdateUserInput } from '../../shared/api/users';
import type { PublicUser } from '../../shared/api/types';

interface Props {
  open: boolean;
  user: PublicUser | null;
  onClose: () => void;
  onSubmit: (dto: CreateUserInput | UpdateUserInput) => Promise<void>;
}

/**
 * `UserFormFields` mounts only while `open` is true and remounts (fresh
 * initial state, no reset effect) whenever the target user changes, via the
 * `key` below — see RoleFormDialog's docblock for why this replaces the
 * "effect mirrors a prop into local state" pattern.
 */
export function UserFormDialog({ open, user, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const isEdit = user !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? t('core.users.edit_title') : t('core.users.create_title')}</DialogTitle>
      {open ? <UserFormFields key={user?.id ?? 'new'} user={user} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function UserFormFields({
  user,
  onClose,
  onSubmit,
}: {
  user: PublicUser | null;
  onClose: () => void;
  onSubmit: (dto: CreateUserInput | UpdateUserInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const isEdit = user !== null;
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [externalId, setExternalId] = useState(user?.externalId ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [mustChangePassword, setMustChangePassword] = useState(user?.mustChangePassword ?? true);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        const dto: UpdateUserInput = {
          email,
          name,
          externalId: externalId || undefined,
          department: department || undefined,
          isActive,
          mustChangePassword,
        };
        if (password) dto.password = password;
        await onSubmit(dto);
      } else {
        const dto: CreateUserInput = {
          email,
          name,
          password,
          externalId: externalId || undefined,
          department: department || undefined,
          mustChangePassword,
        };
        await onSubmit(dto);
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
          <TextField label={t('core.auth.name')} value={name} onChange={(e) => setName(e.target.value)} required fullWidth />
          <TextField
            label={t('core.auth.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label={isEdit ? t('core.users.new_password_optional') : t('core.auth.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!isEdit}
            fullWidth
            autoComplete="new-password"
          />
          <TextField label={t('core.users.external_id')} value={externalId} onChange={(e) => setExternalId(e.target.value)} fullWidth />
          <TextField label={t('core.users.department')} value={department} onChange={(e) => setDepartment(e.target.value)} fullWidth />
          <FormControlLabel
            control={<Checkbox checked={mustChangePassword} onChange={(e) => setMustChangePassword(e.target.checked)} />}
            label={t('core.users.must_change_password')}
          />
          {isEdit ? (
            <FormControlLabel
              control={<Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
              label={t('core.users.is_active')}
            />
          ) : null}
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
