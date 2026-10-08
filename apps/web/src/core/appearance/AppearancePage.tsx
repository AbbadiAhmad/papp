import type { MenuLayout, ThemePack } from '@papp/shared-types';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../app/LanguageContext';
import { useMenuLayout, useThemePack } from '../../app/AppearanceContext';
import { appearanceApi } from '../../shared/api/appearance';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { usePermission } from '../../shared/permissions';
import { materializeLayout } from '../../shared/modules/applyMenuLayout';
import type { ResolvedMenuLeaf } from '../../shared/modules/buildModuleMenuEntries';
import { useDefaultNavNodes } from '../../shared/components/PageLayout';

/** Entries the api refuses to hide, so nobody locks themselves out of this page (mirrors MENU_ALWAYS_VISIBLE_IDS). */
const ALWAYS_VISIBLE = ['appearance'];

export function AppearancePage() {
  const { t } = useTranslation();
  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.appearance')}
      </Typography>
      <Stack spacing={4}>
        <ThemesSection />
        <MenuEditorSection />
      </Stack>
    </Box>
  );
}

function ThemesSection() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const canManage = usePermission('appearance.manage');
  const { reload: reloadActiveTheme } = useThemePack();
  const { status, data, errorMessage, reload } = useGuardedQuery(() => appearanceApi.listThemes());
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const activate = async (key: string) => {
    setError(null);
    setBusyKey(key);
    try {
      await appearanceApi.setActiveTheme(key);
      reload();
      reloadActiveTheme();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Box component="section" aria-labelledby="themes-heading">
      <Typography id="themes-heading" variant="h6" component="h3">
        {t('core.appearance.themesTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('core.appearance.themesHint')}
      </Typography>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {data ? (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            <ThemeCard
              themeKey="default"
              name={t('core.appearance.builtInName')}
              description={t('core.appearance.builtInDescription')}
              colors={['#1c4b82', '#f5f5f5', '#8a5a1c']}
              shell="sidebar"
              active={data.activeKey === 'default'}
              canManage={canManage}
              busy={busyKey === 'default'}
              onActivate={activate}
            />
            {data.themes.map((theme: ThemePack) => (
              <ThemeCard
                key={theme.key}
                themeKey={theme.key}
                name={theme.name[language === 'ar' ? 'ar' : 'en']}
                description={theme.description?.[language === 'ar' ? 'ar' : 'en']}
                colors={[theme.light.primary, theme.light.hero, theme.light.headerBg]}
                shell={theme.shell}
                active={data.activeKey === theme.key}
                canManage={canManage}
                busy={busyKey === theme.key}
                onActivate={activate}
              />
            ))}
          </Box>
        ) : null}
      </QueryStateGate>
    </Box>
  );
}

function ThemeCard(props: {
  themeKey: string;
  name: string;
  description?: string;
  colors: string[];
  shell: 'sidebar' | 'tabs';
  active: boolean;
  canManage: boolean;
  busy: boolean;
  onActivate: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card variant="outlined" sx={props.active ? { borderColor: 'primary.main', borderWidth: 2 } : undefined}>
      <CardContent>
        <Box aria-hidden sx={{ display: 'flex', height: 36, borderRadius: 1, overflow: 'hidden', mb: 1.5, border: 1, borderColor: 'divider' }}>
          {props.colors.map((c, i) => (
            <Box key={i} sx={{ flex: 1, bgcolor: c }} />
          ))}
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flexGrow: 1 }}>
            {props.name}
          </Typography>
          {props.active ? <Chip size="small" color="primary" label={t('core.appearance.active')} /> : null}
        </Stack>
        {props.description ? (
          <Typography variant="body2" color="text.secondary">
            {props.description}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {t(props.shell === 'tabs' ? 'core.appearance.shellTabs' : 'core.appearance.shellSidebar')}
        </Typography>
        {props.canManage && !props.active ? (
          <Button sx={{ mt: 1.5 }} variant="contained" size="small" disabled={props.busy} onClick={() => props.onActivate(props.themeKey)}>
            {t('core.appearance.activate')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function MenuEditorSection() {
  const { t } = useTranslation();
  const { layout, reload: reloadLayout } = useMenuLayout();
  const defaults = useDefaultNavNodes();
  const canManage = usePermission('appearance.manage');

  const leafById = useMemo(() => {
    const map = new Map<string, ResolvedMenuLeaf>();
    for (const node of defaults) {
      if (node.type === 'leaf') map.set(node.id, node);
      else node.children.forEach((c) => map.set(c.id, c));
    }
    return map;
  }, [defaults]);

  // `null` until the admin changes something; until then the editor shows the stored layout.
  const [edited, setEdited] = useState<MenuLayout | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const defaultGroupLabelKey = (id: string): string | undefined => {
    const node = defaults.find((n) => n.type === 'group' && n.id === id);
    return node?.labelKey;
  };

  const draft = useMemo(() => edited ?? materializeLayout(defaults, layout), [edited, defaults, layout]);
  const update = (next: MenuLayout) => {
    setSavedAt(null);
    setEdited(next);
  };

  const setGroup = (gi: number, patch: Partial<MenuLayout['groups'][number]>) =>
    update({ ...draft, groups: draft.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });

  const moveItemToGroup = (id: string, fromGi: number, toGi: number) => {
    if (fromGi === toGi) return;
    update({
      ...draft,
      groups: draft.groups.map((g, i) =>
        i === fromGi ? { ...g, itemIds: g.itemIds.filter((x) => x !== id) } : i === toGi ? { ...g, itemIds: [...g.itemIds, id] } : g,
      ),
    });
  };

  const setLeafLabel = (id: string, lang: 'ar' | 'en', text: string) =>
    update({ ...draft, labels: { ...draft.labels, [id]: { ...draft.labels[id], [lang]: text } } });

  const toggleHidden = (id: string) =>
    update({ ...draft, hidden: draft.hidden.includes(id) ? draft.hidden.filter((x) => x !== id) : [...draft.hidden, id] });

  const addGroup = () =>
    update({ ...draft, groups: [...draft.groups, { id: `custom_${Date.now().toString(36)}`, label: { ar: '', en: '' }, itemIds: [] }] });

  const deleteGroup = (gi: number) => {
    if (draft.groups.length < 2) return;
    const target = gi === 0 ? 1 : 0;
    const removed = draft.groups[gi];
    update({
      ...draft,
      groups: draft.groups
        .map((g, i) => (i === target ? { ...g, itemIds: [...g.itemIds, ...removed.itemIds] } : g))
        .filter((_, i) => i !== gi),
    });
  };

  /** Drops blank labels (the api requires both languages for a group label, and non-empty text for any override). */
  const sanitized = (): MenuLayout => ({
    groups: draft.groups.map((g) => {
      const ar = g.label?.ar?.trim() ?? '';
      const en = g.label?.en?.trim() ?? '';
      return { id: g.id, icon: g.icon, itemIds: g.itemIds, label: ar || en ? { ar: ar || en, en: en || ar } : undefined };
    }),
    hidden: draft.hidden,
    labels: Object.fromEntries(
      Object.entries(draft.labels)
        .map(([id, l]) => [id, { ...(l.ar?.trim() ? { ar: l.ar.trim() } : {}), ...(l.en?.trim() ? { en: l.en.trim() } : {}) }] as const)
        .filter(([, l]) => Object.keys(l).length > 0),
    ),
  });

  const save = async (next: MenuLayout) => {
    setError(null);
    setSaving(true);
    try {
      await appearanceApi.setMenuLayout(next);
      setEdited(null);
      reloadLayout();
      setSavedAt(Date.now());
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="section" aria-labelledby="menu-heading">
      <Typography id="menu-heading" variant="h6" component="h3">
        {t('core.appearance.menuTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('core.appearance.menuHint')}
      </Typography>
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {savedAt ? <Alert severity="success" sx={{ mb: 2 }}>{t('core.appearance.saved')}</Alert> : null}

      <Stack spacing={2}>
        {draft.groups.map((group, gi) => (
          <Card key={group.id} variant="outlined">
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, mb: 1 }}>
                <TextField
                  size="small"
                  label={t('core.appearance.groupNameAr')}
                  placeholder={defaultGroupLabelKey(group.id) ? t(defaultGroupLabelKey(group.id)!) : undefined}
                  slotProps={{ htmlInput: { maxLength: 80 }, inputLabel: { shrink: true } }}
                  value={group.label?.ar ?? ''}
                  disabled={!canManage}
                  onChange={(e) => setGroup(gi, { label: { ar: e.target.value, en: group.label?.en ?? '' } })}
                />
                <TextField
                  size="small"
                  label={t('core.appearance.groupNameEn')}
                  placeholder={defaultGroupLabelKey(group.id) ? t(defaultGroupLabelKey(group.id)!) : undefined}
                  value={group.label?.en ?? ''}
                  disabled={!canManage}
                  onChange={(e) => setGroup(gi, { label: { ar: group.label?.ar ?? '', en: e.target.value } })}
                  slotProps={{ htmlInput: { maxLength: 80 }, inputLabel: { shrink: true } }}
                />
                <Box sx={{ flexGrow: 1 }} />
                {canManage ? (
                  <Stack direction="row">
                    <Tooltip title={t('core.appearance.moveUp')}>
                      <span>
                        <IconButton aria-label={t('core.appearance.moveUp')} disabled={gi === 0} onClick={() => update({ ...draft, groups: move(draft.groups, gi, gi - 1) })}>
                          <ArrowUpwardIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('core.appearance.moveDown')}>
                      <span>
                        <IconButton aria-label={t('core.appearance.moveDown')} disabled={gi === draft.groups.length - 1} onClick={() => update({ ...draft, groups: move(draft.groups, gi, gi + 1) })}>
                          <ArrowDownwardIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('core.appearance.deleteGroup')}>
                      <span>
                        <IconButton aria-label={t('core.appearance.deleteGroup')} disabled={draft.groups.length < 2} onClick={() => deleteGroup(gi)}>
                          <DeleteIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ) : null}
              </Stack>

              {group.itemIds.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('core.appearance.emptyGroup')}
                </Typography>
              ) : null}

              {group.itemIds.map((id, ii) => {
                const leaf = leafById.get(id);
                if (!leaf) return null;
                const hidden = draft.hidden.includes(id);
                const locked = ALWAYS_VISIBLE.includes(id);
                return (
                  <Stack
                    key={id}
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { md: 'center' }, py: 1, borderTop: 1, borderColor: 'divider', opacity: hidden ? 0.6 : 1 }}
                  >
                    <Typography sx={{ minWidth: 160, fontWeight: 600 }}>{t(leaf.labelKey)}</Typography>
                    <TextField
                      size="small"
                      label={t('core.appearance.renameAr')}
                      value={draft.labels[id]?.ar ?? ''}
                      disabled={!canManage}
                      onChange={(e) => setLeafLabel(id, 'ar', e.target.value)}
                      slotProps={{ htmlInput: { maxLength: 80 } }}
                    />
                    <TextField
                      size="small"
                      label={t('core.appearance.renameEn')}
                      value={draft.labels[id]?.en ?? ''}
                      disabled={!canManage}
                      onChange={(e) => setLeafLabel(id, 'en', e.target.value)}
                      slotProps={{ htmlInput: { maxLength: 80 } }}
                    />
                    <TextField
                      select
                      size="small"
                      label={t('core.appearance.moveToGroup')}
                      value={gi}
                      disabled={!canManage}
                      onChange={(e) => moveItemToGroup(id, gi, Number(e.target.value))}
                      sx={{ minWidth: 150 }}
                    >
                      {draft.groups.map((g, idx) => (
                        <MenuItem key={g.id} value={idx}>
                          {g.label?.ar || g.label?.en || t(leafById.get(g.itemIds[0] ?? '')?.labelKey ?? 'core.appearance.untitledGroup')}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Box sx={{ flexGrow: 1 }} />
                    {canManage ? (
                      <Stack direction="row" sx={{ alignItems: 'center' }}>
                        <IconButton aria-label={t('core.appearance.moveUp')} disabled={ii === 0} onClick={() => setGroup(gi, { itemIds: move(group.itemIds, ii, ii - 1) })}>
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton aria-label={t('core.appearance.moveDown')} disabled={ii === group.itemIds.length - 1} onClick={() => setGroup(gi, { itemIds: move(group.itemIds, ii, ii + 1) })}>
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                        <Tooltip title={locked ? t('core.appearance.alwaysVisible') : ''}>
                          <span>
                            <Switch
                              checked={!hidden}
                              disabled={locked}
                              onChange={() => toggleHidden(id)}
                              slotProps={{ input: { 'aria-label': `${t('core.appearance.visible')}: ${t(leaf.labelKey)}` } }}
                            />
                          </span>
                        </Tooltip>
                      </Stack>
                    ) : null}
                  </Stack>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </Stack>

      {canManage ? (
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={addGroup}>
            {t('core.appearance.addGroup')}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button color="inherit" disabled={saving} onClick={() => void save({ groups: [], hidden: [], labels: {} })}>
            {t('core.appearance.resetMenu')}
          </Button>
          <Button variant="contained" disabled={saving || edited === null} onClick={() => void save(sanitized())}>
            {t('core.common.save')}
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}
