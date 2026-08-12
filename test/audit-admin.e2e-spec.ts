import { Harness, TestUser, idempotencyKey } from './support/harness';

describe('audit trail and admin endpoints', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  const transfer = (token: string, body: object) =>
    h.http
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(body);

  const actions = async () =>
    (await h.prisma.auditLog.findMany()).map((log) => log.action);

  async function adminOf(): Promise<string> {
    return h.makeAdmin(await h.registerUser());
  }

  describe('audit trail', () => {
    it('records a deposit as initiated by the user and completed by the system', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 300_000);

      const logs = await h.prisma.auditLog.findMany({
        orderBy: { createdAt: 'asc' },
      });
      const initiated = logs.find((l) => l.action === 'DEPOSIT_INITIATED');
      const completed = logs.find((l) => l.action === 'DEPOSIT_COMPLETED');

      expect(initiated?.actorType).toBe('USER');
      expect(initiated?.actorId).toBe(user.userId);
      // The webhook has no logged-in actor.
      expect(completed?.actorType).toBe('SYSTEM');
      expect(completed?.actorId).toBeNull();
    });

    it('records a transfer against the user who made it', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 300_000);

      const { body } = await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 50_000,
      }).expect(201);

      const log = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'TRANSFER_COMPLETED' },
      });
      expect(log.actorType).toBe('USER');
      expect(log.actorId).toBe(alice.userId);
      expect(log.entityId).toBe(body.id);
      expect(log.payload).toMatchObject({ amount: '50000' });
    });

    it('records a withdrawal', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 300_000);
      await h.http
        .post('/api/v1/withdrawals')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send({ accountId: user.accountId, amount: 100_000 })
        .expect(201);

      expect(await actions()).toContain('WITHDRAWAL_COMPLETED');
    });

    it('records freeze and unfreeze against the admin', async () => {
      const user = await h.registerUser();
      const admin = await adminOf();

      for (const status of ['FROZEN', 'ACTIVE']) {
        await h.http
          .patch(`/api/v1/admin/accounts/${user.accountId}/status`)
          .set('Authorization', `Bearer ${admin}`)
          .send({ status })
          .expect(200);
      }

      const logs = await h.prisma.auditLog.findMany({
        where: { entityType: 'account' },
      });
      expect(logs.map((l) => l.action).sort()).toEqual([
        'ACCOUNT_FROZEN',
        'ACCOUNT_UNFROZEN',
      ]);
      expect(logs.every((l) => l.actorType === 'ADMIN')).toBe(true);
    });

    // The audit row shares the transfer transaction, so a rollback drops both.
    it('writes nothing when the action fails', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.fundAccount(alice, 10_000);
      const before = await h.prisma.auditLog.count();

      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 999_999,
      }).expect(422);

      expect(await h.prisma.auditLog.count()).toBe(before);
    });

    it('never stores the actor email in the payload', async () => {
      const alice = await h.registerUser('private@test.local');
      const bob = await h.registerUser();
      await h.fundAccount(alice, 300_000);
      await transfer(alice.token, {
        sourceAccountId: alice.accountId,
        destinationAccountNumber: bob.accountNumber,
        amount: 10_000,
      }).expect(201);

      const logs = await h.prisma.auditLog.findMany();
      expect(JSON.stringify(logs)).not.toContain('private@test.local');
    });
  });

  describe('append-only enforcement', () => {
    it('refuses to update a ledger entry', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);

      await expect(
        h.prisma.$executeRawUnsafe(`UPDATE ledger_entries SET amount = 1`),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses to delete a ledger entry', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);

      await expect(
        h.prisma.$executeRawUnsafe(`DELETE FROM ledger_entries`),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses to update an audit log', async () => {
      const user = await h.registerUser();
      await h.fundAccount(user, 100_000);

      await expect(
        h.prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'TAMPERED'`),
      ).rejects.toThrow(/append-only/);
    });

    it('still allows account balances to change', async () => {
      const user = await h.registerUser();
      await expect(
        h.prisma.$executeRawUnsafe(
          `UPDATE accounts SET "cachedBalance" = "cachedBalance" WHERE id = '${user.accountId}'`,
        ),
      ).resolves.toBe(1);
    });
  });

  describe('history and pagination', () => {
    async function userWithHistory(): Promise<TestUser> {
      const user = await h.registerUser();
      const other = await h.registerUser();
      await h.fundAccount(user, 500_000);
      await h.http
        .post('/api/v1/withdrawals')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send({ accountId: user.accountId, amount: 50_000 })
        .expect(201);
      await transfer(user.token, {
        sourceAccountId: user.accountId,
        destinationAccountNumber: other.accountNumber,
        amount: 25_000,
      }).expect(201);
      return user;
    }

    it('pages through history with correct metadata', async () => {
      const user = await userWithHistory();
      const { body } = await h.http
        .get(`/api/v1/accounts/${user.accountId}/transactions?limit=2&page=1`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(body.data).toHaveLength(2);
      expect(body.meta).toEqual({ total: 3, page: 1, limit: 2, pages: 2 });
    });

    it('returns the remainder on the last page', async () => {
      const user = await userWithHistory();
      const { body } = await h.http
        .get(`/api/v1/accounts/${user.accountId}/transactions?limit=2&page=2`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(body.data).toHaveLength(1);
    });

    it('filters by transaction type', async () => {
      const user = await userWithHistory();
      const { body } = await h.http
        .get(`/api/v1/accounts/${user.accountId}/transactions?type=WITHDRAWAL`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].type).toBe('WITHDRAWAL');
    });

    it('caps the page size', async () => {
      const user = await h.registerUser();
      await h.http
        .get(`/api/v1/accounts/${user.accountId}/transactions?limit=101`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(400);
    });

    it('refuses history for an account you do not own', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.http
        .get(`/api/v1/accounts/${alice.accountId}/transactions`)
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(404);
    });
  });

  describe('admin access control', () => {
    it.each([
      ['audit logs', '/api/v1/admin/audit-logs'],
      ['account search', '/api/v1/admin/accounts'],
      ['reconciliation reports', '/api/v1/admin/reconciliation/reports'],
    ])('denies %s to a normal user', async (_label, path) => {
      const user = await h.registerUser();
      const { body } = await h.http
        .get(path)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(403);
      expect(body.error).toBe('FORBIDDEN');
    });

    it('lets an admin search accounts by number', async () => {
      const user = await h.registerUser();
      const admin = await adminOf();

      const { body } = await h.http
        .get(`/api/v1/admin/accounts?search=${user.accountNumber}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].accountNumber).toBe(user.accountNumber);
    });

    it('lets an admin read any account ledger', async () => {
      const user = await h.registerUser();
      const admin = await adminOf();
      await h.fundAccount(user, 100_000);

      const { body } = await h.http
        .get(`/api/v1/admin/accounts/${user.accountId}/ledger`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].direction).toBe('CREDIT');
      expect(body.data[0].amount).toBe('100000');
    });

    it('lets an admin filter the audit trail by action', async () => {
      const user = await h.registerUser();
      const admin = await adminOf();
      await h.fundAccount(user, 100_000);

      const { body } = await h.http
        .get('/api/v1/admin/audit-logs?action=DEPOSIT_COMPLETED')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(body.data).toHaveLength(1);
      expect(body.data[0].action).toBe('DEPOSIT_COMPLETED');
    });

    it('refuses to freeze a system account', async () => {
      const admin = await adminOf();
      const system = await h.prisma.account.findUniqueOrThrow({
        where: { accountNumber: '0000000000' },
      });

      await h.http
        .patch(`/api/v1/admin/accounts/${system.id}/status`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ status: 'FROZEN' })
        .expect(400);
    });

    it('rejects a status outside freeze and unfreeze', async () => {
      const user = await h.registerUser();
      const admin = await adminOf();

      await h.http
        .patch(`/api/v1/admin/accounts/${user.accountId}/status`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ status: 'CLOSED' })
        .expect(400);
    });
  });
});
