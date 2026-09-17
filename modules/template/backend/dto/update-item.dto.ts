import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { TEMPLATE_ITEM_STATUSES, type TemplateItemStatusValue } from './create-item.dto';

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(TEMPLATE_ITEM_STATUSES)
  status?: TemplateItemStatusValue;
}
