# Grocery accounts in the wholesale portal

The account administration page at `/wholesale/admin/` can create a **Grocery · barcode scanning** account. Grocery users sign in at the existing `/wholesale/` page. Existing accounts default to `vendor`; account type is independent of wholesale store category. Changing type requires signing out and back in.

Grocery accounts use two simple workspaces:

- **Scan stock**: scan a barcode, enter name/unit price/total unit stock once, then save. A known barcode opens its editor. Scanning pauses during editing. Stock is an absolute total, not an increment. Grocery products are single-variant, tracked, and deny overselling.
- **Scan order**: each deliberate scan adds one unit, with quantity/removal controls, current stock checks, cash/change, or unpaid credit. Credit requires customer name and phone. Orders and payments use the existing order history/customer ledger. Receipt must be dismissed explicitly before the next sale.

The existing inventory/catalog, chat, customers, order/payment/status screens remain available. Grocery catalog/chat/order ownership uses stable vendor ID tags. Ordinary vendor entry/order flows are preserved. Grocery accounts cannot bypass scanning through the old product, inventory, order, or batch entry APIs.

## Scanning

EAN-13, EAN-8, UPC-A and Code 128; rear camera when available. Native BarcodeDetector is preferred, with bundled ZXing fallback. GTIN checksum checks, two agreeing frames, held-label suppression and explicit rescan protect against common misreads. USB/Bluetooth keyboard scanners and manual Enter input are available. Barcode strings preserve leading zeroes; UPC-A maps to its EAN-13 equivalent.

A barcode identifies an item already in the account catalog; an unknown barcode needs its name and price entered once. No external product-information database is queried. A multi-variant or multi-location legacy item requires explicit catalog preparation.

## Safety and recovery

Grocery routes require the existing vendor login plus a signed, account-bound, seven-day grocery token. Password changes invalidate the grocery token. Server-side account type, ownership, quantities, current Shopify prices, inventory policy, available stock and payment are checked. The server calculates totals with Decimal. No client-supplied price is trusted at checkout.

The exact request UUID is durably claimed before writes and stored on the browser before submission. Confirmed results replay without creating another item/order. A network interruption retains the same request; the UI exposes **Check same request**. An ambiguous Shopify write returns `needs_review` and is never blindly replayed. Admins must reconcile the shown request ID against `grocery_operations` and Shopify before releasing a blocked browser draft. Grocery order note attributes retain the request ID and customer snapshot. The barcode reservation records a known created product ID even if later stock setup fails.

Cash sales atomically update the existing wholesale payment tracker with the order total, excluding change. Grocery-tagged confirmed Shopify paid orders can recover their paid status in history if local payment persistence was interrupted.

Internet is required for writes. Draft/basket/request recovery uses sessionStorage scoped to account and mode on this device/tab. This is not an offline checkout queue. Browser storage failure blocks submission rather than risking an untracked retry.

Legacy products lacking a stable `vendor_id:<id>` tag are intentionally excluded from grocery catalogs. Do not convert an established vendor without an explicit product-tag/barcode migration; same-name ownership is insufficient.

## Validation and limits

Automated backend coverage includes permissions, cross-account isolation, duplicate UUIDs, barcode canonicalization, no blind retries after ambiguity, cash/credit totals, stock/price checks, payment-ledger integration, existing vendor behavior, and batch entry rejection. Pure scanner tests cover checksums, UPC equivalence, agreeing reads and held-label suppression. Browser fixture checks cover scanning to basket, repeated quantities, reload recovery, cash/change, unpaid identity requirements and stock updates.

Physical phone-camera speed/accuracy, lighting, autofocus and real USB/Bluetooth devices still need device acceptance testing. No physical scanning benchmark or live Shopify transaction is claimed. The existing configured Shopify REST API version remains unchanged; the bundled Shopify GraphQL validator cannot validate these Python REST payloads.
