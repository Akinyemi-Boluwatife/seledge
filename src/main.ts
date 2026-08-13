import { ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  // rawBody is required to verify webhook HMAC signatures over the exact bytes
  // received; it cannot be recovered after JSON parsing.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('LedgerCore')
    .setDescription('Double-entry wallet and ledger API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );

  // Nothing is served at the root, and a bare 404 reads as a broken deployment.
  app
    .getHttpAdapter()
    .get('/', (_req: unknown, res: Response) => res.redirect('/docs'));

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
