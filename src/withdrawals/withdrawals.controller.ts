import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { TransactionResponseDto } from '../transfers/dto/transaction-response.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('money movement')
@ApiBearerAuth()
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Withdraw to a bank account' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiUnprocessableEntityResponse({ description: 'Insufficient funds' })
  @ApiConflictResponse({ description: 'Idempotency key conflict' })
  @ApiNotFoundResponse({ description: 'Account not found or not yours' })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWithdrawalDto,
  ): Promise<TransactionResponseDto> {
    return this.withdrawalsService.withdraw(user, dto);
  }
}
