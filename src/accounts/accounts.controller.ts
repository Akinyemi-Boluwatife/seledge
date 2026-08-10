import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { BalanceResponseDto } from './dto/balance-response.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  async findAll(): Promise<AccountResponseDto[]> {
    const accounts = await this.accountsService.findAll();
    return accounts.map(AccountResponseDto.from);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.accountsService.findOne(id));
  }

  @Get(':id/balance')
  async getBalance(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BalanceResponseDto> {
    return BalanceResponseDto.from(await this.accountsService.getBalance(id));
  }
}
