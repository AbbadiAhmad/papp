import { IsString, Matches, MinLength } from 'class-validator';

export class CreateRoleDto {
  /** snake_case machine code, e.g. "branch_supervisor". Immutable once created. */
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'code must be snake_case (lowercase letters, digits, underscores; must start with a letter)',
  })
  code!: string;

  @IsString()
  @MinLength(1)
  nameI18nKey!: string;
}
