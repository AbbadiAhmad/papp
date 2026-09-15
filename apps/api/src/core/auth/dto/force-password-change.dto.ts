import { IsString, MinLength } from 'class-validator';

export class ForcePasswordChangeDto {
  @IsString()
  @MinLength(1)
  newPassword!: string;
}
