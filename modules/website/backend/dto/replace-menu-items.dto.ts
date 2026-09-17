import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

export class MenuItemInputDto {
  /** Client-generated (`crypto.randomUUID()`) for both new and existing items — same pattern as `BlockInputDto`. */
  @IsUUID()
  id!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @MinLength(1)
  urlOrSlug!: string;

  @IsInt()
  orderIndex!: number;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class ReplaceMenuItemsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => MenuItemInputDto)
  items!: MenuItemInputDto[];
}
