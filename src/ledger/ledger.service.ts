import { Injectable } from '@nestjs/common';
import { UnbalancedLedgerException } from '../common/exceptions/domain.exception';
import { Prisma } from '../generated/prisma/client';
import { LedgerDirection } from '../generated/prisma/enums';
import { LedgerEntryModel } from '../generated/prisma/models';

export interface LedgerEntryInput {
  accountId: string;
  direction: LedgerDirection;
  amount: bigint;
}

@Injectable()
export class LedgerService {
  // ORDER BY id means every caller locks accounts in the same sequence, so
  // simultaneous opposing transfers cannot each hold the row the other needs.
  async lockAccounts(
    tx: Prisma.TransactionClient,
    accountIds: string[],
  ): Promise<void> {
    const ids = [...new Set(accountIds)];
    await tx.$queryRaw`
      SELECT id FROM accounts
      WHERE id = ANY(${ids}::uuid[])
      ORDER BY id
      FOR UPDATE
    `;
  }

  async post(
    tx: Prisma.TransactionClient,
    transactionId: string,
    entries: LedgerEntryInput[],
  ): Promise<LedgerEntryModel[]> {
    assertBalanced(entries);

    // Touch accounts in a consistent order so concurrent transfers involving
    // the same pair cannot deadlock by locking them in opposite orders.
    const ordered = [...entries].sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    );

    const written: LedgerEntryModel[] = [];
    for (const entry of ordered) {
      const delta =
        entry.direction === LedgerDirection.CREDIT
          ? entry.amount
          : -entry.amount;

      const account = await tx.account.update({
        where: { id: entry.accountId },
        data: { cachedBalance: { increment: delta } },
      });

      written.push(
        await tx.ledgerEntry.create({
          data: {
            transactionId,
            accountId: entry.accountId,
            direction: entry.direction,
            amount: entry.amount,
            balanceAfter: account.cachedBalance,
          },
        }),
      );
    }

    return written;
  }
}

export function assertBalanced(entries: LedgerEntryInput[]): void {
  if (entries.length < 2) {
    throw new UnbalancedLedgerException(0n);
  }

  let drift = 0n;
  for (const entry of entries) {
    if (entry.amount <= 0n) {
      throw new UnbalancedLedgerException(entry.amount);
    }
    drift +=
      entry.direction === LedgerDirection.CREDIT ? entry.amount : -entry.amount;
  }

  if (drift !== 0n) {
    throw new UnbalancedLedgerException(drift);
  }
}
