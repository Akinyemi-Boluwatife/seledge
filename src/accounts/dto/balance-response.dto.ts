export class BalanceResponseDto {
  cached!: string;
  ledgerDerived!: string;
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
