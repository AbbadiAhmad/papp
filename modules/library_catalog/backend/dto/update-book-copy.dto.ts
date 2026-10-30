import { LibraryCatalogBookCopyStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

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
  /** Staff-only note (LIBRARY_CATALOG-D35); empty clears it. Needs `library_catalog.notes.view`, checked in the controller. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNote?: string;

}
