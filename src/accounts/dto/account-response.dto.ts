import { AccountModel } from '../../generated/prisma/models';
import { AccountStatus, AccountType } from '../../generated/prisma/enums';

export class AccountResponseDto {
  id!: string;
  accountNumber!: string;
  type!: AccountType;
  currency!: string;
  status!: AccountStatus;
  cachedBalance!: string;
  createdAt!: Date;

  static from(account: AccountModel): AccountResponseDto {
    return {
      id: account.id,
      accountNumber: account.accountNumber,
      type: account.type,
      currency: account.currency,
      status: account.status,
      cachedBalance: account.cachedBalance.toString(),
      createdAt: account.createdAt,
    };
  }
}
