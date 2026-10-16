import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';
import { MAX_INVITES_PER_REQUEST } from '../email-list';

export class InviteDto {
  /** Raw addresses as typed; the server parses, checks and de-duplicates them (backend/email-list.ts). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVITES_PER_REQUEST * 2)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  emails!: string[];
}
