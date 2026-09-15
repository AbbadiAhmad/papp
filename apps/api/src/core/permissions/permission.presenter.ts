import { Permission } from '@prisma/client';

export interface PublicPermission {
  id: string;
  code: string;
  moduleKey: string;
  category: string;
  descriptionI18nKey: string;
}

export function toPublicPermission(permission: Permission): PublicPermission {
  return {
    id: permission.id,
    code: permission.code,
    moduleKey: permission.moduleKey,
    category: permission.category,
    descriptionI18nKey: permission.descriptionI18nKey,
  };
}
