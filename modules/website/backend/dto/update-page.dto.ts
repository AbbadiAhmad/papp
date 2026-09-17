import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'slug must be lowercase letters, digits, and hyphens only' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsBoolean()
  isHomepage?: boolean;
}
