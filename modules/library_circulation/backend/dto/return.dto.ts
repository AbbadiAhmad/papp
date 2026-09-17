import { IsUUID } from 'class-validator';

export class ReturnDto {
  @IsUUID()
  borrowingId!: string;
}
