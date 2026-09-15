import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * `code` and `isSystem` are deliberately not editable via the API — a role's
 * code is its stable identity (referenced by permission grants, seeds, and
 * potentially future code), and `isSystem` is a seed-time flag only. Only
 * the display label key can be changed after creation, for every role
 * including the 4 base ones.
 */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nameI18nKey?: string;
}
