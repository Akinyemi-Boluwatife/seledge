import { Harness } from './support/harness';

describe('auth and account ownership', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  describe('registration', () => {
    it('creates a user with a default NGN account and returns a token', async () => {
      const { body } = await h.http
        .post('/api/v1/auth/register')
        .send({ email: 'ada@test.local', password: 'test-password-123' })
        .expect(201);

      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.accountNumber).toMatch(/^\d{10}$/);

      const account = await h.prisma.account.findUniqueOrThrow({
        where: { accountNumber: body.accountNumber },
      });
      expect(account.currency).toBe('NGN');
      expect(account.cachedBalance).toBe(0n);
      expect(account.userId).toBe(body.userId);
    });

    it('normalises the email before storing it', async () => {
      await h.http
        .post('/api/v1/auth/register')
        .send({ email: '  ADA@Test.Local  ', password: 'test-password-123' })
        .expect(201);

      expect(
        await h.prisma.user.findUnique({ where: { email: 'ada@test.local' } }),
      ).not.toBeNull();
    });

    it('rejects a duplicate email with 409', async () => {
      await h.registerUser('dup@test.local');
      const { body } = await h.http
        .post('/api/v1/auth/register')
        .send({ email: 'dup@test.local', password: 'test-password-123' })
        .expect(409);

      expect(body.error).toBe('EMAIL_EXISTS');
    });

    it('rejects a duplicate regardless of casing', async () => {
      await h.registerUser('case@test.local');
      await h.http
        .post('/api/v1/auth/register')
        .send({ email: 'CASE@TEST.LOCAL', password: 'test-password-123' })
        .expect(409);
    });

    it('rejects a short password and never creates the user', async () => {
      await h.http
        .post('/api/v1/auth/register')
        .send({ email: 'weak@test.local', password: 'short' })
        .expect(400);

      expect(await h.prisma.user.count()).toBe(0);
    });

    it('stores an argon2 hash, never the password', async () => {
      const user = await h.registerUser('hash@test.local');
      const stored = await h.prisma.user.findUniqueOrThrow({
        where: { id: user.userId },
      });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain('test-password-123');
    });
  });

  describe('login', () => {
    it('returns a token for correct credentials', async () => {
      const user = await h.registerUser('login@test.local');
      const { body } = await h.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'test-password-123' })
        .expect(200);

      expect(body.accessToken).toEqual(expect.any(String));
    });

    it('gives the same generic error for a wrong password', async () => {
      const user = await h.registerUser('wrong@test.local');
      const { body } = await h.http
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'not-the-password' })
        .expect(401);

      expect(body.error).toBe('INVALID_CREDENTIALS');
      expect(body.message).toBe('Invalid credentials');
    });

    it('gives an identical error for an unknown email', async () => {
      const { body } = await h.http
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.local', password: 'test-password-123' })
        .expect(401);

      expect(body.error).toBe('INVALID_CREDENTIALS');
      expect(body.message).toBe('Invalid credentials');
    });
  });

  describe('protected routes', () => {
    it('rejects a request with no token', async () => {
      await h.http.get('/api/v1/accounts').expect(401);
    });

    it('rejects a malformed token', async () => {
      await h.http
        .get('/api/v1/accounts')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('rejects a token with the wrong scheme', async () => {
      const user = await h.registerUser();
      await h.http
        .get('/api/v1/accounts')
        .set('Authorization', `Basic ${user.token}`)
        .expect(401);
    });

    it('returns the current user and their accounts', async () => {
      const user = await h.registerUser('me@test.local');
      const { body } = await h.http
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(body.email).toBe('me@test.local');
      expect(body.role).toBe('USER');
      expect(body.accounts).toHaveLength(1);
    });
  });

  describe('ownership', () => {
    it('lists only your own accounts', async () => {
      const alice = await h.registerUser();
      await h.registerUser();

      const { body } = await h.http
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${alice.token}`)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(alice.accountId);
    });

    // 404 rather than 403: a 403 would confirm the account exists.
    it('returns 404, not 403, for another user account', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();

      const { body } = await h.http
        .get(`/api/v1/accounts/${alice.accountId}`)
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(404);

      expect(body.error).toBe('ACCOUNT_NOT_FOUND');
    });

    it('hides another user balance behind the same 404', async () => {
      const alice = await h.registerUser();
      const bob = await h.registerUser();
      await h.http
        .get(`/api/v1/accounts/${alice.accountId}/balance`)
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(404);
    });

    it('lets an admin see every account', async () => {
      const alice = await h.registerUser();
      const operator = await h.registerUser();
      const adminToken = await h.makeAdmin(operator);

      const { body } = await h.http
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const numbers = body.map(
        (a: { accountNumber: string }) => a.accountNumber,
      );
      expect(numbers).toContain(alice.accountNumber);
      expect(numbers).toContain('0000000000');
    });

    it('rejects a non-uuid account id with 400', async () => {
      const user = await h.registerUser();
      await h.http
        .get('/api/v1/accounts/not-a-uuid')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(400);
    });
  });
});
