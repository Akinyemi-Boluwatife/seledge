# Deploying LedgerCore for free

Three providers, because no single free tier gives all three pieces without a
catch. Roughly 30 minutes end to end.

| Piece | Provider | Free tier catch |
|---|---|---|
| App | Render | Sleeps after ~15 min idle (solved in step 4) |
| Postgres | Neon | Sleeps when idle, wakes automatically |
| Redis | Upstash | Request-count limit |

**Do not use Render's own free Postgres.** It is deleted after 30 days, and it
would take the ledger with it.

---

## 1. Postgres on Neon

1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. Copy the **pooled** connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```

3. Keep it for step 3. `sslmode=require` must stay in the string.

Use the pooled endpoint, not the direct one — Render restarts the container on
every deploy, and pooling avoids exhausting connection slots.

## 2. Redis on Upstash

1. Sign up at [upstash.com](https://upstash.com) and create a Redis database.
2. From the details page, note the **endpoint host**, **port** (usually 6379)
   and **password**.

Check Upstash's current BullMQ guide before relying on this. BullMQ uses Redis
blocking commands, which have documented caveats on Upstash. If it misbehaves,
statements are the only feature affected — everything else works without Redis.

## 3. App on Render

1. Sign up at [render.com](https://render.com) → **New** → **Web Service** →
   connect the GitHub repo.
2. Settings:

   | Field | Value |
   |---|---|
   | Language / Runtime | **Docker** |
   | Dockerfile path | `./Dockerfile` |
   | Instance type | Free |
   | Health check path | `/health` |
   | Pre-deploy command | `npx prisma migrate deploy` |

   The pre-deploy command is how migrations run in production — the `migrate`
   service in `docker-compose.yml` is local-only.

3. Environment variables:

   ```
   NODE_ENV=production
   PORT=3000
   DATABASE_URL=<the Neon pooled string from step 1>
   JWT_SECRET=<generate below>
   JWT_EXPIRES_IN_SECONDS=900
   WEBHOOK_SECRET=<generate below>
   REDIS_HOST=<Upstash endpoint>
   REDIS_PORT=6379
   REDIS_DB=0
   REDIS_PASSWORD=<Upstash password>
   REDIS_TLS=true
   ```

   Generate each secret separately:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   Never reuse the values from your local `.env`.

4. Deploy. First build takes a few minutes.

Boot will fail loudly on any missing or malformed variable — that is the env
validation doing its job, and the message names the offending variable.

## 4. Keep it awake

Render free instances sleep after ~15 minutes idle. A sleeping instance runs no
scheduled jobs, so nightly reconciliation and hourly cleanup would never fire.

1. Sign up at [uptimerobot.com](https://uptimerobot.com).
2. New monitor → **HTTP(s)** → `https://<your-app>.onrender.com/health`.
3. Interval: 5 minutes (the free minimum; the 15-minute sleep gives margin).

`/health` also checks the database, so the monitor doubles as real alerting
rather than just a keep-alive.

**Budget note:** Render gives ~750 free instance-hours per month across the whole
account. One always-on service uses ~730. A second free service will push you
over and both get suspended.

## 5. Verify

```bash
curl https://<your-app>.onrender.com/health
```

```json
{ "status": "ok", "database": "up", "latencyMs": 12, "uptimeSeconds": 61 }
```

Then register a user and check the docs page:

```bash
curl -X POST https://<your-app>.onrender.com/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-real-password"}'
```

Docs at `https://<your-app>.onrender.com/docs`.

## 6. Optional: seed demo data

The seed script is guarded against `NODE_ENV=production` on purpose. To create
demo accounts for a portfolio link, run it locally against the Neon database:

```bash
DATABASE_URL="<neon string>" NODE_ENV=development npx prisma db seed
```

Be deliberate about this — it writes to your live database.

---

## What differs from local

| | Local | Deployed |
|---|---|---|
| Postgres, Redis | Containers from `docker-compose.yml` | Neon and Upstash |
| Migrations | `migrate` service, or `prisma migrate dev` | Render pre-deploy command |
| Config | `.env` | Render environment variables |
| Scheduled jobs | Always running | Only while the instance is awake |

Render runs exactly one service from your Dockerfile. The `postgres`, `redis`
and `migrate` services in `docker-compose.yml` exist for local development only.

## Troubleshooting

**Boot fails with `Invalid environment configuration`** — a variable is missing
or malformed. The error names it.

**`Can't reach database server`** — check `sslmode=require` survived the paste
into Render, and that you used the pooled Neon endpoint.

**Redis connection errors** — `REDIS_TLS=true` is required for Upstash. Without
it the connection is refused.

**First request takes ~50 seconds** — the instance was asleep. Confirm the
UptimeRobot monitor is running and pointed at the right URL.
