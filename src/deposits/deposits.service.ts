import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AccountsService } from '../accounts/accounts.service';
import {
  AccountFrozenException,
  AccountNotFoundException,
} from '../common/exceptions/domain.exception';
import {
  AccountStatus,
  ActorType,
  LedgerDirection,
  TransactionStatus,
  TransactionType,
} from '../generated/prisma/enums';
import { AuditAction, AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import {
  CreateDepositDto,
  DepositInitiatedDto,
} from './dto/create-deposit.dto';

export type WebhookOutcome =
  | 'APPLIED'
  | 'DUPLICATE_EVENT'
  | 'ALREADY_COMPLETED'
  | 'UNKNOWN_REFERENCE'
  | 'AMOUNT_MISMATCH';

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  async initiate(
    user: AuthenticatedUser,
    dto: CreateDepositDto,
  ): Promise<DepositInitiatedDto> {
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });
    if (!account || account.userId !== user.userId) {
      throw new AccountNotFoundException(dto.accountId);
    }
    if (account.status !== AccountStatus.ACTIVE) {
      throw new AccountFrozenException(account.accountNumber);
    }

    // No ledger entries yet: nothing has actually been paid.
    const transaction = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.PENDING,
          reference: generateDepositReference(),
          amount: BigInt(dto.amount),
          currency: account.currency,
          initiatedByUserId: user.userId,
          metadata: { accountId: account.id, provider: 'mockpay' },
        },
      });

      await this.audit.record(tx, {
        actorType: ActorType.USER,
        actorId: user.userId,
        action: AuditAction.DEPOSIT_INITIATED,
        entityType: 'transaction',
        entityId: created.id,
        payload: {
          reference: created.reference,
          amount: created.amount.toString(),
          accountId: account.id,
        },
      });

      return created;
    });

    return {
      reference: transaction.reference,
      amount: transaction.amount.toString(),
      status: transaction.status,
    };
  }

  async applyConfirmedDeposit(
    reference: string,
    paidAmount: bigint,
  ): Promise<WebhookOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { reference },
      });
      if (!transaction || transaction.type !== TransactionType.DEPOSIT) {
        this.logger.warn(`Webhook for unknown reference ${reference}`);
        return 'UNKNOWN_REFERENCE';
      }
      if (transaction.status === TransactionStatus.COMPLETED) {
        return 'ALREADY_COMPLETED';
      }
      // A valid signature proves the sender holds the secret, not that the
      // amount matches what was initiated.
      if (transaction.amount !== paidAmount) {
        this.logger.error(
          `Webhook amount ${paidAmount} != initiated ${transaction.amount} for ${reference}`,
        );
        return 'AMOUNT_MISMATCH';
      }

      const metadata = transaction.metadata as { accountId?: string } | null;
      const accountId = metadata?.accountId;
      if (!accountId) {
        return 'UNKNOWN_REFERENCE';
      }

      const systemCash = await this.accounts.findSystemCash(tx);
      await this.ledger.lockAccounts(tx, [accountId, systemCash.id]);

      await tx.transaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.COMPLETED },
      });

      await this.ledger.post(tx, transaction.id, [
        {
          accountId: systemCash.id,
          direction: LedgerDirection.DEBIT,
          amount: transaction.amount,
        },
        {
          accountId,
          direction: LedgerDirection.CREDIT,
          amount: transaction.amount,
        },
      ]);

      await this.audit.record(tx, {
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: AuditAction.DEPOSIT_COMPLETED,
        entityType: 'transaction',
        entityId: transaction.id,
        payload: {
          reference: transaction.reference,
          amount: transaction.amount.toString(),
          accountId,
          provider: 'mockpay',
        },
      });

      return 'APPLIED';
    });
  }
}

function generateDepositReference(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `DEP-${day}-${randomBytes(5).toString('hex').toUpperCase()}`;
}
