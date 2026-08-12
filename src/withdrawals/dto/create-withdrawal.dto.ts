import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MAX_WITHDRAWAL_MINOR_UNITS = 1_000_000_000;

export class CreateWithdrawalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({
    description: 'Amount in minor units (kobo)',
    example: 100000,
    maximum: MAX_WITHDRAWAL_MINOR_UNITS,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_WITHDRAWAL_MINOR_UNITS)
  amount!: number;

  @ApiPropertyOptional({ maxLength: 140 })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  narration?: string;
}
