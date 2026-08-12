import { Harness, TestUser, idempotencyKey } from './support/harness';

// These are the tests the locking strategy exists for. They assert on
// invariants (how many succeeded, final balances, ledger sums) and never on
// timing or ordering, so they cannot become flaky.
describe('concurrency', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  const transfer = (user: TestUser, body: object, key = idempotencyKey()) =>
    h.http
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send(body);

  async function assertLedgerIntact(): Promise<void> {
    const accounts = await h.prisma.account.findMany();
    for (const account of accounts) {
      expect(account.cachedBalance).toBe(await h.ledgerSumOf(account.id));
    }

    const transactions = await h.prisma.transaction.findMany({
      where: { status: 'COMPLETED' },
      include: { ledgerEntries: true },
    });
    for (const transaction of transactions) {
      const net = transaction.ledgerEntries.reduce(
        (sum, e) =>
          e.direction === 'CREDIT' ? sum + e.amount : sum - e.amount,
        0n,
      );
      expect(net).toBe(0n);
      expect(transaction.ledgerEntries).toHaveLength(2);
    }

    const total = accounts.reduce((sum, a) => sum + a.cachedBalance, 0n);
    expect(total).toBe(0n);
  }

  it('lets exactly three of ten parallel transfers succeed against a small balance', async () => {
    const spender = await h.registerUser();
    const sink = await h.registerUser();
    await h.fundAccount(spender, 100_000); // ₦1,000

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        transfer(spender, {
          sourceAccountId: spender.accountId,
          destinationAccountNumber: sink.accountNumber,
          amount: 30_000, // ₦300
        }),
      ),
    );

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);

    expect(created).toHaveLength(3);
    expect(rejected).toHaveLength(7);
    expect(rejected.every((r) => r.body.error === 'INSUFFICIENT_FUNDS')).toBe(
      true,
    );

    // No 5xx: the balance check must reject cleanly, not fall through to the
    // database CHECK constraint.
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);

    expect(await h.balanceOf(spender.accountId)).toBe(10_000n); // ₦100
    expect(await h.balanceOf(sink.accountId)).toBe(90_000n);
    await assertLedgerIntact();
  });

  it('never overdraws when the balance divides evenly', async () => {
    const spender = await h.registerUser();
    const sink = await h.registerUser();
    await h.fundAccount(spender, 100_000);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        transfer(spender, {
          sourceAccountId: spender.accountId,
          destinationAccountNumber: sink.accountNumber,
          amount: 25_000,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(
      results
        .filter((r) => r.status !== 201)
        .every((r) => r.body.error === 'INSUFFICIENT_FUNDS'),
    ).toBe(true);
    expect(await h.balanceOf(spender.accountId)).toBe(0n);
    await assertLedgerIntact();
  });

  // Opposing transfers lock the same two rows; without a consistent lock order
  // each would hold the row the other needs.
  it('does not deadlock when two accounts transfer to each other at once', async () => {
    const a = await h.registerUser();
    const b = await h.registerUser();
    await h.fundAccount(a, 200_000);
    await h.fundAccount(b, 200_000);

    const rounds = 15;
    const results = [];
    for (let round = 0; round < rounds; round++) {
      results.push(
        ...(await Promise.all([
          transfer(a, {
            sourceAccountId: a.accountId,
            destinationAccountNumber: b.accountNumber,
            amount: 100,
          }),
          transfer(b, {
            sourceAccountId: b.accountId,
            destinationAccountNumber: a.accountNumber,
            amount: 100,
          }),
        ])),
      );
    }

    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(results.filter((r) => r.status === 201)).toHaveLength(rounds * 2);

    // Equal amounts both ways, so both balances return to where they started.
    expect(await h.balanceOf(a.accountId)).toBe(200_000n);
    expect(await h.balanceOf(b.accountId)).toBe(200_000n);
    await assertLedgerIntact();
  });

  it('applies a transfer once when the same key arrives five times at once', async () => {
    const alice = await h.registerUser();
    const bob = await h.registerUser();
    await h.fundAccount(alice, 500_000);
    const key = idempotencyKey();
    const payload = {
      sourceAccountId: alice.accountId,
      destinationAccountNumber: bob.accountNumber,
      amount: 40_000,
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => transfer(alice, payload, key)),
    );

    const applied = results.filter((r) => r.status === 201);
    const inFlight = results.filter(
      (r) => r.status === 409 && r.body.error === 'REQUEST_IN_PROGRESS',
    );

    expect(applied).toHaveLength(1);
    expect(inFlight).toHaveLength(4);

    expect(await h.balanceOf(alice.accountId)).toBe(460_000n);
    expect(
      await h.prisma.transaction.count({ where: { type: 'TRANSFER' } }),
    ).toBe(1);
    await assertLedgerIntact();
  });

  it('keeps the ledger balanced under mixed concurrent traffic', async () => {
    const a = await h.registerUser();
    const b = await h.registerUser();
    const c = await h.registerUser();
    await h.fundAccount(a, 300_000);
    await h.fundAccount(b, 300_000);

    await Promise.all([
      transfer(a, {
        sourceAccountId: a.accountId,
        destinationAccountNumber: b.accountNumber,
        amount: 50_000,
      }),
      transfer(b, {
        sourceAccountId: b.accountId,
        destinationAccountNumber: c.accountNumber,
        amount: 70_000,
      }),
      transfer(a, {
        sourceAccountId: a.accountId,
        destinationAccountNumber: c.accountNumber,
        amount: 20_000,
      }),
      h.http
        .post('/api/v1/withdrawals')
        .set('Authorization', `Bearer ${b.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send({ accountId: b.accountId, amount: 30_000 }),
    ]);

    await assertLedgerIntact();
  });
});
