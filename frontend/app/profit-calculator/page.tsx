"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { DollarSign, RefreshCw, Rocket, Save, Trash2 } from "lucide-react"
import {
  fetchMetaCampaigns,
  type MetaCampaignRow,
  metaGetAdAccount,
  metaListAdAccounts,
  metaSetAdAccount,
  campaignMappingsList,
  shopifyProductsBrief,
  usdToMadRateGet,
  usdToMadRateSet,
  profitCampaignCardsList,
  profitCampaignCardCalculate,
  profitCampaignCardDelete,
  type ProfitCampaignCard,
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

function extractNumericId(s?: string | null) {
  const n = String(s || "")
  const m = n.match(/(\d{3,})/)
  return m ? m[1] : null
}

export default function ProfitCalculatorPage() {
  const [store, setStore] = useState<string>(() => {
    try {
      return localStorage.getItem("ptos_store") || "irrakids"
    } catch {
      return "irrakids"
    }
  })

  // Ad account selector (same pattern as Ads Management)
  const [adAccount, setAdAccount] = useState<string>(() => {
    try {
      return localStorage.getItem("ptos_ad_account") || ""
    } catch {
      return ""
    }
  })
  const [adAccountName, setAdAccountName] = useState<string>("")
  const [adAccounts, setAdAccounts] = useState<Array<{ id: string; name: string; account_status?: number }>>([])

  // Global period for listing campaigns-with-spend
  const [datePreset, setDatePreset] = useState<string>("last_7d_incl_today")
  const [customStart, setCustomStart] = useState<string>("")
  const [customEnd, setCustomEnd] = useState<string>("")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const [usdToMadRate, setUsdToMadRate] = useState<number>(10)
  const [usdToMadDraft, setUsdToMadDraft] = useState<string>("10")
  const [savingRate, setSavingRate] = useState(false)

  const [campaigns, setCampaigns] = useState<MetaCampaignRow[]>([])
  const [mappings, setMappings] = useState<Record<string, { kind: "product" | "collection"; id: string }>>({})
  const [productBriefs, setProductBriefs] = useState<Record<string, { image?: string | null }>>({})
  const [savedByCampaign, setSavedByCampaign] = useState<Record<string, ProfitCampaignCard>>({})

  // Per-card period selector (defaults to global)
  const [cardPreset, setCardPreset] = useState<Record<string, string>>({})
  const [cardCustom, setCardCustom] = useState<Record<string, { start: string; end: string }>>({})
  const [cardBusy, setCardBusy] = useState<Record<string, boolean>>({})
  const loadSeq = useRef(0)

  function effectiveYmdRange(preset: string, campaignId?: string) {
    if (preset === "custom") {
      const cc = campaignId ? cardCustom[campaignId] : undefined
      const s = cc?.start || customStart
      const e = cc?.end || customEnd
      if (s && e) return { start: s, end: e }
      return computeRange("last_7d_incl_today")
    }
    return computeRange(preset)
  }

  function metaRangeParams(preset: string): { datePreset?: string; range?: { start: string; end: string } } {
    if (preset === "custom") {
      if (customStart && customEnd) return { range: { start: customStart, end: customEnd } }
      const { start, end } = computeRange("last_7d_incl_today")
      return { range: { start, end } }
    }
    if (preset === "last_3d_incl_today" || preset === "last_4d_incl_today" || preset === "last_5d_incl_today" || preset === "last_6d_incl_today" || preset === "last_7d_incl_today") {
      const { start, end } = computeRange(preset)
      return { range: { start, end } }
    }
    if (preset === "today") return { datePreset: "today" }
    if (preset === "yesterday") return { datePreset: "yesterday" }
    const { start, end } = computeRange("last_7d_incl_today")
    return { range: { start, end } }
  }

  function productIdForCampaign(c: MetaCampaignRow): string | null {
    const cid = String(c.campaign_id || "").trim()
    const name = String(c.name || "").trim()
    const fromMap = (cid && mappings[cid] && mappings[cid].kind === "product") ? mappings[cid].id : ((name && mappings[name] && mappings[name].kind === "product") ? mappings[name].id : null)
    if (fromMap && /^\d+$/.test(fromMap)) return fromMap
    return extractNumericId(name)
  }

  async function loadList() {
    const token = ++loadSeq.current
    setLoading(true)
    setError(undefined)
    try {
      const metaParams = metaRangeParams(datePreset)
      const res = await fetchMetaCampaigns(metaParams.datePreset, adAccount || undefined, metaParams.range)
      if (token !== loadSeq.current) return
      if ((res as any)?.error) throw new Error(String((res as any).error))
      const rows = (((res as any)?.data || []) as MetaCampaignRow[]).filter((r) => Number(r.spend || 0) > 0)
      setCampaigns(rows)

      // default per-card preset to global preset
      setCardPreset((prev) => {
        const next = { ...prev }
        for (const r of rows) {
          const cid = String(r.campaign_id || "")
          if (cid && !next[cid]) next[cid] = datePreset
        }
        return next
      })
      // propagate global custom range into per-card custom values when needed
      if (datePreset === "custom" && customStart && customEnd) {
        setCardCustom((prev) => {
          const next = { ...prev }
          for (const r of rows) {
            const cid = String(r.campaign_id || "")
            if (cid && !next[cid]) next[cid] = { start: customStart, end: customEnd }
          }
          return next
        })
      }

      // Load mappings (for product id resolution)
      try {
        const mres = await campaignMappingsList(store)
        if (token !== loadSeq.current) return
        setMappings((((mres as any)?.data || {}) as any) || {})
      } catch {}

      // Load saved calculations for this store+ad_account
      try {
        const sres = await profitCampaignCardsList({ store, ad_account: adAccount || undefined })
        if (token !== loadSeq.current) return
        setSavedByCampaign((((sres as any)?.data || {}) as any) || {})
      } catch {
        setSavedByCampaign({})
      }

      // Load product images only
      const ids: string[] = []
      const seen: Record<string, true> = {}
      for (const r of rows) {
        const pid = productIdForCampaign(r)
        if (pid && !seen[pid]) {
          seen[pid] = true
          ids.push(pid)
        }
      }
      if (ids.length) {
        try {
          const pb = await shopifyProductsBrief({ ids, store })
          if (token !== loadSeq.current) return
          setProductBriefs((((pb as any)?.data || {}) as any) || {})
        } catch {
          setProductBriefs({})
        }
      } else {
        setProductBriefs({})
      }
    } catch (e: any) {
      setError(String(e?.message || e))
      setCampaigns([])
    } finally {
      if (token === loadSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    const { start, end } = computeRange("last_7d_incl_today")
    setCustomStart(start)
    setCustomEnd(end)
  }, [])

  useEffect(() => {
    // load ad accounts list once
    ;(async () => {
      try {
        const res = await metaListAdAccounts()
        setAdAccounts(((res as any)?.data || []) as any)
      } catch {
        setAdAccounts([])
      }
    })()
  }, [])

  useEffect(() => {
    // store-scoped ad account + exchange rate on store change
    let cancelled = false
    ;(async () => {
      try {
        const rateRes = await usdToMadRateGet(store)
        if (!cancelled) {
          const r = Number(((rateRes as any)?.data || {})?.rate ?? 10)
          setUsdToMadRate(r)
          setUsdToMadDraft(String(r))
        }
      } catch {}
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
        }
        setAdAccountName(nextName || "")
      } catch {
        if (cancelled) return
        setAdAccountName("")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store])

  // reload list when key selectors change
  useEffect(() => {
    if (!adAccount) return
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, adAccount, datePreset, customStart, customEnd])

  const totalSpendMad = useMemo(() => {
    // sum across campaigns, convert using *current* header rate for display only
    let sum = 0
    for (const c of campaigns || []) sum += Number(c.spend || 0) * Number(usdToMadRate || 10)
    return sum
  }, [campaigns, usdToMadRate])

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
              </div>
            )}
          </div>

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
                } catch (e) {
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

          <button onClick={loadList} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Updating…" : "Refresh list"}
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
                <span>Campaigns with spend</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="text-xs opacity-90">Campaigns</div>
                <div className="mt-1 text-xl font-bold">{(campaigns || []).length}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="text-xs opacity-90">Spend (MAD, using rate)</div>
                <div className="mt-1 text-xl font-bold">{fmtMad(totalSpendMad)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {campaigns.map((c) => {
            const cid = String(c.campaign_id || "")
            const pid = productIdForCampaign(c)
            const img = pid ? (productBriefs[pid] as any)?.image : null
            const saved = cid ? savedByCampaign[cid] : undefined
            const preset = cardPreset[cid] || datePreset
            const rng = effectiveYmdRange(preset, cid)
            const showData = !!saved
            const busy = !!cardBusy[cid]
            const net = Number((saved as any)?.net_profit_mad || 0)
            const netClass = net >= 0 ? "bg-emerald-600" : "bg-rose-600"
            return (
              <div key={cid || c.name} className="bg-white border rounded-none">
                <div className="p-3 border-b flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="product" className="w-16 h-16 rounded object-cover border" />
                    ) : (
                      <div className="w-16 h-16 rounded border bg-slate-50" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.name || cid}</div>
                      <div className="text-xs text-slate-600">Status: {String(c.status || "").toUpperCase() || "—"}</div>
                      <div className="text-xs text-slate-600">Product ID: {pid || "—"}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {showData ? (
                      <div className={`px-3 py-2 rounded-xl text-white font-bold ${netClass}`}>
                        <span className="text-white/90 mr-1">MAD</span>
                        <span>{Number(net || 0).toFixed(2)}</span>
                      </div>
                    ) : (
                      <div className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 font-semibold">Not calculated</div>
                    )}
                    <div className="flex items-center gap-2">
                      <select
                        value={preset}
                        onChange={(e) => {
                          const v = e.target.value
                          setCardPreset((prev) => ({ ...prev, [cid]: v }))
                          if (v === "custom") {
                            setCardCustom((prev) => ({ ...prev, [cid]: prev[cid] || { start: customStart, end: customEnd } }))
                          }
                        }}
                        className="rounded-xl border px-2 py-1 text-xs bg-white"
                      >
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="last_3d_incl_today">Last 3d</option>
                        <option value="last_4d_incl_today">Last 4d</option>
                        <option value="last_5d_incl_today">Last 5d</option>
                        <option value="last_6d_incl_today">Last 6d</option>
                        <option value="last_7d_incl_today">Last 7d</option>
                        <option value="custom">Custom…</option>
                      </select>
                    </div>
                    {preset === "custom" && (
                      <div className="flex items-center gap-1 text-xs">
                        <input
                          type="date"
                          value={(cardCustom[cid]?.start || customStart) || ""}
                          onChange={(e) => setCardCustom((prev) => ({ ...prev, [cid]: { start: e.target.value, end: prev[cid]?.end || customEnd } }))}
                          className="rounded-xl border px-2 py-1 bg-white"
                        />
                        <span>to</span>
                        <input
                          type="date"
                          value={(cardCustom[cid]?.end || customEnd) || ""}
                          onChange={(e) => setCardCustom((prev) => ({ ...prev, [cid]: { start: prev[cid]?.start || customStart, end: e.target.value } }))}
                          className="rounded-xl border px-2 py-1 bg-white"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  <div className="text-xs text-slate-600">
                    Selected range: <span className="font-mono">{rng.start}</span> to <span className="font-mono">{rng.end}</span>
                  </div>

                  {showData ? (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="border rounded p-2 bg-slate-50">
                        <div className="text-xs text-slate-500">Spend (MAD)</div>
                        <div className="font-semibold">{fmtMad(Number((saved as any)?.spend_mad || 0))}</div>
                      </div>
                      <div className="border rounded p-2 bg-slate-50">
                        <div className="text-xs text-slate-500">Paid orders</div>
                        <div className="font-semibold">{Number((saved as any)?.shopify?.paid_orders_total || 0)}</div>
                      </div>
                      <div className="border rounded p-2 bg-slate-50">
                        <div className="text-xs text-slate-500">Price (MAD)</div>
                        <div className="font-semibold">{(saved as any)?.product?.price_mad != null ? fmtMad(Number((saved as any)?.product?.price_mad || 0)) : "—"}</div>
                      </div>
                      <div className="border rounded p-2 bg-slate-50">
                        <div className="text-xs text-slate-500">Inventory</div>
                        <div className="font-semibold">{(saved as any)?.product?.inventory ?? "—"}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">Only image is loaded. Click Calculate to compute and save results.</div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        setCardBusy((prev) => ({ ...prev, [cid]: true }))
                        try {
                          const res = await profitCampaignCardCalculate({ campaign_id: cid, start: rng.start, end: rng.end, store, ad_account: adAccount })
                          if ((res as any)?.error) throw new Error(String((res as any).error))
                          const data = (res as any)?.data as ProfitCampaignCard
                          setSavedByCampaign((prev) => ({ ...prev, [cid]: data }))
                        } catch (e: any) {
                          setError(String(e?.message || e))
                        } finally {
                          setCardBusy((prev) => ({ ...prev, [cid]: false }))
                        }
                      }}
                      disabled={busy}
                      className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm disabled:opacity-60"
                    >
                      <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> {showData ? "Refresh calculation" : "Calculate"}
                    </button>
                    {showData && (
                      <button
                        onClick={async () => {
                          const ok = window.confirm("Delete saved calculation for this campaign?")
                          if (!ok) return
                          try {
                            const res = await profitCampaignCardDelete({ campaign_id: cid, store, ad_account: adAccount })
                            if ((res as any)?.error) throw new Error(String((res as any).error))
                            setSavedByCampaign((prev) => {
                              const next = { ...prev }
                              delete next[cid]
                              return next
                            })
                          } catch (e: any) {
                            setError(String(e?.message || e))
                          }
                        }}
                        className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-2 bg-rose-100 hover:bg-rose-200 text-rose-700 text-sm"
                      >
                        <Trash2 className="w-4 h-4" /> Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {!loading && campaigns.length === 0 && (
            <div className="text-sm text-slate-500">No campaigns with spend in this range.</div>
          )}
        </div>
      </div>
    </div>
  )
}


