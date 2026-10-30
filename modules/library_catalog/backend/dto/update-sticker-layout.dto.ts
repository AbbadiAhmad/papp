import { IsDefined, IsObject } from 'class-validator';

/** The layout is validated and completed by `normalizeLayout` (sticker-layout.ts); the decorators only keep the whitelist from stripping it. */
export class UpdateStickerLayoutDto {
  @IsDefined()
  @IsObject()
  layout!: Record<string, unknown>;
}
