# Grocery retail workspace

Grocery products, customers, orders, payments, request receipts and image ownership use `grocery_local_*` PostgreSQL tables, partitioned by immutable account UUID. Grocery operations do not read or write Shopify. Existing wholesale workflows retain Shopify. Earlier Shopify grocery records and old operation tables remain preserved and are not imported into fresh grocery workspaces.

At `/wholesale/admin/`, create a Grocery retail account. Creation uses `operation: create` and rejects duplicate usernames; edits use `operation: update` and preserve account identity. New accounts get UUID chat identities. Earlier grocery accounts receive a fresh grocery inbox when initialized. Ordinary wholesale inboxes remain intact. Old messages are preserved but cannot be retrieved as another account through HTTP or WebSocket identity spoofing. Sign out and sign in after upgrading to load the current identity.

## Merchant flow

- **Add product**: name, image, section initial, selling price and stock. Barcode optional. The server assigns a per-section ID such as `L-01`. Barcode aliases and short IDs cannot collide within an account. Images have durable local database-backed storage.
- **By item**: stock and sale quantities are whole items.
- **By weight**: price is DH/kg and stock is integer grams. Two bags of 25 kg create 50,000 g. Selecting/scanning opens a gram/kg dialog with 250 g, 500 g and 1 kg shortcuts. Selling 500 g leaves 49,500 g (49.5 kg). Subsequent scans pause until the dialog resolves.
- **Create order**: find by name, short ID, barcode or QR, review the basket and record cash/change or credit. Credit requires customer name and phone. Orders, payments and customer history stay inside the grocery account.

Type `L` for its section or `l23` for `L-23`, followed by similar IDs such as `L-230` and `L-234`, with images. Enter selects only an exact, unambiguous identity. Duplicate names require choosing a suggestion. Barcode leading zeroes are preserved; UPC-A maps to EAN-13.

## Performance and correctness

The UI keeps the catalog in memory, reuses the loaded parent catalog and immediately applies confirmed mutation responses. Camera decoding prefers native BarcodeDetector with bundled ZXing fallback, QR support, two-read confirmation, GTIN checksums, held-label suppression and camera cleanup. USB/Bluetooth keyboard scanners and manual input remain supported.

Checkout locks the account row, verifies ownership/current price, conditionally decrements stock, and commits the order, lines, customer and UUID receipt in one transaction. Money uses Decimal with half-up rounding per line; weight uses whole grams. Repeating a UUID returns its original receipt; changed content with that UUID is rejected. Cancellation restores quantity once. No external store call occurs inside the transaction. Browser drafts/pending requests use immutable account keys.

Catalog, chat cards, order status, payment and customer screens use local grocery adapters. Fractional kg stock stays visible; cards retain kg/unit price basis. Rejected payment edits display errors and never optimistically mark an order paid.

Internet is required to save; offline checkout is not implemented. An isolated SQLite benchmark measured checkout median 7.42 ms and a 50-product catalog at 3.49 ms. These are database-layer test results, not production/network/phone benchmarks.

## Verification

Backend regressions cover no-Shopify local CRUD, concurrent checkout/retries, account recycling, weighted stock, alias collisions, barcode attachment, durable image fallback, cancellation, payment validation, HTTP/WebSocket isolation and existing wholesale/auth behavior. Frontend tests cover barcode/QR checks, repeated reads, short-ID suggestions, ambiguity and gram/currency arithmetic. Browser checks use a separate SQLite database, real handlers, external calls disabled and a 234-product image catalog.

Physical phone camera speed, autofocus, lighting and real handheld devices still need acceptance testing.
