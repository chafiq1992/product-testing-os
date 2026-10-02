"use client";
import { useState } from "react";
import { AffiliateCustomer, field, money, secondary } from "@/lib/affiliates";

export default function AffiliateCustomers({
  customers,
  useCustomer,
}: {
  customers: AffiliateCustomer[];
  useCustomer: (customer: AffiliateCustomer) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState("");
  const filtered = customers.filter((c) =>
    `${c.customer_name} ${c.customer_phone} ${c.city}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section aria-label="Your customers">
      <h2 className="text-lg font-bold">Customer list</h2>
      <p className="mt-1 text-sm text-slate-500">
        Customers are saved when you create an order. Only your customer list
        appears here.
      </p>
      <input
        aria-label="Search customers"
        placeholder="Search name, phone or city"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={`${field} my-4`}
      />
      {!filtered.length ? (
        <p className="rounded-xl border border-dashed bg-white p-6 text-sm text-slate-500">
          No customers found.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <article key={c.id} className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-bold">{c.customer_name}</h3>
                  <a
                    href={`tel:${c.customer_phone}`}
                    className="mt-1 inline-flex min-h-11 items-center text-sm text-emerald-800"
                  >
                    {c.customer_phone}
                  </a>
                  <p className="break-words text-xs text-slate-500">
                    {c.address} · {c.city}
                  </p>
                </div>
                <button onClick={() => useCustomer(c)} className={secondary}>
                  New order
                </button>
              </div>
              <button
                onClick={() => setExpanded(expanded === c.id ? "" : c.id)}
                aria-expanded={expanded === c.id}
                className="mt-3 min-h-11 text-sm font-semibold text-slate-600"
              >
                {c.orders_count} {c.orders_count === 1 ? "order" : "orders"} ·{" "}
                {expanded === c.id ? "Hide history" : "View history"}
              </button>
              {expanded === c.id && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  {c.orders.map((o) => (
                    <div
                      key={o.id}
                      className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"
                    >
                      <div>
                        <p className="font-semibold">{o.name}</p>
                        <p className="mt-1 text-xs capitalize text-slate-500">
                          {o.status.replaceAll("_", " ")} ·{" "}
                          {new Date(o.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p>{money(o.total, o.currency)}</p>
                        <p className="mt-1 text-xs text-emerald-800">
                          Earned {money(o.profit, o.currency)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
