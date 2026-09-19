import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * First-run setup (root D60/A27's UI-wizard option). Same minimal shape as
 * `RegisterDto` — no role selection, `admin` is always the role assigned,
 * never a registrant/operator choice. Password shape is checked against the
 * live `auth.password_policy` by AuthService, same as every other password.
 */
export class SetupCreateAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
