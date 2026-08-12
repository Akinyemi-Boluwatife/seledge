import { UnbalancedLedgerException } from '../common/exceptions/domain.exception';
import { LedgerDirection } from '../generated/prisma/enums';
import { LedgerEntryInput, assertBalanced } from './ledger.service';

const debit = (amount: bigint, accountId = 'a1'): LedgerEntryInput => ({
  accountId,
  direction: LedgerDirection.DEBIT,
  amount,
});

const credit = (amount: bigint, accountId = 'a2'): LedgerEntryInput => ({
  accountId,
  direction: LedgerDirection.CREDIT,
  amount,
});

describe('assertBalanced', () => {
  it('accepts a matched debit and credit', () => {
    expect(() => assertBalanced([debit(1000n), credit(1000n)])).not.toThrow();
  });

  it('accepts a split across several accounts that nets to zero', () => {
    expect(() =>
      assertBalanced([
        debit(1000n, 'a1'),
        credit(600n, 'a2'),
        credit(400n, 'a3'),
      ]),
    ).not.toThrow();
  });

  it('rejects a credit larger than the debit', () => {
    expect(() => assertBalanced([debit(1000n), credit(1001n)])).toThrow(
      UnbalancedLedgerException,
    );
  });

  it('rejects a debit larger than the credit', () => {
    expect(() => assertBalanced([debit(1001n), credit(1000n)])).toThrow(
      UnbalancedLedgerException,
    );
  });

  it('rejects a single entry', () => {
    expect(() => assertBalanced([debit(1000n)])).toThrow(
      UnbalancedLedgerException,
    );
  });

  it('rejects no entries at all', () => {
    expect(() => assertBalanced([])).toThrow(UnbalancedLedgerException);
  });

  it('rejects a zero amount', () => {
    expect(() => assertBalanced([debit(0n), credit(0n)])).toThrow(
      UnbalancedLedgerException,
    );
  });

  it('rejects a negative amount even when the sum is zero', () => {
    expect(() => assertBalanced([debit(-500n), credit(-500n)])).toThrow(
      UnbalancedLedgerException,
    );
  });

  it('rejects two debits that happen to cancel nothing', () => {
    expect(() => assertBalanced([debit(500n), debit(500n)])).toThrow(
      UnbalancedLedgerException,
    );
  });

  it('reports the drift amount', () => {
    expect(() => assertBalanced([debit(1000n), credit(1250n)])).toThrow(
      /drift 250/,
    );
  });

  it('handles amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993n;
    expect(() => assertBalanced([debit(huge), credit(huge)])).not.toThrow();
    expect(() => assertBalanced([debit(huge), credit(huge - 1n)])).toThrow(
      UnbalancedLedgerException,
    );
  });
});
