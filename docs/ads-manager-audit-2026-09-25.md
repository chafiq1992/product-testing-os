# Ads manager audit — 2026-09-25

## Fixed in this pass

| Finding | Impact | Change |
| --- | --- | --- |
| Product and campaign rows each saved an owner, and clearing a product owner exposed stale campaign owners. | Conflicting assignments and repeated writes for each campaign. | Owner is now stored once under `product-owner:<product_id>` in the product's store. Campaign rows display the inherited value. |
| The account picker enumerated `/me/adaccounts` and every business on page load. | Startup latency and unnecessary Meta API calls. | A connected store reads the account list saved during OAuth; the initial dashboard load selects those accounts. |
| Meta campaign timeouts and API errors became an empty campaign list. | A failed request could look like zero spend. | The bundle returns an error and the page displays it. |
| Shopify OAuth start was public and its callback had an optional HMAC bypass. | An unauthorized user could initiate a connection; HMAC verification could be disabled. | OAuth start and status require a System Health administrator, and callback HMAC verification is mandatory. |
| Shopify and Meta callbacks returned to a relative backend URL. | The connection page could be lost when the frontend and API use separate origins. | The administrator's frontend origin is signed into OAuth state and used for the return redirect. |
| The ads API could be reached without an operator session and accepted browser requests from any origin. | Connected accounts could be read or changed by unauthorized clients. | The upstream operator gate now covers ads routes; this release adds the Meta callback to the signed-callback allowlist and limits CORS to configured origins. |
| OAuth access tokens were stored in cleartext. | Database users and backups could read store credentials. | Shopify and Meta tokens are encrypted before storage; existing cleartext records migrate on first read. |
| Mixed-store account selection sent every account through the first store's Meta token. | Campaigns from secondary stores could fail to load or use the wrong workspace. | Account discovery now returns the associated store, and bundle requests use that store. |

## Remaining risks

| Priority | Finding | Recommended next change |
| --- | --- | --- |
| Medium | A campaign assigned to two stores still has one merged mapping key in the dashboard. | Use composite `(store, campaign_id)` keys throughout the mapping and owner model. |
| Medium | Meta Graph reads can still consume most of the 55-second bundle deadline when an account has many pages or Meta is slow. | Add a durable background refresh for larger accounts and cache account snapshots beyond the current short TTL. |
| Low | Existing database backups taken before this release may contain cleartext OAuth tokens. | Retire old backups on the normal retention schedule after confirming that migrated records are encrypted. |

## Verification

- `python -m pytest backend/tests -q --disable-warnings` — 227 passed with a file-backed SQLite test database.
- `npx tsc --noEmit --incremental false` — passed.
- `npm run build` — passed; `/settings/connections` exported as a static route.
- Live Meta and Shopify authorization still require configured app credentials and an actual account grant.
