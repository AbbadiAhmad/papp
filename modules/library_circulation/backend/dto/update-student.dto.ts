import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Everything on the reader — library profile AND the linked platform
 * account's own data (name/email/ID/department/active/password reset), same
 * fields core's Edit User offers, MINUS roles (a reader's roles are managed
 * only through core Users).
 */
export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;

  /** Generates a new random temporary password (returned ONCE) and forces a change at next login. */
  @IsOptional()
  @IsBoolean()
  resetPassword?: boolean;
}
