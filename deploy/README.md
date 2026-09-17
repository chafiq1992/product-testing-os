# Deploying product-testing-os on the Netcup box

The migration brief is [PORT-TO-NETCUP.prompt.md](PORT-TO-NETCUP.prompt.md). This
file is the operational summary: what lives where, and what to run.

**Cut over on 2026-09-16.** This box is now the live deployment, serving
`https://pt.chattbase.site` against its own Postgres. Cloud Run
(`product-testing-os-4`) is sealed at `--ingress=internal` with its scheduler job
paused, kept only as a rollback. Supabase still holds the pre-cutover data and
has not been touched since.

## Layout

| Where | What |
|---|---|
| `159.195.204.91`, `/opt/pto/` | this app's directory, `deploy` user |
| `/opt/pto/compose.yaml` | from [compose.yaml](compose.yaml) |
| `/opt/pto/deploy.sh` | from [deploy.sh](deploy.sh) |
| `/opt/pto/.env` | Compose substitution only — `IMAGE_TAG`, `REDIS_PASSWORD`, `WORKER_LOOPS`. Generated on the box; the Redis password has never left it |
| `/opt/pto/app.env` | runtime environment, `chmod 600`, written by [pull-env.sh](pull-env.sh) |
| `/opt/pto/src/` | the build context, shipped by [push-source.sh](push-source.sh) |
| `/opt/pto/pto.caddy` | source of the reverse-proxy config, from [pto.caddy](pto.caddy) |
| `/opt/edge/sites/pto.caddy` | installed and live, serving `pt.chattbase.site` |
| `/opt/pto/.dbpassword` | local Postgres role password, generated on the box |
| `/opt/pto/cutover-*.sh` | database cutover, prepared but not run — see below |

Shared, not ours: `/opt/edge/` (Caddy), `/opt/redis/` (shared Redis — this app
does **not** use it), `/opt/apex/`, `/opt/whatsapp/`, `/opt/collector/`,
`/opt/postgres/`. Do not modify any of them.

## Routine release

```bash
./deploy/push-source.sh deploy@159.195.204.91
ssh deploy@159.195.204.91 /opt/pto/deploy.sh <tag>
```

`deploy.sh` builds the image, runs a **fail-closed database preflight** in a
throwaway container, then `docker compose up -d --wait`. The healthcheck parses
`/health`'s body rather than its status code, so a container that cannot reach
Postgres never replaces a working one.

To re-pull configuration after someone changes it on Cloud Run:

```bash
./deploy/pull-env.sh deploy@159.195.204.91 --dry-run   # names + lengths only
./deploy/pull-env.sh deploy@159.195.204.91
```

## The one switch that matters

`WORKER_LOOPS` in `/opt/pto/.env`. It gates both sources of background work:

- the wholesale batch recovery loop, which creates Shopify products
- `/api/social-agent/scheduler/tick`, which publishes to Meta and Instagram

Neither holds a lock, so **exactly one deployment may have it enabled**. It is
now `1` here, and Cloud Run is sealed off. The `web` service pins it to `0`
regardless of `.env`; only `worker` honours the variable — which is why the
scheduler tick runs on the box via cron against the worker, not through Caddy
(`web` answers that endpoint with 503 by design).

```bash
*/5 * * * * /opt/pto/social-agent-tick.sh     # replaces the Cloud Scheduler job
journalctl -t pto-social-agent --since -1h    # what it did
```

**Never set `WORKER_LOOPS=1` on `web`, and never scale `worker` past one.**

`WORKER_LOOPS` unset means *enabled* — that is deliberate, so Cloud Run (which
does not set it) keeps behaving exactly as it does today. See
[backend/app/worker_loops.py](../backend/app/worker_loops.py).

Check where it actually stands, on either deployment:

```bash
curl -s https://<host>/health | python -m json.tool
```

## DNS — done

`pt.chattbase.site` → `159.195.204.91` (A record, confirmed at the authoritative
nameservers `dns{1,2}.registrar-servers.com`). `pto.caddy` is installed in
`/opt/edge/sites/` and Caddy holds a Let's Encrypt certificate for the name,
obtained via `tls-alpn-01`.

Validated over HTTPS on 2026-09-16:

| Check | Result |
|---|---|
| `http://` → `https://` | 308 |
| `GET /` | 200, Next.js export, valid chain |
| `GET /health` | `healthy`, `postgresql`, redis subscribed |
| `POST /api/social-agent/scheduler/tick` with a valid key | **503** — the gate holds on the real caller path |
| `GET /api/chat/ws/...` upgrade | 101 Switching Protocols |
| `/_next/static/*` | `public, max-age=31536000, immutable` |
| HSTS / nosniff / Referrer-Policy / X-Frame-Options | all present, `Server` stripped |

Shopify OAuth fails on this hostname until its callback URL is registered in all
four Shopify apps. That is expected — `_abs_base_url` derives the callback from
the host you are visiting, not from `BASE_URL`.

**Cloud Run is still the live deployment.** This hostname is for validation only
until cutover.

### If the Caddy config ever needs changing

Validate in a throwaway container first — a syntax error fails the reload for
`apex`, `whatsapp` and `collector` too:

```bash
docker run --rm -v /opt/edge/Caddyfile:/etc/caddy/Caddyfile:ro -v /opt/edge/sites:/etc/caddy/sites:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

## Database — migrated 2026-09-16

The app runs on the box's Postgres: `postgresql://pto@postgres-shared:5432/pto`.
Supabase (`db.ronmjaiqktkdrjsqzchp`) holds the pre-cutover snapshot and has
received no writes since — it is the rollback, so **do not delete that project**
until the box has been trusted for a while and `/opt/postgres/backup.sh` covers
the new database.

Migration run at 20:48-20:50 UTC: dump 28s (168 MB), restore 17s, all 15 tables
row-for-row identical, 592 MB restored, ownership transferred to `pto`.

On the box:

| | |
|---|---|
| role `pto`, database `pto` | live, 15 tables, owned by `pto` |
| password | `/opt/pto/.dbpassword`, generated on the box, never left it |
| `pgnet` | already attached to `web` and `worker`, so the switch is a one-line change |
| [cutover-migrate-db.sh](cutover-migrate-db.sh) | dumps Supabase `public` → restores into `pto` |
| [cutover-switch-db.sh](cutover-switch-db.sh) | rewrites `DATABASE_URL`, restarts health-gated |

Also run at cutover: [cutover-rewrite-urls.sh](cutover-rewrite-urls.sh) `--apply`,
which repointed 32 rows holding absolute `run.app/uploads/...` URLs at
`https://pt.chattbase.site`. The files themselves were never on Cloud Run's disk
in any durable sense — they live in Postgres as `upload_blob:` rows — so only the
hostname needed changing. `--revert` is an exact inverse.

### Rollback

```bash
# app back onto Supabase (loses anything written to the box since the switch)
cp -a /opt/pto/app.env.pre-dbswitch.<stamp> /opt/pto/app.env
cd /opt/pto && docker compose up -d --wait
/opt/pto/cutover-rewrite-urls.sh --revert

# Cloud Run back in service
gcloud run services update product-testing-os-4 --region europe-west1   --project sinuous-bedrock-347205 --ingress=all
gcloud scheduler jobs resume product-testing-os-social-agent   --location europe-west1 --project sinuous-bedrock-347205
crontab -e   # remove the social-agent-tick line first, or both will publish
```

## Not done, and owner-approved only

Choosing to cut over, moving `BASE_URL` to the new hostname, registering the new
Shopify callback URLs, pausing the Cloud Scheduler job
`product-testing-os-social-agent`, and flipping `WORKER_LOOPS` to `1` here.
Section 5 of the brief has the required ordering.
