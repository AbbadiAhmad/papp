import { Matches } from 'class-validator';

export class PurgeSessionsDto {
  /**
   * Plain Gregorian calendar date (D7), `YYYY-MM-DD`, interpreted as
   * 00:00:00 UTC. Ended sessions issued strictly BEFORE this instant are
   * deleted. Must be at least 3 days before today (UTC) — the service
   * enforces the cap, this just enforces the shape.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'cutoffDate must be a plain date in YYYY-MM-DD format' })
  cutoffDate!: string;
}
