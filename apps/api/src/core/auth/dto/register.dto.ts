import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * D41: self-registration is deliberately minimal — no `externalId`/
 * `department`/role selection (the `reader` role is always auto-assigned,
 * never chosen by the registrant). Password shape is checked against the
 * live `auth.password_policy` by AuthService, same as every other password.
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
