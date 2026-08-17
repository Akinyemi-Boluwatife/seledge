# Deploying Seledge for free

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

3. Keep it for step 3. The SSL parameter must stay in the string.

Change `sslmode=require` to `sslmode=verify-full`. The Postgres driver currently
treats them as the same thing but warns on every boot, because a future major
version will make `require` weaker:

```
SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca'
are treated as aliases for 'verify-full'.
```

`verify-full` is the behaviour you already have; naming it explicitly keeps it
after the driver changes.

Use the pooled endpoint, not the direct one — Render restarts the container on
every deploy, and pooling avoids exhausting connection slots.

## 2. Redis on Upstash

1. Sign up at [upstash.com](https://upstash.com) and create a Redis database.
2. Take the **TCP** endpoint, not the HTTPS/REST one. Upstash shows it as:

   ```
   rediss://default:PASSWORD@your-db.upstash.io:6379
   ```

   Note the double `s` in `rediss://` — that means TLS. From it you need the
   **host**, **port** (6379) and **password**.

The REST endpoint only works with Upstash's own SDK and does not support the
blocking commands BullMQ relies on. It will not work here.

3. **Turn eviction off.** In the database's configuration, set the eviction
   policy to `noeviction`. Upstash defaults to evicting keys under memory
   pressure, which for BullMQ means silently discarding queued jobs. The app
   logs a loud warning on every connection until this is changed:

   ```
   IMPORTANT! Eviction policy is optimistic-volatile. It should be "noeviction"
   ```

Check Upstash's current BullMQ guide before relying on this. Blocking commands
have documented caveats on their free tier. If it misbehaves, statements are the
only feature affected — everything else works without Redis.

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
   | Auto-Deploy | **Off** |

   Auto-Deploy is off on purpose. Deploys are triggered from CI only after
   tests pass — see step 4. Left on, Render would ship every push the moment it
   lands, including broken ones.

   Free tier has no pre-deploy command, so migrations also run from CI.

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

   `REDIS_TLS=true` is required for Upstash. Without it the connection is
   refused.

   Generate each secret separately:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   Never reuse the values from your local `.env`.

4. Copy the **Deploy Hook** URL from Settings → Deploy Hook. You need it in
   step 4.
5. Deploy once manually to confirm the build works. First build takes a few
   minutes.

Boot will fail loudly on any missing or malformed variable — that is the env
validation doing its job, and the message names the offending variable.

The first deploy will fail to serve traffic until migrations have run, which is
step 4. Alternatively, run them once from your machine:

```bash
DATABASE_URL="<neon string>" npx prisma migrate deploy
```

## 4. Automated deploys, gated on tests

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs after the CI
workflow succeeds on `master`:

```
push → CI: lint, typecheck, 153 tests
         → migrations applied to Neon
         → Render deploy hook fired
```

Migrations run before the new code goes live rather than racing it. Nothing
deploys if a test fails.

Add two repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `PRODUCTION_DATABASE_URL` | the Neon connection string from step 1 |
| `RENDER_DEPLOY_HOOK_URL` | the deploy hook from step 3 |

The workflow checks out the exact commit CI tested, not the branch tip, so a
push landing mid-run cannot deploy untested code.

**Why not run migrations in the container?** The runtime image deliberately
omits the Prisma CLI — including it costs about 480MB for something that runs
once. CI has it already.

## 5. Keep it awake

Render free instances sleep after ~15 minutes idle. A sleeping instance runs no
scheduled jobs, so nightly reconciliation and hourly cleanup would never fire.

1. Sign up at [uptimerobot.com](https://uptimerobot.com).
2. New monitor → **HTTP(s)** → `https://<your-app>.onrender.com/health`.
3. Interval: 5 minutes (the free minimum; the 15-minute sleep gives margin).

**Point it at `/health`, not the bare domain.** Monitoring
`https://<your-app>.onrender.com` on its own reports the service as *down*: the
root only redirects to the docs, and any non-2xx counts as a failure.

`/health` also checks the database, so the monitor doubles as real alerting
rather than just a keep-alive.

**Budget note:** Render gives ~750 free instance-hours per month across the whole
account. One always-on service uses ~730. A second free service will push you
over and both get suspended.

## 6. Verify

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

Docs at `https://<your-app>.onrender.com/docs`, and the root redirects there,
so the bare URL is safe to share.

## 7. Optional: seed demo data

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
| Migrations | `migrate` service, or `prisma migrate dev` | CI, after tests pass |
| Config | `.env` | Render environment variables |
| Scheduled jobs | Always running | Only while the instance is awake |

Render runs exactly one service from your Dockerfile. The `postgres`, `redis`
and `migrate` services in `docker-compose.yml` exist for local development only.

## Troubleshooting

**Boot fails with `Invalid environment configuration`** — a variable is missing
or malformed. The error names it.

**`Can't reach database server`** — check `sslmode=require` survived the paste
into Render, and that you used the pooled Neon endpoint.

**Redis connection errors** — `REDIS_TLS=true` is required for Upstash, and you
must use the TCP endpoint rather than the REST/HTTPS one.

**Deploy workflow never runs** — it only triggers on a *successful* CI run on
`master`. Check the CI run went green first.

**First request takes ~50 seconds** — the instance was asleep. Confirm the
UptimeRobot monitor is running and pointed at the right URL.

**UptimeRobot reports the service down while it is clearly up** — the monitor is
pointed at the bare domain instead of `/health`.

**`Eviction policy is optimistic-volatile`** — set Upstash eviction to
`noeviction`, otherwise queued jobs can be dropped under memory pressure.

**`SSL modes ... are treated as aliases for 'verify-full'`** — change
`sslmode=require` to `sslmode=verify-full` in `DATABASE_URL`.
