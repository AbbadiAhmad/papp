import { IsString, MaxLength } from 'class-validator';

/** PUT /appearance/branding. Either title may be empty; it then falls back to the other language's title. */
export class UpdateBrandingDto {
  @IsString()
  @MaxLength(60)
  titleAr!: string;

  @IsString()
  @MaxLength(60)
  titleEn!: string;
}
