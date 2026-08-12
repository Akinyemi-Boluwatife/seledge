import { Module, forwardRef } from '@nestjs/common';
import { StatementsModule } from '../statements/statements.module';
import { TransfersModule } from '../transfers/transfers.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AdminAccountsController } from './admin-accounts.controller';

@Module({
  imports: [forwardRef(() => TransfersModule), StatementsModule],
  controllers: [AccountsController, AdminAccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
