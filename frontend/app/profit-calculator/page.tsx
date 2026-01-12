"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { DollarSign, Plus, RefreshCw, Rocket, Save, Trash2 } from "lucide-react"
import {
  type ProfitCard,
  profitCardsList,
  profitCardCreate,
  profitCardDelete,
  profitCardRefresh,
  profitCostsList,
  profitCostsUpsert,
  usdToMadRateGet,
  usdToMadRateSet,
} from "@/lib/api"

function fmtMad(v: number) {
  const n = Number(v || 0)
  try {
    return n.toLocaleString(undefined, { style: "currency", currency: "MAD", maximumFractionDigits: 2 })
  } catch {
    return `${n.toFixed(2)} MAD`
  }
}

function computeRange(preset: string) {
  const now = new Date()
  const toYmd = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }
  const endDate = new Date(now)
  const startDate = new Date(now)
  switch (preset) {
    case "today":
      startDate.setHours(0, 0, 0, 0)
      break
    case "yesterday": {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      d.setHours(0, 0, 0, 0)
      const e = new Date(d)
      e.setHours(23, 59, 59, 999)
      return { start: toYmd(d), end: toYmd(e) }
    }
    case "last_3d_incl_today":
      startDate.setDate(startDate.getDate() - (3 - 1))
      break
    case "last_4d_incl_today":
      startDate.setDate(startDate.getDate() - (4 - 1))
      break
    case "last_5d_incl_today":
      startDate.setDate(startDate.getDate() - (5 - 1))
      break
    case "last_6d_incl_today":
      startDate.setDate(startDate.getDate() - (6 - 1))
      break
    case "last_7d_incl_today":
    default:
      startDate.setDate(startDate.getDate() - (7 - 1))
      break
  }
  startDate.setHours(0, 0, 0, 0)
  return { start: toYmd(startDate), end: toYmd(endDate) }
}

function effectiveYmdRange(preset: string, customStart: string, customEnd: string) {
  if (preset === "custom" && customStart && customEnd) return { start: customStart, end: customEnd }
  return computeRange(preset)
}

export default function ProfitCalculatorPage() {
  const [store, setStore] = useState<string>(() => {
    try {
      return localStorage.getItem("ptos_store") || "irrakids"
    } catch {
      return "irrakids"
    }
  })

  const [cards, setCards] = useState<ProfitCard[]>([])
  const [costsByProduct, setCostsByProduct] = useState<Record<string, { product_cost?: number | null; service_delivery_cost?: number | null }>>({})

  const [usdToMadRate, setUsdToMadRate] = useState<number>(10)
  const [usdToMadDraft, setUsdToMadDraft] = useState<string>("10")
  const [savingRate, setSavingRate] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // New product modal state
  const [newOpen, setNewOpen] = useState(false)
  const [newProductId, setNewProductId] = useState("")
  const [datePreset, setDatePreset] = useState<string>("last_7d_incl_today")
  const [customStart, setCustomStart] = useState<string>("")
  const [customEnd, setCustomEnd] = useState<string>("")
  const [savingCard, setSavingCard] = useState(false)

  async function reloadCards() {
    setLoading(true)
    setError(undefined)
    try {
      const res = await profitCardsList(store)
      if ((res as any)?.error) throw new Error(String((res as any).error))
      setCards((((res as any)?.data || []) as any) || [])
    } catch (e: any) {
      setError(String(e?.message || e))
      setCards([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const { start, end } = computeRange("last_7d_incl_today")
    setCustomStart(start)
    setCustomEnd(end)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(undefined)
      try {
        const [cardsRes, costsRes, rateRes] = await Promise.allSettled([profitCardsList(store), profitCostsList(store), usdToMadRateGet(store)])
        if (cancelled) return
        if (cardsRes.status === "fulfilled") setCards((((cardsRes.value as any)?.data || []) as any) || [])
        if (costsRes.status === "fulfilled") setCostsByProduct((((costsRes.value as any)?.data || {}) as any) || {})
        if (rateRes.status === "fulfilled") {
          const r = Number(((rateRes.value as any)?.data || {})?.rate ?? 10)
          setUsdToMadRate(r)
          setUsdToMadDraft(String(r))
        }
      } catch (e: any) {
        if (cancelled) return
        setError(String(e?.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store])

  const totalSpendMad = useMemo(() => {
    let sum = 0
    for (const c of cards || []) {
      for (const r of c.campaigns || []) sum += Number((r as any).spend_mad || 0)
    }
    return sum
  }, [cards])

  const totalPaidOrders = useMemo(() => {
    let sum = 0
    for (const c of cards || []) sum += Number((c.shopify as any)?.paid_orders_total || 0)
    return sum
  }, [cards])

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="min-h-16 py-2 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-emerald-600" />
          <h1 className="font-semibold text-lg">Profit calculator</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={store}
            onChange={(e) => {
              const v = e.target.value
              setStore(v)
              try {
                localStorage.setItem("ptos_store", v)
              } catch {}
            }}
            className="rounded-xl border px-2 py-1 text-sm bg-white"
          >
            <option value="irrakids">irrakids</option>
            <option value="irranova">irranova</option>
          </select>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">USD→MAD</span>
            <input className="w-24 rounded-xl border px-2 py-1 text-sm bg-white" value={usdToMadDraft} onChange={(e) => setUsdToMadDraft(e.target.value)} inputMode="decimal" />
            <button
              onClick={async () => {
                const v = Number(usdToMadDraft || 0) || 10
                setSavingRate(true)
                try {
                  const res = await usdToMadRateSet({ rate: v, store })
                  if ((res as any)?.error) throw new Error(String((res as any).error))
                  const r = Number(((res as any)?.data || {})?.rate ?? v)
                  setUsdToMadRate(r)
                  setUsdToMadDraft(String(r))
                } catch {
                  // ignore
                } finally {
                  setSavingRate(false)
                }
              }}
              disabled={savingRate}
              className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-900 text-sm disabled:opacity-60"
            >
              <Save className="w-4 h-4" /> {savingRate ? "Saving…" : "Save rate"}
            </button>
          </div>

          <button onClick={reloadCards} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Loading…" : "Refresh list"}
          </button>

          <button onClick={() => setNewOpen(true)} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm">
            <Plus className="w-4 h-4" /> New product
          </button>

          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">
            Home
          </Link>
        </div>
      </header>

      <div className="p-4 md:p-6">
        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        <div className="mb-4 rounded-2xl overflow-hidden shadow-lg bg-gradient-to-r from-emerald-600 via-green-600 to-lime-500 text-white">
          <div className="p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <div>
                <div className="text-xs uppercase/relaxed opacity-80">Store</div>
                <div className="text-lg font-semibold">{store}</div>
                <div className="text-xs opacity-80">Saved cards: {(cards || []).length} • USD→MAD: {usdToMadRate}</div>
              </div>
              <div className="text-sm opacity-90 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                <span>Profit overview</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="text-xs opacity-90">Total Spend (MAD)</div>
                <div className="mt-1 text-xl font-bold">{fmtMad(totalSpendMad)}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="text-xs opacity-90">Paid Orders (all cards)</div>
                <div className="mt-1 text-xl font-bold">{totalPaidOrders}</div>
              </div>
            </div>
          </div>
        </div>

        {!loading && (cards || []).length === 0 && (
          <div className="flex items-center justify-center py-16">
            <button onClick={() => setNewOpen(true)} className="rounded-2xl px-8 py-6 text-lg font-bold bg-emerald-700 hover:bg-emerald-800 text-white inline-flex items-center gap-3">
              <Plus className="w-6 h-6" /> New product
            </button>
          </div>
        )}

        <div className="space-y-4">
          {(cards || []).map((card) => {
            const pid = String(card.product_id || "")
            const savedCosts = costsByProduct[pid] || (card.costs as any) || {}
            const productCost = Number((savedCosts as any).product_cost || 0)
            const serviceCost = Number((savedCosts as any).service_delivery_cost || 0)
            const priceMad = Number((card.product as any)?.price_mad || 0)
            const paid = Number((card.shopify as any)?.paid_orders_total || 0)
            const revenueMad = priceMad * paid
            const inv = (card.product as any)?.inventory
            return (
              <div key={card.id} className="bg-white border rounded-none">
                <div className="px-4 py-3 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {(card.product as any)?.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={(card.product as any).image} alt="product" className="w-14 h-14 rounded object-cover border" />
                    ) : (
                      <div className="w-14 h-14 rounded border bg-slate-50" />
                    )}
                    <div>
                      <div className="font-semibold">Product {pid}</div>
                      <div className="text-xs text-slate-600">
                        Range: {(card.range as any)?.start} to {(card.range as any)?.end} • Updated: {String(card.updated_at || "").replace("T", " ").replace("Z", "") || "—"}
                      </div>
                      <div className="text-xs text-slate-600">
                        Price: {priceMad ? fmtMad(priceMad) : "—"} • Paid orders: {paid} • Revenue: {fmtMad(revenueMad)} • Inventory: {inv ?? "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        setLoading(true)
                        setError(undefined)
                        try {
                          const res = await profitCardRefresh({ card_id: card.id, store })
                          if ((res as any)?.error) throw new Error(String((res as any).error))
                          const next = (res as any)?.data
                          setCards((prev) => prev.map((c) => (c.id === card.id ? (next as any) : c)))
                        } catch (e: any) {
                          setError(String(e?.message || e))
                        } finally {
                          setLoading(false)
                        }
                      }}
                      className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
                      disabled={loading}
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </button>
                    <button
                      onClick={async () => {
                        const ok = window.confirm("Delete this card?")
                        if (!ok) return
                        try {
                          const res = await profitCardDelete({ card_id: card.id, store })
                          if ((res as any)?.error) throw new Error(String((res as any).error))
                          setCards((prev) => prev.filter((c) => c.id !== card.id))
                        } catch (e: any) {
                          setError(String(e?.message || e))
                        }
                      }}
                      className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 text-sm"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                </div>

                <div className="p-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-semibold">Campaign</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold text-right">Spend (MAD)</th>
                        <th className="px-3 py-2 font-semibold text-right">Product cost</th>
                        <th className="px-3 py-2 font-semibold text-right">Service + delivery</th>
                        <th className="px-3 py-2 font-semibold text-right">Net profit (MAD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(card.campaigns || []).map((r, idx) => {
                        const spendMad = Number((r as any).spend_mad || 0)
                        const net = revenueMad - spendMad - productCost - serviceCost
                        const netClass = net >= 0 ? "bg-emerald-600" : "bg-rose-600"
                        const st = String((r as any).status || "").toUpperCase()
                        const active = st === "ACTIVE"
                        const statusClass = active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                        return (
                          <tr key={String((r as any).campaign_id || idx)} className="border-b last:border-b-0">
                            <td className="px-3 py-2 whitespace-nowrap">{(r as any).name || (r as any).campaign_id || "-"}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass}`}>{active ? "Active" : "Paused"}</span>
                            </td>
                            <td className="px-3 py-2 text-right">{fmtMad(spendMad)}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                value={String((savedCosts as any).product_cost ?? "")}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value)
                                  setCostsByProduct((prev) => ({ ...prev, [pid]: { ...(prev[pid] || {}), product_cost: v } }))
                                }}
                                onBlur={async () => {
                                  const rec = costsByProduct[pid] || savedCosts || {}
                                  try {
                                    await profitCostsUpsert({ product_id: pid, product_cost: (rec as any).product_cost ?? null, store })
                                  } catch {
                                    // ignore
                                  }
                                }}
                                className="w-28 rounded-md border px-2 py-1 text-sm bg-white"
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                step="0.01"
                                value={String((savedCosts as any).service_delivery_cost ?? "")}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? null : Number(e.target.value)
                                  setCostsByProduct((prev) => ({ ...prev, [pid]: { ...(prev[pid] || {}), service_delivery_cost: v } }))
                                }}
                                onBlur={async () => {
                                  const rec = costsByProduct[pid] || savedCosts || {}
                                  try {
                                    await profitCostsUpsert({ product_id: pid, service_delivery_cost: (rec as any).service_delivery_cost ?? null, store })
                                  } catch {
                                    // ignore
                                  }
                                }}
                                className="w-36 rounded-md border px-2 py-1 text-sm bg-white"
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className={`w-full min-w-44 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-white font-bold ${netClass}`}>
                                <span className="text-white/90">MAD</span>
                                <span>{Number(net || 0).toFixed(2)}</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                      {(card.campaigns || []).length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                            No campaigns found for this product in this range. Click Refresh.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNewOpen(false)} />
          <div className="relative bg-white rounded-xl border shadow-xl w-[92vw] max-w-xl p-4">
            <div className="font-semibold text-lg mb-3">New product</div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="text-xs text-slate-600 mb-1">Product ID</div>
                <input
                  value={newProductId}
                  onChange={(e) => setNewProductId(e.target.value.replace(/[^0-9]/g, ""))}
                  className="w-full rounded-xl border px-3 py-2"
                  placeholder="e.g. 123456789"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className="rounded-xl border px-2 py-2 text-sm bg-white">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last_3d_incl_today">Last 3 days (including today)</option>
                  <option value="last_4d_incl_today">Last 4 days (including today)</option>
                  <option value="last_5d_incl_today">Last 5 days (including today)</option>
                  <option value="last_6d_incl_today">Last 6 days (including today)</option>
                  <option value="last_7d_incl_today">Last 7 days (including today)</option>
                  <option value="custom">Custom…</option>
                </select>
                {datePreset === "custom" && (
                  <div className="flex items-center gap-1 text-sm">
                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-xl border px-2 py-2 bg-white" />
                    <span>to</span>
                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-xl border px-2 py-2 bg-white" />
                  </div>
                )}
              </div>
              <div className="text-xs text-slate-600">
                Range:{" "}
                {(() => {
                  const r = effectiveYmdRange(datePreset, customStart, customEnd)
                  return `${r.start} to ${r.end}`
                })()}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNewOpen(false)} className="rounded-xl px-4 py-2 border bg-white hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={async () => {
                  const pid = String(newProductId || "").trim()
                  const { start, end } = effectiveYmdRange(datePreset, customStart, customEnd)
                  if (!pid || !/^\d+$/.test(pid)) {
                    alert("Enter a valid numeric product id")
                    return
                  }
                  setSavingCard(true)
                  setError(undefined)
                  try {
                    const res = await profitCardCreate({ product_id: pid, start, end, store })
                    if ((res as any)?.error) throw new Error(String((res as any).error))
                    const card = (res as any)?.data
                    if (card) setCards((prev) => [card as any, ...prev])
                    setNewOpen(false)
                    setNewProductId("")
                  } catch (e: any) {
                    setError(String(e?.message || e))
                  } finally {
                    setSavingCard(false)
                  }
                }}
                disabled={savingCard}
                className="rounded-xl px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold disabled:opacity-60 inline-flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> {savingCard ? "Saving…" : "Save card"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


