import { LibraryCatalogBookCopyStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateBookCopyDto {
  @IsOptional()
  @IsEnum(LibraryCatalogBookCopyStatus)
  status?: LibraryCatalogBookCopyStatus;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
