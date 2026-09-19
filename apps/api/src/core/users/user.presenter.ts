import { User } from '@prisma/client';
import { PublicRole } from '../roles/role.presenter';

/**
 * Public shape of a user row — never includes `passwordHash`. `roles` is
 * `undefined` for single-user reads (findById/create/update/remove — no
 * page needs it there today) and populated ONLY by `UsersService.list()`,
 * which eager-loads `userRoles.role` in one query specifically to feed the
 * Users table's read-only Roles column — never an N+1 per-row lookup.
 */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  externalId: string | null;
  department: string | null;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
  defaultLandingPage: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  roles?: PublicRole[];
}

export function toPublicUser(user: User, roles?: PublicRole[]): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    externalId: user.externalId,
    department: user.department,
    mustChangePassword: user.mustChangePassword,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    defaultLandingPage: user.defaultLandingPage,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdBy: user.createdBy,
    ...(roles ? { roles } : {}),
  };
}
