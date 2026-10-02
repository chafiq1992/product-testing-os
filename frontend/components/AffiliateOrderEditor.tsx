"use client";
import { Plus, X } from "lucide-react";
import AffiliateReceipt from "@/components/AffiliateReceipt";
import {
  AffiliateCustomer,
  CartLine,
  RoutingCity,
  button,
  field,
  money,
  productImage,
  secondary,
} from "@/lib/affiliates";

export type OrderCustomer = {
  customer_name: string;
  customer_phone: string;
  city: string;
  address: string;
  country: string;
  note: string;
};

export default function AffiliateOrderEditor({
  cart,
  setCart,
  customer,
  setCustomer,
  customerId,
  selectCustomer,
  clearCustomerId,
  customers,
  cities,
  citiesError,
  retryCities,
  busy,
  addProduct,
  close,
  submit,
  deliveryFee,
}: {
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  customer: OrderCustomer;
  setCustomer: React.Dispatch<React.SetStateAction<OrderCustomer>>;
  customerId: string;
  selectCustomer: (c?: AffiliateCustomer) => void;
  clearCustomerId: () => void;
  customers: AffiliateCustomer[];
  cities: RoutingCity[];
  citiesError: string;
  retryCities: () => void;
  busy: boolean;
  addProduct: () => void;
  close: () => void;
  submit: (event: React.FormEvent) => void;
  deliveryFee: number;
}) {
  const currency = cart[0]?.product.currency || "MAD";
  const total = cart.reduce(
    (sum, l) => sum + Number(l.sale_price) * l.quantity,
    0,
  );
  const cost = cart.reduce(
    (sum, l) => sum + Number(l.variant.unit_cost) * l.quantity,
    0,
  );
  const profit = total - cost - deliveryFee;
  const valid =
    cart.length > 0 &&
    Number.isFinite(profit) &&
    profit > 0 &&
    cart.every(
      (l) =>
        l.variant.available &&
        l.quantity >= 1 &&
        l.quantity <= 100 &&
        (l.variant.inventory_quantity === null ||
          l.quantity <= l.variant.inventory_quantity) &&
        Number(l.sale_price) > Number(l.variant.unit_cost),
    );
  function edit(key: keyof OrderCustomer, value: string) {
    setCustomer((c) => ({ ...c, [key]: value }));
    if (key === "customer_phone") clearCustomerId();
  }
  return (
    <form
      onSubmit={submit}
      className="mb-6 min-w-0 space-y-5 rounded-2xl border bg-white p-4 sm:p-6"
    >
      <header className="flex min-w-0 justify-between gap-2">
        <h2 className="font-bold">Create order</h2>
        <button
          type="button"
          disabled={busy}
          onClick={close}
          aria-label="Close order editor"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        >
          <X size={18} />
        </button>
      </header>
      <section aria-label="Selected products" className="min-w-0 space-y-3">
        {cart.map((line, i) => (
          <div
            key={`${line.product.id}:${line.variant.id}`}
            className="min-w-0 rounded-xl bg-slate-50 p-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white">
                <img
                  src={productImage(
                    line.variant.image || line.product.image,
                    160,
                  )}
                  alt={line.product.title}
                  className="absolute inset-0 h-full w-full max-w-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1 break-words">
                <p className="text-sm font-semibold">{line.product.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {line.variant.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Recommended {money(line.variant.price, currency)}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCart((old) => old.filter((_, j) => i !== j))}
                aria-label={`Remove ${line.product.title}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-2 gap-3">
              <label className="min-w-0 text-xs">
                Quantity
                <input
                  type="number"
                  inputMode="numeric"
                  disabled={busy}
                  required
                  min="1"
                  max={Math.min(100, line.variant.inventory_quantity ?? 100)}
                  value={line.quantity}
                  onChange={(e) =>
                    setCart((old) =>
                      old.map((l, j) =>
                        i === j
                          ? { ...l, quantity: Number(e.target.value) }
                          : l,
                      ),
                    )
                  }
                  className={`${field} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs">
                Sale price ({currency})
                <input
                  type="number"
                  inputMode="decimal"
                  disabled={busy}
                  required
                  min={Number(line.variant.unit_cost) + 0.01}
                  step="0.01"
                  value={line.sale_price}
                  onChange={(e) =>
                    setCart((old) =>
                      old.map((l, j) =>
                        i === j ? { ...l, sale_price: e.target.value } : l,
                      ),
                    )
                  }
                  className={`${field} mt-1`}
                />
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={addProduct}
          className={`${secondary} w-full border-dashed`}
        >
          <Plus size={16} />
          {cart.length ? "Add another product" : "Add product"}
        </button>
      </section>
      <section className="min-w-0 space-y-4">
        {!!customers.length && (
          <label className="block text-sm font-medium">
            Saved customer
            <select
              disabled={busy}
              value={customerId}
              onChange={(e) =>
                selectCustomer(customers.find((c) => c.id === e.target.value))
              }
              className={`${field} mt-1`}
            >
              <option value="">New customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customer_name} · {c.customer_phone}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm font-medium">
          Name
          <input
            disabled={busy}
            required
            autoComplete="name"
            value={customer.customer_name}
            onChange={(e) => edit("customer_name", e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
        <label className="block text-sm font-medium">
          Phone
          <input
            disabled={busy}
            required
            type="tel"
            autoComplete="tel"
            value={customer.customer_phone}
            onChange={(e) => edit("customer_phone", e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
        <label className="block text-sm font-medium">
          City
          <select
            aria-label="City"
            disabled={busy || !cities.length}
            required
            value={customer.city}
            onChange={(e) => edit("city", e.target.value)}
            className={`${field} mt-1`}
          >
            <option value="">Choose an active delivery city</option>
            {cities.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {citiesError && (
          <div
            role="alert"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
          >
            <p>{citiesError}</p>
            <button
              type="button"
              onClick={retryCities}
              className={`${secondary} mt-2`}
            >
              Retry cities
            </button>
          </div>
        )}
        {!cities.length && !citiesError && (
          <p className="text-xs text-slate-500">
            Loading active routing cities…
          </p>
        )}
        <label className="block text-sm font-medium">
          Address
          <input
            disabled={busy}
            required
            autoComplete="street-address"
            value={customer.address}
            onChange={(e) => edit("address", e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
        <label className="block text-sm font-medium">
          Order note
          <input
            disabled={busy}
            value={customer.note}
            onChange={(e) => edit("note", e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
      </section>
      {!!cart.length && (
        <>
          <AffiliateReceipt
            draft
            receipt={{
              ...customer,
              currency,
              total,
              items: cart.map((l) => ({
                title: l.product.title,
                variant: l.variant.title,
                image: l.variant.image || l.product.image,
                quantity: l.quantity,
                unit_price: Number(l.sale_price),
                total: Number(l.sale_price) * l.quantity,
              })),
            }}
            canShare={
              valid &&
              !!customer.customer_name &&
              !!customer.customer_phone &&
              !!customer.city &&
              !!customer.address
            }
          />
          <div className="min-w-0 text-sm">
            <div className="flex justify-between gap-3 text-slate-500">
              <span>Your product costs</span>
              <span className="break-words text-right">
                {money(cost, currency)}
              </span>
            </div>
            <div className="mt-1 flex justify-between gap-3 text-slate-500">
              <span>Delivery deducted</span>
              <span>
                {Number.isFinite(deliveryFee)
                  ? money(deliveryFee, currency)
                  : "Not configured"}
              </span>
            </div>
            <div className="mt-2 flex justify-between gap-3 font-semibold text-emerald-800">
              <span>Your expected profit</span>
              <span className="break-words text-right">
                {money(Math.max(0, profit || 0), currency)}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Available after delivery and collection. Your costs and profit are
              excluded from the shared receipt.
            </p>
          </div>
        </>
      )}
      <button
        type="submit"
        disabled={
          busy || !valid || !cities.some((c) => c.name === customer.city)
        }
        className={`${button} w-full`}
      >
        {busy ? "Submitting…" : "Submit order"}
      </button>
    </form>
  );
}
