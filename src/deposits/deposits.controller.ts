import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { DepositsService } from './deposits.service';
import {
  CreateDepositDto,
  DepositInitiatedDto,
} from './dto/create-deposit.dto';

@ApiTags('money movement')
@ApiBearerAuth()
@Controller('deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @Post()
  @ApiOperation({
    summary: 'Start a deposit and get a reference for the provider',
  })
  @ApiNotFoundResponse({ description: 'Account not found or not yours' })
  @ApiForbiddenResponse({ description: 'Account is frozen' })
  initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepositDto,
  ): Promise<DepositInitiatedDto> {
    return this.depositsService.initiate(user, dto);
  }
}
