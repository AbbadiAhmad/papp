import { IsOptional, IsString } from 'class-validator';

/** `reason` is OPTIONAL — never required to discard an entry (see DECISIONS.md). */
export class DiscardBookEntryDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
