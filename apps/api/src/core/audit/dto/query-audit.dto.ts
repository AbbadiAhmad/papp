import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class QueryAuditDto {
  /** Exact-match module category, e.g. 'core.users' (§8.1). */
  @IsOptional()
  @IsString()
  category?: string;

  /** Exact-match entity type, e.g. 'User'. */
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  /** Inclusive lower bound on occurred_at (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Inclusive upper bound on occurred_at (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
