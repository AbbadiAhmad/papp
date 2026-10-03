import { IsOptional, IsUUID } from 'class-validator';

/**
 * Assigns a reader to a group (first assignment, or moving them to a
 * DIFFERENT group — §"the librarian can move the reader from one group to
 * another"). `stageId` is optional: omitted, the reader starts at that
 * group's own first stage (lowest `stageOrder`); provided, it must belong
 * to `groupId` (checked in the service) — lets a librarian place a reader
 * directly onto a later stage when moving groups mid-progress.
 */
export class AssignMembershipDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  groupId!: string;

  @IsOptional()
  @IsUUID()
  stageId?: string;
}
