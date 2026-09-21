import { Box, Card, CardActionArea, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { readingClubApi } from '../api';

/** "The dashboard shows the groups and stages statistics. When clicking it goes to the details." — clicking a group/stage navigates to the readers list, pre-filtered. */
export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, data, errorMessage, reload } = useGuardedQuery(() => readingClubApi.getDashboardStats());

  const topCards = data
    ? [
        { label: t('reading_club.dashboard.total_groups'), value: data.totalGroups, color: 'text.primary' },
        { label: t('reading_club.dashboard.total_active_readers'), value: data.totalActiveReaders, color: 'text.primary' },
        { label: t('reading_club.dashboard.pending_rewards'), value: data.pendingRewardsCount, color: 'warning.main' },
      ]
    : [];

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('reading_club.menu.dashboard')}
      </Typography>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {topCards.map((card) => (
            <Grid key={card.label} size={{ xs: 12, sm: 4 }}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    {card.label}
                  </Typography>
                  <Typography variant="h4" sx={{ color: card.color, mt: 1 }}>
                    {card.value}
                  </Typography>
                </CardContent>
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
                <CardActionArea onClick={() => navigate(`/reading-club/readers?groupId=${group.id}`)}>
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
                              navigate(`/reading-club/readers?groupId=${group.id}&stageId=${stage.id}`);
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
      </QueryStateGate>
    </Box>
  );
}
