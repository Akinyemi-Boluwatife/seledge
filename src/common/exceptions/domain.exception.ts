import { HttpException, HttpStatus } from '@nestjs/common';

export class DomainException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 'Invalid credentials', HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidWebhookSignatureException extends DomainException {
  constructor() {
    super('INVALID_SIGNATURE', 'Invalid signature', HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenRoleException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'Insufficient role', HttpStatus.FORBIDDEN);
  }
}

export class AccountFrozenException extends DomainException {
  constructor(accountNumber: string) {
    super(
      'ACCOUNT_FROZEN',
      `Account ${accountNumber} is frozen`,
      HttpStatus.FORBIDDEN,
    );
  }
}

export class AccountNotFoundException extends DomainException {
  constructor(identifier: string) {
    super(
      'ACCOUNT_NOT_FOUND',
      `Account ${identifier} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class TransactionNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'TRANSACTION_NOT_FOUND',
      `Transaction ${id} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class DuplicateEmailException extends DomainException {
  constructor() {
    super('EMAIL_EXISTS', 'Email already registered', HttpStatus.CONFLICT);
  }
}

export class InsufficientFundsException extends DomainException {
  constructor(balance: bigint, attempted: bigint) {
    super(
      'INSUFFICIENT_FUNDS',
      `Insufficient funds: balance ${balance}, attempted ${attempted}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class SelfTransferException extends DomainException {
  constructor() {
    super(
      'SELF_TRANSFER',
      'Source and destination must differ',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class CurrencyMismatchException extends DomainException {
  constructor(source: string, destination: string) {
    super(
      'CURRENCY_MISMATCH',
      `Cannot transfer between ${source} and ${destination} accounts`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class IdempotencyConflictException extends DomainException {
  constructor() {
    super(
      'IDEMPOTENCY_CONFLICT',
      'This Idempotency-Key was already used with a different request body',
      HttpStatus.CONFLICT,
    );
  }
}

export class IdempotencyInProgressException extends DomainException {
  constructor() {
    super(
      'REQUEST_IN_PROGRESS',
      'An identical request is still being processed, retry shortly',
      HttpStatus.CONFLICT,
    );
  }
}

export class UnbalancedLedgerException extends DomainException {
  constructor(drift: bigint) {
    super(
      'UNBALANCED_LEDGER',
      `Ledger entries do not net to zero (drift ${drift})`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
