import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountModel } from '../generated/prisma/models';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<AccountModel[]> {
    return this.prisma.account.findMany({ orderBy: { accountNumber: 'asc' } });
  }

  async findOne(id: string): Promise<AccountModel> {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return account;
  }

  async getBalance(id: string) {
    const account = await this.findOne(id);
    const ledgerDerived = await this.deriveBalance(id);

    return {
      cached: account.cachedBalance,
      ledgerDerived,
      inSync: account.cachedBalance === ledgerDerived,
    };
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
