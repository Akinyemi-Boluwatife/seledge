export const QUEUE = {
  STATEMENTS: 'statements',
  RECONCILIATION: 'reconciliation',
  MAINTENANCE: 'maintenance',
} as const;

export const JOB = {
  GENERATE_STATEMENT: 'generate-statement',
  RECONCILE: 'reconcile',
  CLEANUP_IDEMPOTENCY_KEYS: 'cleanup-idempotency-keys',
} as const;

export interface GenerateStatementJob {
  statementId: string;
  accountId: string;
  period: string;
}
