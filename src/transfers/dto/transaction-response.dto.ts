import { ApiProperty } from '@nestjs/swagger';
import {
  LedgerDirection,
  TransactionStatus,
  TransactionType,
} from '../../generated/prisma/enums';
import {
  LedgerEntryModel,
  TransactionModel,
} from '../../generated/prisma/models';

export class LedgerEntryResponseDto {
  id!: string;
  accountId!: string;

  @ApiProperty({ enum: LedgerDirection })
  direction!: LedgerDirection;

  @ApiProperty({ description: 'Minor units, always positive' })
  amount!: string;

  @ApiProperty({ description: 'Account balance immediately after this entry' })
  balanceAfter!: string;

  static from(entry: LedgerEntryModel): LedgerEntryResponseDto {
    return {
      id: entry.id,
      accountId: entry.accountId,
      direction: entry.direction,
      amount: entry.amount.toString(),
      balanceAfter: entry.balanceAfter.toString(),
    };
  }
}

export class TransactionResponseDto {
  id!: string;
  reference!: string;

  @ApiProperty({ enum: TransactionType })
  type!: TransactionType;

  @ApiProperty({ enum: TransactionStatus })
  status!: TransactionStatus;

  @ApiProperty({ description: 'Minor units' })
  amount!: string;

  currency!: string;
  narration!: string | null;
  createdAt!: Date;

  @ApiProperty({ type: [LedgerEntryResponseDto] })
  entries!: LedgerEntryResponseDto[];

  static from(
    transaction: TransactionModel,
    entries: LedgerEntryModel[],
  ): TransactionResponseDto {
    return {
      id: transaction.id,
      reference: transaction.reference,
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount.toString(),
      currency: transaction.currency,
      narration: transaction.narration,
      createdAt: transaction.createdAt,
      entries: entries.map(LedgerEntryResponseDto.from),
    };
  }
}
