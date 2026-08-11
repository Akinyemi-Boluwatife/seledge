import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AdminAccountsController } from './admin-accounts.controller';

@Module({
  controllers: [AccountsController, AdminAccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
