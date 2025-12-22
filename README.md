# Product Testing OS (MVP)

FastAPI  + Celery backend, Next.js frontend wizard, and Cloud Run deploy scripts.

## Local
1) `cp .env.example .env` and fill values
2) `docker compose up --build`
3) POST to `/api/tests` as shown in the canvas

## Cloud Run
See `cloudrun/README.md`.

## Confirmation page (order confirmation team)

The frontend route is `"/confirmation"` (link available on Home).

### Configure login users

Set `CONFIRMATION_USERS` as JSON (either a map or an array):

- Map form:
  - `{"agent1@example.com":"password1","agent2@example.com":"password2"}`
- Array form:
  - `[{"email":"agent1@example.com","password":"password1","name":"Agent 1"}]`

Optionally, set a signing secret for login tokens:

- `CONFIRMATION_AUTH_SECRET`: random string used to sign session tokens

### Admin dashboard (manage agents + analytics)

Frontend route: `"/confirmation-admin"`

Set admin users in env (JSON map or array):

- `CONFIRMATION_ADMIN_USERS='{"admin@example.com":"adminpass"}'`
- or `CONFIRMATION_ADMIN_USERS='[{"email":"admin@example.com","password":"adminpass","name":"Admin"}]'`

Set a signing secret (recommended):

- `CONFIRMATION_ADMIN_SECRET`: secret used to sign admin session tokens