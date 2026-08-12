import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { DepositsModule } from './deposits/deposits.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TransfersModule } from './transfers/transfers.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
    HealthModule,
    AccountsModule,
    AuthModule,
    TransfersModule,
    DepositsModule,
    WithdrawalsModule,
    JobsModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
