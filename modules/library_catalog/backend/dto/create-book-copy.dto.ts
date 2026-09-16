import { LibraryCatalogBookCopyStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

/** docs/LIBRARY_MODULE_REQUIREMENTS.md §5. `status` defaults to 'available' server-side when omitted. */
export class CreateBookCopyDto {
  @IsString()
  @MinLength(1)
  qrCode!: string;

  @IsOptional()
  @IsEnum(LibraryCatalogBookCopyStatus)
  status?: LibraryCatalogBookCopyStatus;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsDateString()
  acquisitionDate?: string;
}
