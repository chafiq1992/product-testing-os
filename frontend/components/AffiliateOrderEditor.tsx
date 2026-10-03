"use client";
import { useAffiliateLocale } from "@/lib/affiliate-locale";
import { Plus, X } from "lucide-react";
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
  const { t, language } = useAffiliateLocale();
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
        <h2 className="font-bold">{t("Create order")}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={close}
          aria-label={t("Close order editor")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        >
          <X size={18} />
        </button>
      </header>
      <section
        aria-label={t("Selected products")}
        className="min-w-0 space-y-3"
      >
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
                <p className="mt-1 rounded-lg bg-emerald-50 px-2 py-1 text-sm font-bold text-emerald-900">
                  {t("Product cost")}:{" "}
                  {money(line.variant.unit_cost || 0, currency, language)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t("Recommended selling price")}{" "}
                  {money(line.variant.price, currency, language)}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCart((old) => old.filter((_, j) => i !== j))}
                aria-label={t(`Remove ${line.product.title}`)}
                className="flex h-11 w-11 shrink-0 items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-2 gap-3">
              <label className="min-w-0 text-xs">
                {t("Quantity")}
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
                {t("Sale price (")}
                {currency})
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
          {cart.length ? t("Add another product") : t("Add product")}
        </button>
      </section>
      {!!cart.length && (
        <div
          className="rounded-xl bg-emerald-50 p-3 text-sm"
          aria-label={t("Order summary")}
        >
          <div className="flex justify-between gap-3 font-semibold">
            <span>{t("Order total")}</span>
            <span>{money(total, currency, language)}</span>
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-3 text-lg font-bold text-emerald-800">
            <span>{t("Expected profit")}</span>
            <span>{money(Math.max(0, profit || 0), currency, language)}</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {money(cost, currency, language)} {t("product costs ·")}{" "}
            {Number.isFinite(deliveryFee)
              ? money(deliveryFee, currency, language)
              : t("Not configured")}{" "}
            {t("delivery deducted")}
          </p>
        </div>
      )}
      <section className="min-w-0 space-y-4">
        {!!customers.length && (
          <label className="block text-sm font-medium">
            {t("Saved customer")}
            <select
              disabled={busy}
              value={customerId}
              onChange={(e) =>
                selectCustomer(customers.find((c) => c.id === e.target.value))
              }
              className={`${field} mt-1`}
            >
              <option value="">{t("New customer")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customer_name} · {c.customer_phone}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm font-medium">
          {t("Name")}
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
          {t("Phone")}
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
          {t("City")}
          <select
            aria-label={t("City")}
            disabled={busy || !cities.length}
            required
            value={customer.city}
            onChange={(e) => edit("city", e.target.value)}
            className={`${field} mt-1`}
          >
            <option value="">{t("Choose an active delivery city")}</option>
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
            <p>{t(String(citiesError))}</p>
            <button
              type="button"
              onClick={retryCities}
              className={`${secondary} mt-2`}
            >
              {t("Retry cities")}
            </button>
          </div>
        )}
        {!cities.length && !citiesError && (
          <p className="text-xs text-slate-500">
            {t("Loading active routing cities\u2026")}
          </p>
        )}
        <label className="block text-sm font-medium">
          {t("Address")}
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
          {t("Order note")}
          <input
            disabled={busy}
            value={customer.note}
            onChange={(e) => edit("note", e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
      </section>
      <button
        type="submit"
        disabled={
          busy || !valid || !cities.some((c) => c.name === customer.city)
        }
        className={`${button} w-full`}
      >
        {busy ? t("Submitting…") : t("Submit order")}
      </button>
    </form>
  );
}
