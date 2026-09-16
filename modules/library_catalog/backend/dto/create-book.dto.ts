import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * docs/LIBRARY_MODULE_REQUIREMENTS.md §4's Books field shape — only `title`
 * is required, matching the librarian's own description of the catalog
 * record (everything else is descriptive metadata a librarian may not have
 * on hand yet when first entering a title).
 */
export class CreateBookDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  readingLevel?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;
}
