import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { LedgerModule } from '../ledger/ledger.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [LedgerModule, AccountsModule],
  controllers: [DepositsController, WebhooksController],
  providers: [DepositsService],
})
export class DepositsModule {}
