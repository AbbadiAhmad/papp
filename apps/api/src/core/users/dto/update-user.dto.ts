import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  department?: string;

  /** `YYYY-MM-DD` to set, `null` to clear, omitted = unchanged. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be a date in YYYY-MM-DD format' })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;

  /** Admin-driven password reset. If provided, must still satisfy the current password policy. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}
