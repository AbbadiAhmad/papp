import { Matches } from 'class-validator';

export class PurgeAuditDto {
  /**
   * Plain Gregorian calendar date (D7), `YYYY-MM-DD`, interpreted as
   * 00:00:00 UTC. Everything strictly OLDER than this instant is deleted
   * (D25). Must be yesterday (UTC) or earlier — the service enforces the
   * cap, this just enforces the shape.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'cutoffDate must be a plain date in YYYY-MM-DD format' })
  cutoffDate!: string;
}
