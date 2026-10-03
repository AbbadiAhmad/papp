import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

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

  /** Omitted -> the current episode (READING_CLUB-D12). */
  @IsOptional()
  @IsUUID()
  episodeId?: string;
}
