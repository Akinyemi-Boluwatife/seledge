import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PaginatedDto } from '../common/dto/pagination.dto';
import { TransactionQueryDto } from '../transfers/dto/transaction-query.dto';
import { TransactionResponseDto } from '../transfers/dto/transaction-response.dto';
import { TransfersService } from '../transfers/transfers.service';
import { StatementsService } from '../statements/statements.service';
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { BalanceResponseDto } from './dto/balance-response.dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly transfersService: TransfersService,
    private readonly statementsService: StatementsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List your own accounts (admins see all)' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto[]> {
    const accounts = await this.accountsService.findAllForUser(user);
    return accounts.map((account) => AccountResponseDto.from(account));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your accounts by id' })
  @ApiNotFoundResponse({
    description: 'Account does not exist or is not yours',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(
      await this.accountsService.findOne(id, user),
    );
  }

  @Get(':id/balance')
  @ApiOperation({
    summary: 'Get cached and ledger-derived balance side by side',
  })
  @ApiNotFoundResponse({
    description: 'Account does not exist or is not yours',
  })
  async getBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BalanceResponseDto> {
    return BalanceResponseDto.from(
      await this.accountsService.getBalance(id, user),
    );
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Paginated transaction history for your account' })
  @ApiNotFoundResponse({
    description: 'Account does not exist or is not yours',
  })
  async transactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TransactionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaginatedDto<TransactionResponseDto>> {
    const account = await this.accountsService.findOne(id, user);
    return this.transfersService.findForAccount(account.id, query);
  }

  @Get(':id/statements/:period')
  @ApiOperation({
    summary: 'Monthly statement; 202 while it is still being generated',
  })
  @ApiNotFoundResponse({
    description: 'Account does not exist or is not yours',
  })
  async statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('period') period: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.accountsService.findOne(id, user);
    const result = await this.statementsService.request(account.id, period);

    if (!result.ready) {
      response.status(HttpStatus.ACCEPTED);
      return {
        statementId: result.statement.id,
        status: result.statement.status,
        period,
      };
    }

    return {
      statementId: result.statement.id,
      status: result.statement.status,
      period,
      openingBalance: result.statement.openingBalance?.toString() ?? null,
      closingBalance: result.statement.closingBalance?.toString() ?? null,
      entryCount: result.statement.entryCount,
      content: result.statement.content,
    };
  }
}
