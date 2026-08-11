import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
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
  ): Promise<AccountResponseDto> {
    return AccountResponseDto.from(
      await this.accountsService.updateStatus(id, dto.status),
    );
  }
}
