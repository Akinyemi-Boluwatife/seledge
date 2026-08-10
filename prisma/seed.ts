import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { AccountType, Role } from '../src/generated/prisma/enums';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'password123';
const SYSTEM_CASH_NUMBER = '0000000000';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const testUsers = [
  { email: 'alice@ledgercore.test', accountNumber: '1000000001' },
  { email: 'bob@ledgercore.test', accountNumber: '1000000002' },
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
    where: { email: 'admin@ledgercore.test' },
    update: {},
    create: {
      email: 'admin@ledgercore.test',
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

  const [users, accounts] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
  ]);
  console.log(`seeded: ${users} users, ${accounts} accounts`);
  console.log(`login password for all seeded users: ${SEED_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
