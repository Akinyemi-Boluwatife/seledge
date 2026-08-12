import { Harness, randomSuffix, signPayload } from './support/harness';

describe('deposits via signed webhook', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  const initiate = (token: string, accountId: string, amount: number) =>
    h.http
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId, amount });

  const event = (reference: string, amount: number, id?: string) => ({
    event: 'charge.success',
    id: id ?? `evt-${randomSuffix()}`,
    data: { reference, amount },
  });

  it('creates a PENDING transaction with no ledger entries', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 500_000).expect(
      201,
    );

    expect(body.status).toBe('PENDING');
    expect(body.reference).toMatch(/^DEP-\d{8}-[0-9A-F]{10}$/);
    expect(await h.balanceOf(user.accountId)).toBe(0n);
    expect(await h.prisma.ledgerEntry.count()).toBe(0);
  });

  it('credits the account when a valid signature arrives', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 500_000);

    const res = await h.sendWebhook(event(body.reference, 500_000)).expect(200);
    expect(res.body.outcome).toBe('APPLIED');

    expect(await h.balanceOf(user.accountId)).toBe(500_000n);
    expect(await h.ledgerSumOf(user.accountId)).toBe(500_000n);

    const transaction = await h.prisma.transaction.findUniqueOrThrow({
      where: { reference: body.reference },
      include: { ledgerEntries: true },
    });
    expect(transaction.status).toBe('COMPLETED');
    expect(transaction.ledgerEntries).toHaveLength(2);
  });

  it('balances the credit against SYSTEM_CASH', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 300_000);
    await h.sendWebhook(event(body.reference, 300_000)).expect(200);

    const system = await h.prisma.account.findUniqueOrThrow({
      where: { accountNumber: '0000000000' },
    });
    expect(system.cachedBalance).toBe(-300_000n);
  });

  it('rejects an invalid signature and changes nothing', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 500_000);

    const res = await h
      .sendWebhook(event(body.reference, 500_000), 'deadbeef')
      .expect(401);
    expect(res.body.error).toBe('INVALID_SIGNATURE');

    expect(await h.balanceOf(user.accountId)).toBe(0n);
    expect(await h.prisma.webhookEvent.count()).toBe(0);
  });

  it('rejects a body altered after signing', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 500_000);

    const honest = event(body.reference, 500_000);
    const signatureForHonest = signPayload(JSON.stringify(honest));
    const tampered = { ...honest, data: { ...honest.data, amount: 999_999 } };

    // Real signature, but for a different payload than the one being sent.
    await h.sendWebhook(tampered, signatureForHonest).expect(401);
    expect(await h.balanceOf(user.accountId)).toBe(0n);
  });

  it('applies a duplicated provider event only once', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 400_000);
    const payload = event(body.reference, 400_000, 'evt-fixed-id');

    const first = await h.sendWebhook(payload).expect(200);
    const second = await h.sendWebhook(payload).expect(200);

    expect(first.body.outcome).toBe('APPLIED');
    expect(second.body.outcome).toBe('DUPLICATE_EVENT');
    expect(await h.balanceOf(user.accountId)).toBe(400_000n);
    expect(await h.prisma.ledgerEntry.count()).toBe(2);
  });

  it('ignores a second event for an already completed deposit', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 400_000);

    await h.sendWebhook(event(body.reference, 400_000)).expect(200);
    const again = await h
      .sendWebhook(event(body.reference, 400_000))
      .expect(200);

    expect(again.body.outcome).toBe('ALREADY_COMPLETED');
    expect(await h.balanceOf(user.accountId)).toBe(400_000n);
  });

  // A 2xx stops the provider retrying an event that can never succeed.
  it('acknowledges an unknown reference with 200', async () => {
    const res = await h
      .sendWebhook(event('DEP-20260101-DEADBEEF00', 1_000))
      .expect(200);
    expect(res.body.outcome).toBe('UNKNOWN_REFERENCE');
  });

  it('refuses to credit an amount that differs from what was initiated', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 100_000);

    const res = await h.sendWebhook(event(body.reference, 999_999)).expect(200);
    expect(res.body.outcome).toBe('AMOUNT_MISMATCH');
    expect(await h.balanceOf(user.accountId)).toBe(0n);
  });

  it('stores the raw event for investigation', async () => {
    const user = await h.registerUser();
    const { body } = await initiate(user.token, user.accountId, 100_000);
    await h.sendWebhook(event(body.reference, 100_000)).expect(200);

    const stored = await h.prisma.webhookEvent.findFirstOrThrow();
    expect(stored.provider).toBe('mockpay');
    expect(stored.signatureValid).toBe(true);
    expect(stored.processedAt).not.toBeNull();
  });

  it('requires authentication to initiate', async () => {
    await h.http.post('/api/v1/deposits').send({ amount: 1000 }).expect(401);
  });

  it('refuses to initiate on an account you do not own', async () => {
    const alice = await h.registerUser();
    const bob = await h.registerUser();
    await initiate(bob.token, alice.accountId, 1_000).expect(404);
  });
});
