import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
