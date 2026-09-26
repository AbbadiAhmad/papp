import { Alert, MenuItem, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { readingClubApi, type ReadingClubEpisode } from '../api';

/**
 * A `<Select>` reachable from Dashboard/Groups/Readers toolbars (placement
 * choice — see DECISIONS.md READING_CLUB-D12) letting a permitted user
 * browse a past, closed episode read-only via `?episodeId=`. Defaults to
 * the current episode when `episodeId` is empty. Callers pass
 * `onEpisodeChange` (updates the `?episodeId=` search param) and
 * `episodeId` (the currently-selected value, `''` meaning "current").
 */
export function EpisodeSwitcher({
  episodeId,
  onEpisodeChange,
}: {
  episodeId: string;
  onEpisodeChange: (episodeId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: episodes } = useGuardedQuery(() => readingClubApi.listEpisodes());
  const current = (episodes ?? []).find((e: ReadingClubEpisode) => e.isCurrent) ?? null;
  const selected = episodeId || current?.id || '';
  const isViewingPast = Boolean(episodeId) && episodeId !== current?.id;

  return (
    <>
      <TextField
        select
        size="small"
        label={t('reading_club.episodes.viewing_episode')}
        value={selected}
        onChange={(e) => onEpisodeChange(e.target.value === current?.id ? '' : e.target.value)}
        sx={{ minWidth: 220 }}
      >
        {(episodes ?? []).map((episode) => (
          <MenuItem key={episode.id} value={episode.id}>
            {episode.name}
            {episode.isCurrent ? ` (${t('reading_club.episodes.current')})` : ''}
          </MenuItem>
        ))}
      </TextField>
      {isViewingPast ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {t('reading_club.episodes.viewing_past_readonly')}
        </Alert>
      ) : null}
    </>
  );
}
