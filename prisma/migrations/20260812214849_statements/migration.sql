-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "statements" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "status" "StatementStatus" NOT NULL DEFAULT 'PENDING',
    "openingBalance" BIGINT,
    "closingBalance" BIGINT,
    "entryCount" INTEGER,
    "content" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "statements_accountId_period_key" ON "statements"("accountId", "period");

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
