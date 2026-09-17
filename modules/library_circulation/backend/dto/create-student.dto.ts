import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Creates the student's platform account AND its library profile in one
 * call (the librarian's real workflow, §2) — a temporary password is
 * generated server-side (never typed by the librarian) and returned ONCE in
 * the response so it can be handed to the student; `mustChangePassword` is
 * set so they're forced to pick their own on first login, same as any
 * admin-created account (core UsersService's own pattern).
 */
export class CreateStudentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  code!: string;

  @IsOptional()
  @IsString()
  className?: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}
