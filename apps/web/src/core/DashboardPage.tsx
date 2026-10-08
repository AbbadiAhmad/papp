import { alpha, Box, Card, CardActionArea, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { useLanguage } from '../app/LanguageContext';
import { labelOf } from '../shared/modules/applyMenuLayout';
import { resolveMenuIcon } from '../shared/modules/menuIcons';
import { useNavNodes } from '../shared/components/PageLayout';
import { CardGrid, PageHero } from '../shared/ui/kit';

/** Each shortcut gets its own accent so the page reads as colorful tiles, not a wall of one hue. */
const ACCENTS = ['primary', 'secondary', 'success', 'info', 'warning', 'error'] as const;

/**
 * Home: a welcome banner plus a shortcut tile for every page this user can
 * open, grouped exactly like the menu (so an admin's menu layout, D96, also
 * shapes this page). Built from the same nodes and permission checks as the
 * sidebar, so it never offers a page the user can't reach.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { user, hasPermission } = useAuth();
  const nodes = useNavNodes();

  const sections = nodes
    .map((node) => ({
      node,
      leaves: (node.type === 'leaf' ? [node] : node.children).filter(
        (leaf) => leaf.route !== '/' && (leaf.requiredPermission === '__always__' || hasPermission(leaf.requiredPermission)),
      ),
    }))
    .filter((section) => section.leaves.length > 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <PageHero title={t('core.dashboard.welcome', { name: user?.name ?? '' })} subtitle={t('core.dashboard.hint')} />
      {sections.map(({ node, leaves }) => (
        <Box key={node.id} component="section" aria-labelledby={`dash-${node.id}`}>
          <Typography id={`dash-${node.id}`} variant="h6" component="h3" sx={{ mb: 1.5 }}>
            {labelOf(node, language, t)}
          </Typography>
          <CardGrid min={190}>
            {leaves.map((leaf, index) => (
              <Card key={leaf.id}>
                <CardActionArea component={RouterLink} to={leaf.route} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'flex-start' }}>
                  <Box
                    sx={(theme) => {
                      const accent = theme.palette[ACCENTS[index % ACCENTS.length]].main;
                      return { display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: '50%', flexShrink: 0, color: accent, bgcolor: alpha(accent, theme.palette.mode === 'dark' ? 0.22 : 0.14) };
                    }}
                  >
                    {resolveMenuIcon(leaf.iconName ?? (node.type === 'group' ? node.iconName : undefined))}
                  </Box>
                  <Typography sx={{ fontWeight: 700 }}>{labelOf(leaf, language, t)}</Typography>
                </CardActionArea>
              </Card>
            ))}
          </CardGrid>
        </Box>
      ))}
    </Box>
  );
}
