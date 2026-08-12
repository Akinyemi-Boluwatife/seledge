import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ActorType } from '../../generated/prisma/enums';
import { AuditLogModel } from '../../generated/prisma/models';

export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ActorType })
  @IsOptional()
  @IsEnum(ActorType)
  actorType?: ActorType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'TRANSFER_COMPLETED' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ example: 'transaction' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class AuditLogResponseDto {
  id!: string;

  @ApiProperty({ enum: ActorType })
  actorType!: ActorType;

  actorId!: string | null;
  action!: string;
  entityType!: string;
  entityId!: string;

  @ApiProperty({ type: Object })
  payload!: unknown;

  createdAt!: Date;

  static from(log: AuditLogModel): AuditLogResponseDto {
    return {
      id: log.id,
      actorType: log.actorType,
      actorId: log.actorId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      payload: log.payload,
      createdAt: log.createdAt,
    };
  }
}
