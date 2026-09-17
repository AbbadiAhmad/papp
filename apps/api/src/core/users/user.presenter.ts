import { User } from '@prisma/client';

/** Public shape of a user row — never includes `passwordHash`. */
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
}

export function toPublicUser(user: User): PublicUser {
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
  };
}
