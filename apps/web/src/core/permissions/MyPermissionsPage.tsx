import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { permissionsApi } from '../../shared/api/permissions';

/**
 * The reduced, self-scoped counterpart to `PermissionsMatrixPage`: shows
 * only the caller's OWN effective grants (`GET /permissions/me`, gated by
 * `permissions.view_my`, migration 0010) — never every role's grants or a
 * role editor. Unlike the full matrix, this page has no D12 admin bypass
 * and no client-side pre-check exception: it's wrapped in the normal
 * `RequirePermissionRoute code="permissions.view_my"` (App.tsx) like any
 * other gated page, since seeing your own permission list is exactly the
 * kind of ordinary, admin-revocable capability the platform's permission
 * umbrella is meant to cover.
 */
export function MyPermissionsPage() {
  const { t } = useTranslation();
  const { status, data: permissions, errorMessage, reload } = useGuardedQuery(() => permissionsApi.getMine());

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.menu.myPermissions')}
      </Typography>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('core.permissions.permission')}</TableCell>
                <TableCell>{t('core.myPermissions.category')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(permissions ?? []).map((permission) => (
                <TableRow key={permission.id} hover>
                  <TableCell>{t(permission.descriptionI18nKey)}</TableCell>
                  <TableCell>{permission.category}</TableCell>
                </TableRow>
              ))}
              {(permissions ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>{t('core.myPermissions.empty')}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>
    </Box>
  );
}
