import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const MESSAGE_RECIPIENT_MODES = ['all', 'individual', 'unpaid_fines', 'overdue'] as const;
export type MessageRecipientMode = (typeof MESSAGE_RECIPIENT_MODES)[number];

/**
 * Who a message goes to. `unpaid_fines`: readers with an unpaid/partially
 * paid fine (period = the fine's creation date). `overdue`: readers with a
 * book still out past its due date (period = the due date). Both periods
 * are optional, inclusive and date-only.
 */
export class MessageRecipientsDto {
  @IsIn(MESSAGE_RECIPIENT_MODES)
  mode!: MessageRecipientMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  studentIds?: string[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class PreviewMessageDto {
  @ValidateNested()
  @Type(() => MessageRecipientsDto)
  recipients!: MessageRecipientsDto;
}

export class SendMessageDto extends PreviewMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  bodyMarkdown!: string;

  /** false = in-app notification only; true = also email each reader. */
  @IsBoolean()
  sendEmail!: boolean;
}

export class MessageTemplateDto {
  /** Omitted for a new template — assigned server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  bodyMarkdown!: string;
}

export class SaveMessageTemplatesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MessageTemplateDto)
  templates!: MessageTemplateDto[];
}
