import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** A present the librarian gives a reader outside the stage flow; free text recording what was given. */
export class GivePresentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;
}
