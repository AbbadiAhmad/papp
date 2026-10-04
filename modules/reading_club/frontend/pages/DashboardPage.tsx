import { Box, Card, CardActionArea, CardContent, Chip, Grid, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { readingClubApi } from '../api';
import { EpisodeSwitcher } from './EpisodeSwitcher';

/** "The dashboard shows the groups and stages statistics. When clicking it goes to the details." — clicking a group/stage navigates to the readers list, pre-filtered. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const episodeId = searchParams.get('episodeId') ?? '';
  const { status, data, errorMessage, reload } = useGuardedQuery(() => readingClubApi.getDashboardStats(episodeId || undefined));

  const setEpisodeFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('episodeId', value);
    else next.delete('episodeId');
    setSearchParams(next);
  };

  // `episodeId` carried through on every link below (bug fix — it was
  // previously dropped even on the existing per-group/per-stage cards),
  // so following a link while viewing a past episode lands on that SAME
  // episode's data instead of silently resetting to the current one
  // (ReadersListPage/GroupsListPage's own `episodeId` default).
  const episodeQuery = episodeId ? `episodeId=${episodeId}` : '';
  const withEpisodeQuery = (path: string, params: string) => {
    const query = [params, episodeQuery].filter(Boolean).join('&');
    return query ? `${path}?${query}` : path;
  };

  const topCards = data
    ? [
        {
          label: t('reading_club.dashboard.total_groups'),
          value: data.totalGroups,
          color: 'text.primary',
          to: withEpisodeQuery('/reading-club/groups', ''),
        },
        {
          label: t('reading_club.dashboard.total_active_readers'),
          value: data.totalActiveReaders,
          color: 'text.primary',
          to: withEpisodeQuery('/reading-club/readers', ''),
        },
        // No separate "pending rewards" list page exists — the table right
        // below this row already shows every pending reward in full, so
        // there's nothing further to link to (CLAUDE.md: flag the gap
        // rather than guess; see this change's DECISIONS.md entry).
        { label: t('reading_club.dashboard.pending_rewards'), value: data.pendingRewardsCount, color: 'warning.main', to: null },
      ]
    : [];

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Typography variant="h4" component="h2">
          {t('reading_club.menu.dashboard')}
        </Typography>
        <EpisodeSwitcher episodeId={episodeId} onEpisodeChange={setEpisodeFilter} />
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {topCards.map((card) => (
            <Grid key={card.label} size={{ xs: 12, sm: 4 }}>
              <Card>
                {card.to ? (
                  <CardActionArea onClick={() => navigate(card.to as string)}>
                    <CardContent>
                      <Typography variant="body2" color="text.secondary">
                        {card.label}
                      </Typography>
                      <Typography variant="h4" sx={{ color: card.color, mt: 1 }}>
                        {card.value}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                ) : (
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">
                      {card.label}
                    </Typography>
                    <Typography variant="h4" sx={{ color: card.color, mt: 1 }}>
                      {card.value}
                    </Typography>
                  </CardContent>
                )}
              </Card>
            </Grid>
          ))}
        </Grid>

        <Typography variant="h6" gutterBottom>
          {t('reading_club.dashboard.groups_heading')}
        </Typography>
        <Grid container spacing={2}>
          {(data?.groups ?? []).map((group) => (
            <Grid key={group.id} size={{ xs: 12, md: 6 }}>
              <Card>
                <CardActionArea onClick={() => navigate(withEpisodeQuery('/reading-club/readers', `groupId=${group.id}`))}>
                  <CardContent>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="h6">{group.name}</Typography>
                      <Chip
                        size="small"
                        label={t('reading_club.dashboard.member_count', { count: group.memberCount })}
                        color="primary"
                      />
                    </Stack>
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                      {group.stages.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('reading_club.groups.no_stages')}
                        </Typography>
                      ) : (
                        group.stages.map((stage) => (
                          <Stack
                            key={stage.id}
                            direction="row"
                            sx={{ justifyContent: 'space-between' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(withEpisodeQuery('/reading-club/readers', `groupId=${group.id}&stageId=${stage.id}`));
                            }}
                          >
                            <Typography variant="body2">
                              {stage.stageOrder}. {stage.name} ({stage.targetAmount} {t(`reading_club.target_type.${stage.targetType}`)})
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {t('reading_club.dashboard.readers_on_stage', { count: stage.readersOnStageCount })}
                            </Typography>
                          </Stack>
                        ))
                      )}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>

        <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
          {t('reading_club.dashboard.pending_rewards_heading')}
        </Typography>
        {(data?.pendingRewards ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('core.common.no_data')}
          </Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('reading_club.fields.name')}</TableCell>
                  <TableCell>{t('reading_club.menu.groups')}</TableCell>
                  <TableCell>{t('reading_club.readers.current_stage')}</TableCell>
                  <TableCell>{t('reading_club.fields.reward_description')}</TableCell>
                  <TableCell>{t('reading_club.readers.completed_at')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.pendingRewards ?? []).map((reward) => (
                  <TableRow key={reward.id} hover>
                    <TableCell>
                      <RouterLink to={`/reading-club/readers/${reward.studentId}`}>
                        {reward.studentName ?? reward.studentCode ?? '—'}
                      </RouterLink>
                    </TableCell>
                    <TableCell>{reward.groupName ?? '—'}</TableCell>
                    <TableCell>{reward.stageName ?? '—'}</TableCell>
                    <TableCell>{reward.rewardDescription ?? '—'}</TableCell>
                    <TableCell>{formatDateOnly(reward.completedAt, language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryStateGate>
    </Box>
  );
}
