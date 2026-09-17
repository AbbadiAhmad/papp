import { Controller, Get, UseGuards } from '@nestjs/common';
import { CirculationService } from './circulation.service';
import { FinesService } from './fines.service';
import { MustChangePasswordGuard, RequirePermission } from './platform';
import { StudentsService } from './students.service';

export interface DashboardStats {
  students: number;
  totalCopies: number;
  availableCopies: number;
  borrowedCopies: number;
  overdueBorrowings: number;
  unpaidFinesTotal: number;
  paidFinesTotal: number;
}

/** §18's dashboard cards — combines real counts from all three services, no mock data. */
@Controller('api/library-circulation/dashboard')
@UseGuards(MustChangePasswordGuard)
export class DashboardController {
  constructor(
    private readonly students: StudentsService,
    private readonly circulation: CirculationService,
    private readonly fines: FinesService,
  ) {}

  @Get()
  @RequirePermission('library_circulation.dashboard.view')
  async getStats(): Promise<DashboardStats> {
    const [students, copyStats, financeSummary] = await Promise.all([
      this.students.count(),
      this.circulation.getCopyStats(),
      this.fines.getFinanceSummary(),
    ]);
    return {
      students,
      totalCopies: copyStats.totalCopies,
      availableCopies: copyStats.availableCopies,
      borrowedCopies: copyStats.borrowedCopies,
      overdueBorrowings: copyStats.overdueBorrowings,
      unpaidFinesTotal: financeSummary.unpaidTotal,
      paidFinesTotal: financeSummary.paidTotal,
    };
  }
}
