import { IsUUID } from 'class-validator';

/** Manually moves a reader to a different stage WITHIN their current group, without going through the "mark stage complete" reward flow — an administrative override. */
export class MoveStageDto {
  @IsUUID()
  stageId!: string;
}
