import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [LedgerModule, IdempotencyModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
