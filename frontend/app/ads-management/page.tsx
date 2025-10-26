"use client"
import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, DollarSign, ShoppingCart, Calculator } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow, shopifyOrdersCountByTitle, shopifyProductsBrief, shopifyOrdersCountByCollection, shopifyCollectionProducts, campaignMappingsList, campaignMappingUpsert, metaGetAdAccount, metaSetAdAccount, metaSetCampaignStatus, fetchCampaignAdsets, metaSetAdsetStatus, type MetaAdsetRow, fetchCampaignPerformance, shopifyOrdersCountTotal } from '@/lib/api'

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
  const [adsetsExpanded, setAdsetsExpanded] = useState<Record<string, boolean>>({})
  const [adsetsLoading, setAdsetsLoading] = useState<Record<string, boolean>>({})
  const [adsetsByCampaign, setAdsetsByCampaign] = useState<Record<string, MetaAdsetRow[]>>({})
  const [togglingCampaign, setTogglingCampaign] = useState<Record<string, boolean>>({})
  const [togglingAdset, setTogglingAdset] = useState<Record<string, boolean>>({})
  const [sortKey, setSortKey] = useState<'campaign'|'spend'|'purchases'|'cpp'|'ctr'|'add_to_cart'|'shopify_orders'|'true_cpp'|'inventory'|'zero_variant'>('spend')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')
  const [perfOpen, setPerfOpen] = useState<boolean>(false)
  const [perfLoading, setPerfLoading] = useState<boolean>(false)
  const [perfCampaign, setPerfCampaign] = useState<{ id:string, name:string }|null>(null)
  const [perfMetrics, setPerfMetrics] = useState<Array<{ date:string, spend:number, purchases:number, cpp?:number|null, ctr?:number|null, add_to_cart:number }>>([])
  const [perfOrders, setPerfOrders] = useState<number[]>([])
  const [storeOrdersTotal, setStoreOrdersTotal] = useState<number|null>(null)

  const totalSpend = useMemo(()=> (items||[]).reduce((acc, it)=> acc + Number(it.spend||0), 0), [items])
  const tableOrdersTotal = useMemo(()=>{
    let sum = 0
    for(const r of (items||[])){
      const v = getOrders(r)
      if(typeof v==='number' && v>0) sum += v
    }
    return sum
  }, [items, shopifyCounts, manualCounts, manualIds])
  const totalCPP = useMemo(()=> (tableOrdersTotal>0? (totalSpend / tableOrdersTotal) : null), [totalSpend, tableOrdersTotal])
  const storeCPP = useMemo(()=> ((storeOrdersTotal||0)>0? (totalSpend / Number(storeOrdersTotal||0)) : null), [totalSpend, storeOrdersTotal])

  function fmtCurrency(v:number){ try{ return v.toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits:2 }) }catch{ return `$${(v||0).toFixed(2)}` } }
  function fmtInt(v:number){ try{ return Math.round(v||0).toLocaleString() }catch{ return String(Math.round(v||0)) } }

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
      // Fetch store-wide orders total for the same range
      try{
        const { start, end } = computeRange(effPreset)
        const resTotal = await shopifyOrdersCountTotal({ start, end, store, include_closed: true, date_field: 'processed' }) as any
        setStoreOrdersTotal(Number(((resTotal||{}).data||{}).count||0))
      }catch{ setStoreOrdersTotal(0) }
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
    const loadAdAccount = async () => {
      try{
        const res = await metaGetAdAccount(store)
        const conf = (res as any)?.data||{}
        if(conf && conf.id){
          setAdAccount(String(conf.id||''))
          try{ localStorage.setItem('ptos_ad_account', String(conf.id||'')) }catch{}
        }
        if(conf && conf.name){ setAdAccountName(String(conf.name||'')) } else { setAdAccountName('') }
      }catch{ setAdAccountName('') }
    }
    loadAdAccount()
    const loadMappings = async () => {
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
    }
    loadMappings()
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
        {/* Summary Header */}
        <div className="mb-4 rounded-2xl overflow-hidden shadow-lg bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 text-white">
          <div className="p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <div>
                <div className="text-xs uppercase/relaxed opacity-80">Ad account</div>
                <div className="text-lg font-semibold">{adAccountName || adAccount || '—'}</div>
                <div className="text-xs opacity-80">Range: {datePreset} • Store: {store}</div>
              </div>
              <div className="text-sm opacity-90 flex items-center gap-2">
                <Rocket className="w-4 h-4"/>
                <span>Performance overview</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="flex items-center justify-between text-xs opacity-90"><span>Total Spend</span><DollarSign className="w-4 h-4 opacity-90"/></div>
                <div className="mt-1 text-xl font-bold">{fmtCurrency(totalSpend)}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="flex items-center justify-between text-xs opacity-90"><span>Shopify Orders (table)</span><ShoppingCart className="w-4 h-4 opacity-90"/></div>
                <div className="mt-1 text-xl font-bold">{fmtInt(tableOrdersTotal)}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="flex items-center justify-between text-xs opacity-90"><span>Store Orders (all)</span><ShoppingCart className="w-4 h-4 opacity-90"/></div>
                <div className="mt-1 text-xl font-bold">{storeOrdersTotal!=null? fmtInt(storeOrdersTotal) : '—'}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="flex items-center justify-between text-xs opacity-90"><span>Total CPP</span><Calculator className="w-4 h-4 opacity-90"/></div>
                <div className="mt-1 text-xl font-bold">{totalCPP!=null? fmtCurrency(totalCPP) : '—'}</div>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-3 border border-white/20">
                <div className="flex items-center justify-between text-xs opacity-90"><span>Full Store CPP</span><Calculator className="w-4 h-4 opacity-90"/></div>
                <div className="mt-1 text-xl font-bold">{storeCPP!=null? fmtCurrency(storeCPP) : '—'}</div>
              </div>
            </div>
          </div>
        </div>
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
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async()=>{
                            const cid = String(c.campaign_id||'')
                            if(!cid) return
                            const open = !adsetsExpanded[cid]
                            setAdsetsExpanded(prev=> ({ ...prev, [cid]: open }))
                            if(open && !adsetsByCampaign[cid]){
                              try{
                                setAdsetsLoading(prev=> ({ ...prev, [cid]: true }))
                                const res = await fetchCampaignAdsets(cid, datePreset)
                                const items = ((res as any)?.data)||[]
                                setAdsetsByCampaign(prev=> ({ ...prev, [cid]: items }))
                              }catch{
                                setAdsetsByCampaign(prev=> ({ ...prev, [cid]: [] }))
                              }finally{
                                setAdsetsLoading(prev=> ({ ...prev, [cid]: false }))
                              }
                            }
                          }}
                          className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-xs"
                        >{adsetsExpanded[String(c.campaign_id||'')]? '▾' : '▸'}</button>
                        <span>{c.name||'-'}</span>
                      </div>
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
                        const cid = String(c.campaign_id||'')
                        return (
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{active? 'Active' : 'Paused'}</span>
                            {c.campaign_id && (
                              <label className="inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={active}
                                  disabled={!!togglingCampaign[cid]}
                                  onChange={async(e)=>{
                                    const next = e.target.checked? 'ACTIVE' : 'PAUSED'
                                    const ok = window.confirm(`Turn ${next==='ACTIVE'?'ON':'OFF'} this campaign?`)
                                    if(!ok) return
                                    try{
                                      setTogglingCampaign(prev=> ({ ...prev, [cid]: true }))
                                      await metaSetCampaignStatus(String(cid), next as any)
                                      setItems(prev=> prev.map(row=> row.campaign_id===c.campaign_id? { ...row, status: next } : row))
                                    }catch(e){ alert('Failed to update status') }
                                    finally{ setTogglingCampaign(prev=> ({ ...prev, [cid]: false })) }
                                  }}
                                  className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-emerald-500 transition-colors">
                                  <div className="w-4 h-4 bg-white rounded-full shadow transform transition-transform translate-x-0 peer-checked:translate-x-5 mt-0.5 ml-0.5" />
                                </div>
                              </label>
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
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={async()=>{
                          const cid = String(c.campaign_id||'')
                          if(!cid) return
                          setPerfOpen(true)
                          setPerfLoading(true)
                          setPerfCampaign({ id: cid, name: c.name||'' })
                          try{
                            const res = await fetchCampaignPerformance(cid, 6)
                            const days = (((res as any)?.data||{}).days)||[]
                            setPerfMetrics(days)
                            // Load Shopify orders per day based on mapping or numeric id
                            const rk = (c.campaign_id || c.name || '') as any
                            const conf = (manualIds as any)[rk]
                            const useProduct = conf? (conf.kind==='product') : /^\d+$/.test((c.name||'').trim())
                            const prodId = useProduct? (conf? conf.id : (c.name||'').trim()) : undefined
                            const collId = (!useProduct && conf && conf.kind==='collection')? conf.id : undefined
                            const ordersPerDay: number[] = []
                            for(const d of (days||[])){
                              const start = d.date
                              const end = d.date
                              try{
                                if(prodId){
                                  const oc = await shopifyOrdersCountByTitle({ names: [prodId], start, end, include_closed: true, date_field: 'processed' })
                                  const count = ((oc as any)?.data||{})[prodId] ?? 0
                                  ordersPerDay.push(Number(count||0))
                                }else if(collId){
                                  const oc = await shopifyOrdersCountByCollection({ collection_id: collId, start, end, store, include_closed: true, aggregate: 'sum_product_orders', date_field: 'processed' })
                                  const count = Number(((oc as any)?.data||{})?.count ?? 0)
                                  ordersPerDay.push(Number(count||0))
                                }else{
                                  ordersPerDay.push(0)
                                }
                              }catch{ ordersPerDay.push(0) }
                            }
                            setPerfOrders(ordersPerDay)
                          }finally{
                            setPerfLoading(false)
                          }
                        }}
                        className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-xs"
                      >Performance</button>
                    </td>
                  </tr>
                  {(()=>{
                    const rk = (c.campaign_id || c.name || '') as any
                    const conf = (manualIds as any)[rk]
                    const colSpan = 14
                    const cid = String(c.campaign_id||'')
                    const showAdsets = !!adsetsExpanded[cid]
                    const loadingAdsets = !!adsetsLoading[cid]
                    if(showAdsets){
                      const adsets = adsetsByCampaign[cid]||[]
                      return (
                        <tr className="border-b last:border-b-0">
                          <td className="px-3 py-2 bg-slate-50" colSpan={colSpan}>
                            {loadingAdsets ? (
                              <div className="text-xs text-slate-500">Loading ad sets…</div>
                            ) : (
                              <div className="text-xs">
                                <div className="border rounded bg-white">
                                  <div className="grid grid-cols-8 gap-2 px-2 py-1 text-slate-500">
                                    <div className="col-span-3">Ad set</div>
                                    <div className="text-right">Spend</div>
                                    <div className="text-right">Purchases</div>
                                    <div className="text-right">CPP</div>
                                    <div className="text-right">CTR</div>
                                    <div className="text-right">Status</div>
                                  </div>
                                  {adsets.map(a=>{
                                    const ast = (a.status||'').toUpperCase()
                                    const aactive = ast==='ACTIVE'
                                    const acolor = aactive? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                                    const aid = String(a.adset_id||'')
                                    return (
                                      <div key={aid||a.name} className="grid grid-cols-8 gap-2 px-2 py-1 border-t items-center">
                                        <div className="col-span-3 whitespace-nowrap overflow-hidden text-ellipsis">{a.name||'-'}</div>
                                        <div className="text-right">${(a.spend||0).toFixed(2)}</div>
                                        <div className="text-right">{a.purchases||0}</div>
                                        <div className="text-right">{a.cpp!=null? `$${a.cpp.toFixed(2)}` : '—'}</div>
                                        <div className="text-right">{a.ctr!=null? `${(a.ctr*1).toFixed(2)}%` : '—'}</div>
                                        <div className="flex items-center justify-end gap-2">
                                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${acolor}`}>{aactive? 'Active' : 'Paused'}</span>
                                          {aid && (
                                            <label className="inline-flex items-center cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={aactive}
                                                disabled={!!togglingAdset[aid]}
                                                onChange={async(e)=>{
                                                  const next = e.target.checked? 'ACTIVE' : 'PAUSED'
                                                  const ok = window.confirm(`Turn ${next==='ACTIVE'?'ON':'OFF'} this ad set?`)
                                                  if(!ok) return
                                                  try{
                                                    setTogglingAdset(prev=> ({ ...prev, [aid]: true }))
                                                    await metaSetAdsetStatus(aid, next as any)
                                                    setAdsetsByCampaign(prev=> ({ ...prev, [cid]: (prev[cid]||[]).map(x=> x.adset_id===aid? { ...x, status: next } : x) }))
                                                  }catch{
                                                    alert('Failed to update ad set status')
                                                  }finally{
                                                    setTogglingAdset(prev=> ({ ...prev, [aid]: false }))
                                                  }
                                                }}
                                                className="sr-only peer"
                                              />
                                              <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-emerald-500 transition-colors">
                                                <div className="w-4 h-4 bg-white rounded-full shadow transform transition-transform translate-x-0 peer-checked:translate-x-5 mt-0.5 ml-0.5" />
                                              </div>
                                            </label>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                  {adsets.length===0 && (
                                    <div className="px-2 py-2 text-slate-500 border-t">No ad sets found.</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    }
                    // Existing collection expansion block
                    const conf2 = (manualIds as any)[rk]
                    if(!(conf2 && conf2.kind==='collection' && expanded[String(rk)])) return null
                    const ids = collectionProducts[String(rk)]||[]
                    const counts = collectionCounts[String(rk)]||{}
                    const loadingChildren = !!childrenLoading[String(rk)]
                    return (
                      <tr className="border-b last:border-b-0">
                        <td className="px-3 py-2 bg-slate-50" colSpan={14}>
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
      <PerformanceModal open={perfOpen} onClose={()=> setPerfOpen(false)} loading={perfLoading} campaign={perfCampaign} days={perfMetrics} orders={perfOrders} />
    </div>
  )
}

// Performance Modal
function PerformanceModal({ open, onClose, loading, campaign, days, orders }:{ open:boolean, onClose:()=>void, loading:boolean, campaign:{id:string,name:string}|null, days:Array<{date:string,spend:number,purchases:number,cpp?:number|null,ctr?:number|null,add_to_cart:number}>, orders:number[] }){
  if(!open) return null
  const labels = (days||[]).map(d=> d.date)
  const spend = (days||[]).map(d=> d.spend||0)
  const purchases = (days||[]).map(d=> d.purchases||0)
  const ctr = (days||[]).map(d=> (d.ctr||0)*1)
  const cpp = (days||[]).map(d=> d.cpp==null? 0 : (d.cpp||0))
  const atc = (days||[]).map(d=> d.add_to_cart||0)
  const ordersArr = (orders||[])
  const [showOrders, setShowOrders] = useState(true)
  const [showATC, setShowATC] = useState(true)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-[92vw] max-w-5xl max-h-[90vh] overflow-auto">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold text-lg">Performance · {campaign?.name||campaign?.id}</div>
          <button onClick={onClose} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">Close</button>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="text-slate-500">Loading…</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={showOrders} onChange={(e)=> setShowOrders(e.target.checked)} />
                  <span>Show Orders</span>
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={showATC} onChange={(e)=> setShowATC(e.target.checked)} />
                  <span>Show Add to cart</span>
                </label>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(days||[]).map((d,i)=> (
                  <div key={d.date+String(i)} className="border rounded p-3 bg-slate-50">
                    <div className="text-xs text-slate-500">{d.date}</div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <div className="text-slate-500">Spend</div><div className="text-right font-semibold">${(d.spend||0).toFixed(2)}</div>
                      <div className="text-slate-500">Purchases</div><div className="text-right font-semibold">{d.purchases||0}</div>
                      <div className="text-slate-500">CPP</div><div className="text-right font-semibold">{d.cpp!=null? `$${(d.cpp||0).toFixed(2)}` : '—'}</div>
                      <div className="text-slate-500">CTR</div><div className="text-right font-semibold">{d.ctr!=null? `${(d.ctr*1).toFixed(2)}%` : '—'}</div>
                      <div className="text-slate-500">Add to cart</div><div className="text-right font-semibold">{d.add_to_cart||0}</div>
                      <div className="text-slate-500">Shopify Orders</div><div className="text-right font-semibold">{(ordersArr[i]||0)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="mb-2 text-sm text-slate-600">Daily performance (Spend bars, Orders/ATC lines)</div>
                <PerformanceChart labels={labels} spend={spend} orders={ordersArr} addToCart={atc} showOrders={showOrders} showATC={showATC} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PerformanceChart({ labels, spend, orders, addToCart, showOrders, showATC }:{ labels:string[], spend:number[], orders:number[], addToCart:number[], showOrders:boolean, showATC:boolean }){
  const w = 1000, h = 320, padL = 56, padR = 56, padT = 24, padB = 40
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = Math.max(1, labels.length)
  const xs = labels.map((_, i)=> padL + (i*(innerW))/Math.max(1, n-1))
  // Fixed axes: Spend $1..$100 (left), Orders/ATC 1..100 (right)
  const minSpend = 1, maxSpend = 100
  const minCount = 1, maxCount = 100
  const clamp = (v:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, v||0))
  const yLeft = (v:number)=> padT + innerH - ((clamp(v, minSpend, maxSpend)-minSpend)/(maxSpend-minSpend))*innerH
  const yRight = (v:number)=> padT + innerH - ((clamp(v, minCount, maxCount)-minCount)/(maxCount-minCount))*innerH
  const gridLines = 5
  const leftTicks = [1,25,50,75,100]
  const rightTicks = [1,25,50,75,100]
  // Build line paths (spend, orders, atc)
  const pathSpend = `M ${xs[0]},${yLeft(spend[0]||0)} ` + spend.slice(1).map((v,i)=> `L ${xs[i+1]},${yLeft(v||0)}`).join(' ')
  const pathOrders = `M ${xs[0]},${yRight(orders[0]||0)} ` + orders.slice(1).map((v,i)=> `L ${xs[i+1]},${yRight(v||0)}`).join(' ')
  const pathATC = `M ${xs[0]},${yRight(addToCart[0]||0)} ` + addToCart.slice(1).map((v,i)=> `L ${xs[i+1]},${yRight(v||0)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      <rect x={0} y={0} width={w} height={h} fill="#ffffff"/>
      {/* Horizontal gridlines */}
      {leftTicks.map((tick,i)=> (
        <line key={`h${i}`} x1={padL} y1={yLeft(tick)} x2={w-padR} y2={yLeft(tick)} stroke="#e5e7eb" strokeDasharray="2 2"/>
      ))}
      {/* Vertical gridlines per day */}
      {xs.map((x,i)=> (
        <line key={`v${i}`} x1={x} y1={padT} x2={x} y2={h-padB} stroke="#f1f5f9" />
      ))}
      {/* Lines */}
      <path d={pathSpend} fill="none" stroke="#10b981" strokeWidth={2.5} />
      {showOrders && (<path d={pathOrders} fill="none" stroke="#2563eb" strokeWidth={2.5} />)}
      {showATC && (<path d={pathATC} fill="none" stroke="#f59e0b" strokeWidth={2.5} />)}
      {/* Axis labels */}
      {leftTicks.map((tick,i)=> (
        <text key={`lt${i}`} x={padL-8} y={yLeft(tick)} textAnchor="end" alignmentBaseline="middle" fontSize="10" fill="#64748b">${tick}</text>
      ))}
      {rightTicks.map((tick,i)=> (
        <text key={`rt${i}`} x={w-padR+8} y={yRight(tick)} textAnchor="start" alignmentBaseline="middle" fontSize="10" fill="#64748b">{tick}</text>
      ))}
      {xs.map((x,i)=> (
        <text key={`x${i}`} x={x} y={h-10} textAnchor="middle" fontSize="10" fill="#64748b">{labels[i].slice(5)}</text>
      ))}
      {/* Legends */}
      <g>
        <rect x={padL} y={8} width={18} height={2} fill="#10b981"/>
        <text x={padL+24} y={12} fontSize="11" fill="#334155">Spend ($)</text>
        <rect x={padL+120} y={8} width={18} height={2} fill="#2563eb"/>
        <text x={padL+146} y={12} fontSize="11" fill="#334155">Orders</text>
        <rect x={padL+220} y={8} width={18} height={2} fill="#f59e0b"/>
        <text x={padL+246} y={12} fontSize="11" fill="#334155">Add to cart</text>
      </g>
    </svg>
  )
}


