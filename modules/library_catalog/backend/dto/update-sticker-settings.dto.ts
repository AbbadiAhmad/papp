import { IsString, MaxLength } from 'class-validator';

/**
 * `library_catalog.sticker_header_text` (LIBRARY_CATALOG-D22) — the fixed
 * header line printed on every copy sticker (e.g. the school/library name).
 * An empty string is valid (no header line printed) — never required to be
 * non-empty, since not every librarian wants one.
 */
export class UpdateStickerSettingsDto {
  @IsString()
  @MaxLength(200)
  headerText!: string;
}
