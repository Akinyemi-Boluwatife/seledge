import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE } from './queues';

interface Drift {
  accountId: string;
  accountNumber: string;
  cached: string;
  ledgerDerived: string;
  difference: string;
}

@Injectable()
export class ReconciliationRunner {
  private readonly logger = new Logger(ReconciliationRunner.name);

  constructor(private readonly prisma: PrismaService) {}

  // Recomputes every balance from the ledger and reports drift. It never
  // corrects anything: a silent auto-fix would hide the bug that caused it.
  async run(): Promise<{
    id: string;
    accountsChecked: number;
    driftCount: number;
  }> {
    const rows = await this.prisma.$queryRaw<
      { id: string; accountNumber: string; cached: bigint; derived: bigint }[]
    >`
      SELECT a.id,
             a."accountNumber",
             a."cachedBalance" AS cached,
             COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END), 0) AS derived
      FROM accounts a
      LEFT JOIN ledger_entries le ON le."accountId" = a.id
      GROUP BY a.id, a."accountNumber", a."cachedBalance"
    `;

    const drifted: Drift[] = rows
      .filter((r) => BigInt(r.cached) !== BigInt(r.derived))
      .map((r) => ({
        accountId: r.id,
        accountNumber: r.accountNumber,
        cached: r.cached.toString(),
        ledgerDerived: r.derived.toString(),
        difference: (BigInt(r.cached) - BigInt(r.derived)).toString(),
      }));

    if (drifted.length > 0) {
      this.logger.error(
        `Reconciliation found drift on ${drifted.length} account(s): ${drifted
          .map((d) => d.accountNumber)
          .join(', ')}`,
      );
    }

    const report = await this.prisma.reconciliationReport.create({
      data: {
        accountsChecked: rows.length,
        driftCount: drifted.length,
        details: { drifted } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      id: report.id,
      accountsChecked: rows.length,
      driftCount: drifted.length,
    };
  }
}

@Processor(QUEUE.RECONCILIATION)
export class ReconciliationProcessor extends WorkerHost {
  constructor(private readonly runner: ReconciliationRunner) {
    super();
  }

  async process(): Promise<void> {
    await this.runner.run();
  }
}
