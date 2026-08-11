import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MAX_TRANSFER_MINOR_UNITS = 1_000_000_000;

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceAccountId!: string;

  @ApiProperty({ example: '1000000002' })
  @Matches(/^\d{10}$/, { message: 'destinationAccountNumber must be 10 digits' })
  destinationAccountNumber!: string;

  @ApiProperty({
    description: 'Amount in minor units (kobo). 150000 = ₦1,500.00',
    example: 150000,
    maximum: MAX_TRANSFER_MINOR_UNITS,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_TRANSFER_MINOR_UNITS)
  amount!: number;

  @ApiPropertyOptional({ maxLength: 140 })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  narration?: string;
}
