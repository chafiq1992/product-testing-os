"use client"
import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow, shopifyOrdersCountByTitle, shopifyProductsBrief, shopifyOrdersCountByCollection, shopifyCollectionProducts, campaignMappingsList, campaignMappingUpsert, metaGetAdAccount, metaSetAdAccount, metaSetCampaignStatus } from '@/lib/api'

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
  const [adAccountName, setAdAccountName] = useState<string>('')
  const [notes, setNotes] = useState<Record<string, string>>(()=>{
    try{ return JSON.parse(localStorage.getItem('ptos_notes')||'{}') }catch{ return {} }
  })
  const [manualIds, setManualIds] = useState<Record<string, { kind: 'product'|'collection', id: string }>>({})
  const [manualDrafts, setManualDrafts] = useState<Record<string, { kind: 'product'|'collection', id: string }>>({})
  const [manualCounts, setManualCounts] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [collectionProducts, setCollectionProducts] = useState<Record<string, string[]>>({})
  const [collectionCounts, setCollectionCounts] = useState<Record<string, Record<string, number>>>({})
  const [childrenLoading, setChildrenLoading] = useState<Record<string, boolean>>({})
  const [sortKey, setSortKey] = useState<'campaign'|'spend'|'purchases'|'cpp'|'ctr'|'add_to_cart'|'shopify_orders'|'true_cpp'|'inventory'|'zero_variant'>('spend')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')

  function computeRange(preset: string){
    const now = new Date()
    const toYmd = (d: Date)=>{
      const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0')
      return `${y}-${m}-${day}`
    }
    const endDate = new Date(now)
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
        return { start: toYmd(d), end: toYmd(e) }
      }
      case 'last_14d':
        startDate.setDate(startDate.getDate()-14)
        break
      case 'this_month':{
        const d = new Date(now.getFullYear(), now.getMonth(), 1)
        return { start: toYmd(d), end: toYmd(endDate) }
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
    return { start: toYmd(startDate), end: toYmd(endDate) }
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
      setManualCounts({})
      setExpanded({})
      setCollectionProducts({})
      setCollectionCounts({})
      setChildrenLoading({})
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
            const oc = await shopifyOrdersCountByTitle({ names: [id], start, end, include_closed: true })
            const count = ((oc as any)?.data||{})[id] ?? 0
            setShopifyCounts(prev=> ({ ...prev, [id]: count }))
          }catch{
            setShopifyCounts(prev=> ({ ...prev, [id]: 0 }))
          }
          await new Promise(r=> setTimeout(r, 50))
        }
        // Also fetch manual IDs (for rows whose campaign name is not numeric)
        for(const row of rows){
          if(token !== ordersSeqToken.current) break
          const rowKey = (row.campaign_id || row.name || '') as any
          try{
            const conf = (manualIds as any)[rowKey]
            if(!conf) continue
            if(!conf.id || !/^\d+$/.test(conf.id)) continue
            if(conf.kind==='product'){
              const oc = await shopifyOrdersCountByTitle({ names: [conf.id], start, end, include_closed: true })
              const count = ((oc as any)?.data||{})[conf.id] ?? 0
              setManualCounts(prev=> ({ ...prev, [String(rowKey)]: count }))
            }else{
              const oc = await shopifyOrdersCountByCollection({ collection_id: conf.id, start, end, store, include_closed: true, aggregate: 'sum_product_orders' })
              const count = Number(((oc as any)?.data||{})?.count ?? 0)
              setManualCounts(prev=> ({ ...prev, [String(rowKey)]: count }))
            }
          }catch{
            setManualCounts(prev=> ({ ...prev, [String(rowKey)]: 0 }))
          }
          await new Promise(r=> setTimeout(r, 50))
        }
      }, 0)
    }catch(e:any){ setError(String(e?.message||e)); setItems([]) }
    finally{ setLoading(false) }
  }

  async function loadCollectionChildren(rowKey: any, collectionId: string){
    setChildrenLoading(prev=> ({ ...prev, [String(rowKey)]: true }))
    try{
      const { data } = await shopifyCollectionProducts({ collection_id: collectionId, store }) as any
      const ids: string[] = ((data||{}).product_ids)||[]
      setCollectionProducts(prev=> ({ ...prev, [String(rowKey)]: ids }))
      const { start, end } = computeRange(datePreset)
      try{
        const oc = await shopifyOrdersCountByTitle({ names: ids, start, end, include_closed: true })
        const map = ((oc as any)?.data)||{}
        setCollectionCounts(prev=> ({ ...prev, [String(rowKey)]: map }))
        // Update collection total to match sum of children
        const sum = ids.reduce((acc, id)=> acc + (Number(map[id] ?? 0) || 0), 0)
        setManualCounts(prev=> ({ ...prev, [String(rowKey)]: sum }))
      }catch{
        const empty: Record<string, number> = {}
        for(const id of ids) empty[id] = 0
        setCollectionCounts(prev=> ({ ...prev, [String(rowKey)]: empty }))
        setManualCounts(prev=> ({ ...prev, [String(rowKey)]: 0 }))
      }
    }finally{
      setChildrenLoading(prev=> ({ ...prev, [String(rowKey)]: false }))
    }
  }

  useEffect(()=>{ load(datePreset) },[])
  useEffect(()=>{
    // Load saved ad account for this store and display name
    (async()=>{
      try{
        const res = await metaGetAdAccount(store)
        const conf = (res as any)?.data||{}
        if(conf && conf.id){
          setAdAccount(String(conf.id||''))
          try{ localStorage.setItem('ptos_ad_account', String(conf.id||'')) }catch{}
        }
        if(conf && conf.name){ setAdAccountName(String(conf.name||'')) } else { setAdAccountName('') }
      }catch{ setAdAccountName('') }
    })()
    (async()=>{
      try{
        const res = await campaignMappingsList(store)
        const map = ((res as any)?.data)||{}
        const shaped: Record<string, { kind:'product'|'collection', id:string }> = {}
        for(const k of Object.keys(map||{})){
          const v = (map as any)[k]
          if(v && (v.kind==='product' || v.kind==='collection') && v.id) shaped[k] = { kind: v.kind, id: v.id }
        }
        setManualIds(shaped)
      }catch{
        // ignore
      }
    })()
  }, [store])

  function getId(row: MetaCampaignRow){
    return (row.name||'').trim()
  }
  function getOrders(row: MetaCampaignRow){
    const id = getId(row)
    // If manual mapping exists for this row, prefer it
    const rowKey = (row.campaign_id || row.name || '') as any
    const manual = (manualIds as any)[rowKey]
    if(manual && manualCounts[String(rowKey)]!=null){
      return manualCounts[String(rowKey)]
    }
    if(!/^\d+$/.test(id)) return null
    const v = shopifyCounts[id]
    return typeof v==='number'? v : null
  }
  function getInventory(row: MetaCampaignRow){
    const id = getId(row)
    if(!/^\d+$/.test(id)) return null
    const brief = productBriefs[id]
    if(!brief) return null
    return typeof brief.total_available==='number'? brief.total_available : null
  }
  function getZeroVariants(row: MetaCampaignRow){
    const id = getId(row)
    if(!/^\d+$/.test(id)) return null
    const brief = productBriefs[id]
    if(!brief) return null
    return typeof brief.zero_variants==='number'? brief.zero_variants : null
  }
  function getTrueCpp(row: MetaCampaignRow){
    const orders = getOrders(row)
    if(orders==null || orders<=0) return null
    const spend = row.spend||0
    return spend/orders
  }
  function getSortValue(row: MetaCampaignRow){
    switch(sortKey){
      case 'campaign': return (row.name||'').toLowerCase()
      case 'spend': return row.spend||0
      case 'purchases': return row.purchases||0
      case 'cpp': return row.cpp==null? null : Number(row.cpp)
      case 'ctr': return row.ctr==null? null : Number(row.ctr)
      case 'add_to_cart': return row.add_to_cart||0
      case 'shopify_orders': return getOrders(row)
      case 'true_cpp': return getTrueCpp(row)
      case 'inventory': return getInventory(row)
      case 'zero_variant': return getZeroVariants(row)
      default: return null
    }
  }
  function compareRows(a: MetaCampaignRow, b: MetaCampaignRow){
    const av = getSortValue(a) as any
    const bv = getSortValue(b) as any
    // Always push null/undefined to the bottom, regardless of sort direction
    const aNull = (av==null)
    const bNull = (bv==null)
    if(aNull && bNull) return 0
    if(aNull && !bNull) return 1
    if(!aNull && bNull) return -1
    let res = 0
    if(typeof av==='string' || typeof bv==='string'){
      res = String(av).localeCompare(String(bv))
    }else{
      res = (Number(av)||0) - (Number(bv)||0)
    }
    return sortDir==='asc'? res : -res
  }
  const sortedItems = useMemo(()=>{
    const arr = (items||[]).slice()
    try{ arr.sort(compareRows) }catch{}
    return arr
  }, [items, sortKey, sortDir, shopifyCounts, productBriefs])

  function toggleSort(key: typeof sortKey){
    if(sortKey===key){
      setSortDir(prev=> prev==='asc'? 'desc' : 'asc')
    }else{
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function SortArrow(){
    return sortDir==='asc'? <ArrowUp className="w-3.5 h-3.5"/> : <ArrowDown className="w-3.5 h-3.5"/>
  }

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Ads management</h1>
        </div>
        <div className="flex items-center gap-2">
          <select value={store} onChange={(e)=>{ const v=e.target.value; setStore(v); try{ localStorage.setItem('ptos_store', v) }catch{} }} className="rounded-xl border px-2 py-1 text-sm bg-white">
            <option value="irrakids">irrakids</option>
            <option value="irranova">irranova</option>
          </select>
          <div className="flex items-center gap-1">
            <input value={adAccount} onChange={(e)=>{ const v=e.target.value.replace(/[^0-9]/g,''); setAdAccount(v); try{ localStorage.setItem('ptos_ad_account', v) }catch{} }} onBlur={async()=>{
              const v = (adAccount||'').trim()
              if(!v) return
              try{
                const res = await metaSetAdAccount({ id: v, store })
                const data = (res as any)?.data||{}
                if(data && data.name){ setAdAccountName(String(data.name||'')) }
              }catch{}
            }} placeholder="Ad account (numeric)" className="rounded-xl border px-2 py-1 text-sm bg-white w-40" />
            {adAccountName? (<span className="text-xs text-slate-600">{adAccountName}</span>) : null}
          </div>
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
            <thead className="bg-slate-50/90 backdrop-blur supports-backdrop-blur:bg-slate-50/60 border-b shadow-sm">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">
                  <button onClick={()=>toggleSort('campaign')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>Campaign</span>
                    {sortKey==='campaign'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <span>Status</span>
                </th>
                <th className="px-3 py-2 font-semibold text-right">
                  <button onClick={()=>toggleSort('spend')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>Spend</span>
                    {sortKey==='spend'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-right">
                  <button onClick={()=>toggleSort('purchases')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>Purchases</span>
                    {sortKey==='purchases'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-right">
                  <button onClick={()=>toggleSort('cpp')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>Cost / Purchase</span>
                    {sortKey==='cpp'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-right">
                  <button onClick={()=>toggleSort('ctr')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>CTR</span>
                    {sortKey==='ctr'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-right">
                  <button onClick={()=>toggleSort('add_to_cart')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>Add to cart</span>
                    {sortKey==='add_to_cart'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-emerald-700">
                  <button onClick={()=>toggleSort('shopify_orders')} className="inline-flex items-center gap-1 hover:text-emerald-800">
                    <span>Shopify Orders</span>
                    {sortKey==='shopify_orders'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-emerald-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-right">
                  <button onClick={()=>toggleSort('true_cpp')} className="inline-flex items-center gap-1 hover:text-slate-900">
                    <span>True CPP</span>
                    {sortKey==='true_cpp'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-indigo-700 text-right">
                  <button onClick={()=>toggleSort('inventory')} className="inline-flex items-center gap-1 hover:text-indigo-800">
                    <span>Inventory</span>
                    {sortKey==='inventory'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-indigo-400"/>}
                  </button>
                </th>
                <th className="px-3 py-2 font-semibold text-rose-700 text-right">
                  <button onClick={()=>toggleSort('zero_variant')} className="inline-flex items-center gap-1 hover:text-rose-800">
                    <span>Zero-variant</span>
                    {sortKey==='zero_variant'? <SortArrow/> : <ArrowUpDown className="w-3.5 h-3.5 text-rose-400"/>}
                  </button>
                </th>
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
              {!loading && sortedItems.map((c)=>{
                const cpp = c.cpp!=null? `$${c.cpp.toFixed(2)}` : '—'
                const ctr = c.ctr!=null? `${(c.ctr*1).toFixed(2)}%` : '—'
                const id = (c.name||'').trim()
                const isNumeric = /^\d+$/.test(id)
                const orders = getOrders(c)
                const trueCppVal = (orders!=null && orders>0)? (c.spend||0)/orders : null
                const trueCpp = trueCppVal!=null? `$${trueCppVal.toFixed(2)}` : '—'
                const brief = isNumeric? productBriefs[id] : undefined
                const inv = brief? brief.total_available : null
                const zeros = brief? brief.zero_variants : null
                const img = brief? brief.image : null
                const severityAccent = trueCppVal==null? 'border-l-2 border-l-transparent' : (trueCppVal < 2 ? 'border-l-4 border-l-emerald-400' : (trueCppVal < 3 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-rose-400'))
                const colorClass = trueCppVal==null? '' : (trueCppVal < 2 ? 'bg-emerald-50' : (trueCppVal < 3 ? 'bg-amber-50' : 'bg-rose-50'))
                const rowKey = c.campaign_id || c.name || String(Math.random())
                return (
                  <Fragment key={c.campaign_id || c.name}>
                  <tr className={`border-b last:border-b-0 ${colorClass} ${severityAccent}`}>
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
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div>{c.name||'-'}</div>
                      <div className="mt-1 flex items-center gap-1">
                        {(()=>{
                          const rk = (c.campaign_id || c.name || '') as any
                          const draft = manualDrafts[rk] || manualIds[rk] || { kind:'product', id:'' }
                          return (
                            <>
                              <select
                                value={draft.kind}
                                onChange={(e)=> setManualDrafts(prev=> ({ ...prev, [rk]: { ...(prev[rk]||{ id:'', kind:'product' }), kind: (e.target.value as any) } }))}
                                className="border rounded px-1 py-0.5 text-xs bg-white"
                              >
                                <option value="product">Product</option>
                                <option value="collection">Collection</option>
                              </select>
                              <input
                                value={draft.id||''}
                                onChange={(e)=> setManualDrafts(prev=> ({ ...prev, [rk]: { ...(prev[rk]||{ kind: draft.kind }), id: e.target.value.replace(/[^0-9]/g,'') } }))}
                                placeholder="ID"
                                className="w-24 border rounded px-2 py-0.5 text-xs bg-white"
                              />
                              <button
                                onClick={async()=>{
                                  const next = { kind: (manualDrafts[rk]?.kind || draft.kind) as ('product'|'collection'), id: (manualDrafts[rk]?.id || draft.id || '').trim() }
                                  setManualIds(prev=> ({ ...prev, [rk]: next }))
                                  // Fetch now for this row respecting current range
                                  try{
                                    // Persist mapping server-side
                                    try{ await campaignMappingUpsert({ campaign_key: String(rk), kind: next.kind, id: next.id, store }) }catch{}
                                    const { start, end } = computeRange(datePreset)
                                    if(next.kind==='product'){
                                      const oc = await shopifyOrdersCountByTitle({ names: [next.id], start, end, include_closed: true })
                                      const count = ((oc as any)?.data||{})[next.id] ?? 0
                                      setManualCounts(prev=> ({ ...prev, [String(rk)]: count }))
                                    }else{
                                      const oc = await shopifyOrdersCountByCollection({ collection_id: next.id, start, end, store, include_closed: true, aggregate: 'sum_product_orders' })
                                      const count = Number(((oc as any)?.data||{})?.count ?? 0)
                                      setManualCounts(prev=> ({ ...prev, [String(rk)]: count }))
                                      // Preload children and align total with sum
                                      await loadCollectionChildren(rk, next.id)
                                    }
                                  }catch{
                                    setManualCounts(prev=> ({ ...prev, [String(rk)]: 0 }))
                                  }
                                }}
                                className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-xs"
                              >Save</button>
                              {(manualIds as any)[rk] && (manualIds as any)[rk]?.kind==='collection' && (manualIds as any)[rk]?.id && (
                                <button
                                  onClick={async()=>{
                                    const open = !expanded[String(rk)]
                                    setExpanded(prev=> ({ ...prev, [String(rk)]: open }))
                                    if(open){
                                      const collId = String(((manualIds as any)[rk]||{}).id||'')
                                      if(collId) await loadCollectionChildren(rk, collId)
                                    }
                                  }}
                                  className="px-2 py-0.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs"
                                >{expanded[String(rk)]? 'Hide products' : 'Show products'}</button>
                              )}
                              {(manualIds as any)[rk] && (
                                <button
                                  onClick={()=>{
                                    setManualIds(prev=>{ const m={...prev}; delete (m as any)[rk]; try{ localStorage.setItem('ptos_campaign_ids', JSON.stringify(m)) }catch{}; return m })
                                    setManualDrafts(prev=>{ const m={...prev}; delete (m as any)[rk]; return m })
                                    setManualCounts(prev=>{ const m={...prev}; delete (m as any)[String(rk)]; return m })
                                  setExpanded(prev=>{ const m={...prev}; delete (m as any)[String(rk)]; return m })
                                  setCollectionProducts(prev=>{ const m={...prev}; delete (m as any)[String(rk)]; return m })
                                  setCollectionCounts(prev=>{ const m={...prev}; delete (m as any)[String(rk)]; return m })
                                  }}
                                  className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs"
                                >Clear</button>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {(()=>{
                        const st = (c.status||'').toUpperCase()
                        const active = st==='ACTIVE'
                        const color = active? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                        return (
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{active? 'Active' : 'Paused'}</span>
                            {c.campaign_id && (
                              <button
                                onClick={async()=>{
                                  const next = (st==='ACTIVE')? 'PAUSED' : 'ACTIVE'
                                  const ok = window.confirm(`Turn ${next==='ACTIVE'?'ON':'OFF'} this campaign?`)
                                  if(!ok) return
                                  try{
                                    await metaSetCampaignStatus(String(c.campaign_id), next as any)
                                    setItems(prev=> prev.map(row=> row.campaign_id===c.campaign_id? { ...row, status: next } : row))
                                  }catch(e){ alert('Failed to update status') }
                                }}
                                className={`px-2 py-0.5 rounded text-xs ${st==='ACTIVE'? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                              >{st==='ACTIVE'? 'Turn off' : 'Turn on'}</button>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right">${(c.spend||0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{c.purchases||0}</td>
                    <td className="px-3 py-2 text-right">{cpp}</td>
                    <td className="px-3 py-2 text-right">{ctr}</td>
                    <td className="px-3 py-2 text-right">{c.add_to_cart||0}</td>
                    <td className="px-3 py-2">
                      {orders==null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">{orders}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{orders==null ? <span className="inline-block h-4 w-12 bg-slate-100 rounded animate-pulse" /> : trueCpp}</td>
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
                  {(()=>{
                    const rk = (c.campaign_id || c.name || '') as any
                    const conf = (manualIds as any)[rk]
                    if(!(conf && conf.kind==='collection' && expanded[String(rk)])) return null
                    const ids = collectionProducts[String(rk)]||[]
                    const counts = collectionCounts[String(rk)]||{}
                    const loadingChildren = !!childrenLoading[String(rk)]
                    return (
                      <tr className="border-b last:border-b-0">
                        <td className="px-3 py-2 bg-slate-50" colSpan={12}>
                          {loadingChildren ? (
                            <div className="text-xs text-slate-500">Loading products…</div>
                          ) : (
                            <div className="text-xs">
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {ids.map(pid=> (
                                  <div key={pid} className="flex items-center justify-between border rounded px-2 py-1 bg-white">
                                    <span className="font-mono">{pid}</span>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">{counts[pid] ?? '—'}</span>
                                  </div>
                                ))}
                                {ids.length===0 && (
                                  <div className="text-slate-500">No products in this collection.</div>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })()}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


