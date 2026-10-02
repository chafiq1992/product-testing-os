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
   products, inventory, order reads/writes and `read_customers`/`write_customers`
   with the required protected customer-data access. Reading orders older than 60 days requires
   Shopify-approved `read_all_orders` access.
5. In Wholesale Admin → Seller administration → Marketplace pricing, review the
   default 35% discount and 33 MAD delivery deduction. Add collection discounts
   when needed. The last matching collection rule overrides the global discount.
   Configure a separate delivery fee for each additional selling currency.
6. Sellers apply at `/affiliates/`. Review each application, select exact Shopify
   vendor names separately for each store, and approve the account.

The new tables follow this repository's existing `create(checkfirst=True)`
pattern. They are additive: `affiliate_sellers`, `affiliate_sessions`,
`affiliate_orders`, `affiliate_product_costs`, `affiliate_payouts`,
`affiliate_order_terms`, `affiliate_product_marks`, `affiliate_customers`, and
`affiliate_customer_shopify_links`, plus `affiliate_order_receipts`. Legacy product-cost records remain for audit;
new orders use percentage pricing. Use the
production database connection, not a local SQLite file, in deployed instances.

## Orders and profit

Sellers choose a sale price above their discounted product cost. By default the
cost is 65% of the original Shopify variant selling price, rounded to hundredths.
That original Shopify price remains the recommended selling price. The full
order margin must also cover the delivery deduction.
The server rechecks account approval, store/vendor access, product status, variant
ownership, stock, currency and cost at submission. Orders use the existing
Shopify client, decrement inventory and carry `affiliate`, `aff_s:<seller UUID>`
and `aff_o:<local order UUID>` tags. Each tag stays within Shopify's
[40-character order-tag limit](https://help.shopify.com/en/manual/fulfillment/managing-orders/managing-order-details).
Full seller and original submission IDs also appear in order note attributes.
One order contains products from one store. Sellers can create
separate orders for different stores.

Product costs and the delivery deduction are fixed on the order at submission.
Later pricing edits affect new orders only. Profit is net merchandise sales minus
the original product costs and the delivery fee, before advertising spend.
The default 33 MAD fee is deducted once per order, not added to the customer's
selling price. For example, a 199 MAD item costs 129.35 MAD and earns 36.65 MAD
when sold for 199 MAD and delivered with full collection. Historical orders
created before delivery-fee snapshots retain their original zero-fee accounting.
Shipping and tax are excluded from merchandise profit. Refunds reduce sales;
cancelled, failed, fully refunded and returned orders earn zero. Partial COD
collection caps earnings at the approved amount reported by the delivery app.
All original product costs remain deducted after a partial refund or delivery.
Currencies are tracked separately and never summed into one balance.

## Marketplace and customers

The seller Marketplace hides store and vendor names. Cards show images, original
recommended prices, discounted costs, color/size swatches and stock. Filters use
available sizes and Men, Women, Kids, Boys, Girls, Unisex kids/adult, or Other. Categories
come from Shopify product type and tags, with title fallback; unclassified items
remain under Other. Sorting supports newest, quantity, and price in either
direction. Different currencies are grouped for price sorting, without conversion.
Marks persist per seller. Product details show all photos, plaintext descriptions
and selectable swatches. Zero-stock variants are crossed out and blocked even
when the store's Shopify policy permits overselling. Untracked stock is shown as
available without inventing a quantity; submission always rechecks current stock.

Catalog loading runs independently of sales and delivery tracking. Stores load in
parallel, with the first 250 products returned before background pagination loads
the remainder. Shared server snapshots refresh after two minutes and can be served
for up to thirty minutes while refreshing. Every response applies current seller
vendor permissions and pricing settings. Browsers also retain their seller's
catalog for fifteen minutes in session storage while fetching an update; logout
clears it. Shopify image URLs request smaller thumbnails. These caches are only
for browsing: order submission reads current stock, prices and access again.

Create order is available from Overview and Orders. The Orders header opens the
seller's customer list and order history. The editor begins with Add product,
which opens a filtered Marketplace with marked products first. Selecting a product
opens its variant details; Add to order returns to the editor. Additional products
must belong to the same store, without exposing store names in the picker.
Selected images, variants, quantities and sale prices appear above customer name,
phone, city, address and note. Country is fixed to Morocco without a country-code
control. City selection uses the delivery app's Active routing cities; submission
checks the current city list before any customer or order write.

The editor shows the seller's sale total, product costs, delivery deduction and
expected profit above the customer fields. Submit order is the final control,
immediately below Order note. There is no receipt sharing before submission.
A confirmed order opens a success popup with confetti (disabled for reduced-motion
preferences) and its customer receipt. Rejected or uncertain submissions never
trigger the celebration. History opens saved order details and the same receipt.

New orders retain immutable receipt data, including product images, color, size,
variant names, sale prices and entered customer details. The designed receipt
includes the delivery fee as **included** in the customer's total; the default
33 MAD remains deducted once from affiliate profit, without increasing the
customer total. The exact Arabic inspection/return notice appears on every receipt.
Affiliate costs, private earnings, store and vendor identities are excluded.
Older orders derive their receipt from their saved Shopify snapshot and delivery
terms, preserving original accounting.

Sharing sends a PNG file through the phone's native file share sheet when
`navigator.canShare({files})` supports it, with PNG download as the fallback.
The image is prepared before the click to preserve the user gesture required by
native sharing. Language and width changes regenerate it. Loaded product photos
are rasterized before canvas export to preserve SVG and contain sizing. Failed
image preparation offers a retry; receipt fetching can retry without resubmitting
the order.

The seller workspace, sign-in, application, customer list, order editor, details
and receipts support English, French and Arabic. A language selector in the header
and popups stores the preference locally. Arabic uses right-to-left layout,
including navigation, fields and modal content. Product titles/descriptions and
entered customer data retain their original language. The compact header places
refresh and exit next to the seller's welcome name and has no currency selector.
Accounts using several settlement currencies retain their selector in content.

Order entry saves a local customer by
seller and normalized phone number. Existing customers can be reused. Shopify
customers carry `affiliate` and `affiliate_seller:<seller UUID>` tags. Customer
tags support the longer format; orders use the shorter `aff_s:` prefix. Matching existing Shopify customers retain their names,
addresses and other tags; tags are added atomically using GraphQL `tagsAdd`.
New customers receive the entered address without an account invitation. Sellers
only see their own local customer records and their own orders, including when a
Shopify customer is shared with another seller. Failed customer synchronization
blocks Shopify order submission and reports the permission issue.

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

Its authenticated GET `/api/integrations/affiliate-tracking/cities` returns only
approved, active Moroccan cities with an active route through a connected partner
or the delivery app's own drivers. Provider capability catalogs alone do not
qualify. The dashboard's server calls this endpoint using its existing delivery
connection; browsers receive city names and IDs without the integration key.
City lists are cached for five minutes, with a forced refresh at submission.
Deploy this endpoint before the new order editor. An unavailable connection or
an empty active-routing list blocks submission with an actionable error.

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
link the numeric Shopify order ID after checking matching `aff_s:` seller and
`aff_o:` local-order tags. Reconciliation also accepts the original
`affiliate_seller:` and `affiliate_request:` pair on legacy submissions.
If Shopify never created it, staff should investigate before accepting a
new submission; there is no automatic retry of uncertain writes.

An explicit Shopify validation or authorization rejection is recorded as
`rejected` and returns its validation message. Repeating the same submission ID
returns that rejection without another Shopify write. Correcting the form creates
a new submission ID. HTML responses from a proxy are handled without exposing a
JSON parsing error; the seller is directed to check orders before trying again.

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
The Marketplace uses two compact columns on phones and more columns on larger
screens. Product selection and details use bounded, rounded popups on phones,
leaving the order page visible behind them. A Back to products control returns
from variant selection to the picker; adding returns to the same editor without
changing the URL or losing entered customer data. Nested focus trapping and
Escape handling restore scrolling when all popups close. Option controls are 44px.

`backend/tests/test_affiliates.py` covers account approval, session revocation,
store/vendor/variant isolation, stock, pricing, original costs, duplicate
submission, reconciliation, refunds, returns, currencies and payout transitions.
It also checks collection discounts, immutable delivery deductions, marks,
customer isolation/reuse, customer tagging and failed pricing/customer reads.
Additional checks cover cached catalog authorization, progressive pagination,
active routing cities, immutable seller-owned receipts and explicit Shopify
rejections, the 40-character order-tag limit, original submission IDs in note
attributes, idempotent retries, and immutable receipt color/size/delivery totals.
The affiliate, operator-gate and Shopify-registry regression suites pass 81 tests.
`node --test frontend/tests/affiliate-translations.test.cjs` checks dynamic
messages, preservation of customer/product data, and static seller-label coverage.
Mobile browser QA covers the complete multiple-product order flow, English/French/
Arabic persistence and RTL, confirmed PNG receipt sharing with an active user
gesture, product-photo pixels in the exported file, language regeneration and
download fallback. It also covers customer reuse, nested popup focus and Escape,
HTML errors without success UI, image bounds and horizontal overflow at 320–430px,
plus tablet and desktop layouts.
Delivery tests live in `delvery-app-v3/backend/tests/test_affiliate_tracking.py`.
The browser QA uses an isolated synthetic database, not production stores.

Shopify API references: [Order](https://shopify.dev/docs/api/admin-rest/2026-01/resources/order),
[Product](https://shopify.dev/docs/api/admin-rest/2026-01/resources/product),
[Customer](https://shopify.dev/docs/api/admin-rest/2026-01/resources/customer), and
[tagsAdd](https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/tagsAdd).
The implementation reuses the repository's existing REST and GraphQL Shopify clients. Shopify
requires GraphQL for new public apps; this change does not create a new Shopify
public app or replace the existing client.
