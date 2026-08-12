import { BullModule } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MaintenanceProcessor } from './maintenance.processor';
import {
  ReconciliationProcessor,
  ReconciliationRunner,
} from './reconciliation.processor';
import { JOB, QUEUE } from './queues';
import { StatementsProcessor } from './statements.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE.STATEMENTS },
      { name: QUEUE.RECONCILIATION },
      { name: QUEUE.MAINTENANCE },
    ),
  ],
  providers: [
    StatementsProcessor,
    ReconciliationProcessor,
    ReconciliationRunner,
    MaintenanceProcessor,
  ],
  exports: [BullModule, ReconciliationRunner],
})
export class JobsModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE.RECONCILIATION) private readonly reconciliation: Queue,
    @InjectQueue(QUEUE.MAINTENANCE) private readonly maintenance: Queue,
  ) {}

  // Schedulers are upserted by id, so restarting the app updates the schedule
  // rather than stacking duplicate timers.
  async onModuleInit() {
    await this.reconciliation.upsertJobScheduler(
      JOB.RECONCILE,
      { pattern: '0 2 * * *' },
      { name: JOB.RECONCILE },
    );
    await this.maintenance.upsertJobScheduler(
      JOB.CLEANUP_IDEMPOTENCY_KEYS,
      { pattern: '0 * * * *' },
      { name: JOB.CLEANUP_IDEMPOTENCY_KEYS },
    );
  }
}
