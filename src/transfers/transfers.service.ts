import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AccountFrozenException,
  AccountNotFoundException,
  CurrencyMismatchException,
  InsufficientFundsException,
  SelfTransferException,
  TransactionNotFoundException,
} from '../common/exceptions/domain.exception';
import { Prisma } from '../generated/prisma/client';
import {
  AccountStatus,
  LedgerDirection,
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';
import { AccountModel } from '../generated/prisma/models';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async transfer(
    user: AuthenticatedUser,
    dto: CreateTransferDto,
  ): Promise<TransactionResponseDto> {
    const amount = BigInt(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      const sourceId = await this.resolveOwnedAccountId(
        tx,
        dto.sourceAccountId,
        user.userId,
      );
      const destinationId = await this.resolveAccountIdByNumber(
        tx,
        dto.destinationAccountNumber,
      );

      await lockAccounts(tx, [sourceId, destinationId]);

      // Re-read after locking: the balance may have moved while we waited.
      const source = await tx.account.findUniqueOrThrow({
        where: { id: sourceId },
      });
      const destination = await tx.account.findUniqueOrThrow({
        where: { id: destinationId },
      });

      assertTransferable(source, destination, amount);

      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.TRANSFER,
          status: TransactionStatus.COMPLETED,
          reference: generateReference(),
          amount,
          currency: source.currency,
          narration: dto.narration ?? null,
          initiatedByUserId: user.userId,
        },
      });

      const entries = await this.ledger.post(tx, transaction.id, [
        { accountId: source.id, direction: LedgerDirection.DEBIT, amount },
        {
          accountId: destination.id,
          direction: LedgerDirection.CREDIT,
          amount,
        },
      ]);

      return TransactionResponseDto.from(transaction, entries);
    });
  }

  private async resolveOwnedAccountId(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
  ): Promise<string> {
    const account = await tx.account.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!account || account.userId !== userId) {
      throw new AccountNotFoundException(id);
    }
    return account.id;
  }

  private async resolveAccountIdByNumber(
    tx: Prisma.TransactionClient,
    accountNumber: string,
  ): Promise<string> {
    const account = await tx.account.findUnique({
      where: { accountNumber },
      select: { id: true },
    });
    if (!account) {
      throw new AccountNotFoundException(accountNumber);
    }
    return account.id;
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<TransactionResponseDto> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { ledgerEntries: { include: { account: true } } },
    });

    const isParticipant = transaction?.ledgerEntries.some(
      (entry) => entry.account.userId === user.userId,
    );
    if (!transaction || !isParticipant) {
      throw new TransactionNotFoundException(id);
    }

    return TransactionResponseDto.from(transaction, transaction.ledgerEntries);
  }
}

// ORDER BY id means every transfer locks accounts in the same sequence, so
// simultaneous A->B and B->A cannot each hold the row the other needs.
async function lockAccounts(
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

function assertTransferable(
  source: AccountModel,
  destination: AccountModel,
  amount: bigint,
): void {
  if (source.id === destination.id) {
    throw new SelfTransferException();
  }
  // Frozen is checked before balance so a frozen account leaks nothing.
  if (source.status !== AccountStatus.ACTIVE) {
    throw new AccountFrozenException(source.accountNumber);
  }
  if (destination.status !== AccountStatus.ACTIVE) {
    throw new AccountFrozenException(destination.accountNumber);
  }
  if (source.currency !== destination.currency) {
    throw new CurrencyMismatchException(source.currency, destination.currency);
  }
  if (source.cachedBalance < amount) {
    throw new InsufficientFundsException(source.cachedBalance, amount);
  }
}

function generateReference(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(5).toString('hex').toUpperCase();
  return `TXN-${day}-${suffix}`;
}

export type TransferTx = Prisma.TransactionClient;
