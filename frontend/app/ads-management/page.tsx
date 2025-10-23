"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow, shopifyOrdersCountByTitle } from '@/lib/api'

export default function AdsManagementPage(){
  const [items, setItems] = useState<MetaCampaignRow[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [datePreset, setDatePreset] = useState<string>('last_7d')
  const [error, setError] = useState<string|undefined>(undefined)
  const [shopifyCounts, setShopifyCounts] = useState<Record<string, number>>({})

  function computeRange(preset: string){
    const now = new Date()
    const end = now.toISOString()
    const startDate = new Date(now)
    switch(preset){
      case 'today':
        startDate.setHours(0,0,0,0)
        break
      case 'yesterday':{
        const d = new Date(now)
        d.setDate(d.getDate()-1)
        d.setHours(0,0,0,0)
        const e = new Date(d)
        e.setHours(23,59,59,999)
        return { start: d.toISOString(), end: e.toISOString() }
      }
      case 'last_14d':
        startDate.setDate(startDate.getDate()-14)
        break
      case 'this_month':{
        const d = new Date(now.getFullYear(), now.getMonth(), 1)
        return { start: d.toISOString(), end }
      }
      case 'last_30d':
        startDate.setDate(startDate.getDate()-30)
        break
      case 'last_7d':
      default:
        startDate.setDate(startDate.getDate()-7)
        break
    }
    startDate.setHours(0,0,0,0)
    return { start: startDate.toISOString(), end }
  }

  async function load(preset?: string){
    setLoading(true); setError(undefined)
    try{
      const effPreset = preset||datePreset
      const res = await fetchMetaCampaigns(effPreset)
      if((res as any)?.error){ setError(String((res as any).error)); setItems([]) }
      else setItems((res as any)?.data||[])
      // After meta items load, fetch Shopify orders counts for the same period
      // Only use numeric campaign names (Shopify product_id); ignore textual names
      const ids = ((((res as any)?.data)||[]) as MetaCampaignRow[]).map(c=> (c.name||'').trim()).filter(n=> /^\d+$/.test(n))
      if(ids.length){
        const { start, end } = computeRange(effPreset)
        const oc = await shopifyOrdersCountByTitle({ names: ids as string[], start, end })
        setShopifyCounts((oc as any)?.data||{})
      } else {
        setShopifyCounts({})
      }
    }catch(e:any){ setError(String(e?.message||e)); setItems([]) }
    finally{ setLoading(false) }
  }

  useEffect(()=>{ load(datePreset) },[])

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Ads management</h1>
        </div>
        <div className="flex items-center gap-2">
          <select value={datePreset} onChange={(e)=>{ setDatePreset(e.target.value); load(e.target.value) }} className="rounded-xl border px-2 py-1 text-sm bg-white">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_7d">Last 7 days</option>
            <option value="last_14d">Last 14 days</option>
            <option value="this_month">This month</option>
            <option value="last_30d">Last 30 days</option>
          </select>
          <button onClick={()=>load()} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60" disabled={loading}>
            <RefreshCw className="w-4 h-4"/> Refresh
          </button>
          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Home</Link>
        </div>
      </header>

      <div className="p-4 md:p-6">
        {error && (
          <div className="mb-3 text-sm text-red-600">{error}</div>
        )}
        <div className="overflow-x-auto bg-white border rounded-none">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Campaign</th>
                <th className="px-3 py-2 font-semibold">Spend</th>
                <th className="px-3 py-2 font-semibold">Purchases</th>
                <th className="px-3 py-2 font-semibold">Cost / Purchase</th>
                <th className="px-3 py-2 font-semibold">CTR</th>
                <th className="px-3 py-2 font-semibold">Add to cart</th>
                <th className="px-3 py-2 font-semibold text-emerald-700">Shopify Orders</th>
                <th className="px-3 py-2 font-semibold">True CPP</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">Loading…</td>
                </tr>
              )}
              {!loading && items.length===0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">No active campaigns.</td>
                </tr>
              )}
              {!loading && items.map((c)=>{
                const cpp = c.cpp!=null? `$${c.cpp.toFixed(2)}` : '—'
                const ctr = c.ctr!=null? `${(c.ctr*1).toFixed(2)}%` : '—'
                const orders = shopifyCounts[c.name||''] || 0
                const trueCppVal = orders>0? (c.spend||0)/orders : null
                const trueCpp = trueCppVal!=null? `$${trueCppVal.toFixed(2)}` : '—'
                return (
                  <tr key={c.campaign_id || c.name} className="border-b last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap">{c.name||'-'}</td>
                    <td className="px-3 py-2">${(c.spend||0).toFixed(2)}</td>
                    <td className="px-3 py-2">{c.purchases||0}</td>
                    <td className="px-3 py-2">{cpp}</td>
                    <td className="px-3 py-2">{ctr}</td>
                    <td className="px-3 py-2">{c.add_to_cart||0}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-600">{orders}</td>
                    <td className="px-3 py-2">{trueCpp}</td>
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


