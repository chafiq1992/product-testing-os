"use client"
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow, shopifyOrdersCountByTitle, shopifyProductsBrief } from '@/lib/api'

export default function AdsManagementPage(){
  const [items, setItems] = useState<MetaCampaignRow[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [datePreset, setDatePreset] = useState<string>('last_7d')
  const [error, setError] = useState<string|undefined>(undefined)
  const [shopifyCounts, setShopifyCounts] = useState<Record<string, number>>({})
  const ordersSeqToken = useRef(0)
  const [store, setStore] = useState<string>(()=>{
    try{ return localStorage.getItem('ptos_store')||'irrakids' }catch{ return 'irrakids' }
  })
  const [adAccount, setAdAccount] = useState<string>(()=>{
    try{ return localStorage.getItem('ptos_ad_account')||'' }catch{ return '' }
  })
  const [productBriefs, setProductBriefs] = useState<Record<string, { image?: string|null, total_available: number, zero_variants: number }>>({})
  const [notes, setNotes] = useState<Record<string, string>>(()=>{
    try{ return JSON.parse(localStorage.getItem('ptos_notes')||'{}') }catch{ return {} }
  })

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
      const res = await fetchMetaCampaigns(effPreset, adAccount||undefined)
      if((res as any)?.error){ setError(String((res as any).error)); setItems([]) }
      else setItems((res as any)?.data||[])
      // Reset counts and start lazy sequential fetching after table is visible
      setShopifyCounts({})
      setProductBriefs({})
      const token = ++ordersSeqToken.current
      setTimeout(async ()=>{
        if(token !== ordersSeqToken.current) return
        const rows: MetaCampaignRow[] = (((res as any)?.data)||[]) as MetaCampaignRow[]
        const ids = rows.map(c=> (c.name||'').trim()).filter(n=> /^\d+$/.test(n))
        if(!ids.length) return
        // Fetch product briefs (image + inventory) in batch for speed
        try{
          const pb = await shopifyProductsBrief({ ids, store })
          setProductBriefs(((pb as any)?.data)||{})
        }catch{
          setProductBriefs({})
        }
        const { start, end } = computeRange(effPreset)
        for(const id of ids){
          if(token !== ordersSeqToken.current) break
          try{
            const oc = await shopifyOrdersCountByTitle({ names: [id], start, end })
            const count = ((oc as any)?.data||{})[id] ?? 0
            setShopifyCounts(prev=> ({ ...prev, [id]: count }))
          }catch{
            setShopifyCounts(prev=> ({ ...prev, [id]: 0 }))
          }
          await new Promise(r=> setTimeout(r, 50))
        }
      }, 0)
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
          <select value={store} onChange={(e)=>{ const v=e.target.value; setStore(v); try{ localStorage.setItem('ptos_store', v) }catch{} }} className="rounded-xl border px-2 py-1 text-sm bg-white">
            <option value="irrakids">irrakids</option>
            <option value="irranova">irranova</option>
          </select>
          <input value={adAccount} onChange={(e)=>{ const v=e.target.value.trim(); setAdAccount(v); try{ localStorage.setItem('ptos_ad_account', v) }catch{} }} placeholder="Ad account (numeric)" className="rounded-xl border px-2 py-1 text-sm bg-white w-40" />
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
            <thead className="bg-slate-50 border-b sticky top-0 z-10">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">Campaign</th>
                <th className="px-3 py-2 font-semibold text-right">Spend</th>
                <th className="px-3 py-2 font-semibold text-right">Purchases</th>
                <th className="px-3 py-2 font-semibold text-right">Cost / Purchase</th>
                <th className="px-3 py-2 font-semibold text-right">CTR</th>
                <th className="px-3 py-2 font-semibold text-right">Add to cart</th>
                <th className="px-3 py-2 font-semibold text-emerald-700">Shopify Orders</th>
                <th className="px-3 py-2 font-semibold text-right">True CPP</th>
                <th className="px-3 py-2 font-semibold text-indigo-700 text-right">Inventory</th>
                <th className="px-3 py-2 font-semibold text-rose-700 text-right">Zero-variant</th>
                <th className="px-3 py-2 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-slate-500">Loading…</td>
                </tr>
              )}
              {!loading && items.length===0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-slate-500">No active campaigns.</td>
                </tr>
              )}
              {!loading && items.map((c)=>{
                const cpp = c.cpp!=null? `$${c.cpp.toFixed(2)}` : '—'
                const ctr = c.ctr!=null? `${(c.ctr*1).toFixed(2)}%` : '—'
                const id = (c.name||'').trim()
                const isNumeric = /^\d+$/.test(id)
                const ordersVal = isNumeric? shopifyCounts[id] : undefined
                const orders = typeof ordersVal==='number'? ordersVal : null
                const trueCppVal = (orders!=null && orders>0)? (c.spend||0)/orders : null
                const trueCpp = trueCppVal!=null? `$${trueCppVal.toFixed(2)}` : '—'
                const brief = isNumeric? productBriefs[id] : undefined
                const inv = brief? brief.total_available : null
                const zeros = brief? brief.zero_variants : null
                const img = brief? brief.image : null
                const trueCppClass = trueCppVal==null? '' : (trueCppVal < 2 ? 'bg-emerald-50' : (trueCppVal < 3 ? 'bg-yellow-50' : 'bg-rose-50'))
                const rowKey = c.campaign_id || c.name || String(Math.random())
                return (
                  <tr key={c.campaign_id || c.name} className={`border-b last:border-b-0 hover:bg-slate-50 ${trueCppClass}`}>
                    <td className="px-3 py-2">
                      {isNumeric ? (
                        img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="product" className="w-20 h-20 rounded object-cover border" />
                        ) : (
                          <span className="inline-block w-20 h-20 rounded bg-slate-100 border animate-pulse" />
                        )
                      ) : (
                        <span className="inline-block w-20 h-20 rounded bg-slate-50 border" />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.name||'-'}</td>
                    <td className="px-3 py-2 text-right">${(c.spend||0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{c.purchases||0}</td>
                    <td className="px-3 py-2 text-right">{cpp}</td>
                    <td className="px-3 py-2 text-right">{ctr}</td>
                    <td className="px-3 py-2 text-right">{c.add_to_cart||0}</td>
                    <td className="px-3 py-2">
                      {isNumeric ? (
                        orders===null ? (
                          <span className="inline-block h-4 w-10 bg-emerald-50 rounded animate-pulse" />
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{orders}</span>
                        )
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{isNumeric && orders===null ? <span className="inline-block h-4 w-12 bg-slate-100 rounded animate-pulse" /> : trueCpp}</td>
                    <td className="px-3 py-2 text-right">
                      {isNumeric ? (
                        inv===null || inv===undefined ? (
                          <span className="inline-block h-4 w-10 bg-indigo-50 rounded animate-pulse" />
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">{inv}</span>
                        )
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isNumeric ? (
                        zeros===null || zeros===undefined ? (
                          <span className="inline-block h-4 w-10 bg-rose-50 rounded animate-pulse" />
                        ) : (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${zeros>0? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{zeros}</span>
                        )
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={notes[rowKey as any]||''}
                        onChange={(e)=>{
                          const v = e.target.value
                          setNotes(prev=>{ const next={...prev, [rowKey as any]: v}; try{ localStorage.setItem('ptos_notes', JSON.stringify(next)) }catch{}; return next })
                        }}
                        placeholder="Notes"
                        className="w-44 rounded-md border px-2 py-1 text-sm bg-white"
                      />
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


