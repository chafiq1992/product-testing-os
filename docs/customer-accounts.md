# Customer accounts

Customers use `/customer/`, with a separate phone/password login and HttpOnly
session. Registration requires a merchant invitation or an administrator-created
account. Moroccan local phone formats and `+212` normalize to one username.
Phone ownership is not verified by SMS; no phone-based password reset is exposed.

## Merchant and administrator entry points

- Wholesale and grocery: **Invite your customers** on Overview and Customers.
- Approved sellers: invitation QR and **Customer messages** on Overview.
- Wholesale administration: **Customer accounts**, with optional merchant links,
  plus a merchant selector for preparing invitations.

Invitation QR images are generated locally, can be downloaded or copied as a
link, and last 90 days. Existing customers sign in through another invitation to
add that merchant. Invitations never expose customers or grant merchant access.

## Shopping and orders

The portal lists linked shops, product types, images, available variants and a
plus button. Grocery weight products support grams and kilograms. Carts belong
to one customer UUID and merchant; seller items from different fulfillment
stores or currencies require separate orders. Seller checkout asks for a
delivery address and supported city and displays delivery separately.

Prices and stock are checked by the server. A changed displayed total is
rejected before creating an order. Browser checkout saves a request UUID before
sending, keeps it across uncertain responses, and uses Web Locks when available
to serialize checkout across tabs. Server request claims prevent repeated writes.

Grocery orders stay in the grocery database, with unpaid status and atomic stock,
receipt and customer ownership updates. Seller and ordinary wholesale orders use
their existing merchant order pipelines. Ambiguous external outcomes require
review; the portal never blindly creates another external order.

Order history is selected by immutable customer ownership, never by matching an
old phone number. Customer chat is restricted to linked merchant identities,
including WebSocket frames, presence and private attachments. Customer sessions
cannot access employee tools. New merchant products and orders carry immutable
account ownership tags; legacy display-name records require unambiguous ownership.

## Validation

Regression coverage lives in `backend/tests/test_customer_*.py` and
`frontend/components/customer/customer.test.cjs`. Browser acceptance uses an
isolated local database. Production-image PostgreSQL acceptance uses a disposable
schema and blocks external commerce calls; it does not create live test orders.
