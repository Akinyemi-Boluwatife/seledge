import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class WebhookEventDataDto {
  @ApiProperty({ example: 'DEP-20260811-A1B2C3D4E5' })
  @IsString()
  reference!: string;

  @ApiProperty({ description: 'Amount paid, in minor units' })
  @IsInt()
  @Min(1)
  amount!: number;
}

export class PaymentWebhookDto {
  @ApiProperty({ example: 'charge.success' })
  @IsString()
  event!: string;

  @ApiProperty({ description: 'Provider event id, used for deduplication' })
  @IsString()
  id!: string;

  @ApiProperty({ type: WebhookEventDataDto })
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookEventDataDto)
  data!: WebhookEventDataDto;
}
