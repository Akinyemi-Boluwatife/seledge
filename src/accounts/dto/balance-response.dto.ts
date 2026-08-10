import { ApiProperty } from '@nestjs/swagger';

export class BalanceResponseDto {
  @ApiProperty({
    description: 'Cached balance column, in minor units',
    example: '150000',
  })
  cached!: string;

  @ApiProperty({
    description: 'Balance recomputed from ledger entries — the source of truth',
    example: '150000',
  })
  ledgerDerived!: string;

  @ApiProperty({
    description: 'False means the cache has drifted and needs reconciliation',
  })
  inSync!: boolean;

  static from(balance: {
    cached: bigint;
    ledgerDerived: bigint;
    inSync: boolean;
  }): BalanceResponseDto {
    return {
      cached: balance.cached.toString(),
      ledgerDerived: balance.ledgerDerived.toString(),
      inSync: balance.inSync,
    };
  }
}
