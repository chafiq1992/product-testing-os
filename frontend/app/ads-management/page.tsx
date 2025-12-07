"use client"
import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, DollarSign, ShoppingCart, Calculator } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow, shopifyOrdersCountByTitle, shopifyProductsBrief, shopifyOrdersCountByCollection, shopifyCollectionProducts, campaignMappingsList, campaignMappingUpsert, metaGetAdAccount, metaSetAdAccount, metaSetCampaignStatus, fetchCampaignAdsets, metaSetAdsetStatus, type MetaAdsetRow, fetchCampaignPerformance, shopifyOrdersCountTotal, metaListAdAccounts, fetchCampaignAdsetOrders, type AttributedOrder, campaignMetaList, campaignMetaUpsert, campaignTimelineAdd } from '@/lib/api'

export default function AdsManagementPage(){
  const [items, setItems] = useState<MetaCampaignRow[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [datePreset, setDatePreset] = useState<string>('last_7d_incl_today')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [error, setError] = useState<string|undefined>(undefined)
  const [shopifyCounts, setShopifyCounts] = useState<Record<string, number>>({})
  const ordersSeqToken = useRef(0)
  const [store, setStore] = useState<string>(()=>{
    try{ return localStorage.getItem('ptos_store')||'irrakids' }catch{ return 'irrakids' }
  })
  const [adAccount, setAdAccount] = useState<string>(()=>{
    try{ return localStorage.getItem('ptos_ad_account')||'' }catch{ return '' }
  })
  const [adAccounts, setAdAccounts] = useState<Array<{id:string,name:string,account_status?:number}>>([])
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
  const [adsetOrdersByCampaign, setAdsetOrdersByCampaign] = useState<Record<string, Record<string, { count:number, orders: AttributedOrder[] }>>>({})
  const [adsetOrdersLoading, setAdsetOrdersLoading] = useState<Record<string, boolean>>({})
  const [adsetOrdersExpanded, setAdsetOrdersExpanded] = useState<Record<string, boolean>>({})
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
  // Selection + Merging state
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>(()=>{
    try{ return JSON.parse(localStorage.getItem('ptos_ads_selected')||'{}') }catch{ return {} }
  })
  const [mergedWith, setMergedWith] = useState<Record<string, string>>(()=>{
    try{ return JSON.parse(localStorage.getItem('ptos_ads_merged')||'{}') }catch{ return {} }
  })
  const [groupNotes, setGroupNotes] = useState<Record<string, string>>(()=>{
    try{ return JSON.parse(localStorage.getItem('ptos_ads_group_notes')||'{}') }catch{ return {} }
  })
  const [campaignMeta, setCampaignMeta] = useState<Record<string, { supplier_name?:string, supplier_alt_name?:string, supply_available?:string, timeline?:Array<{text:string, at:string}> }>>({})
  const [timelineOpen, setTimelineOpen] = useState<{ open:boolean, campaign?: { id:string, name?:string } }>(()=>({ open:false }))
  const [timelineAdding, setTimelineAdding] = useState<boolean>(false)
  const [timelineDraft, setTimelineDraft] = useState<string>('')
  const browserTz = useMemo(()=> {
    try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined }catch{ return undefined }
  }, [])

  const totalSpend = useMemo(()=> (items||[]).reduce((acc, it)=> acc + Number(it.spend||0), 0), [items])
  const tableOrdersTotal = useMemo(()=>{
    // Sum orders while respecting merged groups (count each group once)
    const rowByKey: Record<string, MetaCampaignRow> = {}
    for(const r of (items||[])){
      const k = String(r.campaign_id||r.name||'')
      rowByKey[k] = r
    }
    const visited: Record<string, true> = {}
    let sum = 0
    for(const r of (items||[])){
      const k = String(r.campaign_id||r.name||'')
      if(visited[k]) continue
      const partner = mergedWith[k]
      if(partner){
        const r2 = rowByKey[partner]
        const o1 = getOrders(r) || 0
        // For merged pairs, only count orders from one row to avoid double counting
        sum += o1
        visited[k] = true
        visited[partner] = true
      }else{
        const v = getOrders(r)
        if(typeof v==='number' && v>0) sum += v
        visited[k] = true
      }
    }
    return sum
  }, [items, shopifyCounts, manualCounts, manualIds, mergedWith])
  const totalCPP = useMemo(()=> (tableOrdersTotal>0? (totalSpend / tableOrdersTotal) : null), [totalSpend, tableOrdersTotal])
  const storeCPP = useMemo(()=> ((storeOrdersTotal||0)>0? (totalSpend / Number(storeOrdersTotal||0)) : null), [totalSpend, storeOrdersTotal])

  function fmtCurrency(v:number){ try{ return v.toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits:2 }) }catch{ return `$${(v||0).toFixed(2)}` } }
  function fmtInt(v:number){ try{ return Math.round(v||0).toLocaleString() }catch{ return String(Math.round(v||0)) } }

  function extractNumericId(s?: string|null){
    const n = String(s||'')
    const m = n.match(/(\d{3,})/)
    return m? m[1] : null
  }

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
      case 'last_3d_incl_today':
        startDate.setDate(startDate.getDate()-(3-1))
        break
      case 'last_4d_incl_today':
        startDate.setDate(startDate.getDate()-(4-1))
        break
      case 'last_5d_incl_today':
        startDate.setDate(startDate.getDate()-(5-1))
        break
      case 'last_6d_incl_today':
        startDate.setDate(startDate.getDate()-(6-1))
        break
      case 'last_7d_incl_today':
      default:
        startDate.setDate(startDate.getDate()-(7-1))
        break
    }
    startDate.setHours(0,0,0,0)
    return { start: toYmd(startDate), end: toYmd(endDate) }
  }

  function presetLabel(p: string){
    switch(p){
      case 'today': return 'today'
      case 'yesterday': return 'yesterday'
      case 'last_3d_incl_today': return 'last 3 days (including today)'
      case 'last_4d_incl_today': return 'last 4 days (including today)'
      case 'last_5d_incl_today': return 'last 5 days (including today)'
      case 'last_6d_incl_today': return 'last 6 days (including today)'
      case 'last_7d_incl_today': return 'last 7 days (including today)'
      case 'custom': return 'custom'
      default: return p
    }
  }

  function metaRangeParams(preset: string): { datePreset?: string, range?: { start: string, end: string } }{
    if(preset==='custom'){
      if(customStart && customEnd) return { range: { start: customStart, end: customEnd } }
      const { start, end } = computeRange('last_7d_incl_today')
      return { range: { start, end } }
    }
    // For all presets that include today, use explicit time range to ensure today's data is included
    if(preset==='last_3d_incl_today' || preset==='last_4d_incl_today' || preset==='last_5d_incl_today' || preset==='last_6d_incl_today' || preset==='last_7d_incl_today'){
      const { start, end } = computeRange(preset)
      return { range: { start, end } }
    }
    // Simple pass-through for exact-day presets
    if(preset==='today') return { datePreset: 'today' }
    if(preset==='yesterday') return { datePreset: 'yesterday' }
    // Fallback to a safe default
    const { start, end } = computeRange('last_7d_incl_today')
    return { range: { start, end } }
  }

  async function load(preset?: string){
    setLoading(true); setError(undefined)
    try{
      const effPreset = preset||datePreset
      const metaParams = metaRangeParams(effPreset)
      const res = await fetchMetaCampaigns(metaParams.datePreset, adAccount||undefined, metaParams.range)
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
      // Clear ad set related state so expanding re-fetches with the current date range
      setAdsetsExpanded({})
      setAdsetsLoading({})
      setAdsetsByCampaign({})
      setAdsetOrdersByCampaign({})
      setAdsetOrdersLoading({})
      setAdsetOrdersExpanded({})
      const token = ++ordersSeqToken.current
      // Fetch store-wide orders total for the same range
      try{
        const { start, end } = (effPreset==='custom' && customStart && customEnd)? { start: customStart, end: customEnd } : computeRange(effPreset)
        const resTotal = await shopifyOrdersCountTotal({ start, end, store, include_closed: true, date_field: 'processed' }) as any
        setStoreOrdersTotal(Number(((resTotal||{}).data||{}).count||0))
      }catch{ setStoreOrdersTotal(0) }
      setTimeout(async ()=>{
        if(token !== ordersSeqToken.current) return
        const rows: MetaCampaignRow[] = (((res as any)?.data)||[]) as MetaCampaignRow[]
        // Build product ID list from numeric in name OR manual product mappings
        const idSet: Record<string, true> = {}
        for(const c of rows){
          const rk = (c.campaign_id || c.name || '') as any
          const manual = (manualIds as any)[rk]
          if(manual && manual.kind==='product' && manual.id && /^\d+$/.test(manual.id)){
            idSet[manual.id] = true
            continue
          }
          const pid = extractNumericId(c.name||'')
          if(pid) idSet[pid] = true
        }
        const ids = Object.keys(idSet)
        if(!ids.length) return
        // Fetch product briefs (image + inventory) in batch for speed
        try{
          const pb = await shopifyProductsBrief({ ids, store })
          setProductBriefs(((pb as any)?.data)||{})
        }catch{
          setProductBriefs({})
        }
        const { start, end } = (effPreset==='custom' && customStart && customEnd)? { start: customStart, end: customEnd } : computeRange(effPreset)
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
        const oc = await shopifyOrdersCountByTitle({ names: ids, start, end, include_closed: false, date_field: 'processed' })
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

  useEffect(()=>{ // initialize custom range defaults
    const { start, end } = computeRange('last_7d_incl_today')
    setCustomStart(start)
    setCustomEnd(end)
    load(datePreset)
  },[])
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
    const loadAccounts = async () => {
      try{
        const res = await metaListAdAccounts()
        const items = ((res as any)?.data)||[]
        // Append extra known accounts if not present
        const extras: Array<{id:string,name:string}> = [
          { id: '8127151147322914', name: '8127151147322914' },
        ]
        const byId: Record<string, {id:string,name:string,account_status?:number}> = {}
        for(const a of items){ byId[a.id] = a }
        for(const e of extras){ if(!byId[e.id]) byId[e.id] = e as any }
        setAdAccounts(Object.values(byId))
      }catch{ setAdAccounts([]) }
    }
    loadAdAccount()
    loadAccounts()
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
    const loadMeta = async ()=>{
      try{
        const res = await campaignMetaList(store)
        setCampaignMeta(((res as any)?.data)||{})
      }catch{
        setCampaignMeta({})
      }
    }
    loadMeta()
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
    const pid = extractNumericId(id)
    if(!pid) return null
    const v = shopifyCounts[pid]
    return typeof v==='number'? v : null
  }
  function getInventory(row: MetaCampaignRow){
    const rowKey = (row.campaign_id || row.name || '') as any
    const manual = (manualIds as any)[rowKey]
    let pid: string | null = null
    if(manual && manual.kind==='product' && manual.id) pid = manual.id
    else pid = extractNumericId(getId(row))
    if(!pid) return null
    const brief = productBriefs[pid]
    if(!brief) return null
    return typeof brief.total_available==='number'? brief.total_available : null
  }
  function getZeroVariants(row: MetaCampaignRow){
    const rowKey = (row.campaign_id || row.name || '') as any
    const manual = (manualIds as any)[rowKey]
    let pid: string | null = null
    if(manual && manual.kind==='product' && manual.id) pid = manual.id
    else pid = extractNumericId(getId(row))
    if(!pid) return null
    const brief = productBriefs[pid]
    if(!brief) return null
    // Prefer size-level zero count if available; fallback to variant-level
    if(typeof (brief as any).zero_sizes === 'number') return Number((brief as any).zero_sizes||0)
    return typeof brief.zero_variants==='number'? Number(brief.zero_variants||0) : null
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
    // Reorder to keep merged pairs adjacent
    const rowByKey: Record<string, MetaCampaignRow> = {}
    for(const r of arr){ rowByKey[String(r.campaign_id||r.name||'')] = r }
    const seen: Record<string, true> = {}
    const out: MetaCampaignRow[] = []
    for(const r of arr){
      const k = String(r.campaign_id||r.name||'')
      if(seen[k]) continue
      const partner = mergedWith[k]
      if(partner && rowByKey[partner]){
        out.push(r)
        out.push(rowByKey[partner])
        seen[k] = true; seen[partner] = true
      }else{
        out.push(r)
        seen[k] = true
      }
    }
    return out
  }, [items, sortKey, sortDir, shopifyCounts, productBriefs, mergedWith])

  function groupIdFor(a:string, b:string){
    return [a,b].map(String).sort().join('||')
  }
  function isMergedKey(k:string){ return !!mergedWith[k] }
  function toggleSelect(k:string, v?:boolean){
    setSelectedKeys(prev=>{ const next={...prev, [k]: v==null? !prev[k] : !!v}; try{ localStorage.setItem('ptos_ads_selected', JSON.stringify(next)) }catch{}; return next })
  }
  function clearSelection(){ setSelectedKeys(()=>{ try{ localStorage.setItem('ptos_ads_selected','{}') }catch{}; return {} }) }
  function doMergeSelected(){
    const keys = Object.keys(selectedKeys).filter(k=> !!selectedKeys[k])
    if(keys.length!==2){ alert('Select exactly 2 rows to merge.'); return }
    const [a,b] = keys
    setMergedWith(prev=>{
      const next = { ...prev }
      // Unmerge existing pairs containing a or b
      const pa = next[a]; const pb = next[b]
      if(pa){ delete next[pa]; delete next[a] }
      if(pb){ delete next[pb]; delete next[b] }
      next[a] = b; next[b] = a
      try{ localStorage.setItem('ptos_ads_merged', JSON.stringify(next)) }catch{}
      return next
    })
    // Initialize shared group note if empty
    const gid = groupIdFor(a,b)
    setGroupNotes(prev=>{ const next={...prev}; if(next[gid]==null){ next[gid]='' } try{ localStorage.setItem('ptos_ads_group_notes', JSON.stringify(next)) }catch{} return next })
    clearSelection()
  }
  function unmergeKey(k:string){
    setMergedWith(prev=>{
      const partner = prev[k]
      if(!partner) return prev
      const next = { ...prev }
      delete next[k]; delete next[partner]
      try{ localStorage.setItem('ptos_ads_merged', JSON.stringify(next)) }catch{}
      return next
    })
  }

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
            <select
              value={adAccount}
              onChange={async (e)=>{
                const v = e.target.value
                setAdAccount(v)
                try{ localStorage.setItem('ptos_ad_account', v) }catch{}
                try{
                  const res = await metaSetAdAccount({ id: v, store })
                  const data = (res as any)?.data||{}
                  setAdAccountName(String((data && data.name) ? data.name : (adAccounts.find(a=> a.id===v)?.name || '')))
                }catch{}
              }}
              className="rounded-xl border px-2 py-1 text-sm bg-white w-56"
            >
              <option value="">Select ad account…</option>
              {adAccounts.map(a=> (
                <option key={a.id} value={a.id}>{a.name||a.id} ({a.id})</option>
              ))}
            </select>
            {adAccountName? (<span className="text-xs text-slate-600">{adAccountName}</span>) : null}
          </div>
          <div className="flex items-center gap-2">
            <select value={datePreset} onChange={(e)=>{ const v=e.target.value; setDatePreset(v); if(v!=='custom') load(v) }} className="rounded-xl border px-2 py-1 text-sm bg-white">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last_3d_incl_today">Last 3 days (including today)</option>
              <option value="last_4d_incl_today">Last 4 days (including today)</option>
              <option value="last_5d_incl_today">Last 5 days (including today)</option>
              <option value="last_6d_incl_today">Last 6 days (including today)</option>
              <option value="last_7d_incl_today">Last 7 days (including today)</option>
              <option value="custom">Custom…</option>
            </select>
            {datePreset==='custom' && (
              <div className="flex items-center gap-1 text-sm">
                <input type="date" value={customStart} onChange={(e)=> setCustomStart(e.target.value)} className="rounded-xl border px-2 py-1 bg-white" />
                <span>to</span>
                <input type="date" value={customEnd} onChange={(e)=> setCustomEnd(e.target.value)} className="rounded-xl border px-2 py-1 bg-white" />
                <button onClick={()=> load('custom')} className="rounded-xl font-semibold inline-flex items-center gap-2 px-2 py-1 bg-slate-200 hover:bg-slate-300">Apply</button>
              </div>
            )}
          </div>
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
                <div className="text-xs opacity-80">Range: {datePreset==='custom'? `${customStart||'—'} to ${customEnd||'—'}` : presetLabel(datePreset)} • Store: {store}</div>
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
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-slate-600">Select 2 rows to merge Shopify metrics.</div>
          <div className="flex items-center gap-2">
            <button
              onClick={doMergeSelected}
              className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-60"
              disabled={Object.keys(selectedKeys).filter(k=> selectedKeys[k]).length!==2}
            >Merge 2</button>
          </div>
        </div>
        <div className="overflow-x-auto bg-white border rounded-none">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/90 backdrop-blur supports-backdrop-blur:bg-slate-50/60 border-b shadow-sm">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold w-8">Sel</th>
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
                <th className="px-3 py-2 font-semibold">
                  <span>Supplier</span>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <span>Supply available</span>
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
                  <td colSpan={17} className="px-3 py-6 text-center text-slate-500">Loading…</td>
                </tr>
              )}
              {!loading && items.length===0 && (
                <tr>
                  <td colSpan={17} className="px-3 py-6 text-center text-slate-500">No active campaigns.</td>
                </tr>
              )}
              {!loading && sortedItems.map((c)=>{
                const cpp = c.cpp!=null? `$${c.cpp.toFixed(2)}` : '—'
                const ctr = c.ctr!=null? `${(c.ctr*1).toFixed(2)}%` : '—'
                const rowKey = String(c.campaign_id||c.name||'')
                const partnerKey = mergedWith[rowKey]
                const partnerRow = (sortedItems||[]).find(r=> String(r.campaign_id||r.name||'')===partnerKey)
                const singleOrders = getOrders(c)
                // Do not sum orders across merged rows; use this row's orders only
                const orders = singleOrders
                const trueCppVal = (orders!=null && orders>0)? (((c.spend||0) + (partnerRow?.spend||0)) / orders) : null
                const trueCpp = trueCppVal!=null? `$${trueCppVal.toFixed(2)}` : '—'
                // Resolve product id from manual mapping (product) or numeric id in name
                const rkSelf = (c.campaign_id || c.name || '') as any
                const confSelf = (manualIds as any)[rkSelf]
                const pidSelf = (confSelf && confSelf.kind==='product' && confSelf.id)? confSelf.id : extractNumericId((c.name||'').trim())
                const briefSelf = pidSelf? productBriefs[pidSelf] : undefined
                const img = briefSelf? briefSelf.image : null
                const invSelf = briefSelf? briefSelf.total_available : null
                const zerosSelf = briefSelf? briefSelf.zero_variants : null
                // Partner resolution
                const rkPartner = partnerRow? (partnerRow.campaign_id || partnerRow.name || '') : null
                const confPartner = rkPartner? (manualIds as any)[rkPartner as any] : undefined
                const pidPartner = partnerRow? ((confPartner && confPartner.kind==='product' && confPartner.id)? confPartner.id : extractNumericId((partnerRow.name||'').trim())) : null
                const briefPartner = pidPartner? productBriefs[pidPartner] : undefined
                const invPartner = briefPartner? briefPartner.total_available : null
                const zerosPartner = briefPartner? briefPartner.zero_variants : null
                // Do not sum inventory/zero-variants across merged rows; show this row's values only
                const inv = (invSelf==null || invSelf==undefined)? null : Number(invSelf||0)
                const zeros = (zerosSelf==null || zerosSelf==undefined)? null : Number(zerosSelf||0)
                const hasAnyPid = !!pidSelf || !!pidPartner
                const severityAccent = trueCppVal==null? 'border-l-2 border-l-transparent' : (trueCppVal < 2 ? 'border-l-4 border-l-emerald-400' : (trueCppVal < 3 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-rose-400'))
                const colorClass = trueCppVal==null? '' : (trueCppVal < 2 ? 'bg-emerald-50' : (trueCppVal < 3 ? 'bg-amber-50' : 'bg-rose-50'))
                return (
                  <Fragment key={c.campaign_id || c.name}>
                  <tr className={`border-b last:border-b-0 ${colorClass} ${severityAccent}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!!selectedKeys[String(rowKey)]}
                        onChange={(e)=> toggleSelect(String(rowKey), e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="product" className="w-20 h-20 rounded object-cover border" />
                      ) : (
                        hasAnyPid ? (
                          <span className="inline-block w-20 h-20 rounded bg-slate-100 border animate-pulse" />
                        ) : (
                          <span className="inline-block w-20 h-20 rounded bg-slate-50 border" />
                        )
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
                                const m = metaRangeParams(datePreset)
                                const res = await fetchCampaignAdsets(cid, m.datePreset, m.range)
                                const items = ((res as any)?.data)||[]
                                setAdsetsByCampaign(prev=> ({ ...prev, [cid]: items }))
                                // Load Shopify-attributed orders per ad set for this campaign
                                try{
                                  const rng = (datePreset==='custom' && customStart && customEnd)? { start: customStart, end: customEnd } : computeRange(datePreset)
                                  setAdsetOrdersLoading(prev=> ({ ...prev, [cid]: true }))
                                  const ord = await fetchCampaignAdsetOrders(cid, rng, store)
                                  const mapping = ((ord as any)?.data)||{}
                                  setAdsetOrdersByCampaign(prev=> ({ ...prev, [cid]: mapping }))
                                }catch{
                                  setAdsetOrdersByCampaign(prev=> ({ ...prev, [cid]: {} }))
                                }finally{
                                  setAdsetOrdersLoading(prev=> ({ ...prev, [cid]: false }))
                                }
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
                      {(()=>{
                        const rk = String(rowKey)
                        const meta = (campaignMeta as any)[rk] || {}
                        const s1 = (meta.supplier_name||'').trim()
                        const s2raw = String(meta.supply_available||meta.supplier_alt_name||'').trim().toLowerCase()
                        const s2 = s2raw ? (['yes','y','true','1'].includes(s2raw)? 'Yes' : 'No') : ''
                        if(!s1 && !s2) return null
                        return (
                          <div className="mt-1 text-xs text-slate-500">
                            {s1? <span className="mr-2">Supplier: <span className="font-medium text-slate-700">{s1}</span></span> : null}
                            {s2? <span>Supply available: <span className="font-medium text-slate-700">{s2}</span></span> : null}
                          </div>
                        )
                      })()}
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
                                      // ensure product brief is loaded for inventory/zero-variants columns
                                      try{ const pb = await shopifyProductsBrief({ ids: [next.id], store }); setProductBriefs(prev=> ({ ...prev, ...(((pb as any)?.data)||{}) })) }catch{}
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
                    <td className="px-3 py-2">
                      {(()=>{
                        const rk = String(rowKey)
                        const meta = (campaignMeta as any)[rk] || {}
                        return (
                          <input
                            value={meta.supplier_name || ''}
                            onChange={(e)=>{
                              const v = e.target.value
                              setCampaignMeta(prev=> ({ ...prev, [rk]: { ...(prev[rk]||{}), supplier_name: v } }))
                            }}
                            onBlur={async(e)=>{
                              const v = e.target.value
                              try{
                                await campaignMetaUpsert({ campaign_key: rk, supplier_name: v, store })
                              }catch{}
                            }}
                            placeholder="Supplier name"
                            className="w-44 rounded-md border px-2 py-1 text-sm bg-white"
                          />
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      {(()=>{
                        const rk = String(rowKey)
                        const meta = (campaignMeta as any)[rk] || {}
                        const raw = String(meta.supply_available || meta.supplier_alt_name || '').trim().toLowerCase()
                        const isYes = raw==='yes' || raw==='y' || raw==='true' || raw==='1'
                        const label = isYes? 'Yes' : 'No'
                        const classes = isYes? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-100 text-rose-700 border border-rose-200'
                        return (
                          <button
                            onClick={async()=>{
                              const next = isYes? 'no' : 'yes'
                              setCampaignMeta(prev=> ({ ...prev, [rk]: { ...(prev[rk]||{}), supply_available: next, supplier_alt_name: next } }))
                              try{ await campaignMetaUpsert({ campaign_key: rk, supply_available: next, store }) }catch{}
                            }}
                            className={`px-2 py-0.5 rounded text-xs ${classes}`}
                            title="Toggle supply availability"
                          >{label}</button>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {hasAnyPid ? (
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
                      {hasAnyPid ? (
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
                      {(()=>{
                        const pk = mergedWith[String(rowKey)]
                        if(pk){
                          const gid = groupIdFor(String(rowKey), String(pk))
                          const val = groupNotes[gid]||''
                          return (
                            <input
                              value={val}
                              onChange={(e)=>{
                                const v = e.target.value
                                setGroupNotes(prev=>{ const next={...prev, [gid]: v}; try{ localStorage.setItem('ptos_ads_group_notes', JSON.stringify(next)) }catch{}; return next })
                              }}
                              placeholder="Group notes"
                              className="w-44 rounded-md border px-2 py-1 text-sm bg-white"
                            />
                          )
                        }
                        return (
                          <input
                            value={notes[rowKey as any]||''}
                            onChange={(e)=>{
                              const v = e.target.value
                              setNotes(prev=>{ const next={...prev, [rowKey as any]: v}; try{ localStorage.setItem('ptos_notes', JSON.stringify(next)) }catch{}; return next })
                            }}
                            placeholder="Notes"
                            className="w-44 rounded-md border px-2 py-1 text-sm bg-white"
                          />
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={async()=>{
                          const cid = String(c.campaign_id||'')
                          const pk = mergedWith[String(rowKey)]
                          const partner = pk? (sortedItems||[]).find(r=> String(r.campaign_id||r.name||'')===pk) : null
                          setPerfOpen(true)
                          setPerfLoading(true)
                          try{
                            if(partner && partner.campaign_id){
                              // Merged performance view: sum days and orders
                              const cid2 = String(partner.campaign_id||'')
                              const [res1, res2] = await Promise.all([
                                fetchCampaignPerformance(cid, 6, browserTz),
                                fetchCampaignPerformance(cid2, 6, browserTz)
                              ])
                              const d1 = ((((res1 as any)?.data||{}).days)||[]) as Array<{ date:string, spend:number, purchases:number, cpp?:number|null, ctr?:number|null, add_to_cart:number }>
                              const d2 = ((((res2 as any)?.data||{}).days)||[]) as Array<{ date:string, spend:number, purchases:number, cpp?:number|null, ctr?:number|null, add_to_cart:number }>
                              // Index by date
                              const allDatesSet: Record<string,true> = {}
                              for(const d of d1){ allDatesSet[d.date]=true }
                              for(const d of d2){ allDatesSet[d.date]=true }
                              const dates = Object.keys(allDatesSet).sort()
                              const days = dates.map(date=>{
                                const a = d1.find(x=> x.date===date) || { date, spend:0, purchases:0, add_to_cart:0 }
                                const b = d2.find(x=> x.date===date) || { date, spend:0, purchases:0, add_to_cart:0 }
                                const spend = Number(a.spend||0)+Number(b.spend||0)
                                const purchases = Number(a.purchases||0)+Number(b.purchases||0)
                                const add_to_cart = Number((a as any).add_to_cart||0)+Number((b as any).add_to_cart||0)
                                const cpp = purchases>0? (spend/purchases) : null
                                return { date, spend, purchases, cpp, ctr: null, add_to_cart }
                              })
                              setPerfMetrics(days)
                              setPerfCampaign({ id: `${cid}+${cid2}` , name: `Merged` })
                              // Orders per day: use ONLY the base row's mapping to avoid double counting
                              const rk1 = (c.campaign_id || c.name || '') as any
                              const conf1 = (manualIds as any)[rk1]
                              const useProduct1 = conf1? (conf1.kind==='product') : /^\d+$/.test((c.name||'').trim())
                              const prodId1 = useProduct1? (conf1? conf1.id : (c.name||'').trim()) : undefined
                              const collId1 = (!useProduct1 && conf1 && conf1.kind==='collection')? conf1.id : undefined
                              const mergedOrders: number[] = []
                              for(const d of days){
                                const start = d.date; const end = d.date
                                let o1 = 0
                                try{
                                  if(prodId1){
                                    const oc = await shopifyOrdersCountByTitle({ names: [prodId1], start, end, include_closed: true, date_field: 'processed' })
                                    o1 = Number(((oc as any)?.data||{})[prodId1] ?? 0)
                                  }else if(collId1){
                                    const oc = await shopifyOrdersCountByCollection({ collection_id: collId1, start, end, store, include_closed: true, aggregate: 'sum_product_orders', date_field: 'processed' })
                                    o1 = Number(((oc as any)?.data||{})?.count ?? 0)
                                  }
                                }catch{}
                                mergedOrders.push((o1||0))
                              }
                              setPerfOrders(mergedOrders)
                            }else{
                              if(!cid) return
                              setPerfCampaign({ id: cid, name: c.name||'' })
                              const res = await fetchCampaignPerformance(cid, 6, browserTz)
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
                            }
                          }finally{
                            setPerfLoading(false)
                          }
                        }}
                        className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-xs"
                      >Performance</button>
                      <button
                        onClick={()=>{
                          setTimelineDraft('')
                          setTimelineOpen({ open: true, campaign: { id: String(c.campaign_id||''), name: c.name||'' } })
                        }}
                        className="ml-2 px-2 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs"
                      >Timeline</button>
                      {partnerKey && (
                        <button
                          onClick={()=> unmergeKey(String(rowKey))}
                          className="ml-2 px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs"
                        >Unmerge</button>
                      )}
                    </td>
                  </tr>
                  {(()=>{
                    const rk = (c.campaign_id || c.name || '') as any
                    const conf = (manualIds as any)[rk]
                    const colSpan = 17
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
                                    const ordersInfo = ((adsetOrdersByCampaign[cid]||{})[aid])
                                    const hasOrders = !!ordersInfo && (ordersInfo.count||0)>0
                                    return (
                                      <Fragment key={aid||a.name}>
                                      <div className="grid grid-cols-8 gap-2 px-2 py-1 border-t items-center">
                                        <div className="col-span-3 whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-2">
                                          <span>{a.name||'-'}</span>
                                          {adsetOrdersLoading[cid]? (
                                            <span className="text-[10px] text-slate-500">loading orders…</span>
                                          ) : (
                                            hasOrders? (
                                              <button
                                                onClick={()=> setAdsetOrdersExpanded(prev=> ({ ...prev, [aid]: !prev[aid] }))}
                                                className="text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200"
                                              >Orders {ordersInfo?.count||0} {adsetOrdersExpanded[aid]? '▾' : '▸'}</button>
                                            ) : (
                                              <span className="text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">Orders 0</span>
                                            )
                                          )}
                                        </div>
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
                                      {adsetOrdersExpanded[aid] && hasOrders && (
                                        <div className="col-span-8 px-2 py-1 border-t bg-slate-50 text-slate-700">
                                          <div className="text-[11px] text-slate-600 mb-1">Attributed Shopify orders (by UTM ad_id)</div>
                                          <div className="overflow-x-auto">
                                            <table className="min-w-full text-xs">
                                              <thead>
                                                <tr className="text-left text-slate-500">
                                                  <th className="px-1 py-1">Order</th>
                                                  <th className="px-1 py-1">Processed</th>
                                                  <th className="px-1 py-1">Total</th>
                                                  <th className="px-1 py-1">ad_id</th>
                                                  <th className="px-1 py-1">utm_campaign</th>
                                                  <th className="px-1 py-1">utm_source</th>
                                                  <th className="px-1 py-1">utm_medium</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {(ordersInfo?.orders||[]).map((o,idx)=> (
                                                  <tr key={String(o.order_id||idx)} className="border-t">
                                                    <td className="px-1 py-1 font-mono">{String(o.order_id||'')}</td>
                                                    <td className="px-1 py-1">{(o.processed_at||'').replace('T',' ').replace('Z','')}</td>
                                                    <td className="px-1 py-1">{typeof o.total_price==='number'? `$${(o.total_price||0).toFixed(2)}` : '-'}</td>
                                                    <td className="px-1 py-1">{o.ad_id|| (o.utm||{}).ad_id || ''}</td>
                                                    <td className="px-1 py-1">{(o.utm||{}).utm_campaign||o.campaign_id||''}</td>
                                                    <td className="px-1 py-1">{(o.utm||{}).utm_source||''}</td>
                                                    <td className="px-1 py-1">{(o.utm||{}).utm_medium||''}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                      </Fragment>
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
                        <td className="px-3 py-2 bg-slate-50" colSpan={15}>
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
      <TimelineModal
        open={timelineOpen.open}
        onClose={()=> setTimelineOpen({ open:false })}
        campaign={timelineOpen.campaign||null}
        meta={(timelineOpen.campaign && campaignMeta[String(timelineOpen.campaign.id||timelineOpen.campaign.name||'')]) || undefined}
        draft={timelineDraft}
        setDraft={setTimelineDraft}
        adding={timelineAdding}
        onAdd={async(text:string)=>{
          if(!timelineOpen.campaign) return
          const ck = String(timelineOpen.campaign.id||timelineOpen.campaign.name||'')
          try{
            setTimelineAdding(true)
            await campaignTimelineAdd({ campaign_key: ck, text, store })
            setTimelineDraft('')
            // Refresh meta mapping
            try{
              const res = await campaignMetaList(store)
              setCampaignMeta(((res as any)?.data)||{})
            }catch{}
          }finally{
            setTimelineAdding(false)
          }
        }}
      />
    </div>
  )
}

// Timeline Modal
function TimelineModal({ open, onClose, campaign, meta, onAdd, adding, draft, setDraft }:{ open:boolean, onClose:()=>void, campaign:{id:string,name?:string}|null, meta?:{ timeline?: Array<{text:string, at:string}> }, onAdd:(text:string)=>Promise<void>, adding:boolean, draft:string, setDraft:(v:string)=>void }){
  if(!open) return null
  const entries = (meta?.timeline||[]).slice().sort((a,b)=> String(a.at||'').localeCompare(String(b.at||'')))
  function fmtDelta(prev:string|undefined, cur:string){
    if(!prev) return '—'
    try{
      const pa = new Date(prev).getTime()
      const ca = new Date(cur).getTime()
      let ms = Math.max(0, ca - pa)
      const days = Math.floor(ms / (24*3600*1000)); ms -= days*(24*3600*1000)
      const hours = Math.floor(ms / (3600*1000)); ms -= hours*(3600*1000)
      const mins = Math.floor(ms / (60*1000))
      const parts:string[] = []
      if(days) parts.push(`${days}d`)
      if(hours) parts.push(`${hours}h`)
      parts.push(`${mins}m`)
      return parts.join(' ')
    }catch{ return '—' }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-[92vw] max-w-2xl max-h-[90vh] overflow-auto">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold text-lg">Timeline · {campaign?.name||campaign?.id}</div>
          <button onClick={onClose} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">Close</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e)=> setDraft(e.target.value)}
              placeholder="Add a note"
              className="flex-1 rounded-md border px-3 py-2 text-sm bg-white"
            />
            <button
              onClick={async()=>{ if(draft.trim()){ await onAdd(draft.trim()) } }}
              disabled={adding || !draft.trim()}
              className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-60"
            >{adding? 'Adding…' : 'Add'}</button>
          </div>
          <div className="space-y-3">
            {entries.map((e, idx)=> {
              const prev = idx>0? entries[idx-1] : undefined
              return (
                <div key={String(e.at||idx)} className="border rounded p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 flex items-center justify-between">
                    <span>{String(e.at||'').replace('T',' ').replace('Z','')}</span>
                    <span className="font-mono">{fmtDelta(prev?.at, e.at||'')}</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap">{e.text||''}</div>
                </div>
              )
            })}
            {entries.length===0 && (
              <div className="text-sm text-slate-500">No notes yet.</div>
            )}
          </div>
        </div>
      </div>
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
  const trueCpp = (days||[]).map((d,i)=> {
    const o = Number(ordersArr[i]||0)
    const s = Number(d.spend||0)
    return o>0? (s/o) : 0
  })
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
                      <div className="text-slate-500">True CPP</div><div className="text-right font-semibold">{(ordersArr[i]||0)>0? `$${(trueCpp[i]||0).toFixed(2)}` : '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="mb-2 text-sm text-slate-600">Daily performance (Spend/True CPP lines, Orders/ATC lines)</div>
                <PerformanceChart labels={labels} spend={spend} trueCpp={trueCpp} orders={ordersArr} addToCart={atc} showOrders={showOrders} showATC={showATC} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PerformanceChart({ labels, spend, trueCpp, orders, addToCart, showOrders, showATC }:{ labels:string[], spend:number[], trueCpp:number[], orders:number[], addToCart:number[], showOrders:boolean, showATC:boolean }){
  const w = 1000, h = 320, padL = 56, padR = 56, padT = 24, padB = 40
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = Math.max(1, labels.length)
  const xs = labels.map((_, i)=> padL + (i*(innerW))/Math.max(1, n-1))
  // Dynamic left axis based on Spend/True CPP in $ (rounded to nearest 25 up, min 25)
  const maxDataValue = Math.max(1, ...spend.map(v=>Number(v||0)), ...trueCpp.map(v=>Number(v||0)))
  const maxRounded = Math.max(25, Math.ceil(maxDataValue/25)*25)
  const minSpend = 0, maxSpend = maxRounded
  const minCount = 1, maxCount = 100
  const clamp = (v:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, v||0))
  const yLeft = (v:number)=> padT + innerH - ((clamp(v, minSpend, maxSpend)-minSpend)/(maxSpend-minSpend))*innerH
  const yRight = (v:number)=> padT + innerH - ((clamp(v, minCount, maxCount)-minCount)/(maxCount-minCount))*innerH
  const gridLines = 5
  const leftTicksBase = [0, 0.25, 0.5, 0.75, 1]
  const leftTicks = leftTicksBase.map(p=> Math.round(p*maxSpend))
  const rightTicks = [1,25,50,75,100]
  // Build line paths (spend, orders, atc)
  const pathSpend = `M ${xs[0]},${yLeft(spend[0]||0)} ` + spend.slice(1).map((v,i)=> `L ${xs[i+1]},${yLeft(v||0)}`).join(' ')
  const pathTrueCpp = `M ${xs[0]},${yLeft(trueCpp[0]||0)} ` + trueCpp.slice(1).map((v,i)=> `L ${xs[i+1]},${yLeft(v||0)}`).join(' ')
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
      <path d={pathTrueCpp} fill="none" stroke="#7c3aed" strokeWidth={2.5} />
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
      {/* True CPP value labels */}
      {xs.map((x,i)=> (
        <g key={`tc${i}`}>
          <circle cx={x} cy={yLeft(trueCpp[i]||0)} r={3} fill="#7c3aed" />
          {(trueCpp[i]||0) > 0 && (
            <text x={x} y={yLeft(trueCpp[i]||0)-8} textAnchor="middle" fontSize="10" fill="#7c3aed">${(trueCpp[i]||0).toFixed(2)}</text>
          )}
        </g>
      ))}
      {/* Legends */}
      <g>
        <rect x={padL} y={8} width={18} height={2} fill="#10b981"/>
        <text x={padL+24} y={12} fontSize="11" fill="#334155">Spend ($)</text>
        <rect x={padL+120} y={8} width={18} height={2} fill="#7c3aed"/>
        <text x={padL+146} y={12} fontSize="11" fill="#334155">True CPP ($)</text>
        <rect x={padL+260} y={8} width={18} height={2} fill="#2563eb"/>
        <text x={padL+286} y={12} fontSize="11" fill="#334155">Orders</text>
        <rect x={padL+360} y={8} width={18} height={2} fill="#f59e0b"/>
        <text x={padL+386} y={12} fontSize="11" fill="#334155">Add to cart</text>
      </g>
    </svg>
  )
}


