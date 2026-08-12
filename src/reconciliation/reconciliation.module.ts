import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AdminReconciliationController } from './admin-reconciliation.controller';

@Module({
  imports: [JobsModule],
  controllers: [AdminReconciliationController],
})
export class ReconciliationModule {}
