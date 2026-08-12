import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { AccountType } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';

export const SYSTEM_CASH_NUMBER = '0000000000';

export interface TestUser {
  token: string;
  userId: string;
  accountId: string;
  accountNumber: string;
  email: string;
}

export class Harness {
  app!: INestApplication;
  prisma!: PrismaService;

  get http() {
    return request(this.app.getHttpServer());
  }

  async start(): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    this.app = moduleRef.createNestApplication({ rawBody: true });
    this.app.setGlobalPrefix('api/v1');
    this.app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    this.app.useGlobalFilters(new GlobalExceptionFilter());
    await this.app.init();
    await this.app.listen(0);

    this.prisma = this.app.get(PrismaService);
  }

  async stop(): Promise<void> {
    await this.app?.close();
  }

  // TRUNCATE rather than DELETE: the append-only triggers on ledger_entries
  // and audit_logs reject DELETE outright.
  async reset(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      TRUNCATE TABLE statements, reconciliation_reports, webhook_events,
        audit_logs, idempotency_keys, ledger_entries, transactions,
        accounts, users
      RESTART IDENTITY CASCADE
    `);
    await this.prisma.account.create({
      data: {
        accountNumber: SYSTEM_CASH_NUMBER,
        type: AccountType.SYSTEM,
        currency: 'NGN',
      },
    });
  }

  async registerUser(email?: string): Promise<TestUser> {
    const address = email ?? `user-${randomSuffix()}@test.local`;
    const { body } = await this.http
      .post('/api/v1/auth/register')
      .send({ email: address, password: 'test-password-123' })
      .expect(201);

    const accounts = await this.http
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    return {
      token: body.accessToken,
      userId: body.userId,
      accountId: accounts.body[0].id,
      accountNumber: accounts.body[0].accountNumber,
      email: address,
    };
  }

  async makeAdmin(user: TestUser): Promise<string> {
    await this.prisma.user.update({
      where: { id: user.userId },
      data: { role: 'ADMIN' },
    });
    const { body } = await this.http
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'test-password-123' })
      .expect(200);
    return body.accessToken;
  }

  // Funds an account through the real deposit + webhook path, so test money
  // enters the ledger the same way production money does.
  async fundAccount(user: TestUser, amount: number): Promise<void> {
    const { body } = await this.http
      .post('/api/v1/deposits')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ accountId: user.accountId, amount })
      .expect(201);

    const payload = {
      event: 'charge.success',
      id: `evt-${randomSuffix()}`,
      data: { reference: body.reference, amount },
    };
    await this.sendWebhook(payload).expect(200);
  }

  sendWebhook(payload: unknown, signature?: string) {
    const raw = JSON.stringify(payload);
    return this.http
      .post('/api/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature ?? signPayload(raw))
      .send(raw);
  }

  async balanceOf(accountId: string): Promise<bigint> {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    return account.cachedBalance;
  }

  async ledgerSumOf(accountId: string): Promise<bigint> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId },
    });
    return entries.reduce(
      (sum, e) => (e.direction === 'CREDIT' ? sum + e.amount : sum - e.amount),
      0n,
    );
  }
}

export function signPayload(raw: string): string {
  return createHmac('sha512', process.env.WEBHOOK_SECRET!)
    .update(raw)
    .digest('hex');
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function idempotencyKey(): string {
  return `test-${randomSuffix()}`;
}
