import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { BalanceResponseDto } from './dto/balance-response.dto';

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List all accounts' })
  async findAll(): Promise<AccountResponseDto[]> {
    const accounts = await this.accountsService.findAll();
    return accounts.map(AccountResponseDto.from);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one account by id' })
  @ApiNotFoundResponse({ description: 'Account does not exist' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.accountsService.findOne(id));
  }

  @Get(':id/balance')
  @ApiOperation({
    summary: 'Get cached and ledger-derived balance side by side',
  })
  @ApiNotFoundResponse({ description: 'Account does not exist' })
  async getBalance(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BalanceResponseDto> {
    return BalanceResponseDto.from(await this.accountsService.getBalance(id));
  }
}
