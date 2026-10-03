import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Switch, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreateGroupInput, ReadingClubGroup, UpdateGroupInput } from '../api';

export function GroupFormDialog({
  open,
  group,
  onClose,
  onSubmit,
}: {
  open: boolean;
  group: ReadingClubGroup | null;
  onClose: () => void;
  onSubmit: (dto: CreateGroupInput | UpdateGroupInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '');
      setDescription(group?.description ?? '');
      setIsActive(group?.isActive ?? true);
    }
  }, [open, group]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSubmit({ name, description: description || undefined, isActive });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{group ? t('reading_club.groups.edit_title') : t('reading_club.groups.create_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label={t('reading_club.fields.name')} value={name} onChange={(e) => setName(e.target.value)} fullWidth required />
          <TextField
            label={t('reading_club.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <FormControlLabel
            control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
            label={t('reading_club.fields.is_active')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving || !name.trim()}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
