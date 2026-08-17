import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AccountType,
  LedgerDirection,
  Role,
  TransactionStatus,
  TransactionType,
} from '../src/generated/prisma/enums';
import { LedgerService } from '../src/ledger/ledger.service';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'password123';
const SYSTEM_CASH_NUMBER = '0000000000';
const OPENING_BALANCE = 5_000_000n;

const ledger = new LedgerService();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const testUsers = [
  { email: 'alice@seledge.test', accountNumber: '1000000001' },
  { email: 'bob@seledge.test', accountNumber: '1000000002' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const passwordHash = await argon2.hash(SEED_PASSWORD);

  await prisma.account.upsert({
    where: { accountNumber: SYSTEM_CASH_NUMBER },
    update: {},
    create: {
      accountNumber: SYSTEM_CASH_NUMBER,
      type: AccountType.SYSTEM,
      currency: 'NGN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@seledge.test' },
    update: {},
    create: {
      email: 'admin@seledge.test',
      passwordHash,
      role: Role.ADMIN,
    },
  });

  for (const { email, accountNumber } of testUsers) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, role: Role.USER },
    });

    await prisma.account.upsert({
      where: { accountNumber },
      update: {},
      create: {
        accountNumber,
        userId: user.id,
        type: AccountType.USER,
        currency: 'NGN',
      },
    });
  }

  await fundTestAccounts();

  const [users, accounts] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
  ]);
  console.log(`seeded: ${users} users, ${accounts} accounts`);
  console.log(`login password for all seeded users: ${SEED_PASSWORD}`);
}

async function fundTestAccounts() {
  const systemCash = await prisma.account.findUniqueOrThrow({
    where: { accountNumber: SYSTEM_CASH_NUMBER },
  });

  for (const { accountNumber } of testUsers) {
    const reference = `SEED-OPENING-${accountNumber}`;
    const funded = await prisma.transaction.findUnique({ where: { reference } });
    if (funded) continue;

    const account = await prisma.account.findUniqueOrThrow({
      where: { accountNumber },
    });

    await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
          reference,
          amount: OPENING_BALANCE,
          currency: account.currency,
          narration: 'Seed opening balance',
        },
      });

      await ledger.post(tx, transaction.id, [
        {
          accountId: systemCash.id,
          direction: LedgerDirection.DEBIT,
          amount: OPENING_BALANCE,
        },
        {
          accountId: account.id,
          direction: LedgerDirection.CREDIT,
          amount: OPENING_BALANCE,
        },
      ]);
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
