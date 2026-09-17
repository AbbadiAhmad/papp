import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/** The two statuses a template item can be in — see the migration's own ENUM. */
export const TEMPLATE_ITEM_STATUSES = ['active', 'archived'] as const;
export type TemplateItemStatusValue = (typeof TEMPLATE_ITEM_STATUSES)[number];

export class CreateItemDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Optional on create — when omitted, `ItemsService.create` falls back to
   * the module's own `template.defaults` setting (docs/MODULE_SPEC.md §8),
   * demonstrating a module-defined setting actually being read at runtime.
   */
  @IsOptional()
  @IsIn(TEMPLATE_ITEM_STATUSES)
  status?: TemplateItemStatusValue;
}
