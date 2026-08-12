import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

const MAX_DEPOSIT_MINOR_UNITS = 1_000_000_000;

export class CreateDepositDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({
    description: 'Amount in minor units (kobo)',
    example: 500000,
    maximum: MAX_DEPOSIT_MINOR_UNITS,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_DEPOSIT_MINOR_UNITS)
  amount!: number;
}

export class DepositInitiatedDto {
  @ApiProperty({ description: 'Quote this back in the provider webhook' })
  reference!: string;

  @ApiProperty()
  amount!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;
}
