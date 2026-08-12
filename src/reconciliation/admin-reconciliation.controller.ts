import { Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto, paginate } from '../common/dto/pagination.dto';
import { Role } from '../generated/prisma/enums';
import { ReconciliationRunner } from '../jobs/reconciliation.processor';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/reconciliation')
export class AdminReconciliationController {
  constructor(
    private readonly runner: ReconciliationRunner,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  @ApiOperation({ summary: 'Run reconciliation now and return the report' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  run() {
    return this.runner.run();
  }

  @Get('reports')
  @ApiOperation({ summary: 'Past reconciliation reports' })
  async reports(@Query() query: PaginationQueryDto) {
    const [data, total] = await Promise.all([
      this.prisma.reconciliationReport.findMany({
        orderBy: { runAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.reconciliationReport.count(),
    ]);
    return paginate(data, total, query);
  }
}
