import { AccountStatus, AccountType } from '../src/generated/prisma/enums';
import { Harness, idempotencyKey } from './support/harness';

describe('transfers', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  const transfer = (token: string, body: object, key = idempotencyKey()) =>
    h.http
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  describe('happy path', () => {
    it('moves money and writes exactly two balanced entries', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 150_000,
        narration: 'lunch',
      }).expect(201);

      expect(body.reference).toMatch(/^TXN-\d{8}-[0-9A-F]{10}$/);
      expect(body.status).toBe('COMPLETED');
      expect(body.entries).toHaveLength(2);

      const debit = body.entries.find(
        (e: { direction: string }) => e.direction === 'DEBIT',
      );
      const credit = body.entries.find(
        (e: { direction: string }) => e.direction === 'CREDIT',
      );

      expect(debit.amount).toBe('150000');
      expect(credit.amount).toBe('150000');
      expect(debit.balanceAfter).toBe('350000');
      expect(credit.balanceAfter).toBe('150000');

      expect(await h.balanceOf(alice.accountId)).toBe(350_000n);
      expect(await h.balanceOf(bob.accountId)).toBe(150_000n);
    });

    it('keeps the cached balance equal to the ledger sum', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);

      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 120_000,
      }).expect(201);

      for (const id of [alice.accountId, bob.accountId]) {
        expect(await h.balanceOf(id)).toBe(await h.ledgerSumOf(id));
      }
    });

    it('allows transferring the entire balance', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 200_000);

      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 200_000,
      }).expect(201);

      expect(await h.balanceOf(alice.accountId)).toBe(0n);
    });

    it('records money as conserved across the whole system', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);
      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 175_000,
      }).expect(201);

      const accounts = await h.prisma.account.findMany();
      const total = accounts.reduce((sum, a) => sum + a.cachedBalance, 0n);
      expect(total).toBe(0n);
    });
  });

  describe('rejections', () => {
    it('rejects more than the balance with 422 and no side effects', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 100_000);

      const transactionsBefore = await h.prisma.transaction.count();
      const entriesBefore = await h.prisma.ledgerEntry.count();
      const auditBefore = await h.prisma.auditLog.count();

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 100_001,
      }).expect(422);

      expect(body.error).toBe('INSUFFICIENT_FUNDS');
      expect(await h.prisma.transaction.count()).toBe(transactionsBefore);
      expect(await h.prisma.ledgerEntry.count()).toBe(entriesBefore);
      expect(await h.prisma.auditLog.count()).toBe(auditBefore);
      expect(await h.balanceOf(alice.accountId)).toBe(100_000n);
      expect(await h.balanceOf(bob.accountId)).toBe(0n);
    });

    it('rejects sending to yourself', async () => {
      const alice = await h.registerUser();
      await h.fundAccount(alice, 100_000);

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: alice.accountNumber,
        amount: 1_000,
      }).expect(422);

      expect(body.error).toBe('SELF_TRANSFER');
      expect(await h.balanceOf(alice.accountId)).toBe(100_000n);
    });

    it('rejects a cross-currency transfer', async () => {
      const alice = await h.registerUser();
      await h.fundAccount(alice, 100_000);
      const usd = await h.prisma.account.create({
        data: {
          accountNumber: '2000000001',
          type: AccountType.USER,
          currency: 'USD',
          userId: (await h.registerUser()).userId,
        },
      });

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: usd.accountNumber,
        amount: 1_000,
      }).expect(422);

      expect(body.error).toBe('CURRENCY_MISMATCH');
    });

    it('rejects a frozen source with 403', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 100_000);
      await h.prisma.account.update({
        where: { id: alice.accountId },
        data: { status: AccountStatus.FROZEN },
      });

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 1_000,
      }).expect(403);

      expect(body.error).toBe('ACCOUNT_FROZEN');
    });

    it('rejects a frozen destination with 403', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 100_000);
      await h.prisma.account.update({
        where: { id: bob.accountId },
        data: { status: AccountStatus.FROZEN },
      });

      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 1_000,
      }).expect(403);
    });

    it('rejects an unknown destination account number', async () => {
      const alice = await h.registerUser();
      await h.fundAccount(alice, 100_000);

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: '9999999999',
        amount: 1_000,
      }).expect(404);

      expect(body.error).toBe('ACCOUNT_NOT_FOUND');
    });

    it('rejects spending from an account you do not own', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(bob, 100_000);

      await transfer(alice.token, {
        sourceAccountId: bob.accountId,
        destinationAccountNumber: alice.accountNumber,
        amount: 1_000,
      }).expect(404);

      expect(await h.balanceOf(bob.accountId)).toBe(100_000n);
    });

    it.each([
      ['a negative amount', -500],
      ['zero', 0],
      ['above the per-transaction cap', 1_000_000_001],
      ['a fractional amount', 100.5],
    ])('rejects %s with 400', async (_label, amount) => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);

      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount,
      }).expect(400);
    });

    it('rejects a narration over 140 characters', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);

      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 1_000,
        narration: 'x'.repeat(141),
      }).expect(400);
    });

    it('requires an Idempotency-Key header', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);

      await h.http
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${alice.token}`)
        .send({
          sourceAccountId: alice.accountId,
          destinationAccountNumber: bob.accountNumber,
          amount: 1_000,
        })
        .expect(400);
    });

    it('requires authentication', async () => {
      await h.http
        .post('/api/v1/transfers')
        .set('Idempotency-Key', idempotencyKey())
        .send({})
        .expect(401);
    });
  });

  describe('reading a transaction', () => {
    it('is visible to both participants but nobody else', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      const stranger = await h.registerUser();
      await h.fundAccount(alice, 500_000);

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 50_000,
      }).expect(201);

      for (const token of [alice.token, bob.token]) {
        await h.http
          .get(`/api/v1/transactions/${body.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }

      const { body: denied } = await h.http
        .get(`/api/v1/transactions/${body.id}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);

      expect(denied.error).toBe('TRANSACTION_NOT_FOUND');
    });
  });
});
