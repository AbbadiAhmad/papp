import { ArrayUnique, IsArray, IsString } from 'class-validator';

/**
 * Sets a role's FULL grant set (D — "your call on the exact shape, keep it
 * simple and RESTful", per BUILD_PLAN.md Phase 2 step 3): the given permission
 * codes become exactly the role's grants — any existing grant not in this
 * list is revoked, any new one is added. Simpler and less error-prone than a
 * separate add/remove-one-at-a-time API for a grant-matrix UI that always
 * submits the whole row/column anyway.
 */
export class SetRoleGrantsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionCodes!: string[];
}
