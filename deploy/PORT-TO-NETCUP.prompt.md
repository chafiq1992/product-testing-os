# Task: move this app from Cloud Run onto our existing Netcup box

You are working in the `product-testing-os` repo. We have already migrated our
delivery app (`delvery-app-v3`) from Google Cloud Run to a Netcup RS 2000 G12,
and the shared infrastructure on that box is **already built and serving
production traffic**. Your job is to add this app alongside it — not to build a
server.

Read this whole brief before you touch anything. Everything in sections 3 and 4
was verified against the live Cloud Run revision and this repo's source on
2026-09-16, not assumed. Each one will cost you real debugging time if you skip
it.

---

## 1. What already exists on the box — do not recreate or disturb it

| | |
|---|---|
| Host | `159.195.204.91`, Ubuntu 24.04.5 LTS, 8 dedicated cores / 15 GiB / 503 GB NVMe |
| SSH | `ssh deploy@159.195.204.91` — key already installed, passwordless sudo. Root login is disabled |
| Docker | 29.8 + Compose 5.5.1. Daemon-wide log rotation (20 MB x 5) and `live-restore` already set |
| Firewall | Netcup panel firewall allows only 22/80/443, plus ufw on the host |
| Reverse proxy | **Shared Caddy** at `/opt/edge/` (Compose project `edge`), on external network `edge` |
| Redis | **Shared Redis** at `/opt/redis/` (Compose project `redis`), on external network `redisnet`, addressed as `redis-shared:6379` |
| Existing app | `/opt/apex/` — the delivery app. **Do not modify anything under `/opt/apex/` or `/opt/edge/compose.yaml`.** |
| Possible second app | `/opt/whatsapp/` — the WhatsApp app was queued for the same migration. **Check whether it exists before you pick names or ACL entries; do not touch it if it does.** |

Your app gets `/opt/pto/` and nothing else outside it, except **one new file** in
`/opt/edge/sites/` and — if trap 3 lets you — **one new line** in
`/opt/redis/users.acl`.

First thing you do on the box: `ls /opt`, and read `/opt/edge/sites/` and
`/opt/redis/users.acl`. Confirm the table above still matches reality and report
anything that does not.

---

## 2. Conventions you must follow

- One Compose project per app, `name: pto`, in `/opt/pto/compose.yaml`.
- Two env files, kept strictly separate:
  - `/opt/pto/.env` — Compose variable substitution only (`IMAGE_TAG`,
    `WORKER_LOOPS`, ...)
  - `/opt/pto/app.env` — the application's runtime environment, `chmod 600`
- Three networks: a private `internal` for your own services, plus the external
  `edge` (so Caddy can reach you) and `redisnet` (so you can reach Redis).
- **Every service gets `mem_limit`, `cpus` and `pids_limit`.** Not optional.
  Without limits, a leak in your app gets the delivery API OOM-killed instead of
  yours. See section 4 for how to size this one — the Cloud Run number is
  misleading here.
- **Use a unique network alias, never the bare service name.** Your web service
  must expose itself on `edge` as `pto-web`. If you use `web`, it collides with
  the delivery app's service and Caddy routes to whichever answers first.
- Use `expose:`, never `ports:`, on anything but Caddy. Docker's iptables rules
  bypass ufw, so a published port is internet-reachable regardless of firewall.
- Reference the working example: `/opt/apex/compose.yaml` on the box, and the
  `deploy/` directory of the `delvery-app-v3` repo. Copy its shape.

### Adding yourself to the shared Caddy

Create `/opt/edge/sites/pto.caddy` (one file, yours alone), then:

```bash
docker compose -f /opt/edge/compose.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

That reloads without restarting the proxy or interrupting the other app. Caddy
obtains the Let's Encrypt certificate automatically once DNS points at the box.
Caddy sets `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For` by
default, which is what this app reads (trap 9) — do not strip them.

### Adding yourself to the shared Redis

Append **one line** to `/opt/redis/users.acl` (see trap 6 for its format rules),
then reload it without a restart:

```bash
cd /opt/redis && docker compose exec redis redis-cli --user admin --pass "$(cat .admin-pw)" --no-auth-warning acl load
```

**Read trap 3 first.** This app's key and channel names are not prefixed, so the
delivery app's pattern will not work unchanged for you.

---

## 3. Traps — verified against this repo and the live revision

1. **This app's Supabase host is IPv6-only.** It uses Supabase project
   `ronmjaiqktkdrjsqzchp` — a *different* project from the delivery app — over
   the direct host `db.ronmjaiqktkdrjsqzchp.supabase.co:5432`. That name has
   **no A record**; it resolves only to AAAA (`2a05:d016:571:a40c::/64`). The
   daemon is already configured for IPv6, but **your Compose network must
   declare `enable_ipv6: true`** or the container gets `Network is unreachable`
   while `psql` from the shell works fine.
   **Test this from inside a container before you build anything else.**

2. **If `DATABASE_URL` is missing, the app does not fail — it silently switches
   to SQLite.** `backend/app/db.py:12-20` falls back to
   `sqlite:////app/data/app.db` when the variable is empty, and
   `Base.metadata.create_all(engine)` then happily builds an empty schema at
   import time. You get a working-looking app with no data, writing new records
   into a file that vanishes on the next `docker compose up`.
   `backend/app/system_health.py:860` already raises a `DB_SQLITE_ON_CLOUD_RUN`
   critical for exactly this. Set `DATABASE_URL` in `app.env` and assert it is
   present and non-SQLite in `deploy.sh` before starting anything.

3. **Nothing in this app prefixes its Redis keys or channels.** The delivery app
   had `REDIS_KEY_PREFIX`; this one does not. Verified:
   - `backend/app/chat.py:264` publishes and subscribes on the literal channel
     `chat_events_v1`.
   - Celery (`backend/app/tasks.py:9`) uses stock key names — `celery`,
     `_kombu.binding.*`, `unacked`, `celery-task-meta-*`.
   An ACL of `~pto:* &pto:*` breaks both, and widening to `~*` would let this app
   read and wipe the delivery app's data. **Do not widen the ACL.** Pick one,
   deliberately, and say which you picked:
   - (a) give this app its own small Redis container inside the `pto` project on
     the private `internal` network — simplest, fully isolated, costs ~10 MB, and
     nothing here needs Redis persistence; or
   - (b) use the shared Redis with an ACL that enumerates the real patterns
     (`&chat_events_v1` plus the Celery key names) **and a dedicated logical DB**.

   (a) is the recommendation unless you find a reason the two apps must share a
   bus.

4. **Redis here is Upstash today, but nothing enforces TLS.** `CELERY_BROKER_URL`
   and `CELERY_RESULT_BACKEND` are Secret Manager values pointing at
   `rediss://...@secure-owl-10172.upstash.io`. `backend/app/config.py:30-37` only
   appends `ssl_cert_reqs=CERT_NONE` when the scheme is already `rediss://`;
   there is **no "production must use TLS" check** like the one that crash-looped
   the delivery app. A plaintext `redis://` URL on a private bridge is accepted
   as-is. Confirm that when you switch it; don't assume it.

5. **CRLF line endings break shell scripts silently — and this repo already has
   them.** `backend/worker_entrypoint.sh` and `cloudrun/deploy.sh` are both CRLF,
   and there is **no `.gitattributes`**. A `\r` on the shebang line produces
   `set: pipefail: invalid option name`, which looks like a bash version problem
   and is not. MSYS/Git-Bash tools *hide* CRs from `grep`, so the files look
   clean locally. Check on the server with `file script.sh`, and add a
   `.gitattributes` with `*.sh text eol=lf` as part of this work.

6. **Redis ACL files accept no comments and no blank lines.** Every line must
   start with `user`. Anything else aborts startup with *"should start with user
   keyword"* repeated once per line. The file must also be `chmod 640` owned
   `deploy:deploy` — at `600` the container's redis user (uid 999, gid 1000) gets
   *Permission denied*. (Only relevant if you chose option (b) in trap 3.)

7. **Never query a hostname before its DNS record exists.** The zone's SOA
   negative-cache TTL is 3601 s, so one premature lookup blinds your resolver —
   and its upstream — to that name for an hour. `resolvectl flush-caches` does
   not help once it is cached upstream. Create the record first, then look it up.

8. **The live revision has malformed variable names, and an env file cannot
   reproduce them.** Two entries have a **trailing tab in the key**:
   `"SHOPIFY_STORE_URL\t"` and `"SHOPIFY_ACCESS_TOKEN\t"`. Because the code reads
   `os.getenv("SHOPIFY_ACCESS_TOKEN")`, the Secret-Manager-backed Shopify access
   token is **not actually reaching the app today** — it is running on the
   per-store OAuth / `_IRRAKIDS` / `_IRRANOVA` credential paths instead. The
   moment you write a clean `app.env`, that token becomes live for the first time
   and the fallback store-credential path changes behaviour. Decide on purpose
   whether to set it or leave it unset, and write down which. Same class of
   problem: `SHOPIFY_SHOP_DOMAIN` is set to `https://nouralibas.myshopify.com` —
   with a scheme, where the code expects a bare domain in URL construction.

9. **One worker, WebSockets and pub/sub — and the bus was broken.** The Dockerfile runs a single uvicorn
   process with no `--workers` flag. `backend/app/chat.py` keeps the WebSocket
   connection registry **in process memory** (`manager.connections`) and fans out
   across instances over the Redis channel, connecting lazily on the first WS
   connect. **Start at one worker.** Before raising it, verify with
   `PUBSUB CHANNELS` and `INFO clients` that the subscriber count equals the
   worker count — on the delivery app only one of four workers ever subscribed,
   and clients on the others silently missed every event. Note this app reads
   `x-forwarded-proto` / `x-forwarded-host` from request headers directly rather
   than through uvicorn's proxy middleware, so the `--forwarded-allow-ips`
   problem from the other migration does not apply here.

   **Fixed during this migration:** `_subscribe_loop` used `pubsub.listen()`,
   which blocks on a raw socket read, while the client is built with
   `socket_timeout=5`. On a quiet channel every idle interval raised
   `Timeout reading from <host>`, the handler tore the subscription down and
   rebuilt it, and `PUBSUB NUMSUB chat_events_v1` read **0** with a WebSocket
   connected — anything published in a gap never reached the other workers. It
   now uses `get_message(timeout=1.0)`, which returns `None` when idle. Verified:
   NUMSUB is a stable 1 with one uvicorn worker. The same code runs on Cloud Run
   against Upstash, so this was a production defect there too, not a box
   artefact.

10. **`create_all` runs at import, against whatever `DATABASE_URL` points at.**
    Five call sites at module scope (`db.py:105,200,1170`, `chat.py:81`,
    `social_agent/models.py:57`). There is no `K_SERVICE`-style guard to lose, so
    unlike the delivery app nothing dangerous flips back on — but it does mean
    **importing the app is a schema write**. Never point a scratch or test
    container at the production `DATABASE_URL`.

---

## 4. What you must work out from this repo and the live service

**Current production, for reference.** Service `product-testing-os-4`, project
`sinuous-bedrock-347205`, region `europe-west1`, URL
`https://product-testing-os-4-z4sedtia6a-ew.a.run.app`, serving revision
`product-testing-os-4-wholesale-upload-fix-0915` at 100%. Container: 1 CPU /
512Mi, `containerConcurrency: 20`, `maxScale: 8`, no `minScale` (scales to zero),
`cpu-throttling: false`, request timeout 900 s, startup probe on `/`.

- **Secrets, and a problem with them.** Unlike the other two apps, **most of this
  app's secrets are stored as plaintext environment variables on the Cloud Run
  revision**, not in Secret Manager: `DATABASE_URL` (with the Supabase password),
  `CLARITY_API_TOKEN`, `SHOPIFY_CLIENT_SECRET*` for four stores,
  `CONFIRMATION_AUTH_SECRET`, `PRODUCT_TESTING_PASSWORD`,
  `PRODUCT_TESTING_AUTH_SECRET`, `SYSTEM_ADMIN_SECRET`, `CONFIRMATION_USERS`,
  `CONFIRMATION_ADMIN_USERS`, `SYSTEM_ADMIN_USERS`, `GOOGLE_API_KEY`. Anyone with
  `run.viewer` on the project reads all of them with one `describe`.
  Only these come from Secret Manager: `OPENAI_API_KEY`, `SHOPIFY_ACCESS_TOKEN`
  (trap 8), `META_ACCESS_TOKEN` (**pinned to version `6`, not `latest` — carry
  that exact version**), `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`,
  `GEMINI_API_KEY`, `SOCIAL_AGENT_SCHEDULER_SECRET`, `Irranova_api_key`,
  `Irranova_password`, `shopify_irrakids_secrete`,
  `SHOPIFY_CLIENT_SECRET_irrakids`.
  Pipe everything straight from `gcloud` into `app.env` over SSH so no value is
  ever printed to a terminal or written locally — see `deploy/pull-secrets.sh` in
  the `delvery-app-v3` repo for the pattern. **Carry
  `PRODUCT_TESTING_AUTH_SECRET`, `CONFIRMATION_AUTH_SECRET`,
  `SYSTEM_ADMIN_SECRET`, `OAUTH_STATE_SECRET` and `SOCIAL_AGENT_SCHEDULER_SECRET`
  verbatim** — regenerating any of them logs every user out or breaks the
  scheduler contract. Flag the plaintext ones for rotation after cutover; do not
  rotate anything during the parallel run.
- **`BASE_URL` is the single riskiest variable, and two resolvers read it with
  opposite precedence.** Verified against the source and the live service:
  - `main.py:_abs_base_url` (line 425) prefers the **forwarded request host**
    and falls back to `BASE_URL` only when the request looks local. This builds
    the Shopify OAuth `redirect_uri`, so on the new hostname the callback
    becomes `https://<newhost>/api/shopify/oauth/callback` **automatically** —
    you cannot pin it with `BASE_URL`. The live service confirms this: it
    reports `base_url` as the host it was *reached on*, not the `BASE_URL` value.
  - `ad_launcher/routes.py:_base_url` (line 32) does the reverse — **`BASE_URL`
    wins** over the request host. This stamps public HTTPS media URLs onto Meta
    ad creatives (`ad_launcher/meta.py:241`).

  During the parallel run that split works in your favour: leave `BASE_URL` on
  the `run.app` value and Meta creative URLs keep pointing at the still-live
  Cloud Run host, which serves the same DB-backed uploads, while OAuth follows
  whatever host the operator is actually on. **At cutover `BASE_URL` must move to
  the new hostname**, or newly launched ad creatives reference a host that is
  about to be deleted. All four stores currently report `connected: true` with
  **database-backed** OAuth tokens, so the new deployment inherits them and
  nobody re-auths — as long as no one re-runs the OAuth flow.

  Its current value, which you carry over unchanged for the validation window:
  `https://product-testing-os-4-985002633728.europe-west1.run.app`.
- **Duplicate and contradictory env entries.** `SHOPIFY_OAUTH_STORES` is defined
  **twice** on the live revision — first `irranova`, then `irranova,mmd,beitii`.
  Work out which one actually wins before you collapse it into one line in
  `app.env`, then set it once, deliberately.
- **There is no custom domain.** Unlike the other two apps, this service has **no
  Cloud Run domain mapping** — it is reachable only on its `run.app` URL. The
  project's mappings are `apex-maroc.com` → delivery and `wtp.chattbase.site` →
  whatsapp. So there is nothing to "re-point" at cutover: the owner has to
  **choose a hostname**, and every operator bookmark plus the external caller of
  `/api/social-agent/scheduler/tick` has to move with it.
- **Sizing. Do not copy the Cloud Run memory limit.** 512Mi × `maxScale: 8` ×
  `concurrency: 20` means up to eight containers serving 160 concurrent requests;
  one container on the box replaces all of them. Size from behaviour, not from
  the limit: the image carries ffmpeg and Pillow, several endpoints do image
  generation and long OpenAI calls, and the request timeout is 900 s. Start
  around `mem_limit: 2g` with `cpus: 2.0`, then watch `docker stats` under real
  load. The box has ~14 GiB free.
- **Uploads are not on a disk you can copy, and only HALF of them are in the
  database.** `UPLOADS_DIR` defaults to `/app/uploads` and **no GCS volume is
  mounted** on the revision — the directory is ephemeral today. The database
  fallback in `main.py:496-540` (`app_settings`, key `upload_blob:<name>`) is
  **not** applied to every upload. Verified by round-tripping both paths on the
  box, deleting the local file and re-fetching:
  - `/api/wholesale/upload-image` (`main.py:8962`) persists via
    `_persist_upload_blob`. It survives: the file served correctly from Postgres
    with no local copy.
  - The ad launcher persists too, through a **second, independent writer** using
    the same key convention — `ad_launcher/repository.py:242` calls
    `db.set_app_setting(None, f"upload_blob:{filename}", ...)` directly. Both are
    read back by the one `/uploads/{filename}` route.
  - `/api/uploads` (`main.py:6591`) — used by the testing pipeline, studio and
    ad launcher — writes to the local filesystem **only**. With the local file
    removed it 404s.

  So there is no file migration to do (nothing durable exists to migrate), but
  do not repeat the claim that the database is the source of truth for uploads.
  It is true for wholesale vendor images and false for everything else. On Cloud
  Run, with `maxScale: 8` and no shared filesystem, that means general uploads
  already 404 whenever a later request lands on a different instance — a
  pre-existing bug, not one the migration introduces. On the box, one container
  plus a named volume makes it strictly better.

  **Consequence for the parallel run:** `/api/uploads` stamps `BASE_URL` onto the
  URL it returns (`main.py:6598`), so an upload performed on the box comes back
  as a `run.app` URL for a file that exists only on the box — a guaranteed broken
  image. Do image-producing flows on Cloud Run during validation. This resolves
  itself at cutover, when `BASE_URL` moves to the new hostname.
- **The frontend does not need rebuilding for the host change.** The root
  `Dockerfile` builds the Next.js static export (`output: 'export'`) into
  `/app/static`, FastAPI mounts it at `/` (`backend/app/main.py:11190-11226`), and
  `frontend/lib/api.ts` uses a **relative** base when `NEXT_PUBLIC_API_BASE_URL`
  is unset. Same origin, so there is no baked-in API URL to change. Note
  `frontend/out/` is committed to git (95 files) and rebuilt by the Docker build
  anyway — decide whether to keep tracking it.
- **How this is deployed today.** Not by a Cloud Build trigger — there is **no
  trigger for this repo** in `global` or `europe-west1` (only `delvery-app-v3`
  has one). The live revision's build source is a
  `gs://run-sources-.../services/product-testing-os-4/*.zip`, i.e. somebody ran
  `gcloud run deploy --source .` by hand. There is therefore no CI to disable at
  cutover and none to inherit — your `deploy.sh` is the first real one.
- **Which files are stale.** `cloudrun/deploy.sh`, `cloudrun/cloudbuild.yaml` and
  the root `docker-compose.yml` describe a three-service layout (`pto-api`,
  `pto-worker`, `pto-frontend`, local Redis) with placeholder project IDs that
  **does not match production** — production is one container built from the root
  `Dockerfile`. `cloudrun/README-patch.txt` is an un-applied patch note.
  `backend/Dockerfile` and `backend/Dockerfile.worker` are not used by the live
  image. Treat all of them as leftovers; do not port them. The two scripts that
  *are* real are `cloudrun/setup-social-agent-scheduler.sh` and
  `cloudrun/setup-wholesale-batches.sh` — read both.
- **Celery is wired up but effectively off.** `USE_CELERY` defaults to `false`
  (`backend/app/main.py:1271`), it is not set on the revision, and no worker
  service is deployed — the pipeline runs in a daemon thread inside the API
  process (`main.py:1283`). Redis is still genuinely used, for chat pub/sub.
  Decide whether to bring a Celery worker up on the box at all; if you don't, say
  so explicitly rather than shipping a dead service.

---

## 5. The rule while Cloud Run is still live

Cloud Run keeps serving all real traffic until we deliberately cut over. Both
deployments may serve HTTP against the same database, but **only one may run
scheduled or queue-consuming work.**

There are exactly two sources of background work in this app, and both are
dangerous to double-run:

1. **The social agent scheduler.** Cloud Scheduler job
   `product-testing-os-social-agent` (europe-west1, `*/5 * * * *`, **ENABLED**)
   POSTs to `/api/social-agent/scheduler/tick` with an `X-Social-Agent-Key`
   header. `service.scheduler_tick` queues, prepares and **publishes posts to
   Meta and Instagram** (`backend/app/social_agent/service.py:668`). I found **no
   lease, lock or advisory lock guarding it** — the only guard is the stored batch
   status. Two instances ticking on the same schedule means duplicate published
   posts.
2. **The wholesale batch recovery loop.** `recover_batches()` is started
   unconditionally from a FastAPI `startup` handler (`main.py:11169-11171`), wakes
   every 60 s, claims database leases on `queued`/`running` batches and **creates
   Shopify products** (`backend/app/wholesale_batches.py:273-289`). On Cloud Run
   it only runs while an instance happens to be warm (`minScale` is 0, despite
   what `cloudrun/setup-wholesale-batches.sh` claims it set). On the box it runs
   24/7. The DB lease is what stops two instances claiming the same batch — do
   not rely on it as your only defence.

Make both switchable from a **single variable** in `/opt/pto/.env` — we used
`WORKER_LOOPS` on the delivery app; use the same name. Keep it off for the whole
validation window; Cloud Run keeps owning that work. With it off, the scheduler
endpoint must still refuse to do work even if someone POSTs to it directly on the
new host. At cutover: pause the Cloud Scheduler job and disable the loops on
Cloud Run **first**, then enable them here, then re-point the scheduler (or
replace it with a cron/loop on the box).

Getting this wrong means duplicate social posts, duplicate Shopify products and
duplicate paid-ad spend.

---

## 6. Order of work, and what done looks like

1. Prove a **container** on the box can reach
   `db.ronmjaiqktkdrjsqzchp.supabase.co` over IPv6 (trap 1). Nothing else matters
   until this works.
2. Decide the Redis question from trap 3, and write down which option you chose
   and why.
3. Write `/opt/pto/compose.yaml`, both env files, and a `deploy.sh` that asserts
   `DATABASE_URL` is set and non-SQLite (trap 2), then restarts health-gated
   (`--wait`) against `GET /health` (`backend/app/main.py:6750`). Do not use `/`
   as the healthcheck — it returns the static frontend and is green even when the
   database is gone.
4. Add the Caddy site file, and the Redis ACL user if trap 3 sent you that way.
5. Bring it up with `WORKER_LOOPS` off and one uvicorn worker. Verify: `/health`;
   that the database is Postgres and not SQLite (`/api/system-health/snapshot`
   will tell you); Redis connectivity; a WebSocket upgrade through Caddy on
   `/api/chat/ws/...`; an upload round-trip through the DB fallback; and that the
   pub/sub subscriber count matches the worker count.
6. Ask the owner to create **one** DNS A record for a test hostname pointing at
   `159.195.204.91` — do not query the name before it exists (trap 7).
7. Validate over HTTPS on that hostname. Expect Shopify OAuth to fail there until
   the redirect URI is registered — that is correct, not a bug to chase.
8. Stop. Choosing the production hostname, changing `BASE_URL`, adding the new
   callback URL to the four Shopify apps, pausing the Cloud Scheduler job and
   enabling `WORKER_LOOPS` are separate, owner-approved steps.

**Do not**: provision or reconfigure the server, touch another app's directory,
change DNS yourself, run scheduled work while Cloud Run is live, widen the Redis
ACL to `~*`, publish a port, rotate a secret during the parallel run, or point
any scratch container at the production `DATABASE_URL` (trap 10).

Report what you changed in this repo versus what you changed on the box, and flag
anything you find that contradicts this brief.
