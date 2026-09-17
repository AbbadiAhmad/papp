import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

/** Reserved — shadowed by the admin routes under /site/admin/* (manifest basePath is "/site"). */
export const RESERVED_SLUGS = ['admin'];

export class CreatePageDto {
  @IsString()
  @MinLength(1)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'slug must be lowercase letters, digits, and hyphens only' })
  slug!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  status?: 'draft' | 'published';
}
