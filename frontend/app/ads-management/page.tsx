"use client"
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow } from '@/lib/api'

export default function AdsManagementPage(){
  const [items, setItems] = useState<MetaCampaignRow[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [datePreset, setDatePreset] = useState<string>('last_7d')
  const [error, setError] = useState<string|undefined>(undefined)

  async function load(preset?: string){
    setLoading(true); setError(undefined)
    try{
      const res = await fetchMetaCampaigns(preset||datePreset)
      if((res as any)?.error){ setError(String((res as any).error)); setItems([]) }
      else setItems((res as any)?.data||[])
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
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td>
                </tr>
              )}
              {!loading && items.length===0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">No active campaigns.</td>
                </tr>
              )}
              {!loading && items.map((c)=>{
                const cpp = c.cpp!=null? `$${c.cpp.toFixed(2)}` : '—'
                const ctr = c.ctr!=null? `${(c.ctr*1).toFixed(2)}%` : '—'
                return (
                  <tr key={c.campaign_id || c.name} className="border-b last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap">{c.name||'-'}</td>
                    <td className="px-3 py-2">${(c.spend||0).toFixed(2)}</td>
                    <td className="px-3 py-2">{c.purchases||0}</td>
                    <td className="px-3 py-2">{cpp}</td>
                    <td className="px-3 py-2">{ctr}</td>
                    <td className="px-3 py-2">{c.add_to_cart||0}</td>
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


