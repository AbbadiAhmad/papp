import { IsBoolean, IsInt, Min } from 'class-validator';

/**
 * PUT /settings/password-policy body — the full `auth.password_policy`
 * value (D23). Whole-object replace, no partial patch: the tab submits the
 * complete form, and storing a merged half-shape would let a typo silently
 * drop a field the policy check depends on.
 */
export class UpdatePasswordPolicyDto {
  @IsInt()
  @Min(1)
  minLength!: number;

  @IsBoolean()
  requireLetter!: boolean;

  @IsBoolean()
  requireNumber!: boolean;

  @IsInt()
  @Min(1)
  maxFailedAttempts!: number;

  @IsInt()
  @Min(1)
  lockoutMinutes!: number;
}
