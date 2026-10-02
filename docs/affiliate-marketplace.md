# Seller marketplace

Seller dashboard: `/affiliates/`. Administration is inside `/wholesale/admin/`.
Both use the existing `/settings/connections/` Shopify registry, OAuth tokens,
store labels, and System Health administrator session. Sellers receive separate
opaque sessions and cannot create products, change stock, or manage integrations.

## Launch setup

1. Deploy the Product Testing OS changes and the delivery app tracking endpoint
   from `delvery-app-v3/backend/app/routes/affiliate_tracking.py`.
2. In the delivery deployment, configure `AFFILIATE_TRACKING_CLIENTS` as a JSON
   map of a newly generated secret key to the exact Shopify domains that key may
   read. Example shape with a placeholder, not a usable credential:
   `{"REPLACE_WITH_RANDOM_SECRET":["store-one.myshopify.com","store-two.myshopify.com"]}`.
3. In Product Testing OS → Connections → Delivery app, enter the delivery HTTPS
   origin and that key. Test and save verifies the deployed endpoint. The key is
   saved in the same server-side AppSetting store used by existing connections;
   status responses never return it to the browser.
4. Connect each Shopify store in Connections. Current permissions must include
   products, inventory, order reads/writes and customer-data access required for
   creating shipping addresses. Reading orders older than 60 days requires
   Shopify-approved `read_all_orders` access.
5. In Wholesale Admin → Seller administration → Product costs, set a cost for
   each sellable variant. Unpriced variants cannot be ordered.
6. Sellers apply at `/affiliates/`. Review each application, select exact Shopify
   vendor names separately for each store, and approve the account.

The new tables follow this repository's existing `create(checkfirst=True)`
pattern. They are additive: `affiliate_sellers`, `affiliate_sessions`,
`affiliate_orders`, `affiliate_product_costs`, and `affiliate_payouts`. Use the
production database connection, not a local SQLite file, in deployed instances.

## Orders and profit

Sellers choose a sale price strictly above the administrator's per-variant cost.
The server rechecks account approval, store/vendor access, product status, variant
ownership, stock, currency and cost at submission. Orders use the existing
Shopify client, decrement inventory obeying stock policy, and carry seller and
submission tags. One order contains products from one store. Sellers can create
separate orders for different stores.

Costs are fixed on the order at submission. Later cost edits affect new orders
only. Profit is net merchandise sales minus that original cost, before the
seller's advertising spend and any fees outside the configured product cost.
Admins should include intended fulfillment/service costs in the seller cost.
Shipping and tax are excluded from merchandise profit. Refunds reduce sales;
cancelled, failed, fully refunded and returned orders earn zero. Partial COD
collection caps earnings at the approved amount reported by the delivery app.
All original product costs remain deducted after a partial refund or delivery.
Currencies are tracked separately and never summed into one balance.

Orders follow the existing warehouse/confirmation/fulfillment process. The
delivery app's existing Shopify intake imports fulfilled orders. This change
does not automatically fulfill newly submitted seller orders or bypass warehouse
approval. Ensure those stores are also connected in the delivery app.

## Delivery tracking

The delivery bridge provides a bounded, authenticated POST endpoint:
`/api/integrations/affiliate-tracking/orders`. It matches exact Shopify shop domain
plus numeric Shopify order ID, excludes return-only parcels and refuses ambiguous
matches. It returns delivery state, original French status, tracking number,
collected COD amount and source update time; it excludes customer details.

The dashboard refreshes every minute while visible. Shopify reads are batched by
store, delivery reads by 100 orders, with a 30-second read cache. Admin manual
sync and payout decisions always force fresh reads. If the connector cannot
refresh orders, payout submission and approval stop until it succeeds. The UI
shows refresh warnings and whether a status came from Shopify or the delivery
app. Without a delivery connection, Shopify fulfillment/shipment states and
existing delivery tags remain available as a fallback.

The delivery app maps `Livré` and `Paid` to delivered/cash collected. A pending
driver COD price-change request prevents settlement even if the parcel is marked
delivered; earnings unlock when that staff review is resolved.

## Payouts and uncertain submissions

Delivered and collected orders earn payout-eligible profit. Pending and approved
payout requests reserve funds immediately under a database transaction lock.
Approval rechecks current earnings. Marking a payout paid requires a transfer
reference and a prior approved state. Transfers are made outside this dashboard;
the dashboard records and tracks them. Subsequent returns/refunds may make the
available balance negative and block further payouts.

Duplicate order requests use the same submission ID and do not create another
Shopify order. If the response is lost after creation, the order is marked
`needs_review`; resubmission is blocked. The seller review panel lets an admin
link the numeric Shopify order ID after checking matching seller and submission
tags. If Shopify never created it, staff should investigate before accepting a
new submission; there is no automatic retry of uncertain writes.

## Validation

Seller endpoints use their own verified bearer sessions through the application's
operator gate. Only the existing seller route paths are exempt from operator
login; affiliate admin routes still require staff access and the system admin
token. The `/affiliates` page uses its own seller sign-in. Regression tests check
that a seller can log in, submit orders and request payouts without staff access,
and cannot access administrative routes or the internal store registry.

The seller workspace uses fixed bottom navigation on phones and tablets below
1024px. Phone order and payout histories show cards below 640px; wider screens
retain tables. Forms have at least 44px controls, 16px text on phones, numeric
keypads for prices and quantities, and customer autofill. Content reserves space
for the bottom navigation and device safe area. Sign-in appears before the
introductory text on phones.

`backend/tests/test_affiliates.py` covers account approval, session revocation,
store/vendor/variant isolation, stock, pricing, original costs, duplicate
submission, reconciliation, refunds, returns, currencies and payout transitions.
Delivery tests live in `delvery-app-v3/backend/tests/test_affiliate_tracking.py`.
The browser QA uses an isolated synthetic database, not production stores.

Shopify API references: [Order](https://shopify.dev/docs/api/admin-rest/2026-01/resources/order)
and [Product](https://shopify.dev/docs/api/admin-rest/2026-01/resources/product).
The implementation reuses the repository's existing REST Shopify client. Shopify
requires GraphQL for new public apps; this change does not create a new Shopify
public app or replace the existing client.
