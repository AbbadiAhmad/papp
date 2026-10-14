import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatisticsQueryDto } from './dto/statistics-query.dto';
import { MustChangePasswordGuard, RequirePermission } from './platform';
import { StatisticsService } from './statistics.service';

/**
 * Club + library statistics (read-only aggregate; includes reader names in the
 * top lists, hence its own permission rather than reusing the dashboard's).
 */
@Controller('api/reading-club/statistics')
@UseGuards(MustChangePasswordGuard)
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get()
  @RequirePermission('reading_club.statistics.view')
  async get(@Query() query: StatisticsQueryDto) {
    return this.statistics.getStatistics(query);
  }
}
