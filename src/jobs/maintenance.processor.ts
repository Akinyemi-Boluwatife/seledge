import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE } from './queues';

@Processor(QUEUE.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(): Promise<void> {
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    if (count > 0) {
      this.logger.log(`Deleted ${count} expired idempotency key(s)`);
    }
  }
}
