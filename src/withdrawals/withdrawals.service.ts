import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AccountsService } from '../accounts/accounts.service';
import {
  AccountFrozenException,
  AccountNotFoundException,
  InsufficientFundsException,
} from '../common/exceptions/domain.exception';
import {
  AccountStatus,
  LedgerDirection,
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';
import { AuditAction, AuditService } from '../audit/audit.service';
import { ActorType } from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { TransactionResponseDto } from '../transfers/dto/transaction-response.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  async withdraw(
    user: AuthenticatedUser,
    dto: CreateWithdrawalDto,
  ): Promise<TransactionResponseDto> {
    const amount = BigInt(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.account.findUnique({
        where: { id: dto.accountId },
        select: { id: true, userId: true },
      });
      if (!owned || owned.userId !== user.userId) {
        throw new AccountNotFoundException(dto.accountId);
      }

      const systemCash = await this.accounts.findSystemCash(tx);
      await this.ledger.lockAccounts(tx, [owned.id, systemCash.id]);

      const account = await tx.account.findUniqueOrThrow({
        where: { id: owned.id },
      });
      if (account.status !== AccountStatus.ACTIVE) {
        throw new AccountFrozenException(account.accountNumber);
      }
      if (account.cachedBalance < amount) {
        throw new InsufficientFundsException(account.cachedBalance, amount);
      }

      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.COMPLETED,
          reference: generateWithdrawalReference(),
          amount,
          currency: account.currency,
          narration: dto.narration ?? null,
          initiatedByUserId: user.userId,
        },
      });

      const entries = await this.ledger.post(tx, transaction.id, [
        { accountId: account.id, direction: LedgerDirection.DEBIT, amount },
        {
          accountId: systemCash.id,
          direction: LedgerDirection.CREDIT,
          amount,
        },
      ]);

      await this.audit.record(tx, {
        actorType: ActorType.USER,
        actorId: user.userId,
        action: AuditAction.WITHDRAWAL_COMPLETED,
        entityType: 'transaction',
        entityId: transaction.id,
        payload: {
          reference: transaction.reference,
          amount: amount.toString(),
          accountId: account.id,
          balanceAfter: entries
            .find((e) => e.accountId === account.id)
            ?.balanceAfter.toString(),
        },
      });

      return TransactionResponseDto.from(transaction, entries);
    });
  }
}

function generateWithdrawalReference(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `WDR-${day}-${randomBytes(5).toString('hex').toUpperCase()}`;
}
