import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { AuthenticatedRequest } from '../auth/types/authenticated-user';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.trim() === '') {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!request.user) {
      throw new BadRequestException('Idempotency requires an authenticated user');
    }

    const userId = request.user.userId;
    const hash = this.idempotency.hashRequest(
      request.method,
      request.path,
      request.body,
    );

    const replay = await this.idempotency.claim(userId, key, hash);
    if (replay) {
      response.status(replay.status);
      return of(replay.body);
    }

    return next.handle().pipe(
      tap((body) =>
        this.idempotency.complete(userId, key, response.statusCode, body),
      ),
      catchError((error: unknown) =>
        from(this.idempotency.release(userId, key)).pipe(
          switchMap(() => throwError(() => error)),
        ),
      ),
    );
  }
}
