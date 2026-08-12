import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Role } from '../generated/prisma/enums';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { UpdateAccountStatusDto } from './dto/update-account-status.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Patch(':id/status')
  @ApiOperation({ summary: 'Freeze or unfreeze an account' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  @ApiNotFoundResponse({ description: 'Account does not exist' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(
      await this.accountsService.updateStatus(id, dto.status, admin),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Search and page through every account' })
  async search(
    @Query() query: PaginationQueryDto,
    @Query('search') search?: string,
  ) {
    const page = await this.accountsService.searchForAdmin(query, search);
    return { ...page, data: page.data.map(AccountResponseDto.from) };
  }

  @Get(':id/ledger')
  @ApiOperation({ summary: 'Raw ledger entries for any account' })
  async ledger(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    const page = await this.accountsService.ledgerFor(id, query);
    return {
      ...page,
      data: page.data.map((entry) => ({
        id: entry.id,
        direction: entry.direction,
        amount: entry.amount.toString(),
        balanceAfter: entry.balanceAfter.toString(),
        createdAt: entry.createdAt,
        transactionReference: entry.transaction.reference,
        transactionType: entry.transaction.type,
      })),
    };
  }
}
