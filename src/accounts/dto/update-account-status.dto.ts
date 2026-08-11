import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AccountStatus } from '../../generated/prisma/enums';

const MUTABLE_STATUSES = [AccountStatus.ACTIVE, AccountStatus.FROZEN] as const;

export type MutableAccountStatus = (typeof MUTABLE_STATUSES)[number];

export class UpdateAccountStatusDto {
  @ApiProperty({ enum: MUTABLE_STATUSES })
  @IsIn(MUTABLE_STATUSES)
  status!: MutableAccountStatus;
}
