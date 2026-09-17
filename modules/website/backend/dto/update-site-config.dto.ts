import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSiteConfigDto {
  @IsString()
  @MinLength(1)
  siteTitle!: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}
