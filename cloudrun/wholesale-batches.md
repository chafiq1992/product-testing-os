# Wholesale product batches

The Add Product page supports a per-submission category (shoes, clothing,
electronics, general) and a batch of up to 50 photos. The vendor's saved store
type remains its default. Each photo becomes one product, with shared size
groups, SKU, quantities, unit cost, unit price and compare-at price. Existing
crate-price multiplication, color combinations, vendor tagging, copy prompts,
image cleanup and publication use the same single-product functions.

Uploads finish before submission. The backend persists the batch before
returning, then analyzes and creates each product sequentially. Analysis is
reused during finalization rather than repeated. A unique submission ID prevents
duplicate submissions; database leases prevent two workers claiming the same
batch. Recent progress is loaded from the server when returning to Add Product.

## Deployment

Deploy backend and frontend together. The backend creates the
`wholesale_product_batches` table using the existing SQLAlchemy database setup.
Production requires a persistent shared `DATABASE_URL`. The existing wholesale
upload endpoint saves an upload blob in that database; the uploads route uses it
when the local copy is absent on another instance or after a restart. Preserve
that upload persistence when changing storage.

Run `bash cloudrun/setup-wholesale-batches.sh` after deploying. It configures
always-allocated CPU and at least one instance for the queue/recovery worker.
This changes baseline Cloud Run billing. Do not deploy this feature with
request-only CPU and scale-to-zero while promising uninterrupted background
processing. Later deployment scripts must preserve these two settings.

Recovery checks persisted work every minute and reclaims expired five-minute
leases. Heartbeats extend leases every 30 seconds. An image interrupted during
analysis may be analyzed again. If creation or product setup was interrupted,
the item is marked **Check product**, with its Shopify ID retained when known.
It is never automatically recreated because Shopify may have accepted the
original write. Subsequent queued images continue. Pre-creation analysis errors
can be retried without replaying successful products.

## Validation

From the repository root, use an isolated database:

```powershell
$env:DATABASE_URL='sqlite://'
$env:PYTHONPATH='backend'
python -m pytest backend/tests/test_wholesale_batches.py -q
```

The tests stub Shopify and AI providers; they create no live products or paid
image generations. Check the frontend with `npx tsc --noEmit --incremental false`
and `npm run build` from `frontend`.
