import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { InvalidWebhookSignatureException } from '../common/exceptions/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { DepositsService } from './deposits.service';
import { PaymentWebhookDto } from './dto/webhook-event.dto';
import { isValidSignature } from './webhook-signature';

const PROVIDER = 'mockpay';
const UNIQUE_VIOLATION = 'P2002';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly deposits: DepositsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Payment provider callback, authenticated by HMAC-SHA512',
  })
  @ApiExcludeEndpoint()
  async payments(
    @Req() request: RawBodyRequest<Request>,
    @Body() dto: PaymentWebhookDto,
    @Headers('x-paystack-signature') signature?: string,
  ): Promise<{ received: true; outcome: string }> {
    const secret = this.config.getOrThrow<string>('WEBHOOK_SECRET');
    if (!isValidSignature(secret, request.rawBody, signature)) {
      throw new InvalidWebhookSignatureException();
    }

    const stored = await this.recordEvent(dto);
    if (!stored) {
      return { received: true, outcome: 'DUPLICATE_EVENT' };
    }

    const outcome = await this.deposits.applyConfirmedDeposit(
      dto.data.reference,
      BigInt(dto.data.amount),
    );

    await this.prisma.webhookEvent.update({
      where: { id: stored.id },
      data: { processedAt: new Date() },
    });

    // Always 2xx once the signature is valid: a non-2xx makes the provider
    // retry forever on events that can never succeed.
    return { received: true, outcome };
  }

  private async recordEvent(dto: PaymentWebhookDto) {
    try {
      return await this.prisma.webhookEvent.create({
        data: {
          provider: PROVIDER,
          providerEventId: dto.id,
          payload: dto as unknown as object,
          signatureValid: true,
        },
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: unknown }).code === UNIQUE_VIOLATION
      ) {
        this.logger.log(`Duplicate provider event ${dto.id} ignored`);
        return null;
      }
      throw error;
    }
  }
}
