import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { BalanceResponseDto } from './dto/balance-response.dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List your own accounts (admins see all)' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountResponseDto[]> {
    const accounts = await this.accountsService.findAllForUser(user);
    return accounts.map(AccountResponseDto.from);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your accounts by id' })
  @ApiNotFoundResponse({ description: 'Account does not exist or is not yours' })
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
  @ApiNotFoundResponse({ description: 'Account does not exist or is not yours' })
  async getBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BalanceResponseDto> {
    return BalanceResponseDto.from(
      await this.accountsService.getBalance(id, user),
    );
  }
}
