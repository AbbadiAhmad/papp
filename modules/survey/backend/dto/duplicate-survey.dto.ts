import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DuplicateSurveyDto {
  /** Title of the new copy; defaults to "<original> (copy)". */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;
}
