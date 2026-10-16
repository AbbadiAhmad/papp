import { IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /notifications/confirm/:token body — the confirmer's optional comment. */
export class ConfirmNotificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
