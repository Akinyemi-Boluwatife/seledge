import { Injectable } from '@nestjs/common';
import { PaginatedDto, paginate } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ActorType } from '../generated/prisma/enums';
import { AuditLogResponseDto, AuditQueryDto } from './dto/audit-query.dto';

export const AuditAction = {
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
  DEPOSIT_COMPLETED: 'DEPOSIT_COMPLETED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  ACCOUNT_FROZEN: 'ACCOUNT_FROZEN',
  ACCOUNT_UNFROZEN: 'ACCOUNT_UNFROZEN',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Takes the caller's transaction client so the audit row commits with the
  // action it describes, or not at all.
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        payload: (entry.payload ?? {}) as object,
      },
    });
  }

  async search(
    query: AuditQueryDto,
  ): Promise<PaginatedDto<AuditLogResponseDto>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(rows.map(AuditLogResponseDto.from), total, query);
  }
}
