import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  IdempotencyConflictException,
  IdempotencyInProgressException,
} from '../common/exceptions/domain.exception';
import { IdempotencyStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = 'P2002';

export interface ReplayedResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hashRequest(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(`${method}:${path}:${JSON.stringify(body ?? null)}`)
      .digest('hex');
  }

  async claim(
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<ReplayedResponse | null> {
    try {
      await this.insertClaim(userId, key, requestHash);
      return null;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({
      where: { userId_key: { userId, key } },
    });

    if (existing.expiresAt <= new Date()) {
      await this.prisma.idempotencyKey.delete({
        where: { userId_key: { userId, key } },
      });
      await this.insertClaim(userId, key, requestHash);
      return null;
    }

    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictException();
    }
    if (existing.status === IdempotencyStatus.PROCESSING) {
      throw new IdempotencyInProgressException();
    }

    return {
      status: existing.responseStatus ?? 200,
      body: existing.responseBody,
    };
  }

  async complete(
    userId: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { userId_key: { userId, key } },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseStatus: status,
        responseBody: body as object,
      },
    });
  }

  // Drop the claim when the handler fails, so a retry is not locked out for 24h.
  async release(userId: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey
      .delete({ where: { userId_key: { userId, key } } })
      .catch(() => undefined);
  }

  private insertClaim(userId: string, key: string, requestHash: string) {
    return this.prisma.idempotencyKey.create({
      data: {
        userId,
        key,
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        expiresAt: new Date(Date.now() + KEY_TTL_MS),
      },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
