import AddIcon from '@mui/icons-material/Add';
import {
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can } from '../../../../apps/web/src/shared/permissions';
import { readingClubApi } from '../api';
import { AssignReaderDialog } from './AssignReaderDialog';

/** "The librarian can search a specific reader or see readers in a specific group or stage (filters) and an indicator how far the reader is from finishing the stage." */
export function ReadersListPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const groupId = searchParams.get('groupId') ?? '';
  const stageId = searchParams.get('stageId') ?? '';
  const [search, setSearch] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);

  const { status, data: readers, errorMessage, reload } = useGuardedQuery(() =>
    readingClubApi.listReaders({ groupId: groupId || undefined, stageId: stageId || undefined, search: search || undefined }),
  );

  const { data: groups } = useGuardedQuery(() => readingClubApi.listGroups());
  const selectedGroup = useMemo(() => (groups ?? []).find((g) => g.id === groupId) ?? null, [groups, groupId]);

  const setGroupFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('groupId', value);
    else next.delete('groupId');
    next.delete('stageId');
    setSearchParams(next);
  };
  const setStageFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('stageId', value);
    else next.delete('stageId');
    setSearchParams(next);
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h2">
          {t('reading_club.menu.readers')}
        </Typography>
        <Can permission="reading_club.memberships.assign">
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setAssignOpen(true)}>
            {t('reading_club.readers.assign_button')}
          </Button>
        </Can>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <TextField
          label={t('reading_club.readers.search_label')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && reload()}
          sx={{ minWidth: 220 }}
        />
        <TextField select label={t('reading_club.menu.groups')} value={groupId} onChange={(e) => setGroupFilter(e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="">{t('reading_club.readers.all_groups')}</MenuItem>
          {(groups ?? []).map((group) => (
            <MenuItem key={group.id} value={group.id}>
              {group.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('reading_club.readers.filter_stage')}
          value={stageId}
          onChange={(e) => setStageFilter(e.target.value)}
          disabled={!selectedGroup}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t('reading_club.readers.all_stages')}</MenuItem>
          {(selectedGroup?.stages ?? [])
            .slice()
            .sort((a, b) => a.stageOrder - b.stageOrder)
            .map((stage) => (
              <MenuItem key={stage.id} value={stage.id}>
                {stage.stageOrder}. {stage.name}
              </MenuItem>
            ))}
        </TextField>
        <Button variant="outlined" onClick={reload}>
          {t('reading_club.readers.apply_filters')}
        </Button>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_circulation.students.code')}</TableCell>
                <TableCell>{t('reading_club.fields.name')}</TableCell>
                <TableCell>{t('reading_club.menu.groups')}</TableCell>
                <TableCell>{t('reading_club.readers.current_stage')}</TableCell>
                <TableCell>{t('reading_club.readers.progress')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(readers ?? []).map((reader) => (
                <TableRow key={reader.studentId} hover>
                  <TableCell>
                    <RouterLink to={`/reading-club/readers/${reader.studentId}`}>{reader.studentCode ?? '—'}</RouterLink>
                  </TableCell>
                  <TableCell>{reader.studentName ?? '—'}</TableCell>
                  <TableCell>{reader.groupName ?? '—'}</TableCell>
                  <TableCell>{reader.stageName ? `${reader.stageOrder}. ${reader.stageName}` : '—'}</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    {reader.progress ? (
                      <Box>
                        <Typography variant="caption">
                          {reader.progress.progressAmount} / {reader.progress.targetAmount} {t(`reading_club.target_type.${reader.progress.targetType}`)}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, (reader.progress.progressAmount / reader.progress.targetAmount) * 100)}
                          color={reader.progress.isComplete ? 'success' : 'primary'}
                        />
                      </Box>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(readers ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.no_data')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      <AssignReaderDialog open={assignOpen} onClose={() => setAssignOpen(false)} onAssigned={reload} />
    </Box>
  );
}
