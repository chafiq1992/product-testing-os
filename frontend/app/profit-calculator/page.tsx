"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { DollarSign, RefreshCw, Rocket, Save } from "lucide-react"
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
  profitCostsList,
  profitCostsUpsert,
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

function normalizeAdAccountId(raw: string) {
  const s = String(raw || "").trim()
  if (!s) return ""
  if (s.toLowerCase().startsWith("act_")) return s.split("_", 2)[1] || ""
  return s
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

  // Ad account selector (mirrors Ads Management)
  const [adAccount, setAdAccount] = useState<string>(() => {
    try {
      return normalizeAdAccountId(localStorage.getItem("ptos_ad_account") || "")
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
  const [costsByProduct, setCostsByProduct] = useState<Record<string, { product_cost?: number | null; service_delivery_cost?: number | null }>>({})

  // Merge behavior (same concept as ads-management)
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("ptos_profit_selected") || "{}")
    } catch {
      return {}
    }
  })
  const [mergedWith, setMergedWith] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("ptos_profit_merged") || "{}")
    } catch {
      return {}
    }
  })

  // Per-row period selector (defaults to global)
  const [rowPreset, setRowPreset] = useState<Record<string, string>>({})
  const [rowCustom, setRowCustom] = useState<Record<string, { start: string; end: string }>>({})
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({})

  const loadSeq = useRef(0)

  function toggleSelect(k: string, v?: boolean) {
    setSelectedKeys((prev) => {
      const next = { ...prev, [k]: v == null ? !prev[k] : !!v }
      try {
        localStorage.setItem("ptos_profit_selected", JSON.stringify(next))
      } catch {}
      return next
    })
  }
  function clearSelection() {
    setSelectedKeys(() => {
      try {
        localStorage.setItem("ptos_profit_selected", "{}")
      } catch {}
      return {}
    })
  }
  function doMergeSelected() {
    const keys = Object.keys(selectedKeys).filter((k) => !!selectedKeys[k])
    if (keys.length !== 2) {
      alert("Select exactly 2 rows to merge.")
      return
    }
    const [a, b] = keys
    setMergedWith((prev) => {
      const next = { ...prev }
      const pa = next[a]
      const pb = next[b]
      if (pa) {
        delete next[pa]
        delete next[a]
      }
      if (pb) {
        delete next[pb]
        delete next[b]
      }
      next[a] = b
      next[b] = a
      try {
        localStorage.setItem("ptos_profit_merged", JSON.stringify(next))
      } catch {}
      return next
    })
    clearSelection()
  }
  function unmergeKey(k: string) {
    setMergedWith((prev) => {
      const partner = prev[k]
      if (!partner) return prev
      const next = { ...prev }
      delete next[k]
      delete next[partner]
      try {
        localStorage.setItem("ptos_profit_merged", JSON.stringify(next))
      } catch {}
      return next
    })
  }

  function effectiveYmdRangeForRow(cid: string) {
    const p = rowPreset[cid] || datePreset
    if (p === "custom") {
      const cc = rowCustom[cid]
      const s = cc?.start || customStart
      const e = cc?.end || customEnd
      if (s && e) return { start: s, end: e }
      return computeRange("last_7d_incl_today")
    }
    return computeRange(p)
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
    const fromMap =
      cid && mappings[cid] && mappings[cid].kind === "product"
        ? mappings[cid].id
        : name && mappings[name] && mappings[name].kind === "product"
          ? mappings[name].id
          : null
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

      setRowPreset((prev) => {
        const next = { ...prev }
        for (const r of rows) {
          const cid = String(r.campaign_id || "")
          if (cid && !next[cid]) next[cid] = datePreset
        }
        return next
      })
      if (datePreset === "custom" && customStart && customEnd) {
        setRowCustom((prev) => {
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

      // Load costs
      try {
        const cres = await profitCostsList(store)
        if (token !== loadSeq.current) return
        setCostsByProduct((((cres as any)?.data || {}) as any) || {})
      } catch {
        setCostsByProduct({})
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
        const nextIdRaw = conf && conf.id ? String(conf.id || "") : ""
        const nextId = normalizeAdAccountId(nextIdRaw)
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

  useEffect(() => {
    if (!adAccount) return
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, adAccount, datePreset, customStart, customEnd])

  // Keep merged pairs adjacent
  const sortedCampaigns = useMemo(() => {
    const arr = (campaigns || []).slice().sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
    const byId: Record<string, MetaCampaignRow> = {}
    for (const r of arr) byId[String(r.campaign_id || "")] = r
    const seen: Record<string, true> = {}
    const out: MetaCampaignRow[] = []
    for (const r of arr) {
      const k = String(r.campaign_id || "")
      if (seen[k]) continue
      const partner = mergedWith[k]
      if (partner && byId[partner]) {
        out.push(r)
        out.push(byId[partner])
        seen[k] = true
        seen[partner] = true
      } else {
        out.push(r)
        seen[k] = true
      }
    }
    return out
  }, [campaigns, mergedWith])

  const totalSpendMad = useMemo(() => {
    let sum = 0
    for (const c of campaigns || []) sum += Number(c.spend || 0) * Number(usdToMadRate || 10)
    return sum
  }, [campaigns, usdToMadRate])

  async function calculateFor(ids: string[], range: { start: string; end: string }) {
    const uniq = Array.from(new Set(ids.filter(Boolean)))
    if (!uniq.length) return
    setRowBusy((prev) => {
      const next = { ...prev }
      for (const id of uniq) next[id] = true
      return next
    })
    try {
      const results = await Promise.all(
        uniq.map((cid) => profitCampaignCardCalculate({ campaign_id: cid, start: range.start, end: range.end, store, ad_account: adAccount }))
      )
      const nextSaved: Record<string, ProfitCampaignCard> = {}
      for (const res of results as any[]) {
        if (res?.error) throw new Error(String(res.error))
        const data = res?.data
        if (data?.campaign_id) nextSaved[String(data.campaign_id)] = data
      }
      setSavedByCampaign((prev) => ({ ...prev, ...nextSaved }))
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev }
        for (const id of uniq) next[id] = false
        return next
      })
    }
  }

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
                const v = normalizeAdAccountId(e.target.value)
                setAdAccount(v)
                try {
                  localStorage.setItem("ptos_ad_account", v)
                } catch {}
                try {
                  const res = await metaSetAdAccount({ id: v, store })
                  const data = (res as any)?.data || {}
                  setAdAccountName(String(data?.name || adAccounts.find((a) => normalizeAdAccountId(a.id) === v)?.name || ""))
                } catch {}
              }}
              className="rounded-xl border px-2 py-1 text-sm bg-white w-44 sm:w-56 md:w-72"
            >
              <option value="">Select ad account…</option>
              {adAccounts.map((a) => (
                <option key={a.id} value={normalizeAdAccountId(a.id)}>
                  {a.name || a.id} ({normalizeAdAccountId(a.id)})
                </option>
              ))}
            </select>
            {adAccountName ? <span className="text-xs text-slate-600">{adAccountName}</span> : null}
          </div>

          <div className="flex items-center gap-2">
            <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className="rounded-xl border px-2 py-1 text-sm bg-white">
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

          <button onClick={loadList} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60" disabled={loading}>
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
                <div className="text-xs opacity-90">Campaigns with spend</div>
                <div className="mt-1 text-xl font-bold">{(campaigns || []).length}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="text-xs opacity-90">Spend (MAD)</div>
                <div className="mt-1 text-xl font-bold">{fmtMad(totalSpendMad)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-slate-600">Select 2 rows to merge (use combined spend for net profit).</div>
          <button
            onClick={doMergeSelected}
            className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-60"
            disabled={Object.keys(selectedKeys).filter((k) => selectedKeys[k]).length !== 2}
          >
            Merge 2
          </button>
        </div>

        <div className="overflow-x-auto bg-white border rounded-none">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/90 backdrop-blur supports-backdrop-blur:bg-slate-50/60 border-b shadow-sm">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold w-8">Sel</th>
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">Campaign</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold text-right">Spend (MAD)</th>
                <th className="px-3 py-2 font-semibold text-right">Shopify Orders</th>
                <th className="px-3 py-2 font-semibold text-right">Paid Orders</th>
                <th className="px-3 py-2 font-semibold text-right">Product price (MAD)</th>
                <th className="px-3 py-2 font-semibold text-right">Inventory</th>
                <th className="px-3 py-2 font-semibold text-right">Product cost</th>
                <th className="px-3 py-2 font-semibold text-right">Service + delivery</th>
                <th className="px-3 py-2 font-semibold text-right">Net profit (MAD)</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && sortedCampaigns.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-slate-500">
                    No campaigns with spend in this range.
                  </td>
                </tr>
              )}
              {!loading &&
                sortedCampaigns.map((c) => {
                  const cid = String(c.campaign_id || "")
                  const partner = mergedWith[cid]
                  const partnerRow = partner ? sortedCampaigns.find((x) => String(x.campaign_id || "") === partner) : undefined
                  const mergedSpendMad =
                    (Number(savedByCampaign[cid]?.spend_mad ?? (Number(c.spend || 0) * Number(usdToMadRate || 10))) || 0) +
                    (partnerRow ? Number(savedByCampaign[String(partnerRow.campaign_id || "")]?.spend_mad ?? (Number(partnerRow.spend || 0) * Number(usdToMadRate || 10))) || 0 : 0)

                  const saved = savedByCampaign[cid]
                  const pid = saved?.product?.id || productIdForCampaign(c)
                  const img = pid ? (productBriefs as any)[pid]?.image : null
                  const costs = pid ? (costsByProduct[pid] || {}) : {}
                  const productCost = Number((costs as any).product_cost ?? (saved?.costs?.product_cost ?? 0) ?? 0)
                  const serviceCost = Number((costs as any).service_delivery_cost ?? (saved?.costs?.service_delivery_cost ?? 0) ?? 0)

                  const paidOrders = Number(saved?.shopify?.paid_orders_total ?? 0)
                  const ordersTotal = Number(saved?.shopify?.orders_total ?? 0)
                  const priceMad = Number(saved?.product?.price_mad ?? 0)
                  const inventory = saved?.product?.inventory
                  const revenueMad = priceMad * paidOrders
                  const net = revenueMad - mergedSpendMad - productCost - serviceCost

                  const hasCalc = !!saved
                  const netClass = net >= 0 ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"

                  const status = String(c.status || "").toUpperCase()
                  const active = status === "ACTIVE"
                  const statusClass = active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"

                  const p = rowPreset[cid] || datePreset
                  const rng = effectiveYmdRangeForRow(cid)
                  const busy = !!rowBusy[cid]

                  return (
                    <tr key={cid || c.name} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={!!selectedKeys[cid]} onChange={(e) => toggleSelect(cid, e.target.checked)} />
                      </td>
                      <td className="px-3 py-2">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="product" className="w-16 h-16 rounded object-cover border" />
                        ) : (
                          <div className="w-16 h-16 rounded border bg-slate-50" />
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {partner ? (
                            <button onClick={() => unmergeKey(cid)} className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs">
                              Unmerge
                            </button>
                          ) : null}
                          <span>{c.name || "-"}</span>
                        </div>
                        {partnerRow ? <div className="text-xs text-slate-500">Merged with: {partnerRow.name || partnerRow.campaign_id}</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass}`}>{active ? "Active" : "Paused"}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{hasCalc ? fmtMad(mergedSpendMad) : "—"}</td>
                      <td className="px-3 py-2 text-right">{hasCalc ? ordersTotal : "—"}</td>
                      <td className="px-3 py-2 text-right">{hasCalc ? paidOrders : "—"}</td>
                      <td className="px-3 py-2 text-right">{hasCalc ? fmtMad(priceMad) : "—"}</td>
                      <td className="px-3 py-2 text-right">{hasCalc ? (inventory ?? "—") : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          disabled={!pid}
                          value={pid ? String((costs as any).product_cost ?? "") : ""}
                          onChange={(e) => {
                            if (!pid) return
                            const v = e.target.value === "" ? null : Number(e.target.value)
                            setCostsByProduct((prev) => ({ ...prev, [pid]: { ...(prev[pid] || {}), product_cost: v } }))
                          }}
                          onBlur={async () => {
                            if (!pid) return
                            const rec = costsByProduct[pid] || {}
                            try {
                              await profitCostsUpsert({ product_id: pid, product_cost: (rec as any).product_cost ?? null, store })
                            } catch {}
                          }}
                          className="w-28 rounded-md border px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          disabled={!pid}
                          value={pid ? String((costs as any).service_delivery_cost ?? "") : ""}
                          onChange={(e) => {
                            if (!pid) return
                            const v = e.target.value === "" ? null : Number(e.target.value)
                            setCostsByProduct((prev) => ({ ...prev, [pid]: { ...(prev[pid] || {}), service_delivery_cost: v } }))
                          }}
                          onBlur={async () => {
                            if (!pid) return
                            const rec = costsByProduct[pid] || {}
                            try {
                              await profitCostsUpsert({ product_id: pid, service_delivery_cost: (rec as any).service_delivery_cost ?? null, store })
                            } catch {}
                          }}
                          className="w-36 rounded-md border px-2 py-1 text-sm bg-white disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {hasCalc ? (
                          <button className={`w-full min-w-44 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-white font-bold ${netClass}`} disabled>
                            <span className="text-white/90">MAD</span>
                            <span>{Number(net || 0).toFixed(2)}</span>
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={p}
                            onChange={(e) => {
                              const v = e.target.value
                              setRowPreset((prev) => ({ ...prev, [cid]: v }))
                              if (v === "custom") setRowCustom((prev) => ({ ...prev, [cid]: prev[cid] || { start: customStart, end: customEnd } }))
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
                          <button
                            onClick={async () => {
                              setError(undefined)
                              try {
                                const ids = [cid]
                                if (partnerRow?.campaign_id) ids.push(String(partnerRow.campaign_id))
                                await calculateFor(ids, rng)
                              } catch (e: any) {
                                setError(String(e?.message || e))
                              }
                            }}
                            disabled={busy}
                            className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs disabled:opacity-60"
                          >
                            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> {hasCalc ? "Refresh calc" : "Calculate"}
                          </button>
                          {hasCalc && (
                            <button
                              onClick={async () => {
                                const ok = window.confirm("Clear saved calculation for this campaign?")
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
                              className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {p === "custom" && (
                          <div className="mt-2 flex items-center justify-end gap-1 text-xs">
                            <input
                              type="date"
                              value={(rowCustom[cid]?.start || customStart) || ""}
                              onChange={(e) => setRowCustom((prev) => ({ ...prev, [cid]: { start: e.target.value, end: prev[cid]?.end || customEnd } }))}
                              className="rounded-xl border px-2 py-1 bg-white"
                            />
                            <span>to</span>
                            <input
                              type="date"
                              value={(rowCustom[cid]?.end || customEnd) || ""}
                              onChange={(e) => setRowCustom((prev) => ({ ...prev, [cid]: { start: prev[cid]?.start || customStart, end: e.target.value } }))}
                              className="rounded-xl border px-2 py-1 bg-white"
                            />
                          </div>
                        )}
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


