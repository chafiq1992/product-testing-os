"use client";
import { useEffect, useState } from "react";
import { affiliateApi, button, field, secondary } from "@/lib/affiliates";

type Rule = {
  store: string;
  collection_id: string;
  discount_percent: number | string;
};
type Settings = {
  discount_percent: number | string;
  rules: Rule[];
  delivery_fees: Record<string, number | string>;
};
type Collection = { store: string; id: string; title: string };

export default function AffiliatePricing() {
  const [settings, setSettings] = useState<Settings>({
    discount_percent: 35,
    rules: [],
    delivery_fees: { MAD: 33 },
  });
  const [collections, setCollections] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [newCurrency, setNewCurrency] = useState("EUR");
  useEffect(() => {
    affiliateApi("/admin/pricing", undefined, "GET", true)
      .then((result) => {
        setSettings(result.settings);
        setCollections(result.collections);
        setWarnings(result.warnings);
        setReady(true);
      })
      .catch((err) => setError(err.message));
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await affiliateApi(
        "/admin/pricing",
        settings,
        "PUT",
        true,
      );
      setSettings(result.settings);
      setNotice(
        "Marketplace pricing saved. Existing orders keep their original costs and delivery fee.",
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <div>
        <h3 className="font-bold">Marketplace pricing</h3>
        <p className="mt-1 text-sm text-slate-500">
          The affiliate cost is your Shopify selling price minus this discount.
          Your Shopify selling price stays the recommended selling price.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="text-sm text-amber-800">
          {w}
        </p>
      ))}
      <label className="block max-w-sm text-sm font-medium">
        Default discount for all products (%)
        <input
          type="number"
          inputMode="decimal"
          required
          min="0"
          max="100"
          step="0.01"
          value={settings.discount_percent}
          onChange={(e) =>
            setSettings({ ...settings, discount_percent: e.target.value })
          }
          className={`${field} mt-1`}
        />
      </label>
      <section className="rounded-xl border p-4">
        <h4 className="font-semibold">Collection discounts</h4>
        <p className="mt-1 text-xs text-slate-500">
          Collection rules override the default. If a product belongs to several
          selected collections, the last matching rule below applies.
        </p>
        <div className="mt-4 space-y-3">
          {settings.rules.map((rule, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[2fr_1fr_auto]"
            >
              <label className="text-xs">
                Collection
                <select
                  required
                  aria-label={`Collection rule ${i + 1}`}
                  value={`${rule.store}:${rule.collection_id}`}
                  onChange={(e) => {
                    const [store, collection_id] = e.target.value.split(":");
                    setSettings({
                      ...settings,
                      rules: settings.rules.map((r, j) =>
                        j === i ? { ...r, store, collection_id } : r,
                      ),
                    });
                  }}
                  className={`${field} mt-1`}
                >
                  <option value=":">Choose a collection</option>
                  {collections.map((c) => (
                    <option
                      key={`${c.store}:${c.id}`}
                      value={`${c.store}:${c.id}`}
                    >
                      {c.store} · {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Discount (%)
                <input
                  required
                  aria-label={`Collection discount ${i + 1}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={rule.discount_percent}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      rules: settings.rules.map((r, j) =>
                        j === i
                          ? { ...r, discount_percent: e.target.value }
                          : r,
                      ),
                    })
                  }
                  className={`${field} mt-1`}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    rules: settings.rules.filter((_, j) => j !== i),
                  })
                }
                className={`${secondary} self-end`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={!collections.length}
          onClick={() =>
            setSettings({
              ...settings,
              rules: [
                ...settings.rules,
                {
                  store: collections[0].store,
                  collection_id: collections[0].id,
                  discount_percent: 35,
                },
              ],
            })
          }
          className={`${secondary} mt-4`}
        >
          Add collection rule
        </button>
      </section>
      <section className="rounded-xl border p-4">
        <h4 className="font-semibold">Delivery fee deducted from profit</h4>
        <p className="mt-1 text-xs text-slate-500">
          Deducted once per order, not added to the customer’s product price.
          Configure each selling currency separately.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {Object.entries(settings.delivery_fees).map(([currency, fee]) => (
            <label key={currency} className="text-sm">
              Delivery fee ({currency})
              <input
                required
                type="number"
                min="0"
                max="100000"
                step="0.01"
                inputMode="decimal"
                value={fee}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    delivery_fees: {
                      ...settings.delivery_fees,
                      [currency]: e.target.value,
                    },
                  })
                }
                className={`${field} mt-1`}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            aria-label="Add delivery currency"
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value)}
            className={`${field} w-auto`}
          >
            {["MAD", "EUR", "USD", "GBP", "CAD", "AED", "SAR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={newCurrency in settings.delivery_fees}
            onClick={() =>
              setSettings({
                ...settings,
                delivery_fees: { ...settings.delivery_fees, [newCurrency]: 0 },
              })
            }
            className={secondary}
          >
            Add currency
          </button>
        </div>
      </section>
      <button disabled={busy || !ready} className={button}>
        {busy ? "Saving…" : "Save Marketplace pricing"}
      </button>
    </form>
  );
}
