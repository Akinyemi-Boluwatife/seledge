import { ApiProperty } from '@nestjs/swagger';
import { AccountModel } from '../../generated/prisma/models';
import { AccountStatus, AccountType } from '../../generated/prisma/enums';

export class AccountResponseDto {
  id!: string;
  accountNumber!: string;

  @ApiProperty({ enum: AccountType })
  type!: AccountType;

  currency!: string;

  @ApiProperty({ enum: AccountStatus })
  status!: AccountStatus;

  @ApiProperty({
    description: 'Balance in minor units (kobo), as a string to preserve precision',
    example: '150000',
  })
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
