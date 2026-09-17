import { IsOptional, IsString, IsUUID } from 'class-validator';

/** Library-profile fields only — name/email changes go through core Users. */
export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}
