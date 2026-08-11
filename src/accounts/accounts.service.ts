import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { AccountModel } from '../generated/prisma/models';
import { AccountType, Role } from '../generated/prisma/enums';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { MutableAccountStatus } from './dto/update-account-status.dto';

const ACCOUNT_NUMBER_LENGTH = 10;
const MAX_GENERATION_ATTEMPTS = 5;

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

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
      throw new NotFoundException(`Account ${id} not found`);
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

  async updateStatus(
    id: string,
    status: MutableAccountStatus,
  ): Promise<AccountModel> {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }

    // Freezing SYSTEM_CASH would halt every deposit and withdrawal.
    if (account.type === AccountType.SYSTEM) {
      throw new BadRequestException('System accounts cannot change status');
    }

    return this.prisma.account.update({ where: { id }, data: { status } });
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
