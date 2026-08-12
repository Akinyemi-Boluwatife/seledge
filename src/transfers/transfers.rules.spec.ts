import {
  AccountFrozenException,
  CurrencyMismatchException,
  InsufficientFundsException,
  SelfTransferException,
} from '../common/exceptions/domain.exception';
import { AccountStatus, AccountType } from '../generated/prisma/enums';
import { AccountModel } from '../generated/prisma/models';
import { assertTransferable } from './transfers.service';

function account(overrides: Partial<AccountModel> = {}): AccountModel {
  return {
    id: 'a1',
    userId: 'u1',
    accountNumber: '1000000001',
    type: AccountType.USER,
    currency: 'NGN',
    status: AccountStatus.ACTIVE,
    cachedBalance: 500_000n,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('assertTransferable', () => {
  const source = account({ id: 'a1', accountNumber: '1000000001' });
  const destination = account({
    id: 'a2',
    userId: 'u2',
    accountNumber: '1000000002',
  });

  it('accepts a valid transfer', () => {
    expect(() =>
      assertTransferable(source, destination, 100_000n),
    ).not.toThrow();
  });

  it('accepts a transfer of the entire balance', () => {
    expect(() =>
      assertTransferable(source, destination, 500_000n),
    ).not.toThrow();
  });

  it('rejects sending to the same account', () => {
    expect(() => assertTransferable(source, source, 1n)).toThrow(
      SelfTransferException,
    );
  });

  it('rejects a frozen source', () => {
    expect(() =>
      assertTransferable(
        account({ status: AccountStatus.FROZEN }),
        destination,
        1n,
      ),
    ).toThrow(AccountFrozenException);
  });

  it('rejects a frozen destination', () => {
    expect(() =>
      assertTransferable(
        source,
        account({ id: 'a2', status: AccountStatus.FROZEN }),
        1n,
      ),
    ).toThrow(AccountFrozenException);
  });

  it('rejects a closed source', () => {
    expect(() =>
      assertTransferable(
        account({ status: AccountStatus.CLOSED }),
        destination,
        1n,
      ),
    ).toThrow(AccountFrozenException);
  });

  it('rejects mismatched currencies', () => {
    expect(() =>
      assertTransferable(source, account({ id: 'a2', currency: 'USD' }), 1n),
    ).toThrow(CurrencyMismatchException);
  });

  it('rejects more than the balance', () => {
    expect(() => assertTransferable(source, destination, 500_001n)).toThrow(
      InsufficientFundsException,
    );
  });

  it('rejects any amount from a zero balance', () => {
    expect(() =>
      assertTransferable(account({ cachedBalance: 0n }), destination, 1n),
    ).toThrow(InsufficientFundsException);
  });

  // A frozen account must not reveal whether it had the funds.
  it('reports frozen before insufficient funds', () => {
    expect(() =>
      assertTransferable(
        account({ status: AccountStatus.FROZEN, cachedBalance: 0n }),
        destination,
        999_999n,
      ),
    ).toThrow(AccountFrozenException);
  });

  it('reports self-transfer before any other rule', () => {
    const frozenSelf = account({ status: AccountStatus.FROZEN });
    expect(() => assertTransferable(frozenSelf, frozenSelf, 1n)).toThrow(
      SelfTransferException,
    );
  });

  it('states balance and attempted amount in the error', () => {
    expect(() => assertTransferable(source, destination, 600_000n)).toThrow(
      /balance 500000, attempted 600000/,
    );
  });
});
