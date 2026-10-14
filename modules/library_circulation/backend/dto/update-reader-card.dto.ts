import { IsString, MaxLength } from 'class-validator';

/** The custom text printed on every reader ID card (library name, address, phone...). */
export class UpdateReaderCardDto {
  @IsString()
  @MaxLength(300)
  headerText!: string;
}
