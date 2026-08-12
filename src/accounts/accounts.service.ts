import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, AuditService } from '../audit/audit.service';
import { AccountNotFoundException } from '../common/exceptions/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AccountModel } from '../generated/prisma/models';
import { AccountStatus, AccountType, ActorType, Role } from '../generated/prisma/enums';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PaginatedDto, PaginationQueryDto, paginate } from '../common/dto/pagination.dto';
import { MutableAccountStatus } from './dto/update-account-status.dto';

export const SYSTEM_CASH_NUMBER = '0000000000';

const ACCOUNT_NUMBER_LENGTH = 10;
const MAX_GENERATION_ATTEMPTS = 5;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createForUser(
    userId: string,
    currency: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AccountModel> {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const accountNumber = generateAccountNumber();
      const taken = await tx.account.findUnique({ where: { accountNumber } });
      if (taken) continue;

      return tx.account.create({
        data: { userId, accountNumber, currency, type: AccountType.USER },
      });
    }

    throw new Error(
      `Could not generate a unique account number after ${MAX_GENERATION_ATTEMPTS} attempts`,
    );
  }

  findSystemCash(tx: Prisma.TransactionClient = this.prisma) {
    return tx.account.findUniqueOrThrow({
      where: { accountNumber: SYSTEM_CASH_NUMBER },
    });
  }

  findAllForUser(user: AuthenticatedUser): Promise<AccountModel[]> {
    return this.prisma.account.findMany({
      where: user.role === Role.ADMIN ? {} : { userId: user.userId },
      orderBy: { accountNumber: 'asc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<AccountModel> {
    const account = await this.prisma.account.findUnique({ where: { id } });

    // 404 rather than 403 for someone else's account, so the endpoint cannot
    // be used to discover which account ids exist.
    if (!account || !canAccess(account, user)) {
      throw new AccountNotFoundException(id);
    }
    return account;
  }

  async getBalance(id: string, user: AuthenticatedUser) {
    const account = await this.findOne(id, user);
    const ledgerDerived = await this.deriveBalance(id);

    return {
      cached: account.cachedBalance,
      ledgerDerived,
      inSync: account.cachedBalance === ledgerDerived,
    };
  }

  async searchForAdmin(
    query: PaginationQueryDto,
    search?: string,
  ): Promise<PaginatedDto<AccountModel>> {
    const where: Prisma.AccountWhereInput = search
      ? {
          OR: [
            { accountNumber: { contains: search } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        orderBy: { accountNumber: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.account.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async ledgerFor(accountId: string, query: PaginationQueryDto) {
    const where = { accountId };
    const [data, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        include: { transaction: true },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async updateStatus(
    id: string,
    status: MutableAccountStatus,
    admin: AuthenticatedUser,
  ): Promise<AccountModel> {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) {
      throw new AccountNotFoundException(id);
    }

    // Freezing SYSTEM_CASH would halt every deposit and withdrawal.
    if (account.type === AccountType.SYSTEM) {
      throw new BadRequestException('System accounts cannot change status');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({ where: { id }, data: { status } });

      await this.audit.record(tx, {
        actorType: ActorType.ADMIN,
        actorId: admin.userId,
        action:
          status === AccountStatus.FROZEN
            ? AuditAction.ACCOUNT_FROZEN
            : AuditAction.ACCOUNT_UNFROZEN,
        entityType: 'account',
        entityId: updated.id,
        payload: {
          accountNumber: updated.accountNumber,
          from: account.status,
          to: status,
        },
      });

      return updated;
    });
  }

  private async deriveBalance(accountId: string): Promise<bigint> {
    const totals = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountId },
      _sum: { amount: true },
    });

    return totals.reduce((balance, { direction, _sum }) => {
      const amount = _sum.amount ?? 0n;
      return direction === 'CREDIT' ? balance + amount : balance - amount;
    }, 0n);
  }
}

function generateAccountNumber(): string {
  const digits = Array.from({ length: ACCOUNT_NUMBER_LENGTH }, () =>
    Math.floor(Math.random() * 10),
  );
  digits[0] = 1 + Math.floor(Math.random() * 9);
  return digits.join('');
}

function canAccess(
  account: { userId: string | null },
  user: AuthenticatedUser,
): boolean {
  return user.role === Role.ADMIN || account.userId === user.userId;
}
