import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDefined, IsIn, IsInt, IsUUID, ValidateNested } from 'class-validator';

/** No raw-HTML block type on purpose — see the module's own DOCUMENTATION.md. */
export const WEBSITE_BLOCK_TYPES = ['hero', 'text', 'image', 'columns', 'button', 'spacer'] as const;
export type WebsiteBlockTypeValue = (typeof WEBSITE_BLOCK_TYPES)[number];

export class BlockInputDto {
  /** Always present, client-generated (`crypto.randomUUID()`) for a brand-new block exactly like an existing one — same pattern as survey's structure endpoint, no server-side temp-id resolution needed. */
  @IsUUID()
  id!: string;

  @IsInt()
  orderIndex!: number;

  @IsIn(WEBSITE_BLOCK_TYPES)
  type!: WebsiteBlockTypeValue;

  /**
   * Shape depends on `type` (e.g. text: { markdown }; hero: { heading,
   * subheading, imageUrl }; button: { label, url }) — validated loosely
   * here (just "must be present") since NestJS's global
   * `ValidationPipe({ whitelist: true })` silently STRIPS any property with
   * no validator at all (see papp-add-feature SKILL.md's gotcha #1); the
   * per-type shape is enforced by the admin UI's own form fields, not the
   * backend, matching this module's "simple, not exhaustive" scope.
   */
  @IsDefined()
  config!: unknown;
}

export class ReplaceBlocksDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => BlockInputDto)
  blocks!: BlockInputDto[];
}
