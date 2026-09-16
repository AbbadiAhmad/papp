import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { rolesApi } from '../../shared/api/roles';
import { usersApi } from '../../shared/api/users';
import { useGatedCall } from '../../shared/permissions';
import type { PublicRole, PublicUser } from '../../shared/api/types';

interface Props {
  open: boolean;
  role: PublicRole | null;
  onClose: () => void;
}

/**
 * `RoleAssignFields` mounts only while the dialog is open for a given role
 * (`key={role.id}` below forces a fresh mount if a different role is opened
 * without the dialog fully closing in between) — so its data-loading effect
 * runs exactly once per "open for this role" and needs no synchronous
 * setState reset before starting the fetch (the initial `useState` values
 * already are the right "about to load" state). See RoleFormDialog's
 * docblock for why this replaces an effect keyed on `[open, role]`.
 */
export function RoleAssignDialog({ open, role, onClose }: Props) {
  const { t } = useTranslation();
  if (!role) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('core.roles.assign_title', { role: role.code })}</DialogTitle>
      {open ? <RoleAssignFields key={role.id} role={role} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RoleAssignFields({ role, onClose }: { role: PublicRole; onClose: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [allUsers, setAllUsers] = useState<PublicUser[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // No bulk "members of this role" endpoint exists on the committed
    // backend (roles.controller.ts only offers `GET /roles/user/:userId`,
    // the reverse direction) — membership is derived by checking every
    // user's own role list. Acceptable for back-office-scale user counts;
    // flagged in this Developer agent's report as a real gap a future
    // `GET /roles/:id/users` endpoint would close.
    usersApi
      .list()
      .then(async (users) => {
        if (cancelled) return;
        setAllUsers(users);
        const memberships = await Promise.all(
          users.map((user) =>
            rolesApi
              .listForUser(user.id)
              .then((roles) => roles.some((r) => r.id === role.id))
              .catch(() => false),
          ),
        );
        if (cancelled) return;
        setMemberIds(new Set(users.filter((_, i) => memberships[i]).map((u) => u.id)));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role.id]);

  const toggle = async (user: PublicUser, checked: boolean) => {
    setError(null);
    try {
      if (checked) {
        await gated('roles.assign', () => rolesApi.assign(role.id, user.id));
        setMemberIds((prev) => new Set(prev).add(user.id));
      } else {
        await gated('roles.assign', () => rolesApi.unassign(role.id, user.id));
        setMemberIds((prev) => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('core.roles.assign_hint')}
        </Alert>
        {loading ? null : (
          <List dense>
            {allUsers.map((user) => (
              <ListItem key={user.id} disableGutters>
                <FormControlLabel
                  control={<Checkbox checked={memberIds.has(user.id)} onChange={(e) => toggle(user, e.target.checked)} />}
                  label={`${user.name} (${user.email})`}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
      </DialogActions>
    </>
  );
}
