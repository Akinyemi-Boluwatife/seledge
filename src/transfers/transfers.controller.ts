import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { TransfersService } from './transfers.service';

@ApiTags('money movement')
@ApiBearerAuth()
@Controller()
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post('transfers')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Transfer money to another account' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Retrying with the same key replays the original response',
  })
  @ApiConflictResponse({
    description: 'Key reused with a different body, or original still in flight',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Insufficient funds, self transfer, or currency mismatch',
  })
  @ApiNotFoundResponse({ description: 'Source or destination account not found' })
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransferDto,
  ): Promise<TransactionResponseDto> {
    return this.transfersService.transfer(user, dto);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Read a transaction with its ledger entries' })
  @ApiNotFoundResponse({ description: 'Not found or you were not a participant' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransactionResponseDto> {
    return this.transfersService.findOne(id, user);
  }
}
