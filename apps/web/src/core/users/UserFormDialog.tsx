import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { rolesApi } from '../../shared/api/roles';
import type { CreateUserInput, UpdateUserInput } from '../../shared/api/users';
import { usePermission } from '../../shared/permissions';
import type { PublicRole, PublicUser } from '../../shared/api/types';

interface Props {
  open: boolean;
  user: PublicUser | null;
  onClose: () => void;
  onSubmit: (dto: CreateUserInput | UpdateUserInput) => Promise<void>;
  /**
   * Called after a successful save with the user's FINAL role id set, only
   * when role checkboxes were shown (editing an existing user AND the
   * caller holds `roles.assign` — see `RolesEditor`'s own docblock) and the
   * set actually changed from what the user started with. `UsersListPage`
   * uses this to reload its table so the Roles column's chips reflect the
   * change without a full page refresh.
   */
  onRolesChanged?: () => void;
}

/**
 * `UserFormFields` mounts only while `open` is true and remounts (fresh
 * initial state, no reset effect) whenever the target user changes, via the
 * `key` below — see RoleFormDialog's docblock for why this replaces the
 * "effect mirrors a prop into local state" pattern.
 */
export function UserFormDialog({ open, user, onClose, onSubmit, onRolesChanged }: Props) {
  const { t } = useTranslation();
  const isEdit = user !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? t('core.users.edit_title') : t('core.users.create_title')}</DialogTitle>
      {open ? (
        <UserFormFields key={user?.id ?? 'new'} user={user} onClose={onClose} onSubmit={onSubmit} onRolesChanged={onRolesChanged} />
      ) : null}
    </Dialog>
  );
}

/**
 * Read-only role chips for an editor who can see this dialog (`users.
 * update`) but was not separately granted `roles.assign` — showing nothing
 * at all would silently hide information every editor could already see on
 * the Users table itself; showing checkboxes they can't act on would be
 * confusing. `roles.view` also isn't required here — the roles being
 * displayed are exactly the ones `UsersListPage`'s own list call already
 * returned for this user, no separate fetch needed.
 */
function ReadOnlyRoles({ roles }: { roles: PublicRole[] | undefined }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" color="text.secondary">
        {t('core.users.roles')}
      </Typography>
      <Typography variant="body2">{roles && roles.length > 0 ? roles.map((r) => r.code).join(', ') : '—'}</Typography>
    </Stack>
  );
}

/**
 * Editable role checkboxes — only ever rendered when the caller holds
 * `roles.assign` (checked by the caller, `UserFormFields` below), since
 * changing membership uses exactly the same `rolesApi.assign`/`unassign`
 * endpoints `RoleAssignDialog` already uses from the Roles page (root
 * DECISIONS.md's role->users direction) — this is the reverse, user->roles
 * direction the user asked for, reusing the identical backend contract.
 * Needs the full role catalog (`GET /roles`, `roles.view`-gated) to render
 * every option — `roles.assign` without `roles.view` both being grantable
 * independently is a real, if unusual, admin configuration; a caller in
 * that state sees the catalog fail to load and the checkboxes replaced by
 * an inline error rather than a silent empty list.
 */
function RolesEditor({
  currentRoleIds,
  onChange,
}: {
  currentRoleIds: Set<string>;
  onChange: (roleIds: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const [allRoles, setAllRoles] = useState<PublicRole[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    rolesApi
      .list()
      .then((roles) => {
        if (!cancelled) setAllRoles(roles);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(extractErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (roleId: string, checked: boolean) => {
    const next = new Set(currentRoleIds);
    if (checked) next.add(roleId);
    else next.delete(roleId);
    onChange(next);
  };

  if (loadError) return <Alert severity="error">{loadError}</Alert>;

  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" color="text.secondary">
        {t('core.users.roles')}
      </Typography>
      <FormGroup>
        {(allRoles ?? []).map((role) => (
          <FormControlLabel
            key={role.id}
            control={
              <Checkbox
                checked={currentRoleIds.has(role.id)}
                onChange={(e) => toggle(role.id, e.target.checked)}
                aria-label={role.code}
              />
            }
            label={role.code}
          />
        ))}
      </FormGroup>
    </Stack>
  );
}

function UserFormFields({
  user,
  onClose,
  onSubmit,
  onRolesChanged,
}: {
  user: PublicUser | null;
  onClose: () => void;
  onSubmit: (dto: CreateUserInput | UpdateUserInput) => Promise<void>;
  onRolesChanged?: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = user !== null;
  const canAssignRoles = usePermission('roles.assign');
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [externalId, setExternalId] = useState(user?.externalId ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [mustChangePassword, setMustChangePassword] = useState(user?.mustChangePassword ?? true);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const initialRoleIds = new Set((user?.roles ?? []).map((r) => r.id));
  const [roleIds, setRoleIds] = useState<Set<string>>(initialRoleIds);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Role membership is a SEPARATE API contract from the plain user PATCH
   * (`rolesApi.assign`/`unassign`, one call per changed role — matching
   * `RoleAssignDialog`'s own per-toggle behavior, never batched into the
   * `UpdateUserInput` DTO) — applied only after the user PATCH itself
   * succeeds, and only for roles whose checked state actually changed, so
   * a caller with `users.update` but not `roles.assign` (checkboxes never
   * rendered, `roleIds` stays exactly `initialRoleIds`) never triggers a
   * role API call at all.
   */
  const applyRoleChanges = async (userId: string) => {
    if (!canAssignRoles) return;
    const added = [...roleIds].filter((id) => !initialRoleIds.has(id));
    const removed = [...initialRoleIds].filter((id) => !roleIds.has(id));
    if (added.length === 0 && removed.length === 0) return;
    await Promise.all([
      ...added.map((roleId) => rolesApi.assign(roleId, userId)),
      ...removed.map((roleId) => rolesApi.unassign(roleId, userId)),
    ]);
    onRolesChanged?.();
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        const dto: UpdateUserInput = {
          email,
          name,
          externalId: externalId || undefined,
          department: department || undefined,
          isActive,
          mustChangePassword,
        };
        if (password) dto.password = password;
        await onSubmit(dto);
        await applyRoleChanges(user.id);
      } else {
        const dto: CreateUserInput = {
          email,
          name,
          password,
          externalId: externalId || undefined,
          department: department || undefined,
          mustChangePassword,
        };
        await onSubmit(dto);
      }
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label={t('core.auth.name')} value={name} onChange={(e) => setName(e.target.value)} required fullWidth />
          <TextField
            label={t('core.auth.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label={isEdit ? t('core.users.new_password_optional') : t('core.auth.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!isEdit}
            fullWidth
            autoComplete="new-password"
          />
          <TextField label={t('core.users.external_id')} value={externalId} onChange={(e) => setExternalId(e.target.value)} fullWidth />
          <TextField label={t('core.users.department')} value={department} onChange={(e) => setDepartment(e.target.value)} fullWidth />
          <FormControlLabel
            control={<Checkbox checked={mustChangePassword} onChange={(e) => setMustChangePassword(e.target.checked)} />}
            label={t('core.users.must_change_password')}
          />
          {isEdit ? (
            <FormControlLabel
              control={<Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
              label={t('core.users.is_active')}
            />
          ) : null}
          {isEdit && canAssignRoles ? (
            <RolesEditor currentRoleIds={roleIds} onChange={setRoleIds} />
          ) : isEdit ? (
            <ReadOnlyRoles roles={user.roles} />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </>
  );
}
