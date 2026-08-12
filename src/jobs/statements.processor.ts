import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LedgerDirection, StatementStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateStatementJob, QUEUE } from './queues';

@Processor(QUEUE.STATEMENTS)
export class StatementsProcessor extends WorkerHost {
  private readonly logger = new Logger(StatementsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<GenerateStatementJob>): Promise<void> {
    const { statementId, accountId, period } = job.data;

    try {
      const { start, end } = periodBounds(period);

      const opening = await this.balanceAt(accountId, start);
      const entries = await this.prisma.ledgerEntry.findMany({
        where: { accountId, createdAt: { gte: start, lt: end } },
        include: { transaction: true },
        orderBy: { createdAt: 'asc' },
      });

      const movement = entries.reduce(
        (sum, e) =>
          e.direction === LedgerDirection.CREDIT ? sum + e.amount : sum - e.amount,
        0n,
      );
      const closing = opening + movement;

      // The whole point of deriving from the ledger: this must always hold.
      const lastBalance = entries.at(-1)?.balanceAfter;
      if (lastBalance !== undefined && lastBalance !== closing) {
        throw new Error(
          `Statement does not reconcile: derived ${closing}, last entry says ${lastBalance}`,
        );
      }

      await this.prisma.statement.update({
        where: { id: statementId },
        data: {
          status: StatementStatus.READY,
          openingBalance: opening,
          closingBalance: closing,
          entryCount: entries.length,
          completedAt: new Date(),
          content: {
            period,
            openingBalance: opening.toString(),
            closingBalance: closing.toString(),
            entries: entries.map((e) => ({
              date: e.createdAt.toISOString(),
              reference: e.transaction.reference,
              type: e.transaction.type,
              direction: e.direction,
              amount: e.amount.toString(),
              balanceAfter: e.balanceAfter.toString(),
              narration: e.transaction.narration,
            })),
          },
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Statement ${statementId} failed: ${reason}`);
      await this.prisma.statement.update({
        where: { id: statementId },
        data: { status: StatementStatus.FAILED, failureReason: reason },
      });
      throw error;
    }
  }

  private async balanceAt(accountId: string, before: Date): Promise<bigint> {
    const totals = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountId, createdAt: { lt: before } },
      _sum: { amount: true },
    });
    return totals.reduce(
      (sum, t) =>
        t.direction === LedgerDirection.CREDIT
          ? sum + (t._sum.amount ?? 0n)
          : sum - (t._sum.amount ?? 0n),
      0n,
    );
  }
}

export function periodBounds(period: string): { start: Date; end: Date } {
  const [year, month] = period.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}
