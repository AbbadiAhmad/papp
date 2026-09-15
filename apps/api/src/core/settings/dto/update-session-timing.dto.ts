import { IsInt, Min } from 'class-validator';

/**
 * PUT /settings/session-timing body — the full `auth.token_lifetimes`
 * value (D24). Same whole-object-replace rationale as the password-policy
 * DTO. Every lifetime must be a positive integer.
 */
export class UpdateSessionTimingDto {
  @IsInt()
  @Min(1)
  accessTokenMinutes!: number;

  @IsInt()
  @Min(1)
  refreshTokenDays!: number;

  @IsInt()
  @Min(1)
  idleTimeoutMinutes!: number;

  @IsInt()
  @Min(1)
  absoluteTimeoutDays!: number;
}
