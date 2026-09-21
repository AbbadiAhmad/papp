import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { readingClubApi, type ReadingClubGroup } from '../api';
import { circulationIntegration, type CirculationStudent } from '../circulationIntegration';

/** First assignment OR moving a reader to a different group (§"the librarian can move the reader from one group to another"). The reader pool is library_circulation's own student list (§ every reader is a library_students row). */
export function AssignReaderDialog({ open, onClose, onAssigned }: { open: boolean; onClose: () => void; onAssigned: () => void }) {
  const { t } = useTranslation();
  const [students, setStudents] = useState<CirculationStudent[]>([]);
  const [groups, setGroups] = useState<ReadingClubGroup[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<CirculationStudent | null>(null);
  const [groupId, setGroupId] = useState('');
  const [stageId, setStageId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedStudent(null);
    setGroupId('');
    setStageId('');
    Promise.all([circulationIntegration.listStudents(), readingClubApi.listGroups()])
      .then(([studentList, groupList]) => {
        setStudents(studentList);
        setGroups(groupList);
      })
      .catch((err) => setError(extractErrorMessage(err)));
  }, [open]);

  const selectedGroup = groups.find((g) => g.id === groupId) ?? null;

  const handleSubmit = async () => {
    if (!selectedStudent || !groupId) return;
    setSaving(true);
    setError(null);
    try {
      await readingClubApi.assign(selectedStudent.id, groupId, stageId || undefined);
      onAssigned();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('reading_club.readers.assign_title')}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Autocomplete
            options={students}
            value={selectedStudent}
            onChange={(_, value) => setSelectedStudent(value)}
            getOptionLabel={(option) => `${option.code}${option.className ? ` — ${option.className}` : ''}`}
            renderInput={(params) => <TextField {...params} label={t('reading_club.readers.pick_reader')} />}
          />
          <TextField
            select
            label={t('reading_club.menu.groups')}
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              setStageId('');
            }}
          >
            {groups.map((group) => (
              <MenuItem key={group.id} value={group.id}>
                {group.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('reading_club.readers.starting_stage')}
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            disabled={!selectedGroup}
            helperText={t('reading_club.readers.starting_stage_hint')}
          >
            <MenuItem value="">{t('reading_club.readers.first_stage')}</MenuItem>
            {(selectedGroup?.stages ?? [])
              .slice()
              .sort((a, b) => a.stageOrder - b.stageOrder)
              .map((stage) => (
                <MenuItem key={stage.id} value={stage.id}>
                  {stage.stageOrder}. {stage.name}
                </MenuItem>
              ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !selectedStudent || !groupId}>
          {t('reading_club.readers.assign_button')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
