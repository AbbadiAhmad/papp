import { Role } from '@prisma/client';

export interface PublicRole {
  id: string;
  code: string;
  nameI18nKey: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicRole(role: Role): PublicRole {
  return {
    id: role.id,
    code: role.code,
    nameI18nKey: role.nameI18nKey,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
