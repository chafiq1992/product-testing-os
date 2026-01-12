"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Rocket, RefreshCw, DollarSign } from "lucide-react"
import {
  fetchMetaCampaigns,
  type MetaCampaignRow,
  metaGetAdAccount,
  metaListAdAccounts,
  metaSetAdAccount,
  shopifyOrdersCountByTitle,
  shopifyOrdersCountPaidByTitle,
  shopifyProductsBrief,
  campaignMappingsList,
  campaignMappingUpsert,
  profitCostsList,
  profitCostsUpsert,
} from "@/lib/api"

export default function ProfitCalculatorPage() {
  const [items, setItems] = useState<MetaCampaignRow[]>([])
  const [loading, setLoading] = useState(false)
  const loadSeqToken = useRef(0)
  const [error, setError] = useState<string | undefined>(undefined)

  const [store, setStore] = useState<string>(() => {
    try {
      return localStorage.getItem("ptos_store") || "irrakids"
    } catch {
      return "irrakids"
    }
  })
  const [adAccount, setAdAccount] = useState<string>(() => {
    try {
      return localStorage.getItem("ptos_ad_account") || ""
    } catch {
      return ""
    }
  })
  const [adAccountName, setAdAccountName] = useState<string>("")
  const [adAccounts, setAdAccounts] = useState<Array<{ id: string; name: string; account_status?: number }>>([])

  const [datePreset, setDatePreset] = useState<string>("last_7d_incl_today")
  const [customStart, setCustomStart] = useState<string>("")
  const [customEnd, setCustomEnd] = useState<string>("")

  const [manualIds, setManualIds] = useState<Record<string, { kind: "product" | "collection"; id: string }>>({})
  const [manualDrafts, setManualDrafts] = useState<Record<string, { kind: "product" | "collection"; id: string }>>({})

  const [shopifyOrders, setShopifyOrders] = useState<Record<string, number>>({})
  const [paidOrders, setPaidOrders] = useState<Record<string, number>>({})
  const [productBriefs, setProductBriefs] = useState<Record<string, { image?: string | null; total_available: number; price?: number | null }>>({})

  const [costsByProduct, setCostsByProduct] = useState<Record<string, { product_cost?: number | null; service_delivery_cost?: number | null }>>({})

  function fmtCurrency(v: number) {
    try {
      return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    } catch {
      return `$${(v || 0).toFixed(2)}`
    }
  }

  function extractNumericId(s?: string | null) {
    const n = String(s || "")
    const m = n.match(/(\d{3,})/)
    return m ? m[1] : null
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

  function presetLabel(p: string) {
    switch (p) {
      case "today":
        return "today"
      case "yesterday":
        return "yesterday"
      case "last_3d_incl_today":
        return "last 3 days (including today)"
      case "last_4d_incl_today":
        return "last 4 days (including today)"
      case "last_5d_incl_today":
        return "last 5 days (including today)"
      case "last_6d_incl_today":
        return "last 6 days (including today)"
      case "last_7d_incl_today":
        return "last 7 days (including today)"
      case "custom":
        return "custom"
      default:
        return p
    }
  }

  function metaRangeParams(preset: string): { datePreset?: string; range?: { start: string; end: string } } {
    if (preset === "custom") {
      if (customStart && customEnd) return { range: { start: customStart, end: customEnd } }
      const { start, end } = computeRange("last_7d_incl_today")
      return { range: { start, end } }
    }
    if (
      preset === "last_3d_incl_today" ||
      preset === "last_4d_incl_today" ||
      preset === "last_5d_incl_today" ||
      preset === "last_6d_incl_today" ||
      preset === "last_7d_incl_today"
    ) {
      const { start, end } = computeRange(preset)
      return { range: { start, end } }
    }
    if (preset === "today") return { datePreset: "today" }
    if (preset === "yesterday") return { datePreset: "yesterday" }
    const { start, end } = computeRange("last_7d_incl_today")
    return { range: { start, end } }
  }

  function effectiveYmdRange(preset: string) {
    if (preset === "custom" && customStart && customEnd) return { start: customStart, end: customEnd }
    return computeRange(preset)
  }

  function productIdForRow(row: MetaCampaignRow): string | null {
    const rowKey = String(row.campaign_id || row.name || "")
    const manual = manualIds[rowKey]
    if (manual && manual.kind === "product" && manual.id && /^\d+$/.test(manual.id)) return manual.id
    return extractNumericId(row.name || "")
  }

  async function load(preset?: string, opts?: { store?: string; adAccount?: string }) {
    const loadToken = ++loadSeqToken.current
    setLoading(true)
    setError(undefined)
    try {
      const effPreset = preset || datePreset
      const effStore = opts?.store ?? store
      const effAdAccount = opts?.adAccount ?? adAccount
      const metaParams = metaRangeParams(effPreset)
      const res = await fetchMetaCampaigns(metaParams.datePreset, effAdAccount || undefined, metaParams.range)
      if (loadToken !== loadSeqToken.current) return
      if ((res as any)?.error) {
        setError(String((res as any).error))
        setItems([])
      } else {
        const rows: MetaCampaignRow[] = ((res as any)?.data || []) as MetaCampaignRow[]
        setItems((rows || []).filter((r) => Number(r.spend || 0) > 0))
      }

      setShopifyOrders({})
      setPaidOrders({})
      setProductBriefs({})

      const { start, end } = effectiveYmdRange(effPreset)

      const ranked = (((res as any)?.data || []) as MetaCampaignRow[]).slice().sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
      const idsOrdered: string[] = []
      const seen: Record<string, true> = {}
      for (const c of ranked) {
        const pid = productIdForRow(c)
        if (pid && !seen[pid]) {
          seen[pid] = true
          idsOrdered.push(pid)
        }
      }
      if (!idsOrdered.length) return

      const chunkSize = 8
      for (let i = 0; i < idsOrdered.length; i += chunkSize) {
        if (loadToken !== loadSeqToken.current) return
        const chunk = idsOrdered.slice(i, i + chunkSize)
        try {
          const pb = await shopifyProductsBrief({ ids: chunk, store: effStore })
          if (loadToken !== loadSeqToken.current) return
          setProductBriefs((prev) => ({ ...prev, ...(((pb as any)?.data || {}) as any) }))
        } catch {}
        try {
          const oc = await shopifyOrdersCountByTitle({ names: chunk, start, end, include_closed: true, date_field: "processed", store: effStore })
          if (loadToken !== loadSeqToken.current) return
          const map = ((oc as any)?.data || {}) as Record<string, number>
          setShopifyOrders((prev) => ({ ...prev, ...map }))
        } catch {}
        try {
          const pc = await shopifyOrdersCountPaidByTitle({ names: chunk, start, end, include_closed: true, date_field: "processed", store: effStore })
          if (loadToken !== loadSeqToken.current) return
          const map = ((pc as any)?.data || {}) as Record<string, number>
          setPaidOrders((prev) => ({ ...prev, ...map }))
        } catch {}
      }
    } catch (e: any) {
      setError(String(e?.message || e))
      setItems([])
    } finally {
      if (loadToken === loadSeqToken.current) setLoading(false)
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
      try {
        const res = await metaListAdAccounts()
        if (cancelled) return
        setAdAccounts(((res as any)?.data || []) as any)
      } catch {
        if (cancelled) return
        setAdAccounts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [mappingsRes, costsRes] = await Promise.allSettled([campaignMappingsList(store), profitCostsList(store)])
        if (cancelled) return
        if (mappingsRes.status === "fulfilled") {
          const map = ((mappingsRes.value as any)?.data || {}) as Record<string, { kind: "product" | "collection"; id: string }>
          const shaped: Record<string, { kind: "product" | "collection"; id: string }> = {}
          for (const k of Object.keys(map || {})) {
            const v = (map as any)[k]
            if (v && (v.kind === "product" || v.kind === "collection") && v.id) shaped[k] = { kind: v.kind, id: v.id }
          }
          setManualIds(shaped)
        }
        if (costsRes.status === "fulfilled") {
          setCostsByProduct((((costsRes.value as any)?.data || {}) as any) || {})
        }

        // Load store-scoped default ad account then campaigns
        try {
          const res = await metaGetAdAccount(store)
          if (cancelled) return
          const conf = (res as any)?.data || {}
          const nextId = conf && conf.id ? String(conf.id || "") : ""
          const nextName = conf && conf.name ? String(conf.name || "") : ""
          if (nextId) {
            setAdAccount(nextId)
            try {
              localStorage.setItem("ptos_ad_account", nextId)
            } catch {}
          } else {
            setAdAccount("")
          }
          setAdAccountName(nextName || "")
          load(undefined, { store, adAccount: nextId || undefined })
        } catch {
          if (cancelled) return
          load(undefined, { store, adAccount })
        }
      } catch {
        if (cancelled) return
        load(undefined, { store, adAccount })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const totalSpend = useMemo(() => (items || []).reduce((acc, it) => acc + Number(it.spend || 0), 0), [items])
  const totalPaidOrders = useMemo(() => {
    let sum = 0
    for (const r of items || []) {
      const pid = productIdForRow(r)
      if (!pid) continue
      sum += Number(paidOrders[pid] || 0)
    }
    return sum
  }, [items, paidOrders, manualIds])

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
          <div className="flex items-center gap-1">
            <select
              value={adAccount}
              onChange={async (e) => {
                const v = e.target.value
                setAdAccount(v)
                try {
                  localStorage.setItem("ptos_ad_account", v)
                } catch {}
                try {
                  const res = await metaSetAdAccount({ id: v, store })
                  const data = (res as any)?.data || {}
                  setAdAccountName(String(data?.name || adAccounts.find((a) => a.id === v)?.name || ""))
                } catch {}
                load(undefined, { adAccount: v })
              }}
              className="rounded-xl border px-2 py-1 text-sm bg-white w-44 sm:w-56 md:w-72"
            >
              <option value="">Select ad account…</option>
              {adAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id} ({a.id})
                </option>
              ))}
            </select>
            {adAccountName ? <span className="text-xs text-slate-600">{adAccountName}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={datePreset}
              onChange={(e) => {
                const v = e.target.value
                setDatePreset(v)
                if (v !== "custom") load(v)
              }}
              className="rounded-xl border px-2 py-1 text-sm bg-white"
            >
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
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-xl border px-2 py-1 bg-white" />
                <span>to</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-xl border px-2 py-1 bg-white" />
                <button onClick={() => load("custom")} className="rounded-xl font-semibold inline-flex items-center gap-2 px-2 py-1 bg-slate-200 hover:bg-slate-300">
                  Apply
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => load()}
            className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Updating…" : "Refresh"}
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
                <div className="text-xs uppercase/relaxed opacity-80">Ad account</div>
                <div className="text-lg font-semibold">{adAccountName || adAccount || "—"}</div>
                <div className="text-xs opacity-80">
                  Range: {datePreset === "custom" ? `${customStart || "—"} to ${customEnd || "—"}` : presetLabel(datePreset)} • Store: {store}
                </div>
              </div>
              <div className="text-sm opacity-90 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                <span>Profit overview</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="text-xs opacity-90">Total Spend</div>
                <div className="mt-1 text-xl font-bold">{fmtCurrency(totalSpend)}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="text-xs opacity-90">Paid Orders (table)</div>
                <div className="mt-1 text-xl font-bold">{totalPaidOrders}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto bg-white border rounded-none">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/90 backdrop-blur supports-backdrop-blur:bg-slate-50/60 border-b shadow-sm">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">Campaign</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold text-right">Spend</th>
                <th className="px-3 py-2 font-semibold text-emerald-700">Shopify Orders</th>
                <th className="px-3 py-2 font-semibold text-emerald-800">Paid Orders</th>
                <th className="px-3 py-2 font-semibold text-right">Product price</th>
                <th className="px-3 py-2 font-semibold text-right">Inventory</th>
                <th className="px-3 py-2 font-semibold text-right">Product cost</th>
                <th className="px-3 py-2 font-semibold text-right">Service + delivery</th>
                <th className="px-3 py-2 font-semibold text-right">Net profit</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                    No campaigns with spend in this range.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((c) => {
                  const rowKey = String(c.campaign_id || c.name || "")
                  const pid = productIdForRow(c)
                  const brief = pid ? productBriefs[pid] : undefined
                  const img = brief?.image
                  const inv = brief ? Number(brief.total_available || 0) : null
                  const price = brief?.price
                  const orders = pid ? Number(shopifyOrders[pid] || 0) : null
                  const paid = pid ? Number(paidOrders[pid] || 0) : null
                  const costRec = pid ? costsByProduct[pid] || {} : {}
                  const productCost = Number(costRec.product_cost || 0)
                  const serviceCost = Number(costRec.service_delivery_cost || 0)
                  const net = (Number(price || 0) * Number(paid || 0) - Number(c.spend || 0) - productCost - serviceCost) || 0
                  const netClass = net >= 0 ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                  const status = String(c.status || "").toUpperCase()
                  const active = status === "ACTIVE"
                  const statusClass = active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                  const draft = manualDrafts[rowKey] || manualIds[rowKey] || { kind: "product" as const, id: "" }
                  return (
                    <tr key={rowKey} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="product" className="w-16 h-16 rounded object-cover border" />
                          ) : pid ? (
                            <span className="inline-block w-16 h-16 rounded bg-slate-100 border animate-pulse" />
                          ) : (
                            <span className="inline-block w-16 h-16 rounded bg-slate-50 border" />
                          )}
                          <div className="space-y-1">
                            <div className="text-xs text-slate-500">Product ID</div>
                            <div className="font-mono text-sm">{pid || "—"}</div>
                            <div className="flex items-center gap-1">
                              <select
                                value={draft.kind}
                                onChange={(e) =>
                                  setManualDrafts((prev) => ({ ...prev, [rowKey]: { ...(prev[rowKey] || { id: "" }), kind: e.target.value as any } }))
                                }
                                className="border rounded px-1 py-0.5 text-xs bg-white"
                              >
                                <option value="product">Product</option>
                                <option value="collection">Collection</option>
                              </select>
                              <input
                                value={draft.id || ""}
                                onChange={(e) =>
                                  setManualDrafts((prev) => ({
                                    ...prev,
                                    [rowKey]: { ...(prev[rowKey] || { kind: draft.kind }), id: e.target.value.replace(/[^0-9]/g, "") },
                                  }))
                                }
                                placeholder="ID"
                                className="w-24 border rounded px-2 py-0.5 text-xs bg-white"
                              />
                              <button
                                onClick={async () => {
                                  const next = { kind: (manualDrafts[rowKey]?.kind || draft.kind) as any, id: (manualDrafts[rowKey]?.id || draft.id || "").trim() }
                                  setManualIds((prev) => ({ ...prev, [rowKey]: next }))
                                  try {
                                    await campaignMappingUpsert({ campaign_key: rowKey, kind: next.kind, id: next.id, store })
                                  } catch {}
                                  load()
                                }}
                                className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-xs"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{c.name || "-"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass}`}>{active ? "Active" : "Paused"}</span>
                      </td>
                      <td className="px-3 py-2 text-right">${Number(c.spend || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">{orders == null ? <span className="text-slate-400">—</span> : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{orders}</span>}</td>
                      <td className="px-3 py-2">{paid == null ? <span className="text-slate-400">—</span> : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-200 text-emerald-800">{paid}</span>}</td>
                      <td className="px-3 py-2 text-right">{price == null ? <span className="text-slate-400">—</span> : fmtCurrency(Number(price || 0))}</td>
                      <td className="px-3 py-2 text-right">{inv == null ? <span className="text-slate-400">—</span> : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">{inv}</span>}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={pid ? String(costRec.product_cost ?? "") : ""}
                          disabled={!pid}
                          onChange={(e) => {
                            if (!pid) return
                            const v = e.target.value === "" ? null : Number(e.target.value)
                            setCostsByProduct((prev) => ({ ...prev, [pid]: { ...(prev[pid] || {}), product_cost: v } }))
                          }}
                          onBlur={async () => {
                            if (!pid) return
                            const rec = costsByProduct[pid] || {}
                            try {
                              await profitCostsUpsert({ product_id: pid, product_cost: rec.product_cost ?? null, store })
                            } catch {}
                          }}
                          className="w-28 rounded-md border px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={pid ? String(costRec.service_delivery_cost ?? "") : ""}
                          disabled={!pid}
                          onChange={(e) => {
                            if (!pid) return
                            const v = e.target.value === "" ? null : Number(e.target.value)
                            setCostsByProduct((prev) => ({ ...prev, [pid]: { ...(prev[pid] || {}), service_delivery_cost: v } }))
                          }}
                          onBlur={async () => {
                            if (!pid) return
                            const rec = costsByProduct[pid] || {}
                            try {
                              await profitCostsUpsert({ product_id: pid, service_delivery_cost: rec.service_delivery_cost ?? null, store })
                            } catch {}
                          }}
                          className="w-32 rounded-md border px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button className={`w-full min-w-40 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-white font-bold ${netClass}`} disabled>
                          <span className="text-white/90">$</span>
                          <span>{Number(net || 0).toFixed(2)}</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


