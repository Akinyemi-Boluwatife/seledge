import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginatedDto } from '../common/dto/pagination.dto';
import { Role } from '../generated/prisma/enums';
import { AuditService } from './audit.service';
import { AuditLogResponseDto, AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Filterable audit trail' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  search(
    @Query() query: AuditQueryDto,
  ): Promise<PaginatedDto<AuditLogResponseDto>> {
    return this.audit.search(query);
  }
}
