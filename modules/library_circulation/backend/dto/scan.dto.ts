import { IsString, MinLength } from 'class-validator';

export class ScanDto {
  @IsString()
  @MinLength(1)
  code!: string;
}
