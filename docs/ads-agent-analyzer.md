# Ads specialist and funnel analyzer

The ads manager now has a dedicated **AI agent settings** tab at
`/ads-management/settings/`. Each product group and standalone campaign has a
compact **Analyze ads** action button. Click it to open the report dropdown,
select the dashboard period, and click **Analyze ads** in the report.
The dashboard defaults to seven calendar days including today.
Reports label the exact period, model, capture limitations and evidence gaps.
The latest five reports are saved per store and product/campaign key.
Winner/risk signals and their dates appear inside the report.

## Controls

Settings are persisted per store in `AppSetting` under `ads_analyzer_settings`.
Controls include enabled/paused, analysis model, reasoning, token budget,
customer profiling, independent reviewer/model, Clarity, screenshots,
previous-period comparison, minimum spend/purchases, optional CPA/ROAS goals,
language and business context. Changes affect new runs. The agent only reads
campaign data and recommends actions; it does not change ad budgets/status.

The model dropdown calls the server OpenAI models API, filters out specialized
audio/image/embedding/coding models, and caches successful discovery for five
minutes. Documented fallback choices are `gpt-6.1-sol`, `gpt-6-astra`, and
`gpt-6-luna`, explicitly marked as unverified if discovery fails. An account's
model listing does not guarantee that every model supports every Responses
option; incompatible calls fail visibly without a silent model substitution.

Official sources checked October 2, 2026:
- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [List account models](https://platform.openai.com/docs/api-reference/models/list)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## Secret Manager

The existing deployment uses `OPENAI_API_KEY` injected from Google Secret
Manager on Cloud Run, or synced by `deploy/pull-env.sh` for Netcup. OpenAI uses
the latest Google secret
version even if the sealed Cloud Run revision still points to an older key.
To refresh only this credential, run `python deploy/sync-openai-secret.py`
from an authenticated gcloud workstation, then perform a normal release or
recreate the app containers. The helper validates model access from the server
before atomically updating only `OPENAI_API_KEY`. It never logs secret values.
No API key is sent to the frontend or accepted in settings.

For optional direct Google Secret Manager access, configure the server:

```text
ADS_ANALYZER_OPENAI_SECRET_VERSION=projects/PROJECT_ID/secrets/OPENAI_API_KEY/versions/latest
```

The server uses Application Default Credentials with permission to access this
secret (`roles/secretmanager.secretAccessor`). Direct access takes precedence
over the environment key and fails closed. The client caches the resolved key
until process restart; restart after key rotation. No credentials or secret
values belong in frontend settings. The new runtime dependencies are
`google-auth` and `playwright`.

## Evidence and decisions

The selected range is validated (maximum 90 days). All selected campaigns are
read using the store's Meta connection. Daily metrics and ad-level insights are
included; ratios use summed numerators/denominators rather than averaging CTR.
The previous period has equal length and does not overlap. Groups with different
currencies are rejected. Product-level Shopify orders remain separate from
Meta-attributed purchases. Client-supplied dashboard metrics are not authoritative.

Long report/reviewer calls use the SDK response stream with a 600-second read
budget and no automatic inference replay after a timeout. Only a completed,
validated report is persisted; partial or interrupted streams remain failures.
High reasoning and the configured output-token limit are preserved. Timeout
errors now identify OpenAI and suggest retrying or changing reasoning depth.
See [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses).

The output-token limit covers both reasoning and the visible report. High
reasoning can exhaust that budget before producing a complete JSON report.
New configurations default to a 32,000-token budget with Medium reasoning;
existing saved settings are preserved. Token cutoffs identify the configured
limit; at the 32,000-token settings cap,
the error recommends reducing reasoning or selecting another model rather than
offering an unavailable budget increase. Incomplete reports are never saved.
The report prompt limits repeated explanations and prioritizes five actions,
two creative concepts and short evidence lists while retaining all nine stages.
See [OpenAI reasoning token budgets](https://developers.openai.com/api/docs/guides/reasoning).

First-screen and lower-page capture results are independent. Buying-section
scrolling targets visible cart/add controls; when those cannot be located, the
fallback image is labeled as a lower-page capture. A failure keeps its own
evidence ID and never invalidates or duplicates a successfully captured view.

The Responses API returns a validated structured report covering delivery,
hook, creative, ad CTA, landing page, offer, checkout, fulfillment and tracking.
The report separates observations from hypotheses and proposes controlled tests.
Sample gates downgrade winner/kill/scale verdicts. Optional independent review
can hold an unsupported verdict. Goals without margins, delivery costs and
matched attribution do not prove profitability.

Clarity only exports recent available behavior (up to three days). It is never
presented as a historical seven-day heatmap. Mobile screenshots show the current
landing page's first screen and buying section; named visual findings explain
each captured area. Capture failures are explicit, and absent screenshots cannot
support visual findings. Captures permit HTTPS public-network GET/HEAD requests,
block private destinations and service workers, and never submit forms. Chromium
is installed in the Docker runtime. For local capture development, run
`python -m playwright install chromium` after installing requirements.

Screenshots use the existing uploads storage and database fallback. Job status
also persists in the database so polling can reach another server instance.
Execution still uses the existing background-thread pattern: a server restart
can interrupt a running job; after 15 minutes pending jobs request a retry.
Completed reports survive reloads and restarts. This is not a scheduled monitor;
signals and warnings reflect the most recent requested analysis.

The new routes use the current application's operator session gate. Upstream
login, encrypted Meta connections and account-timezone reporting are preserved.

## Validation

Provider calls are mocked in regression tests; no production campaign changes
or paid inference are required. Coverage includes ranges, grouped totals,
store-specific settings, model discovery/redaction, structured report options,
sample gates, independent review, safe capture destinations, report persistence,
cross-instance polling, disabled controls and preservation of previous reports
after provider failure. A production Secret Manager/Meta/OpenAI run remains
necessary to confirm account access in the deployed environment.

Verification completed locally: 276 backend tests passed (32 cover this
analyzer), TypeScript checking and the production Next.js build passed. A
headless browser exercised model selection, a store-specific settings save,
analysis submission/polling and saved reports using explicit API fixtures.
Desktop and 390px mobile screenshots were inspected; mobile page overflow and
browser page errors were checked, including stored browser preferences.
Campaigns and settings share a persistent layout. Each tab loads on its first
visit and stays mounted while hidden; filters, reports, active analysis and
unsaved settings survive tab switches. A full browser refresh still reloads
server data. Browser coverage asserts no additional bundle, report, settings or
model requests on tab return. Browser-dependent campaign preferences initialize
inside a client-only tab, avoiding the prior static hydration mismatch.
The existing main-branch deployment workflow is preserved.

## Campaign toggles

Campaign and ad-set status changes use the row's store and ad-account connection.
Only network timeouts, connection failures, HTTP 429/5xx and errors marked
transient by Meta are retried. Exhausted retries return the underlying Meta error
instead of an opaque `RetryError`. Missing permissions and invalid parameters
fail immediately. The UI changes status only after Meta confirms success.
The 14 toggle regression cases cover connection scope, transient recovery,
exhaustion, permanent failures, unconfirmed writes and cache invalidation.
