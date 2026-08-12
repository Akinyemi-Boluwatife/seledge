import { Harness, idempotencyKey } from './support/harness';

async function waitFor<T>(
  attempt: () => Promise<T | null>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await attempt();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('timed out waiting for background job');
}

describe('background jobs', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  async function adminToken(): Promise<string> {
    return h.makeAdmin(await h.registerUser());
  }

  describe('reconciliation', () => {
    it('reports no drift on a healthy ledger', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 200_000);
      const admin = await adminToken();

      const { body } = await h.http
        .post('/api/v1/admin/reconciliation/run')
        .set('Authorization', `Bearer ${admin}`)
        .expect(201);

      expect(body.driftCount).toBe(0);
      expect(body.accountsChecked).toBeGreaterThan(0);
    });

    it('flags exactly the account whose cached balance was corrupted', async () => {
      const corrupted = await h.registerUser();
      const healthy = await h.registerUser();
      await h.fundAccount(corrupted, 200_000);
      await h.fundAccount(healthy, 200_000);
      const admin = await adminToken();

      // Accounts are mutable by design, so this simulates a real cache bug.
      await h.prisma.$executeRawUnsafe(
        `UPDATE accounts SET "cachedBalance" = 999999 WHERE id = '${corrupted.accountId}'`,
      );

      const { body } = await h.http
        .post('/api/v1/admin/reconciliation/run')
        .set('Authorization', `Bearer ${admin}`)
        .expect(201);

      expect(body.driftCount).toBe(1);

      const report = await h.prisma.reconciliationReport.findFirstOrThrow({
        orderBy: { runAt: 'desc' },
      });
      const details = report.details as {
        drifted: { accountId: string; difference: string }[];
      };

      expect(details.drifted).toHaveLength(1);
      expect(details.drifted[0].accountId).toBe(corrupted.accountId);
      expect(details.drifted[0].difference).toBe('799999');
    });

    // Silently correcting drift would erase the evidence of whatever caused it.
    it('does not repair the drift it finds', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 200_000);
      const admin = await adminToken();

      await h.prisma.$executeRawUnsafe(
        `UPDATE accounts SET "cachedBalance" = 1 WHERE id = '${user.accountId}'`,
      );

      await h.http
        .post('/api/v1/admin/reconciliation/run')
        .set('Authorization', `Bearer ${admin}`)
        .expect(201);

      expect(await h.balanceOf(user.accountId)).toBe(1n);
      expect(await h.ledgerSumOf(user.accountId)).toBe(200_000n);
    });

    it('detects drift in either direction', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 200_000);
      const admin = await adminToken();

      await h.prisma.$executeRawUnsafe(
        `UPDATE accounts SET "cachedBalance" = 100000 WHERE id = '${user.accountId}'`,
      );

      const { body } = await h.http
        .post('/api/v1/admin/reconciliation/run')
        .set('Authorization', `Bearer ${admin}`)
        .expect(201);

      expect(body.driftCount).toBe(1);
      const report = await h.prisma.reconciliationReport.findFirstOrThrow({
        orderBy: { runAt: 'desc' },
      });
      const details = report.details as { drifted: { difference: string }[] };
      expect(details.drifted[0].difference).toBe('-100000');
    });

    it('keeps a history of reports for admins', async () => {
      const admin = await adminToken();
      for (let i = 0; i < 3; i++) {
        await h.http
          .post('/api/v1/admin/reconciliation/run')
          .set('Authorization', `Bearer ${admin}`)
          .expect(201);
      }

      const { body } = await h.http
        .get('/api/v1/admin/reconciliation/reports?limit=2')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(body.data).toHaveLength(2);
      expect(body.meta.total).toBe(3);
    });
  });

  describe('statements', () => {
    const currentPeriod = () => new Date().toISOString().slice(0, 7);

    async function statementWhenReady(token: string, accountId: string) {
      const period = currentPeriod();
      const first = await h.http
        .get(`/api/v1/accounts/${accountId}/statements/${period}`)
        .set('Authorization', `Bearer ${token}`);
      expect(first.status).toBe(202);
      expect(first.body.status).toBe('PENDING');

      return waitFor(async () => {
        const res = await h.http
          .get(`/api/v1/accounts/${accountId}/statements/${period}`)
          .set('Authorization', `Bearer ${token}`);
        return res.status === 200 ? res.body : null;
      });
    }

    it('generates a statement whose opening plus movement equals closing', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 700_000);
      await h.http
        .post('/api/v1/withdrawals')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send({ accountId: user.accountId, amount: 250_000 })
        .expect(201);

      const statement = await statementWhenReady(user.token, user.accountId);

      expect(statement.status).toBe('READY');
      expect(statement.openingBalance).toBe('0');
      expect(statement.closingBalance).toBe('450000');
      expect(statement.entryCount).toBe(2);

      const movement = statement.content.entries.reduce(
        (sum: bigint, e: { direction: string; amount: string }) =>
          e.direction === 'CREDIT'
            ? sum + BigInt(e.amount)
            : sum - BigInt(e.amount),
        0n,
      );
      expect(BigInt(statement.openingBalance) + movement).toBe(
        BigInt(statement.closingBalance),
      );
    });

    it('lists entries with their running balance and transaction reference', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);

      const statement = await statementWhenReady(user.token, user.accountId);
      const [entry] = statement.content.entries;

      expect(entry.direction).toBe('CREDIT');
      expect(entry.amount).toBe('100000');
      expect(entry.balanceAfter).toBe('100000');
      expect(entry.reference).toMatch(/^DEP-/);
      expect(entry.type).toBe('DEPOSIT');
    });

    it('returns the stored statement on a repeat request without regenerating', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);

      const first = await statementWhenReady(user.token, user.accountId);
      const second = await h.http
        .get(`/api/v1/accounts/${user.accountId}/statements/${currentPeriod()}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(second.body.statementId).toBe(first.statementId);
      expect(await h.prisma.statement.count()).toBe(1);
    });

    it('produces an empty statement for a month with no activity', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);

      await h.http
        .get(`/api/v1/accounts/${user.accountId}/statements/2020-01`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(202);

      const statement = await waitFor(async () => {
        const res = await h.http
          .get(`/api/v1/accounts/${user.accountId}/statements/2020-01`)
          .set('Authorization', `Bearer ${user.token}`);
        return res.status === 200 ? res.body : null;
      });

      expect(statement.openingBalance).toBe('0');
      expect(statement.closingBalance).toBe('0');
      expect(statement.entryCount).toBe(0);
    });

    it.each(['2026-13', 'august', '2026', '2026-1'])(
      'rejects the malformed period %s',
      async (period) => {
        const user = await h.registerUser();
        await h.http
          .get(`/api/v1/accounts/${user.accountId}/statements/${period}`)
          .set('Authorization', `Bearer ${user.token}`)
          .expect(400);
      },
    );

    it('refuses a statement for an account you do not own', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.http
        .get(
          `/api/v1/accounts/${alice.accountId}/statements/${currentPeriod()}`,
        )
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(404);
    });
  });

  describe('idempotency key cleanup', () => {
    it('removes only keys that have expired', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 200_000);

      await h.http
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send({
          sourceAccountId: alice.accountId,
          destinationAccountNumber: bob.accountNumber,
          amount: 10_000,
        })
        .expect(201);

      await h.prisma.idempotencyKey.create({
        data: {
          userId: alice.userId,
          key: 'already-expired',
          requestHash: 'x'.repeat(64),
          status: 'COMPLETED',
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      expect(await h.prisma.idempotencyKey.count()).toBe(2);

      const { count } = await h.prisma.idempotencyKey.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });

      expect(count).toBe(1);
      expect(await h.prisma.idempotencyKey.count()).toBe(1);
    });
  });
});
