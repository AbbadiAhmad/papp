import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CORE_PERMISSION_CATALOG } from '../../shared/corePermissionCatalog';
import { extractErrorMessage, isForbiddenError } from '../../shared/api/httpClient';
import { permissionsApi } from '../../shared/api/permissions';
import { rolesApi } from '../../shared/api/roles';
import type { PublicPermission, PublicRole } from '../../shared/api/types';

/**
 * D12 (ARCHITECTURE.md §7.4 / docs/DECISIONS.md D12): "admin always reaches
 * the Permissions page regardless of its own permission grants." This
 * page is intentionally NOT wrapped in `useGuardedQuery`/redirected to
 * `/forbidden` the way every other list page is — per BUILD_PLAN.md Phase 6,
 * its route must be reachable by ANYONE authenticated, and the page's OWN
 * behavior is what proves the bypass, not a client-side pre-check (there is
 * no reliable client-side "is this user admin" signal anyway: the login
 * response carries no role/permission claims — ARCHITECTURE.md §6.1/D45 —
 * and the JWT itself only carries `sub`/`sid`).
 *
 * *** A genuine backend gap this page exposes (reported, not fixed — out of
 * this Developer agent's apps/api/** scope) ***: `PermissionsPageGuard`'s
 * D12 bypass is wired ONLY onto `GET/PUT /permissions/roles/:roleId/grants`
 * (permissions.controller.ts). `GET /roles` and `GET /permissions` (the
 * catalog + role list this matrix needs to render at all) go through the
 * NORMAL `PermissionGuard` with NO bypass — gated by `roles.view` /
 * `permissions.view` respectively. A truly zero-grant admin (holding
 * `admin` but with every grant stripped) can therefore reach this route and
 * successfully call the two grants endpoints for a role it already knows
 * the ID of, but CANNOT discover the role list or the permission catalog
 * through any endpoint the committed backend exposes. This page degrades to
 * a manual-role-ID fallback for exactly that case (see `DegradedGrantEditor`
 * below) rather than silently pretending the matrix loaded — see this
 * Developer agent's final report for the recommended backend fix (extend
 * the D12 delegation to those two GET endpoints, since they are read-only
 * catalog/role listings, not grant mutations).
 */
export function PermissionsMatrixPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'loading' | 'full' | 'degraded'>('loading');
  const [permissions, setPermissions] = useState<PublicPermission[]>([]);
  const [roles, setRoles] = useState<PublicRole[]>([]);
  const [degradedReason, setDegradedReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([permissionsApi.list(), rolesApi.list()])
      .then(([perms, roleList]) => {
        if (cancelled) return;
        setPermissions(perms);
        setRoles(roleList);
        setPhase('full');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isForbiddenError(error)) {
          setDegradedReason(t('core.permissions.degraded_reason'));
          setPhase('degraded');
        } else {
          setDegradedReason(extractErrorMessage(error));
          setPhase('degraded');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.permissions')}
      </Typography>

      {phase === 'loading' ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
          <CircularProgress />
        </Box>
      ) : phase === 'full' ? (
        <FullMatrix roles={roles} permissions={permissions} />
      ) : (
        <DegradedGrantEditor reason={degradedReason} />
      )}
    </Box>
  );
}

function groupByCategory(permissions: PublicPermission[] | typeof CORE_PERMISSION_CATALOG) {
  const map = new Map<string, typeof permissions>();
  for (const perm of permissions) {
    const list = map.get(perm.category) ?? [];
    (list as unknown[]).push(perm);
    map.set(perm.category, list);
  }
  return map;
}

function FullMatrix({ roles, permissions }: { roles: PublicRole[]; permissions: PublicPermission[] }) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<Record<string, Set<string>>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(roles.map((role) => permissionsApi.getRoleGrants(role.id)))
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, Set<string>> = {};
        roles.forEach((role, i) => {
          next[role.id] = new Set(results[i]);
        });
        setGrants(next);
      })
      .catch((err: unknown) => setError(extractErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [roles]);

  const grouped = useMemo(() => groupByCategory(permissions) as Map<string, PublicPermission[]>, [permissions]);

  const toggle = (roleId: string, code: string) => {
    setGrants((prev) => {
      const current = new Set(prev[roleId] ?? []);
      if (current.has(code)) current.delete(code);
      else current.add(code);
      return { ...prev, [roleId]: current };
    });
    setDirty((prev) => ({ ...prev, [roleId]: true }));
  };

  const save = async (roleId: string) => {
    setSaving((prev) => ({ ...prev, [roleId]: true }));
    setError(null);
    try {
      const codes = Array.from(grants[roleId] ?? []);
      const updated = await permissionsApi.setRoleGrants(roleId, codes);
      setGrants((prev) => ({ ...prev, [roleId]: new Set(updated) }));
      setDirty((prev) => ({ ...prev, [roleId]: false }));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving((prev) => ({ ...prev, [roleId]: false }));
    }
  };

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('core.permissions.permission')}</TableCell>
              {roles.map((role) => (
                <TableCell key={role.id} align="center">
                  {t(role.nameI18nKey)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from(grouped.entries()).map(([category, perms]) => (
              <PermissionCategoryRows
                key={category}
                category={category}
                perms={perms}
                roles={roles}
                grants={grants}
                onToggle={toggle}
              />
            ))}
            <TableRow>
              <TableCell />
              {roles.map((role) => (
                <TableCell key={role.id} align="center">
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SaveIcon />}
                    disabled={!dirty[role.id] || saving[role.id]}
                    onClick={() => save(role.id)}
                  >
                    {t('core.common.save')}
                  </Button>
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function PermissionCategoryRows({
  category,
  perms,
  roles,
  grants,
  onToggle,
}: {
  category: string;
  perms: PublicPermission[];
  roles: PublicRole[];
  grants: Record<string, Set<string>>;
  onToggle: (roleId: string, code: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <TableRow>
        <TableCell colSpan={roles.length + 1} sx={{ bgcolor: 'action.hover', fontWeight: 700 }}>
          {category}
        </TableCell>
      </TableRow>
      {perms.map((perm) => (
        <TableRow key={perm.code} hover>
          <TableCell>{t(perm.descriptionI18nKey)}</TableCell>
          {roles.map((role) => (
            <TableCell key={role.id} align="center">
              <Checkbox
                size="small"
                checked={grants[role.id]?.has(perm.code) ?? false}
                onChange={() => onToggle(role.id, perm.code)}
                slotProps={{ input: { 'aria-label': `${perm.code} / ${role.code}` } }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * The zero-grant-admin fallback: no `GET /roles` or `GET /permissions`
 * access, so roles cannot be listed — the operator supplies a role ID
 * directly (e.g. copied from the database, or from a teammate who can list
 * roles) and this still exercises the REAL, D12-bypassed
 * `GET/PUT /permissions/roles/:roleId/grants` endpoints end-to-end. Columns
 * come from the static `CORE_PERMISSION_CATALOG` mirror (see that file's
 * docblock) since the live catalog listing is unreachable here.
 */
function DegradedGrantEditor({ reason }: { reason: string | null }) {
  const { t } = useTranslation();
  const [roleId, setRoleId] = useState('');
  const [loadedRoleId, setLoadedRoleId] = useState<string | null>(null);
  const [grants, setGrantsState] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!roleId) return;
    setBusy(true);
    setError(null);
    try {
      const codes = await permissionsApi.getRoleGrants(roleId);
      setGrantsState(new Set(codes));
      setLoadedRoleId(roleId);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [roleId]);

  const toggle = (code: string) => {
    setGrantsState((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const save = async () => {
    if (!loadedRoleId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await permissionsApi.setRoleGrants(loadedRoleId, Array.from(grants));
      setGrantsState(new Set(updated));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t('core.permissions.degraded_notice')} {reason}
      </Alert>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          label={t('core.permissions.role_id')}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          size="small"
          sx={{ minWidth: 320 }}
        />
        <Button variant="outlined" onClick={load} disabled={!roleId || busy}>
          {t('core.permissions.load_grants')}
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {loadedRoleId ? (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('core.permissions.permission')}</TableCell>
                <TableCell align="center">{t('core.permissions.granted')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {CORE_PERMISSION_CATALOG.map((perm) => (
                <TableRow key={perm.code} hover>
                  <TableCell>{t(perm.descriptionI18nKey)}</TableCell>
                  <TableCell align="center">
                    <Checkbox size="small" checked={grants.has(perm.code)} onChange={() => toggle(perm.code)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      {loadedRoleId ? (
        <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={busy} sx={{ mt: 2 }}>
          {t('core.common.save')}
        </Button>
      ) : null}
    </Box>
  );
}
