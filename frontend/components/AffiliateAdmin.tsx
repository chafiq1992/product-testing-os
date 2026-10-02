"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AffiliatePricing from "@/components/AffiliatePricing";
import { systemHealthLogin, systemHealthMe } from "@/lib/api";
import {
  affiliateApi,
  money,
  field,
  button,
  secondary,
} from "@/lib/affiliates";

export default function AffiliateAdmin() {
  const [authorized, setAuthorized] = useState(false);
  const [ready, setReady] = useState(false);
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [data, setData] = useState<any>({ sellers: [], connections: [] });
  const [catalog, setCatalog] = useState<any>({
    products: [],
    stores: [],
    warnings: [],
  });
  const [tab, setTab] = useState("sellers");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [review, setReview] = useState<any>({ status: "pending", access: {} });
  const [references, setReferences] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState("MAD");

  async function load() {
    setBusy(true);
    try {
      setData(await affiliateApi("/admin", undefined, "GET", true));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function loadCatalog() {
    setBusy(true);
    try {
      setCatalog(await affiliateApi("/admin/catalog", undefined, "GET", true));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    systemHealthMe()
      .then((result) => {
        if (!result.error) {
          setAuthorized(true);
          void load();
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await systemHealthLogin({
        ...credentials,
        remember: true,
      });
      if (result.error || !result.data?.token)
        throw new Error(result.error || "Sign in failed");
      localStorage.setItem("ptos_system_admin_token", result.data.token);
      setAuthorized(true);
      setCredentials({ email: credentials.email, password: "" });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function openSeller(seller: any) {
    setSelected(seller);
    setReview({ status: seller.status, access: seller.access });
    setError("");
    setNotice("");
    if (!catalog.stores.length) await loadCatalog();
  }
  function toggleVendor(store: string, vendor: string) {
    const previous = review.access[store] || [];
    setReview({
      ...review,
      access: {
        ...review.access,
        [store]: previous.includes(vendor)
          ? previous.filter((v: string) => v !== vendor)
          : [...previous, vendor],
      },
    });
  }
  async function saveReview(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await affiliateApi(
        `/admin/sellers/${selected.id}`,
        review,
        "PATCH",
        true,
      );
      setNotice("Seller status and vendor access saved.");
      setSelected(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function syncSeller(seller: any) {
    setBusy(true);
    setError("");
    try {
      const result = await affiliateApi(
        `/admin/sellers/${seller.id}/sync`,
        {},
        "POST",
        true,
      );
      if (result.warnings?.length) setError(result.warnings.join(" "));
      await load();
      setSelected({ ...seller, ...result });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function payoutAction(id: string, status: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await affiliateApi(
        `/admin/payouts/${id}`,
        { status, reference: references[id] || "" },
        "PATCH",
        true,
      );
      setNotice(
        status === "paid"
          ? "Payout recorded with transfer reference."
          : `Payout ${status}.`,
      );
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const payouts = data.sellers.flatMap((seller: any) =>
    seller.payouts.map((p: any) => ({ ...p, seller_name: seller.name })),
  );
  const total = data.sellers.reduce(
    (sum: any, seller: any) => {
      const a = seller.analytics[currency] || {};
      return {
        sales: sum.sales + (a.sales || 0),
        profit: sum.profit + (a.profit || 0),
        paid: sum.paid + (a.paid || 0),
        orders: sum.orders + (a.orders || 0),
      };
    },
    { sales: 0, profit: 0, paid: 0, orders: 0 },
  );
  const currencies = Array.from(
    new Set([
      "MAD",
      ...data.sellers.flatMap((s: any) => Object.keys(s.analytics)),
    ]),
  ) as string[];
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 md:p-8">
      <header className="mb-6 flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
            Affiliate marketplace
          </p>
          <h2 className="mt-1 text-xl font-bold">Seller administration</h2>
          <p className="mt-2 text-sm text-slate-500">
            Approve sellers, assign Shopify vendors, set pricing, and review
            payouts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/affiliates" className={secondary}>
            Seller dashboard ↗
          </Link>
          <Link href="/settings/connections" className={secondary}>
            Connections
          </Link>
          {authorized && (
            <button disabled={busy} onClick={load} className={secondary}>
              Refresh
            </button>
          )}
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {!ready ? (
        <p>Checking administrator session…</p>
      ) : !authorized ? (
        <form
          onSubmit={signIn}
          className="max-w-md space-y-4 rounded-2xl bg-slate-50 p-5"
        >
          <p className="text-sm text-slate-600">
            Use the same administrator account as Connections to manage sellers.
          </p>
          <label className="block text-sm">
            Email
            <input
              required
              type="email"
              autoComplete="username"
              value={credentials.email}
              onChange={(e) =>
                setCredentials({ ...credentials, email: e.target.value })
              }
              className={`${field} mt-1`}
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={credentials.password}
              onChange={(e) =>
                setCredentials({ ...credentials, password: e.target.value })
              }
              className={`${field} mt-1`}
            />
          </label>
          <button disabled={busy} className={button}>
            Administrator sign in
          </button>
        </form>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {data.connections.map((c: any) => (
              <Link
                key={c.label}
                href={`/settings/connections?store=${encodeURIComponent(c.label)}`}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${c.connected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
              >
                {c.label} · {c.connected ? "Connected" : "Connect store"}
              </Link>
            ))}
          </div>
          <div className="mb-5 flex flex-wrap justify-between gap-3">
            <p className="text-xs text-slate-500">
              {data.delivery?.configured
                ? `Delivery tracking connected: ${data.delivery.base_url}`
                : "Connect your delivery app in Connections for live tracking."}
            </p>
            <select
              aria-label="Admin analytics currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="rounded-lg border px-2 py-1 text-sm"
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            {[
              ["Sales", money(total.sales, currency)],
              ["Seller profit", money(total.profit, currency)],
              ["Paid out", money(total.paid, currency)],
              ["Orders", total.orders],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-bold">{value}</p>
              </div>
            ))}
          </div>
          <nav className="mb-6 flex flex-wrap gap-2">
            {[
              [
                "sellers",
                `Sellers (${data.sellers.filter((s: any) => s.status === "pending").length} pending)`,
              ],
              ["pricing", "Marketplace pricing"],
              [
                "payouts",
                `Payouts (${payouts.filter((p: any) => p.status === "pending").length} pending)`,
              ],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                }}
                className={tab === id ? button : secondary}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "sellers" && (
            <>
              {!data.sellers.length ? (
                <p className="rounded-xl bg-slate-50 p-6 text-sm text-slate-500">
                  No applications yet. Sellers can apply at /affiliates.
                </p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b text-xs text-slate-500">
                      <tr>
                        {[
                          "Seller",
                          "Status",
                          "Vendor access",
                          `Profit (${currency})`,
                          "Manage",
                        ].map((h) => (
                          <th key={h} className="p-3 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.sellers.map((s: any) => (
                        <tr key={s.id} className="border-b">
                          <td className="p-3">
                            <p className="font-semibold">{s.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {s.username} · {s.phone}
                            </p>
                          </td>
                          <td className="p-3 capitalize">{s.status}</td>
                          <td className="max-w-64 p-3 text-xs text-slate-500">
                            {Object.entries(s.access).map(
                              ([store, vendors]) => (
                                <p key={store}>
                                  {store}: {(vendors as string[]).join(", ")}
                                </p>
                              ),
                            )}
                            {!Object.keys(s.access).length &&
                              "No vendors assigned"}
                          </td>
                          <td className="p-3">
                            {money(
                              s.analytics[currency]?.profit || 0,
                              currency,
                            )}
                          </td>
                          <td className="p-3">
                            <button
                              disabled={busy}
                              onClick={() => openSeller(s)}
                              className={secondary}
                            >
                              Review & analytics
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {selected && (
                <form
                  onSubmit={saveReview}
                  className="mt-6 rounded-2xl border bg-slate-50 p-5"
                >
                  <div className="flex justify-between gap-3">
                    <h3 className="font-bold">{selected.name}</h3>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="text-sm text-slate-500"
                    >
                      Close
                    </button>
                  </div>
                  <label className="my-4 block max-w-xs text-sm">
                    Account status
                    <select
                      value={review.status}
                      onChange={(e) =>
                        setReview({ ...review, status: e.target.value })
                      }
                      className={`${field} mt-1`}
                    >
                      {["pending", "approved", "rejected", "suspended"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <p className="mb-3 text-sm font-semibold">
                    Allowed Shopify vendors by store
                  </p>
                  {catalog.warnings.map((w: string) => (
                    <p key={w} className="mb-3 text-xs text-amber-800">
                      {w}
                    </p>
                  ))}
                  {catalog.stores.map((connection: any) => (
                    <fieldset
                      key={connection.label}
                      className="mb-4 rounded-xl border bg-white p-4"
                    >
                      <legend className="px-1 text-sm font-semibold">
                        {connection.label}
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        {Array.from(
                          new Set([
                            ...connection.vendors,
                            ...(review.access[connection.label] || []),
                          ]),
                        )
                          .filter(Boolean)
                          .map((v) => (
                            <label
                              key={String(v)}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={(
                                  review.access[connection.label] || []
                                ).includes(v)}
                                onChange={() =>
                                  toggleVendor(connection.label, String(v))
                                }
                              />
                              {String(v)}
                            </label>
                          ))}
                      </div>
                    </fieldset>
                  ))}
                  {!catalog.stores.length && (
                    <p className="mb-4 text-sm text-slate-500">
                      Connect stores and refresh the catalog to choose vendors.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button disabled={busy} className={button}>
                      Save seller access
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => syncSeller(selected)}
                      className={secondary}
                    >
                      Refresh sales & orders
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={loadCatalog}
                      className={secondary}
                    >
                      Refresh vendors
                    </button>
                  </div>
                  <div className="mt-5 space-y-3">
                    {Object.entries(selected.analytics).map(([c, a]) => (
                      <p key={c} className="text-sm">
                        {c}: {money((a as any).sales, c)} sales ·{" "}
                        {money((a as any).profit, c)} profit ·{" "}
                        {money((a as any).available, c)} available
                      </p>
                    ))}
                  </div>
                  {selected.orders
                    .filter((o: any) => o.state !== "created")
                    .map((o: any) => (
                      <ReconcileEditor
                        key={o.id}
                        order={o}
                        onSaved={() => syncSeller(selected)}
                        onError={setError}
                      />
                    ))}
                  {selected.orders.length > 0 && (
                    <div className="mt-5 max-h-80 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr>
                            {[
                              "Order",
                              "Store",
                              "Delivery",
                              "Sale",
                              "Profit",
                            ].map((h) => (
                              <th key={h} className="p-2">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selected.orders.map((o: any) => (
                            <tr key={o.id} className="border-t">
                              <td className="p-2">{o.name}</td>
                              <td className="p-2">{o.store}</td>
                              <td className="p-2">
                                {o.state === "created"
                                  ? o.delivery_status || o.status
                                  : o.state}
                              </td>
                              <td className="p-2">
                                {money(o.total, o.currency)}
                              </td>
                              <td className="p-2">
                                {money(o.profit, o.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </form>
              )}
            </>
          )}
          {tab === "pricing" && <AffiliatePricing />}
          {tab === "payouts" && (
            <>
              {!payouts.length ? (
                <p className="rounded-xl bg-slate-50 p-6 text-sm text-slate-500">
                  No payout requests yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {payouts.map((p: any) => (
                    <article key={p.id} className="rounded-xl border p-5">
                      <div className="flex flex-wrap justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">
                            {p.seller_name} · {money(p.amount, p.currency)}
                          </h3>
                          <p className="mt-1 text-xs capitalize text-slate-500">
                            {p.status} ·{" "}
                            {new Date(p.created_at).toLocaleDateString()}
                          </p>
                          <p className="mt-3 break-words text-sm">
                            {p.destination}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-start gap-2">
                          {p.status === "pending" && (
                            <button
                              disabled={busy}
                              onClick={() => payoutAction(p.id, "approved")}
                              className={button}
                            >
                              Approve payout
                            </button>
                          )}
                          {["pending", "approved"].includes(p.status) && (
                            <button
                              disabled={busy}
                              onClick={() => payoutAction(p.id, "rejected")}
                              className={secondary}
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                      {p.status === "approved" && (
                        <div className="mt-4 flex flex-wrap gap-3">
                          <label className="flex-1 text-xs">
                            Transfer reference
                            <input
                              placeholder="Bank transfer / payment reference"
                              value={references[p.id] || ""}
                              onChange={(e) =>
                                setReferences({
                                  ...references,
                                  [p.id]: e.target.value,
                                })
                              }
                              className={`${field} mt-1`}
                            />
                          </label>
                          <button
                            disabled={busy || !references[p.id]?.trim()}
                            onClick={() => payoutAction(p.id, "paid")}
                            className={`${button} self-end`}
                          >
                            Record as paid
                          </button>
                          <p className="w-full text-xs text-slate-500">
                            Record after making the transfer. This dashboard
                            does not send money automatically.
                          </p>
                        </div>
                      )}
                      {p.reference && (
                        <p className="mt-3 text-xs text-slate-500">
                          Transfer reference: {p.reference}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function ReconcileEditor({
  order,
  onSaved,
  onError,
}: {
  order: any;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [shopifyId, setShopifyId] = useState("");
  const [busy, setBusy] = useState(false);
  async function reconcile() {
    setBusy(true);
    try {
      await affiliateApi(
        `/admin/orders/${order.id}/reconcile`,
        { shopify_id: shopifyId },
        "POST",
        true,
      );
      onSaved();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold">
        Submission needs review · {order.store} · {order.name}
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Find this submission in Shopify and enter its numeric order ID. The
        seller and submission tags must match before it can be linked.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label="Shopify order ID to reconcile"
          inputMode="numeric"
          placeholder="Numeric Shopify order ID"
          value={shopifyId}
          onChange={(e) => setShopifyId(e.target.value)}
          className={`${field} max-w-xs`}
        />
        <button
          type="button"
          disabled={busy || !/^\d+$/.test(shopifyId)}
          onClick={reconcile}
          className={secondary}
        >
          Link verified order
        </button>
      </div>
    </div>
  );
}
