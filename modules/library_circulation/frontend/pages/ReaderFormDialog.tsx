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
  Switch,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { libraryCirculationApi, type CreateStudentInput, type LibraryStudent, type UpdateStudentInput } from '../api';

interface Props {
  open: boolean;
  student: LibraryStudent | null;
  onClose: () => void;
  onSubmit: (dto: CreateStudentInput | UpdateStudentInput) => Promise<void>;
}

/**
 * Create makes a NEW platform login + library profile in one step (§2); the
 * code field is pre-filled with the next incremental code (editable, same as
 * a book copy's code). Edit changes every reader field — profile AND the
 * linked account — except roles, which only core Users manages.
 */
export function ReaderFormDialog({ open, student, onClose, onSubmit }: Props) {
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
  const [name, setName] = useState(student?.name ?? '');
  const [email, setEmail] = useState(student?.email ?? '');
  const [code, setCode] = useState(student?.code ?? '');
  const [className, setClassName] = useState(student?.className ?? '');
  const [externalId, setExternalId] = useState(student?.externalId ?? '');
  const [department, setDepartment] = useState(student?.department ?? '');
  const [isActive, setIsActive] = useState(student?.isActive ?? true);
  const [resetPassword, setResetPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Suggested next code — read-only peek, pre-filled but fully editable (library_catalog's Add Copy does the same).
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    libraryCirculationApi
      .peekNextStudentCode()
      .then((next) => {
        if (!cancelled) setCode((current) => current || next);
      })
      .catch(() => undefined); // suggestion only — blank is still valid, the server assigns one
    return () => {
      cancelled = true;
    };
  }, [isEdit]);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        await onSubmit({
          code,
          className,
          name,
          email,
          externalId,
          department,
          isActive,
          ...(resetPassword ? { resetPassword: true } : {}),
        });
      } else {
        await onSubmit({
          name,
          email,
          code: code.trim() || undefined,
          className: className || undefined,
          externalId: externalId || undefined,
          department: department || undefined,
        });
      }
      onClose();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && (!isEdit || code.trim().length > 0);

  return (
    <>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('core.auth.name')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField label={t('core.auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField
            label={t('library_circulation.students.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required={isEdit}
            helperText={isEdit ? t('library_circulation.students.code_help') : t('library_circulation.students.code_suggested_hint')}
          />
          <TextField label={t('library_circulation.students.class_name')} value={className} onChange={(e) => setClassName(e.target.value)} />
          <TextField label={t('library_circulation.students.external_id')} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          <TextField label={t('library_circulation.students.department')} value={department} onChange={(e) => setDepartment(e.target.value)} />
          {isEdit ? (
            <>
              <FormControlLabel
                control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
                label={t('library_circulation.students.is_active')}
              />
              <FormControlLabel
                control={<Checkbox checked={resetPassword} onChange={(e) => setResetPassword(e.target.checked)} />}
                label={t('library_circulation.students.reset_password')}
              />
            </>
          ) : null}
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
