import { AccountStatus } from '../src/generated/prisma/enums';
import { Harness, idempotencyKey } from './support/harness';

describe('withdrawals and idempotency', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  const withdraw = (token: string, body: object, key = idempotencyKey()) =>
    h.http
      .post('/api/v1/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  const transfer = (token: string, body: object, key = idempotencyKey()) =>
    h.http
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  describe('withdrawals', () => {
    it('debits the account and credits SYSTEM_CASH', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 500_000);

      const { body } = await withdraw(user.token, {
        accountId: user.accountId,
        amount: 200_000,
      }).expect(201);

      expect(body.type).toBe('WITHDRAWAL');
      expect(body.entries).toHaveLength(2);
      expect(await h.balanceOf(user.accountId)).toBe(300_000n);

      const system = await h.prisma.account.findUniqueOrThrow({
        where: { accountNumber: '0000000000' },
      });
      // -500,000 from funding, +200,000 back from the withdrawal.
      expect(system.cachedBalance).toBe(-300_000n);
    });

    it('rejects withdrawing more than the balance', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);

      const { body } = await withdraw(user.token, {
        accountId: user.accountId,
        amount: 100_001,
      }).expect(422);

      expect(body.error).toBe('INSUFFICIENT_FUNDS');
      expect(await h.balanceOf(user.accountId)).toBe(100_000n);
    });

    it('rejects a withdrawal from a frozen account', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);
      await h.prisma.account.update({
        where: { id: user.accountId },
        data: { status: AccountStatus.FROZEN },
      });

      await withdraw(user.token, {
        accountId: user.accountId,
        amount: 1_000,
      }).expect(403);
    });

    it('rejects withdrawing from an account you do not own', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 100_000);

      await withdraw(bob.token, {
        accountId: alice.accountId,
        amount: 1_000,
      }).expect(404);
    });
  });

  describe('idempotency', () => {
    it('applies a replayed transfer only once and returns the same body', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);
      const key = idempotencyKey();
      const payload = {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 50_000,
      };

      const responses = [];
      for (let i = 0; i < 5; i++) {
        responses.push(await transfer(alice.token, payload, key).expect(201));
      }

      const references = new Set(responses.map((r) => r.body.reference));
      expect(references.size).toBe(1);
      for (const response of responses) {
        expect(response.body).toEqual(responses[0].body);
      }

      expect(await h.balanceOf(alice.accountId)).toBe(450_000n);
      expect(
        await h.prisma.transaction.count({ where: { type: 'TRANSFER' } }),
      ).toBe(1);
      expect(
        await h.prisma.ledgerEntry.count({
          where: { transaction: { type: 'TRANSFER' } },
        }),
      ).toBe(2);
    });

    it('rejects the same key with a different body', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 500_000);
      const key = idempotencyKey();

      await transfer(
        alice.token,
        {
          sourceAccountId: alice.accountId,
          destinationAccountNumber: bob.accountNumber,
          amount: 10_000,
        },
        key,
      ).expect(201);

      const { body } = await transfer(
        alice.token,
        {
          sourceAccountId: alice.accountId,
          destinationAccountNumber: bob.accountNumber,
          amount: 20_000,
        },
        key,
      ).expect(409);

      expect(body.error).toBe('IDEMPOTENCY_CONFLICT');
      expect(await h.balanceOf(alice.accountId)).toBe(490_000n);
    });

    it('scopes keys per user, so two users may reuse the same string', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 200_000);
      await h.fundAccount(bob, 200_000);
      const shared = 'the-same-key-for-both';

      await transfer(
        alice.token,
        {
          sourceAccountId: alice.accountId,
          destinationAccountNumber: bob.accountNumber,
          amount: 10_000,
        },
        shared,
      ).expect(201);

      await transfer(
        bob.token,
        {
          sourceAccountId: bob.accountId,
          destinationAccountNumber: alice.accountNumber,
          amount: 20_000,
        },
        shared,
      ).expect(201);

      expect(await h.prisma.idempotencyKey.count()).toBe(2);
    });

    it('releases the key when the transfer fails, so a retry can proceed', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 10_000);
      const key = idempotencyKey();
      const tooMuch = {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 999_999,
      };

      await transfer(alice.token, tooMuch, key).expect(422);
      // Same key again: must be a fresh attempt, not a replayed 409.
      await transfer(alice.token, tooMuch, key).expect(422);

      expect(await h.prisma.idempotencyKey.count()).toBe(0);
    });

    it('applies a replayed withdrawal only once', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 500_000);
      const key = idempotencyKey();
      const payload = { accountId: user.accountId, amount: 100_000 };

      const first = await withdraw(user.token, payload, key).expect(201);
      const second = await withdraw(user.token, payload, key).expect(201);

      expect(second.body.reference).toBe(first.body.reference);
      expect(await h.balanceOf(user.accountId)).toBe(400_000n);
    });

    it('stores the key with a 24 hour expiry', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 200_000);

      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 10_000,
      }).expect(201);

      const stored = await h.prisma.idempotencyKey.findFirstOrThrow();
      expect(stored.status).toBe('COMPLETED');
      expect(stored.responseStatus).toBe(201);

      const ttlHours =
        (stored.expiresAt.getTime() - stored.createdAt.getTime()) / 3_600_000;
      expect(Math.round(ttlHours)).toBe(24);
    });
  });
});
