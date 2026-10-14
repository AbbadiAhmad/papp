import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatisticsQueryDto } from './dto/statistics-query.dto';
import { MustChangePasswordGuard, RequirePermission } from './platform';
import { StatisticsService } from './statistics.service';

/**
 * Library statistics (read-only aggregate; the top lists name readers, so it
 * has its own permission rather than reusing the dashboard's).
 */
@Controller('api/library-circulation/statistics')
@UseGuards(MustChangePasswordGuard)
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get()
  @RequirePermission('library_circulation.statistics.view')
  async get(@Query() query: StatisticsQueryDto) {
    return this.statistics.getStatistics(query);
  }
}
