import { Badge, Box, Button, Divider, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { notificationsApi } from '../../shared/api/notifications';
import { useLanguage } from '../../app/LanguageContext';
import { formatDateTime } from '../../shared/format';
import type { InboxItem } from '../../shared/api/types';

/**
 * `GET /notifications/me` is gated by `notifications.view`, granted to every
 * base role by default (ARCHITECTURE.md §12.4) — so this is safe to call
 * unconditionally right after login without any pre-check.
 */
export function NotificationsBellMenu() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<InboxItem[]>([]);

  const load = useCallback(() => {
    notificationsApi
      .getInbox()
      .then((res) => {
        setUnreadCount(res.unreadCount);
        setItems(res.notifications.slice(0, 8));
      })
      .catch(() => {
        // notifications.view is default-granted to everyone; a failure here
        // (network hiccup, or a genuinely revoked grant on a custom role) is
        // silently non-fatal — the bell just shows nothing.
      });
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const handleMarkRead = async (id: string) => {
    await notificationsApi.markRead(id);
    load();
  };

  return (
    <>
      <Tooltip title={t('core.menu.notifications')}>
        <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)} aria-label={t('core.menu.notifications')}>
          <Badge badgeContent={unreadCount} color="error">
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: 360 } } }}>
        {items.length === 0 ? (
          <MenuItem disabled>{t('core.notifications.empty')}</MenuItem>
        ) : (
          items.map((item) => (
            <MenuItem
              key={item.notificationId}
              onClick={() => (item.readAt ? undefined : handleMarkRead(item.notificationId))}
              sx={{ whiteSpace: 'normal', alignItems: 'flex-start' }}
            >
              <Stack spacing={0.5} sx={{ width: '100%' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: item.readAt ? 400 : 700 }}>
                  {item.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(item.createdAt, language)}
                </Typography>
              </Stack>
            </MenuItem>
          ))
        )}
        <Divider />
        <Box sx={{ p: 1 }}>
          <Button component={RouterLink} to="/notifications" fullWidth size="small" onClick={() => setAnchor(null)}>
            {t('core.notifications.view_all')}
          </Button>
        </Box>
      </Menu>
    </>
  );
}
