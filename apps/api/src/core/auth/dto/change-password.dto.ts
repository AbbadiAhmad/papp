import { IsString, MinLength } from 'class-validator';

/** Both fields are checked by AuthService (current password verified, new one against the live password policy). */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(1)
  newPassword!: string;
}
