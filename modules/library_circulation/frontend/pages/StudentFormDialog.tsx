import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import type { CreateStudentInput, LibraryStudent, UpdateStudentInput } from '../api';

interface Props {
  open: boolean;
  student: LibraryStudent | null;
  onClose: () => void;
  onSubmit: (dto: CreateStudentInput | UpdateStudentInput) => Promise<void>;
}

/** Create makes a NEW platform login + library profile in one step (§2) — edit only touches the library profile fields. */
export function StudentFormDialog({ open, student, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const isEdit = student !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? t('library_circulation.students.edit_title') : t('library_circulation.students.create_title')}</DialogTitle>
      {open ? <FormFields key={student?.id ?? 'new'} student={student} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function FormFields({ student, onClose, onSubmit }: { student: LibraryStudent | null; onClose: () => void; onSubmit: Props['onSubmit'] }) {
  const { t } = useTranslation();
  const isEdit = student !== null;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(student?.code ?? '');
  const [className, setClassName] = useState(student?.className ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        await onSubmit({ code, className: className || undefined });
      } else {
        await onSubmit({ name, email, code, className: className || undefined });
      }
      onClose();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = isEdit ? code.trim().length > 0 : name.trim().length > 0 && email.trim().length > 0 && code.trim().length > 0;

  return (
    <>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {!isEdit ? (
            <>
              <TextField label={t('core.auth.name')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              <TextField label={t('core.auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </>
          ) : null}
          <TextField
            label={t('library_circulation.students.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            helperText={t('library_circulation.students.code_help')}
          />
          <TextField label={t('library_circulation.students.class_name')} value={className} onChange={(e) => setClassName(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !canSubmit}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </>
  );
}
