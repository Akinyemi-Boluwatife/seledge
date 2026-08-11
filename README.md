# LedgerCore

A double-entry wallet and ledger API. Users hold balances, transfer to each
other, deposit and withdraw. Balances are derived from an append-only ledger
rather than stored in a mutable column.

Stack: NestJS · Prisma 7 · PostgreSQL 18 · JWT · class-validator · Docker

## Running it

Start Postgres and Redis:

```bash
docker compose up -d
```

Copy `.env.example` to `.env` and fill it in, then:

```bash
npx prisma migrate dev
npx prisma db seed
npm run start:dev
```

API at `http://localhost:3000/api/v1`, docs at `http://localhost:3000/docs`.

Seeded logins, all with password `password123`:

| Email | Role |
|---|---|
| `alice@ledgercore.test` | user, ₦50,000 opening balance |
| `bob@ledgercore.test` | user, ₦50,000 opening balance |
| `admin@ledgercore.test` | admin |

## Core rules

- **Money is integer minor units (kobo).** Never floats. Stored as `BigInt`,
  serialized as strings over HTTP so precision survives JavaScript clients.
- **The ledger is the source of truth.** `balance = SUM(credits) − SUM(debits)`
  over an account's entries. `accounts.cachedBalance` is a cache maintained in
  the same database transaction; `GET /accounts/:id/balance` returns both plus
  an `inSync` flag.
- **Ledger entries are append-only.** No updates, no deletes. Corrections are
  new reversing transactions.
- **Every transaction nets to zero.** Enforced in `LedgerService` before any
  write. Deposits and withdrawals balance against a seeded `SYSTEM_CASH`
  account, which is expected to run negative.

## Concurrency: why pessimistic locking

Transfers take `SELECT ... FOR UPDATE` row locks on both accounts inside the
transaction, before reading balances.

**Why pessimistic over optimistic:** a transfer is short, touches exactly two
rows, and conflicts on a hot account are common rather than rare. Optimistic
locking would mean version columns, retry loops, and a client-visible failure
mode that has to be explained. `FOR UPDATE` puts the correctness in one place —
the balance you read is the balance you write against — and it is far easier to
reason about, which matters most for the code that must not be wrong.

**Why `ORDER BY id`:** simultaneous A→B and B→A transfers would otherwise lock
the two rows in opposite orders and deadlock. Locking in a consistent order
means one waits for the other. Verified with 50 opposing transfers across 25
rounds: zero deadlocks.

**Failure mode:** transfers from the same account serialize. Under heavy load on
one account, throughput drops and requests queue. Correctness holds; latency
does not. Mitigations if it ever mattered would be sharding balances or moving
to an append-only design with asynchronous balance derivation — both out of
scope here.

**Defence in depth:** a `CHECK` constraint rejects any user account balance
below zero. Before locking existed, 10 parallel ₦300 transfers against a ₦1,000
balance produced 3 successes and 7 constraint violations surfacing as HTTP 500 —
the money was correct, but only because the database caught what the application
missed. With locking, the same test gives 3 × 201 and 7 × 422
`INSUFFICIENT_FUNDS`.

## Idempotency

`POST /transfers` requires an `Idempotency-Key` header. Keys are scoped per user
and expire after 24 hours.

- Retrying with the same key replays the original response; the transfer applies
  once.
- Same key with a different body → `409 IDEMPOTENCY_CONFLICT`.
- A retry arriving while the original is in flight → `409 REQUEST_IN_PROGRESS`.
- If the handler fails, the key is released so a retry can proceed.

The claim is committed before the transfer runs and deliberately sits outside
the transfer's transaction — sharing it would let a rollback erase the claim and
allow a double-apply.

## Errors

Every error returns the same envelope:

```json
{
  "statusCode": 422,
  "error": "INSUFFICIENT_FUNDS",
  "message": "Insufficient funds: balance 150000, attempted 200000",
  "timestamp": "2026-08-11T10:00:00.000Z",
  "path": "/api/v1/transfers"
}
```

`error` is a stable machine-readable code; `message` is for humans. Unhandled
exceptions become `500 INTERNAL_ERROR` with no stack trace.

## Resolved decisions

| Decision | Choice |
|---|---|
| Locking strategy | Pessimistic (`FOR UPDATE`) |
| Amount type | `BigInt`, minor units, string-serialized |
| Non-owned account | `404`, not `403` — avoids id enumeration |
| Refresh tokens | Stretch goal, not implemented |
