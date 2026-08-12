import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { StatementStatus } from '../generated/prisma/enums';
import { JOB, QUEUE } from '../jobs/queues';
import { PrismaService } from '../prisma/prisma.service';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE.STATEMENTS) private readonly queue: Queue,
  ) {}

  async request(accountId: string, period: string) {
    if (!PERIOD_PATTERN.test(period)) {
      throw new BadRequestException('period must be formatted as YYYY-MM');
    }

    const existing = await this.prisma.statement.findUnique({
      where: { accountId_period: { accountId, period } },
    });

    if (existing?.status === StatementStatus.READY) {
      return { ready: true as const, statement: existing };
    }
    if (existing?.status === StatementStatus.PENDING) {
      return { ready: false as const, statement: existing };
    }

    const statement = existing
      ? await this.prisma.statement.update({
          where: { id: existing.id },
          data: { status: StatementStatus.PENDING, failureReason: null },
        })
      : await this.prisma.statement.create({
          data: { accountId, period, status: StatementStatus.PENDING },
        });

    await this.queue.add(JOB.GENERATE_STATEMENT, {
      statementId: statement.id,
      accountId,
      period,
    });

    return { ready: false as const, statement };
  }
}
