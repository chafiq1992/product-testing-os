"use client"
import { useEffect, useMemo, useRef, useState, Fragment, useCallback } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, DollarSign, ShoppingCart, Calculator, ChevronDown, Check, Settings, Search, X } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow, shopifyOrdersCountByTitle, shopifyProductsBrief, shopifyOrdersCountByCollection, shopifyCollectionProducts, campaignMappingsList, campaignMappingUpsert, metaGetAdAccount, metaSetAdAccount, metaSetCampaignStatus, fetchCampaignAdsets, metaSetAdsetStatus, type MetaAdsetRow, fetchCampaignPerformance, shopifyOrdersCountTotal, metaListAdAccounts, fetchCampaignAdsetOrders, type AttributedOrder, campaignMetaList, campaignMetaUpsert, campaignTimelineAdd, fetchAdsManagementBundle, productLifeInstructionsGet, productLifeInstructionsSet, campaignAnalyze, type CampaignAnalysisResult } from '@/lib/api'

const ALL_STORES = [
  { value: 'irrakids', label: 'irrakids' },
  { value: 'irranova', label: 'irranova' },
]

function MultiCheckDropdown({ label, options, selected, onChange, className }: {
  label: string,
  options: Array<{ value: string, label: string }>,
  selected: string[],
  onChange: (next: string[]) => void,
  className?: string,
}){
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const handler = (e: MouseEvent) => { if(ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const display = selected.length === 0 ? label
    : selected.length === options.length ? 'All'
    : selected.map(s => options.find(o => o.value === s)?.label || s).join(', ')
  return (
    <div ref={ref} className={`relative ${className||''}`}>
      <button
        onClick={() => setOpen(!open)}
        type="button"
        className="rounded-xl border px-2 py-1 text-sm bg-white flex items-center gap-1 min-w-[120px] justify-between"
      >
        <span className="truncate max-w-[200px]">{display}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}/>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border rounded-xl shadow-lg z-[60] min-w-[180px] py-1">
          {options.map(o => {
            const checked = selected.includes(o.value)
            return (
              <div
                key={o.value}
                onClick={() => {
                  if(checked) onChange(selected.filter(s => s !== o.value))
                  else onChange([...selected, o.value])
                }}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm select-none"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                  {checked && <Check className="w-3 h-3"/>}
                </span>
                <span>{o.label}</span>
              </div>
            )
          })}
          {options.length > 1 && (
            <div className="border-t mt-1 pt-1 px-3 pb-1 flex gap-2">
              <button type="button" onClick={() => onChange(options.map(o => o.value))} className="text-xs text-blue-600 hover:underline">All</button>
              <button type="button" onClick={() => onChange([])} className="text-xs text-slate-500 hover:underline">None</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AdsManagementPage(){
  const [items, setItems] = useState<MetaCampaignRow[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const loadSeqToken = useRef(0)
  const [datePreset, setDatePreset] = useState<string>('last_7d_incl_today')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [error, setError] = useState<string|undefined>(undefined)
  const [shopifyCounts, setShopifyCounts] = useState<Record<string, number>>({})
  const ordersSeqToken = useRef(0)
  // Multi-store and multi-ad-account selection
  const [selectedStores, setSelectedStores] = useState<string[]>(()=>{
    try{
      const saved = localStorage.getItem('ptos_stores_multi')
      if(saved){ const parsed = JSON.parse(saved); if(Array.isArray(parsed) && parsed.length) return parsed }
    }catch{}
    try{ const s = localStorage.getItem('ptos_store'); if(s) return [s] }catch{}
    return ['irrakids']
  })
  const [selectedAdAccounts, setSelectedAdAccounts] = useState<string[]>(()=>{
    try{
      const saved = localStorage.getItem('ptos_ad_accounts_multi')
      if(saved){ const parsed = JSON.parse(saved); if(Array.isArray(parsed) && parsed.length) return parsed }
    }catch{}
    try{ const s = localStorage.getItem('ptos_ad_account'); if(s) return [s] }catch{}
    return []
  })
  // Keep legacy single-value for backward compat with other parts of the code
  const store = selectedStores[0] || 'irrakids'
  const adAccount = selectedAdAccounts[0] || ''
  const setStore = (v: string) => { setSelectedStores([v]); try{ localStorage.setItem('ptos_stores_multi', JSON.stringify([v])); localStorage.setItem('ptos_store', v) }catch{} }
  const setAdAccount = (v: string) => { setSelectedAdAccounts(prev => { const next = prev.includes(v) ? prev : [v, ...prev]; try{ localStorage.setItem('ptos_ad_accounts_multi', JSON.stringify(next)); localStorage.setItem('ptos_ad_account', v) }catch{}; return next }) }
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
  // AI Campaign Analyzer state
  const [analysisOpen, setAnalysisOpen] = useState<boolean>(false)
  const [analysisLoading, setAnalysisLoading] = useState<string|null>(null) // campaign key being analyzed
  const [analysisResult, setAnalysisResult] = useState<CampaignAnalysisResult|null>(null)
  const [analysisError, setAnalysisError] = useState<string|null>(null)
  // Selection + Grouping state
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>(()=>{
    try{ return JSON.parse(localStorage.getItem('ptos_ads_selected')||'{}') }catch{ return {} }
  })
  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>({})
  const [groupNotes, setGroupNotes] = useState<Record<string, string>>(()=>{
    try{ return JSON.parse(localStorage.getItem('ptos_ads_group_notes_by_product')||'{}') }catch{ return {} }
  })
  const [groupTarget, setGroupTarget] = useState<string>('') // product id
  const [campaignMeta, setCampaignMeta] = useState<Record<string, { supplier_name?:string, supplier_alt_name?:string, supply_available?:string, timeline?:Array<{text:string, at:string}>, product_life_checks?:Record<string, Record<string, boolean>> }>>({})
  const [timelineOpen, setTimelineOpen] = useState<{ open:boolean, campaign?: { id:string, name?:string } }>(()=>({ open:false }))
  const [timelineAdding, setTimelineAdding] = useState<boolean>(false)
  const [timelineDraft, setTimelineDraft] = useState<string>('')
  const browserTz = useMemo(()=>{
    try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined }catch{ return undefined }
  }, [])
  // Product Life state
  const [plInstructions, setPlInstructions] = useState<Record<string, string[]>>({ testing: [], action1: [], micro_scaling: [], macro_scaling: [] })
  const [plSettingsOpen, setPlSettingsOpen] = useState<boolean>(false)
  const [plHover, setPlHover] = useState<{ key:string, phase:string, rect?:DOMRect }|null>(null)
  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchActive, setSearchActive] = useState<string>('')  // confirmed filter
  const [searchFocused, setSearchFocused] = useState<boolean>(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const preSearchPresetRef = useRef<string>('')  // remember preset before search

  const totalSpend = useMemo(()=> (items||[]).reduce((acc, it)=> acc + Number(it.spend||0), 0), [items])
  const tableOrdersTotal = useMemo(()=>{
    // Sum orders while respecting product-grouping (count each product once)
    const pidToAnyRow: Record<string, MetaCampaignRow> = {}
    const ungrouped: MetaCampaignRow[] = []
    for(const r of (items||[])){
      const pid = getProductIdForRow(r)
      if(pid){
        if(!pidToAnyRow[pid]) pidToAnyRow[pid] = r
      }else{
        ungrouped.push(r)
      }
    }
    let sum = 0
    for(const pid of Object.keys(pidToAnyRow)){
      const v = getOrdersByProductId(pid)
      if(typeof v==='number' && v>0) sum += v
    }
    for(const r of ungrouped){
      const v = getOrders(r)
      if(typeof v==='number' && v>0) sum += v
    }
    return sum
  }, [items, shopifyCounts, manualCounts, manualIds])
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
      case 'maximum': return 'all time (search)'
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
    if(preset==='maximum') return { datePreset: 'maximum' }
    // Fallback to a safe default
    const { start, end } = computeRange('last_7d_incl_today')
    return { range: { start, end } }
  }

  function effectiveYmdRange(preset: string){
    if(preset==='custom' && customStart && customEnd) return { start: customStart, end: customEnd }
    return computeRange(preset)
  }

  async function load(preset?: string, opts?: { stores?: string[], adAccounts?: string[] }){
    const loadToken = ++loadSeqToken.current
    setLoading(true); setError(undefined)
    try{
      const effPreset = preset||datePreset
      const effStores = opts?.stores ?? selectedStores
      const effAdAccounts = opts?.adAccounts ?? selectedAdAccounts
      const metaParams = metaRangeParams(effPreset)
      const { start: rangeStart, end: rangeEnd } = effectiveYmdRange(effPreset)

      // Phase 1: One bundle call per ad account (campaigns come from Meta, not per-store).
      // Mappings + meta come from first store. This keeps it to N calls (one per ad account).
      let allCampaigns: MetaCampaignRow[] = []
      let shaped: Record<string, { kind:'product'|'collection', id:string }> = {}
      let allMeta: Record<string, any> = {}
      const primaryStore = effStores[0] || 'irrakids'
      const acctList = effAdAccounts.length > 0 ? effAdAccounts : ['']

      const bundlePromises = acctList.map(acct =>
        fetchAdsManagementBundle({
          date_preset: metaParams.datePreset,
          ad_account: acct || undefined,
          store: primaryStore,
          start: metaParams.range?.start || rangeStart,
          end: metaParams.range?.end || rangeEnd,
        }).catch(() => null)
      )
      const bundleResults = await Promise.allSettled(bundlePromises)
      if(loadToken !== loadSeqToken.current) return

      const seenCampaignIds = new Set<string>()
      for(let idx = 0; idx < bundleResults.length; idx++){
        const r = bundleResults[idx]
        if(r.status !== 'fulfilled' || !r.value) continue
        const bundle = (r.value as any)?.data
        if(!bundle) continue
        const acct = acctList[idx]

        const bundleAdAccount = bundle?.ad_account
        if(bundleAdAccount?.id){
          setAdAccountName(prev => prev || String(bundleAdAccount.name || ''))
        }

        for(const c of (bundle?.campaigns || [])){
          const cid = String(c.campaign_id || c.name || '')
          const dedupeKey = `${cid}__${acct}`
          if(!seenCampaignIds.has(dedupeKey)){
            seenCampaignIds.add(dedupeKey)
            allCampaigns.push({ ...c, _store: primaryStore, _adAccount: acct } as any)
          }
        }

        const bundleMappings = bundle?.mappings || {}
        for(const k of Object.keys(bundleMappings)){
          const v = bundleMappings[k]
          if(v && (v.kind==='product' || v.kind==='collection') && v.id) shaped[k] = { kind: v.kind, id: v.id }
        }
        allMeta = { ...allMeta, ...(bundle?.campaign_meta || {}) }
        // Extract product life instructions from bundle (last one wins – they're global per store)
        if(bundle?.product_life_instructions?.phases){
          setPlInstructions(bundle.product_life_instructions.phases)
        }
      }

      // If extra stores selected, load their mappings + meta too (fast DB calls)
      if(effStores.length > 1){
        const extraMappings = await Promise.allSettled(
          effStores.slice(1).map(st => campaignMappingsList(st).catch(() => ({})))
        )
        for(const r of extraMappings){
          if(r.status !== 'fulfilled') continue
          const map = ((r.value as any)?.data) || {}
          for(const k of Object.keys(map)){
            const v = map[k]
            if(v && (v.kind==='product' || v.kind==='collection') && v.id && !shaped[k]) shaped[k] = { kind: v.kind, id: v.id }
          }
        }
      }

      if(allCampaigns.length === 0 && acctList.length > 0){
        try {
          const res = await fetchMetaCampaigns(metaParams.datePreset, acctList[0]||undefined, metaParams.range)
          if(loadToken !== loadSeqToken.current) return
          if(!(res as any)?.error) allCampaigns = (res as any)?.data || []
        } catch {}
      }

      setItems(allCampaigns)
      setManualIds(shaped)
      setCampaignMeta(allMeta)

      // Reset Shopify data + expansion state
      setShopifyCounts({})
      setProductBriefs({})
      setManualCounts({})
      setStoreOrdersTotal(null)
      setExpanded({})
      setCollectionProducts({})
      setCollectionCounts({})
      setChildrenLoading({})
      setAdsetsExpanded({})
      setAdsetsLoading({})
      setAdsetsByCampaign({})
      setAdsetOrdersByCampaign({})
      setAdsetOrdersLoading({})
      setAdsetOrdersExpanded({})

      setLoading(false)

      // Phase 2: Progressive Shopify data loading in chunks of 4
      const ordersToken = ++ordersSeqToken.current
      const { start, end } = effectiveYmdRange(effPreset)

      // Fire store-total in background for each store
      ;(async()=>{
        try{
          const totals = await Promise.allSettled(
            (effStores.length ? effStores : ['irrakids']).map(st =>
              shopifyOrdersCountTotal({ start, end, store: st, include_closed: true, date_field: 'processed' })
            )
          )
          if(ordersToken !== ordersSeqToken.current) return
          let sum = 0
          for(const t of totals){
            if(t.status === 'fulfilled') sum += Number(((t.value as any)?.data||{}).count||0)
          }
          setStoreOrdersTotal(sum)
        }catch{
          if(ordersToken !== ordersSeqToken.current) return
          setStoreOrdersTotal(0)
        }
      })()

      // Build prioritized product IDs (top spend first)
      const ranked = (allCampaigns as MetaCampaignRow[]).slice().sort((a,b)=> Number(b.spend||0) - Number(a.spend||0))
      const idsOrdered: string[] = []
      const seen: Record<string, true> = {}
      for(const c of ranked){
        const rk = (c.campaign_id || c.name || '') as any
        const manual = shaped[rk]
        let pid: string | null = null
        if(manual && manual.kind==='product' && manual.id && /^\d+$/.test(manual.id)) pid = manual.id
        else pid = extractNumericId(c.name||'')
        if(pid && !seen[pid]){
          seen[pid] = true
          idsOrdered.push(pid)
        }
      }

      // Load product briefs + order counts in parallel chunks of 4
      const chunkSize = 4
      const countsById: Record<string, number> = {}

      for(let i = 0; i < idsOrdered.length; i += chunkSize){
        if(ordersToken !== ordersSeqToken.current) break
        const chunk = idsOrdered.slice(i, i + chunkSize)

        // Fetch briefs + counts per store in parallel, then merge
        const storeList = effStores.length ? effStores : [primaryStore]
        const [pbResults, ocResults] = await Promise.all([
          Promise.allSettled(storeList.map(st => shopifyProductsBrief({ ids: chunk, store: st }))),
          Promise.allSettled(storeList.map(st => shopifyOrdersCountByTitle({ names: chunk, start, end, store: st, include_closed: true, date_field: 'processed' }))),
        ])
        if(ordersToken !== ordersSeqToken.current) break

        // Merge product briefs (first store that has image wins)
        const mergedBriefs: Record<string, any> = {}
        for(const pbRes of pbResults){
          if(pbRes.status === 'fulfilled'){
            const data = ((pbRes.value as any)?.data) || {}
            for(const [k, v] of Object.entries(data)){
              if(!mergedBriefs[k]) mergedBriefs[k] = v
              else if(!mergedBriefs[k].image && (v as any)?.image) mergedBriefs[k] = v
            }
          }
        }
        setProductBriefs(prev => ({ ...prev, ...mergedBriefs }))

        // Merge order counts (sum across stores)
        const next: Record<string, number> = {}
        for(const id of chunk) next[id] = 0
        for(const ocRes of ocResults){
          if(ocRes.status === 'fulfilled'){
            const map = ((ocRes.value as any)?.data) || {}
            for(const id of chunk) next[id] = (next[id] || 0) + (Number(map[id] ?? 0) || 0)
          }
        }
        for(const id of chunk) countsById[id] = next[id]
        setShopifyCounts(prev => ({ ...prev, ...next }))
      }

      // Phase 3: Manual mapped rows (collections)
      for(const row of ranked){
        if(ordersToken !== ordersSeqToken.current) break
        const rowKey = (row.campaign_id || row.name || '') as any
        const rowStore = (row as any)._store || primaryStore
        try{
          const conf = shaped[rowKey]
          if(!conf) continue
          if(!conf.id || !/^\d+$/.test(conf.id)) continue
          if(conf.kind === 'product'){
            const count = Number(countsById[conf.id] ?? 0) || 0
            setManualCounts(prev => ({ ...prev, [String(rowKey)]: count }))
          } else {
            const oc = await shopifyOrdersCountByCollection({ collection_id: conf.id, start, end, store: rowStore, include_closed: true, aggregate: 'sum_product_orders', date_field: 'processed' })
            const count = Number(((oc as any)?.data||{})?.count ?? 0)
            setManualCounts(prev => ({ ...prev, [String(rowKey)]: count }))
          }
        }catch{
          setManualCounts(prev => ({ ...prev, [String(rowKey)]: 0 }))
        }
      }

    }catch(e:any){ setError(String(e?.message||e)); setItems([]) }
    finally{ if(loadToken === loadSeqToken.current) setLoading(false) }
  }

  async function loadCollectionChildren(rowKey: any, collectionId: string){
    setChildrenLoading(prev=> ({ ...prev, [String(rowKey)]: true }))
    try{
      const { data } = await shopifyCollectionProducts({ collection_id: collectionId, store }) as any
      const ids: string[] = ((data||{}).product_ids)||[]
      setCollectionProducts(prev=> ({ ...prev, [String(rowKey)]: ids }))
      const { start, end } = effectiveYmdRange(datePreset)
      try{
        const oc = await shopifyOrdersCountByTitle({ names: ids, start, end, include_closed: true, date_field: 'processed' })
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
    // Don't call load() here: the store-scoped bootstrap effect below loads the
    // default ad account first, then fetches campaigns once (avoids duplicate requests).
  },[])
  const initialLoadDone = useRef(false)
  useEffect(()=>{
    const loadAccounts = async () => {
      try{
        const res = await metaListAdAccounts()
        const items = ((res as any)?.data)||[]
        const extras: Array<{id:string,name:string}> = [
          { id: '8127151147322914', name: '8127151147322914' },
        ]
        const byId: Record<string, {id:string,name:string,account_status?:number}> = {}
        for(const a of items){ byId[a.id] = a }
        for(const e of extras){ if(!byId[e.id]) byId[e.id] = e as any }
        setAdAccounts(Object.values(byId))
      }catch{ setAdAccounts([]) }
    }
    ;(async()=>{
      loadAccounts()
      if(!initialLoadDone.current){
        initialLoadDone.current = true
        load(undefined, { stores: selectedStores, adAccounts: selectedAdAccounts })
      }
    })()
  }, [])

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
  function rowKeyOf(r: MetaCampaignRow){
    return String(r.campaign_id||r.name||'')
  }

  function getProductIdForRow(r: MetaCampaignRow): string | null{
    const rk = rowKeyOf(r) as any
    const manual = (manualIds as any)[rk]
    if(manual && manual.kind==='product' && manual.id && /^\d+$/.test(String(manual.id))) return String(manual.id)
    const pid = extractNumericId((r.name||'').trim())
    if(pid && /^\d+$/.test(pid)) return pid
    return null
  }

  function getOrdersByProductId(pid: string): number | null{
    const v = shopifyCounts[String(pid)]
    if(typeof v === 'number') return v
    // Fallback: if a row is manually mapped to this product, use its computed manual count
    for(const k of Object.keys(manualIds||{})){
      const m = (manualIds as any)[k]
      if(m && m.kind==='product' && String(m.id)===String(pid)){
        const c = (manualCounts as any)[String(k)]
        if(typeof c === 'number') return c
      }
    }
    return null
  }

  type ParentRow =
    | { kind:'group', productId: string, rows: MetaCampaignRow[], primary: MetaCampaignRow }
    | { kind:'single', row: MetaCampaignRow }

  const parentRows = useMemo<ParentRow[]>(()=>{
    const byPid: Record<string, MetaCampaignRow[]> = {}
    const singles: MetaCampaignRow[] = []
    for(const r of (items||[])){
      const pid = getProductIdForRow(r)
      if(pid){
        ;(byPid[pid] ||= []).push(r)
      }else{
        singles.push(r)
      }
    }
    const out: ParentRow[] = []
    for(const pid of Object.keys(byPid)){
      const rows = byPid[pid] || []
      if(rows.length<=1){
        if(rows[0]) singles.push(rows[0])
        continue
      }
      const primary = rows.slice().sort((a,b)=> Number(b.spend||0) - Number(a.spend||0))[0] || rows[0]
      out.push({ kind:'group', productId: pid, rows, primary })
    }
    for(const r of singles){
      out.push({ kind:'single', row: r })
    }
    return out
  }, [items, manualIds, shopifyCounts, manualCounts])

  function parentMetric(p: ParentRow){
    if(p.kind==='group'){
      const spend = p.rows.reduce((acc,r)=> acc + Number(r.spend||0), 0)
      const purchases = p.rows.reduce((acc,r)=> acc + Number(r.purchases||0), 0)
      const add_to_cart = p.rows.reduce((acc,r)=> acc + Number(r.add_to_cart||0), 0)
      const orders = getOrdersByProductId(p.productId)
      const trueCpp = (orders!=null && orders>0) ? (spend / orders) : null
      const cpp = purchases>0 ? (spend / purchases) : null
      let ctr: number | null = null
      try{
        const sumSpend = p.rows.reduce((acc,r)=> acc + Number(r.spend||0), 0)
        const ctrSpend = p.rows.reduce((acc,r)=> {
          const v = (r.ctr==null ? null : Number(r.ctr))
          if(v==null) return acc
          const w = Number(r.spend||0)
          return acc + (v * (w||0))
        }, 0)
        const ctrCount = p.rows.reduce((acc,r)=> (r.ctr==null ? acc : acc+1), 0)
        if(sumSpend>0 && ctrSpend>0) ctr = ctrSpend / sumSpend
        else if(ctrCount>0) ctr = p.rows.reduce((acc,r)=> acc + (r.ctr==null?0:Number(r.ctr)), 0) / ctrCount
      }catch{}
      const brief = productBriefs[p.productId]
      const inventory = brief && typeof brief.total_available==='number' ? Number(brief.total_available||0) : null
      const zero_variant = brief ? (typeof (brief as any).zero_sizes==='number' ? Number((brief as any).zero_sizes||0) : (typeof brief.zero_variants==='number' ? Number(brief.zero_variants||0) : null)) : null
      const active = p.rows.filter(r=> String(r.status||'').toUpperCase()==='ACTIVE').length
      const paused = p.rows.length - active
      return { spend, purchases, add_to_cart, orders, trueCpp, cpp, ctr, inventory, zero_variant, active, paused }
    }
    const row = p.row
    const spend = Number(row.spend||0)
    const purchases = Number(row.purchases||0)
    const add_to_cart = Number(row.add_to_cart||0)
    const orders = getOrders(row)
    const trueCpp = (orders!=null && orders>0) ? (spend / orders) : null
    const cpp = row.cpp==null ? (purchases>0 ? (spend/purchases) : null) : Number(row.cpp)
    const ctr = row.ctr==null ? null : Number(row.ctr)
    const inventory = getInventory(row)
    const zero_variant = getZeroVariants(row)
    const active = String(row.status||'').toUpperCase()==='ACTIVE' ? 1 : 0
    const paused = 1 - active
    return { spend, purchases, add_to_cart, orders, trueCpp, cpp, ctr, inventory, zero_variant, active, paused }
  }

  function compareParents(a: ParentRow, b: ParentRow){
    const am = parentMetric(a) as any
    const bm = parentMetric(b) as any
    const av = (()=>{
      switch(sortKey){
        case 'campaign': return (a.kind==='group'? (a.primary.name||a.productId) : (a.row.name||'')).toLowerCase()
        case 'spend': return am.spend
        case 'purchases': return am.purchases
        case 'cpp': return am.cpp
        case 'ctr': return am.ctr
        case 'add_to_cart': return am.add_to_cart
        case 'shopify_orders': return am.orders
        case 'true_cpp': return am.trueCpp
        case 'inventory': return am.inventory
        case 'zero_variant': return am.zero_variant
        default: return null
      }
    })()
    const bv = (()=>{
      switch(sortKey){
        case 'campaign': return (b.kind==='group'? (b.primary.name||b.productId) : (b.row.name||'')).toLowerCase()
        case 'spend': return bm.spend
        case 'purchases': return bm.purchases
        case 'cpp': return bm.cpp
        case 'ctr': return bm.ctr
        case 'add_to_cart': return bm.add_to_cart
        case 'shopify_orders': return bm.orders
        case 'true_cpp': return bm.trueCpp
        case 'inventory': return bm.inventory
        case 'zero_variant': return bm.zero_variant
        default: return null
      }
    })()
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

  const sortedParents = useMemo(()=>{
    const arr = parentRows.slice()
    try{ arr.sort(compareParents) }catch{}
    return arr
  }, [parentRows, sortKey, sortDir, shopifyCounts, productBriefs, manualIds, manualCounts])

  type DisplayRow =
    | { kind:'group', productId: string, rows: MetaCampaignRow[], primary: MetaCampaignRow }
    | { kind:'campaign', row: MetaCampaignRow, groupProductId?: string, isChild?: boolean }

  // Fuzzy search suggestions (instant, client-side on loaded campaigns)
  const searchSuggestions = useMemo(()=>{
    const q = (searchQuery||'').trim().toLowerCase()
    if(!q || q.length < 1) return []
    const results: Array<{ id:string, name:string, score:number }> = []
    for(const c of (items||[])){
      const name = String(c.name||'').toLowerCase()
      const id = String(c.campaign_id||'')
      let score = 0
      // Exact ID match = highest priority
      if(id === q) score = 100
      else if(id.includes(q)) score = 80
      // Name starts with query
      else if(name.startsWith(q)) score = 70
      // Name contains query
      else if(name.includes(q)) score = 50
      // Fuzzy: check if all chars of query appear in order in name
      else {
        let qi = 0
        for(let ni = 0; ni < name.length && qi < q.length; ni++){
          if(name[ni] === q[qi]) qi++
        }
        if(qi === q.length) score = 20
      }
      if(score > 0) results.push({ id, name: c.name||id, score })
    }
    // Deduplicate by id
    const seen = new Set<string>()
    const deduped = results.filter(r => { if(seen.has(r.id)) return false; seen.add(r.id); return true })
    deduped.sort((a,b) => b.score - a.score)
    return deduped.slice(0, 12)
  }, [searchQuery, items])

  const displayRows = useMemo<DisplayRow[]>(()=>{
    const activeFilter = (searchActive||'').trim().toLowerCase()
    const out: DisplayRow[] = []
    for(const p of sortedParents){
      if(p.kind==='group'){
        // If search active, check if any campaign in the group matches
        if(activeFilter){
          const matches = p.rows.some(r => {
            const name = String(r.name||'').toLowerCase()
            const id = String(r.campaign_id||'')
            return name.includes(activeFilter) || id.includes(activeFilter)
          })
          if(!matches) continue
        }
        out.push({ kind:'group', productId: p.productId, rows: p.rows, primary: p.primary })
        if(groupExpanded[p.productId]){
          const children = (p.rows||[]).slice().sort((a,b)=> Number(b.spend||0) - Number(a.spend||0))
          for(const r of children){
            out.push({ kind:'campaign', row: r, groupProductId: p.productId, isChild: true })
          }
        }
      }else{
        if(activeFilter){
          const name = String(p.row.name||'').toLowerCase()
          const id = String(p.row.campaign_id||'')
          if(!name.includes(activeFilter) && !id.includes(activeFilter)) continue
        }
        out.push({ kind:'campaign', row: p.row, isChild: false })
      }
    }
    return out
  }, [sortedParents, groupExpanded, searchActive])

  const selectedCount = useMemo(()=> Object.keys(selectedKeys).filter(k=> !!selectedKeys[k]).length, [selectedKeys])
  const productIdToCount = useMemo(()=>{
    const map: Record<string, number> = {}
    for(const r of (items||[])){
      const pid = getProductIdForRow(r)
      if(!pid) continue
      map[pid] = (map[pid]||0) + 1
    }
    return map
  }, [items, manualIds])
  const productIdOptions = useMemo(()=>{
    const ids = Object.keys(productIdToCount||{})
    ids.sort((a,b)=> (Number(a)||0) - (Number(b)||0))
    return ids
  }, [productIdToCount])

  function toggleSelect(k:string, v?:boolean){
    setSelectedKeys(prev=>{ const next={...prev, [k]: v==null? !prev[k] : !!v}; try{ localStorage.setItem('ptos_ads_selected', JSON.stringify(next)) }catch{}; return next })
  }
  function clearSelection(){ setSelectedKeys(()=>{ try{ localStorage.setItem('ptos_ads_selected','{}') }catch{}; return {} }) }
  async function addSelectedToGroupProduct(targetProductId: string){
    const pid = String(targetProductId||'').trim()
    if(!pid || !/^\d+$/.test(pid)){ alert('Select a valid product ID group.'); return }
    const keys = Object.keys(selectedKeys).filter(k=> !!selectedKeys[k])
    if(keys.length===0){ alert('Select at least 1 campaign to add.'); return }
    // Assign selected campaigns to the target product id (so they auto-merge into one group row)
    setManualIds(prev=> {
      const next = { ...prev }
      for(const rk of keys){
        ;(next as any)[rk] = { kind:'product', id: pid }
      }
      return next
    })
    for(const rk of keys){
      try{ await campaignMappingUpsert({ campaign_key: String(rk), kind: 'product', id: pid, store }) }catch{}
    }
    clearSelection()
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
      <header className="min-h-16 py-2 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Ads management</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <MultiCheckDropdown
            label="Stores"
            options={ALL_STORES}
            selected={selectedStores}
            onChange={(next) => { setSelectedStores(next); try{ localStorage.setItem('ptos_stores_multi', JSON.stringify(next)); if(next.length) localStorage.setItem('ptos_store', next[0]) }catch{} }}
          />
          <MultiCheckDropdown
            label="Ad accounts"
            options={adAccounts.map(a => ({ value: a.id, label: a.name || a.id }))}
            selected={selectedAdAccounts}
            onChange={(next) => { setSelectedAdAccounts(next); try{ localStorage.setItem('ptos_ad_accounts_multi', JSON.stringify(next)) }catch{} }}
            className="min-w-[180px]"
          />
          <div className="flex items-center gap-2">
            <select value={datePreset} onChange={(e)=>{ const v=e.target.value; setDatePreset(v); if(v!=='custom') load(v, { stores: selectedStores, adAccounts: selectedAdAccounts }) }} className="rounded-xl border px-2 py-1 text-sm bg-white">
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
                <button onClick={()=> load('custom', { stores: selectedStores, adAccounts: selectedAdAccounts })} className="rounded-xl font-semibold inline-flex items-center gap-2 px-2 py-1 bg-slate-200 hover:bg-slate-300">Apply</button>
              </div>
            )}
          </div>
          <button onClick={()=>setPlSettingsOpen(true)} className="rounded-xl inline-flex items-center gap-1 px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm" title="Product Life Settings">
            <Settings className="w-4 h-4"/>
          </button>
          <button onClick={()=>load(undefined, { stores: selectedStores, adAccounts: selectedAdAccounts })} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-60" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading? 'animate-spin' : ''}`}/> {loading? 'Updating…' : 'Refresh'}
          </button>
          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm">Home</Link>
        </div>
      </header>

      <div className="px-1.5 py-0.5">
        {error && (
          <div className="mb-2 text-xs text-red-600">{error}</div>
        )}
        {/* Compact Summary Bar */}
        <div className="mb-2 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 text-white px-4 py-2">
          <div className="flex items-center justify-between flex-wrap gap-x-6 gap-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="opacity-70">{adAccountName || adAccount || '—'}</span>
              <span className="opacity-50">•</span>
              <span className="opacity-70">{datePreset==='custom'? `${customStart||'—'}→${customEnd||'—'}` : presetLabel(datePreset)}</span>
              <span className="opacity-50">•</span>
              <span className="opacity-70">{selectedStores.join(', ')||'—'}</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div><span className="opacity-70">Spend </span><span className="font-bold text-sm">{fmtCurrency(totalSpend)}</span></div>
              <div><span className="opacity-70">Orders </span><span className="font-bold text-sm">{fmtInt(tableOrdersTotal)}</span></div>
              <div><span className="opacity-70">Store </span><span className="font-bold text-sm">{storeOrdersTotal!=null? fmtInt(storeOrdersTotal) : '—'}</span></div>
              <div><span className="opacity-70">CPP </span><span className="font-bold text-sm">{totalCPP!=null? fmtCurrency(totalCPP) : '—'}</span></div>
              <div><span className="opacity-70">Full CPP </span><span className="font-bold text-sm">{storeCPP!=null? fmtCurrency(storeCPP) : '—'}</span></div>
            </div>
          </div>
        </div>
        {/* Search + Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
          {/* Search Bar */}
          <div className="relative" style={{minWidth:'320px', maxWidth:'480px'}}>
            <div className="flex items-center gap-2 bg-white border rounded-xl px-3 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-blue-400 transition-all">
              <Search className="w-4 h-4 text-slate-400 flex-shrink-0"/>
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); if(!e.target.value.trim()) setSearchActive('') }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                onKeyDown={(e) => {
                  if(e.key==='Enter'){
                    // Save current date preset and reload with all-time
                    if(!preSearchPresetRef.current) preSearchPresetRef.current = datePreset
                    if(searchSuggestions.length > 0){
                      const first = searchSuggestions[0]
                      setSearchActive(first.name.toLowerCase())
                      setSearchQuery(first.name)
                    } else {
                      setSearchActive(searchQuery.toLowerCase())
                    }
                    setSearchFocused(false)
                    searchRef.current?.blur()
                    // Reload with maximum date range
                    setDatePreset('maximum')
                    load('maximum', { stores: selectedStores, adAccounts: selectedAdAccounts })
                  }
                  if(e.key==='Escape'){
                    const prev = preSearchPresetRef.current || 'last_7d'
                    preSearchPresetRef.current = ''
                    setSearchQuery('')
                    setSearchActive('')
                    setSearchFocused(false)
                    searchRef.current?.blur()
                    // Restore original date preset and reload
                    if(datePreset === 'maximum'){
                      setDatePreset(prev)
                      load(prev, { stores: selectedStores, adAccounts: selectedAdAccounts })
                    }
                  }
                }}
                placeholder="Search campaigns by name or ID…"
                className="flex-1 text-sm outline-none bg-transparent text-slate-800 placeholder:text-slate-400"
              />
              {(searchQuery || searchActive) && (
                <button
                  onClick={() => {
                    const prev = preSearchPresetRef.current || 'last_7d'
                    preSearchPresetRef.current = ''
                    setSearchQuery(''); setSearchActive(''); searchRef.current?.focus()
                    // Restore original date preset and reload
                    if(datePreset === 'maximum'){
                      setDatePreset(prev)
                      load(prev, { stores: selectedStores, adAccounts: selectedAdAccounts })
                    }
                  }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4"/>
                </button>
              )}
            </div>
            {/* Suggestions Dropdown */}
            {searchFocused && searchQuery.trim() && searchSuggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 overflow-y-auto">
                {searchSuggestions.map(s => {
                  const q = searchQuery.toLowerCase()
                  const nameL = s.name.toLowerCase()
                  const matchIdx = nameL.indexOf(q)
                  return (
                    <button
                      key={s.id}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 text-sm border-b border-b-slate-100 last:border-b-0 transition-colors"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        // Save current date preset and reload with all-time
                        if(!preSearchPresetRef.current) preSearchPresetRef.current = datePreset
                        setSearchQuery(s.name)
                        setSearchActive(s.name.toLowerCase())
                        setSearchFocused(false)
                        // Reload with maximum date range
                        setDatePreset('maximum')
                        load('maximum', { stores: selectedStores, adAccounts: selectedAdAccounts })
                      }}
                    >
                      <Search className="w-3.5 h-3.5 text-slate-300 flex-shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {matchIdx >= 0 ? (
                            <>
                              <span className="text-slate-600">{s.name.slice(0, matchIdx)}</span>
                              <span className="text-blue-600 font-semibold bg-blue-50 rounded px-0.5">{s.name.slice(matchIdx, matchIdx + q.length)}</span>
                              <span className="text-slate-600">{s.name.slice(matchIdx + q.length)}</span>
                            </>
                          ) : (
                            <span className="text-slate-600">{s.name}</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">ID: {s.id}</div>
                      </div>
                      {s.score >= 80 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">ID match</span>}
                    </button>
                  )
                })}
              </div>
            )}
            {searchFocused && searchQuery.trim() && searchSuggestions.length === 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 text-sm text-slate-400">
                No campaigns matching "{searchQuery}"
              </div>
            )}
            {searchActive && (
              <div className="mt-1 flex items-center gap-1 text-xs text-blue-600">
                <span>Filtered:</span>
                <span className="font-semibold truncate max-w-[200px]">"{searchActive}"</span>
                <button onClick={() => {
                  const prev = preSearchPresetRef.current || 'last_7d'
                  preSearchPresetRef.current = ''
                  setSearchQuery(''); setSearchActive('')
                  // Restore original date preset and reload
                  if(datePreset === 'maximum'){
                    setDatePreset(prev)
                    load(prev, { stores: selectedStores, adAccounts: selectedAdAccounts })
                  }
                }} className="text-slate-400 hover:text-red-500 ml-1">✕ clear</button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={groupTarget}
              onChange={(e)=> setGroupTarget(e.target.value)}
              className="rounded-xl border px-2 py-1 text-sm bg-white min-w-56"
              title="Choose a product ID group"
            >
              <option value="">Add selected campaigns to group…</option>
              {productIdOptions.map(pid=> (
                <option key={pid} value={pid}>{pid} ({productIdToCount[pid]||0} campaigns)</option>
              ))}
            </select>
            <button
              onClick={()=> addSelectedToGroupProduct(groupTarget)}
              disabled={!groupTarget || selectedCount===0}
              className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-60"
            >Add selected</button>
            <button
              onClick={clearSelection}
              disabled={selectedCount===0}
              className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm disabled:opacity-60"
            >Clear selection</button>
          </div>
        </div>
        <div className="overflow-x-auto bg-white border rounded-none">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50/90 backdrop-blur supports-backdrop-blur:bg-slate-50/60 border-b shadow-sm">
              <tr className="text-left">
                <th className="px-1 py-0.5 font-semibold w-6"></th>
                <th className="px-1 py-0.5 font-semibold w-[80px]"></th>
                <th className="px-1 py-0.5 font-semibold">
                  <button onClick={()=>toggleSort('campaign')} className="inline-flex items-center gap-0.5 hover:text-slate-900">
                    <span>Campaign</span>
                    {sortKey==='campaign'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold">
                  <span>Status</span>
                </th>
                <th className="px-1 py-0.5 font-semibold text-right">
                  <button onClick={()=>toggleSort('spend')} className="inline-flex items-center gap-0.5 hover:text-slate-900">
                    <span>Spend</span>
                    {sortKey==='spend'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-right">
                  <button onClick={()=>toggleSort('purchases')} className="inline-flex items-center gap-0.5 hover:text-slate-900">
                    <span>Purch</span>
                    {sortKey==='purchases'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-right">
                  <button onClick={()=>toggleSort('cpp')} className="inline-flex items-center gap-0.5 hover:text-slate-900">
                    <span>CPP</span>
                    {sortKey==='cpp'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-right">
                  <button onClick={()=>toggleSort('ctr')} className="inline-flex items-center gap-0.5 hover:text-slate-900">
                    <span>CTR</span>
                    {sortKey==='ctr'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-right">
                  <button onClick={()=>toggleSort('add_to_cart')} className="inline-flex items-center gap-0.5 hover:text-slate-900">
                    <span>ATC</span>
                    {sortKey==='add_to_cart'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-emerald-700">
                  <button onClick={()=>toggleSort('shopify_orders')} className="inline-flex items-center gap-0.5 hover:text-emerald-800">
                    <span>Orders</span>
                    {sortKey==='shopify_orders'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-emerald-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-right">
                  <button onClick={()=>toggleSort('true_cpp')} className="inline-flex items-center gap-0.5 hover:text-slate-900">
                    <span>tCPP</span>
                    {sortKey==='true_cpp'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-slate-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-indigo-700 text-right">
                  <button onClick={()=>toggleSort('inventory')} className="inline-flex items-center gap-0.5 hover:text-indigo-800">
                    <span>Inv</span>
                    {sortKey==='inventory'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-indigo-400"/>}
                  </button>
                  <span className="text-rose-500 ml-0.5">/</span>
                  <button onClick={()=>toggleSort('zero_variant')} className="inline-flex items-center gap-0.5 hover:text-rose-800">
                    <span className="text-rose-700">0v</span>
                    {sortKey==='zero_variant'? <SortArrow/> : <ArrowUpDown className="w-3 h-3 text-rose-400"/>}
                  </button>
                </th>
                <th className="px-1 py-0.5 font-semibold text-violet-700" style={{minWidth:'120px'}}>Life</th>
                <th className="px-1 py-0.5 font-semibold">Notes</th>
                <th className="px-1 py-0.5 font-semibold text-right w-[90px]"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={15} className="px-3 py-6 text-center text-slate-500">Loading…</td>
                </tr>
              )}
              {!loading && items.length===0 && (
                <tr>
                  <td colSpan={15} className="px-3 py-6 text-center text-slate-500">No active campaigns.</td>
                </tr>
              )}
              {!loading && displayRows.map((d)=>{
                if(d.kind==='group'){
                  const pid = d.productId
                  const m = parentMetric({ kind:'group', productId: pid, rows: d.rows, primary: d.primary } as any)
                  const orders = m.orders
                  const trueCppVal = m.trueCpp
                  const trueCpp = trueCppVal!=null? `$${trueCppVal.toFixed(2)}` : '—'
                  const ctr = m.ctr!=null? `${(m.ctr*100).toFixed(2)}%` : '—'
                  const cpp = m.cpp!=null? `$${m.cpp.toFixed(2)}` : '—'
                  const brief = productBriefs[pid]
                  const img = brief? brief.image : null
                  const inv = m.inventory
                  const zeros = m.zero_variant
                  const severityAccent = trueCppVal==null? 'border-l-2 border-l-transparent' : (trueCppVal < 2 ? 'border-l-4 border-l-emerald-400' : (trueCppVal < 3 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-rose-400'))
                  const colorClass = trueCppVal==null? '' : (trueCppVal < 2 ? 'bg-emerald-50' : (trueCppVal < 3 ? 'bg-amber-50' : 'bg-rose-50'))
                  const active = Number((m as any).active||0)
                  const paused = Number((m as any).paused||0)
                  const statusLabel = active===0 ? 'Paused' : (paused===0 ? 'Active' : `Mixed (${active} active / ${paused} paused)`)
                  const statusClass = active===0 ? 'bg-slate-200 text-slate-700' : (paused===0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')
                  const noteVal = groupNotes[pid] || ''
                  return (
                    <Fragment key={`group-${pid}`}>
                      <tr className={`border-b last:border-b-0 ${colorClass} ${severityAccent}`}>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-1 py-0.5">
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="product" className="w-[72px] h-[72px] rounded-lg object-cover border shadow-sm" />
                          ) : (
                            <span className="inline-block w-[72px] h-[72px] rounded-lg bg-slate-50 border" />
                          )}
                        </td>
                        <td className="px-1 py-0.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={()=> setGroupExpanded(prev=> ({ ...prev, [pid]: !prev[pid] }))}
                              className="px-1 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-xs"
                              title="Show merged campaigns"
                            >{groupExpanded[pid]? '▾' : '▸'}</button>
                            <span className="font-medium text-xs">{d.primary.name || `Product ${pid}`}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{d.rows.length} camps</span>
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${statusClass}`}>{statusLabel}</span>
                        </td>
                        <td className="px-1 py-0.5 text-right">${Number(m.spend||0).toFixed(2)}</td>
                        <td className="px-1 py-0.5 text-right">{Number(m.purchases||0)}</td>
                        <td className="px-1 py-0.5 text-right">{cpp}</td>
                        <td className="px-1 py-0.5 text-right">{ctr}</td>
                        <td className="px-1 py-0.5 text-right">{Number(m.add_to_cart||0)}</td>
                        <td className="px-1 py-0.5">
                          {orders==null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">{orders}</span>
                          )}
                        </td>
                        <td className="px-1 py-0.5 text-right">{orders==null ? <span className="inline-block h-3 w-8 bg-slate-100 rounded animate-pulse" /> : trueCpp}</td>
                        <td className="px-1 py-0.5 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            {inv==null ? <span className="text-slate-400">—</span> : (
                              <span className="inline-flex items-center px-1 py-0 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">{inv}</span>
                            )}
                            <span className="text-slate-300">/</span>
                            {zeros==null ? <span className="text-slate-400">—</span> : (
                              <span className={`inline-flex items-center px-1 py-0 rounded text-[10px] font-semibold ${Number(zeros||0)>0? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{Number(zeros||0)}</span>
                            )}
                          </div>
                        </td>
                        {/* Product Life */}
                        <td className="px-1.5 py-0.5">
                          {(()=>{
                            const firstCampaign = d.rows[0]
                            const ct = (firstCampaign as any)?.created_time
                            if(!ct) return <span className="text-slate-400 text-xs">—</span>
                            const startDate = new Date(ct)
                            const now = new Date()
                            const daysSinceCreation = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / (1000*60*60*24)))
                            const phases = [
                              { key: 'testing', label: 'Test', days: 3, start: 0 },
                              { key: 'action1', label: 'Act1', days: 3, start: 3 },
                              { key: 'micro_scaling', label: 'Micro', days: 7, start: 6 },
                              { key: 'macro_scaling', label: 'Macro', days: 999, start: 13 },
                            ]
                            const currentPhaseIdx = daysSinceCreation >= 13 ? 3 : daysSinceCreation >= 6 ? 2 : daysSinceCreation >= 3 ? 1 : 0
                            const campaignKey = String(firstCampaign.campaign_id || pid)
                            const checks = (campaignMeta[campaignKey]?.product_life_checks || {}) as Record<string, Record<string, boolean>>
                            return (
                              <div className="flex gap-0.5 relative" style={{minWidth:'120px'}}>
                                {phases.map((ph, idx) => {
                                  const phChecks = checks[ph.key] || {}
                                  const insts = plInstructions[ph.key] || []
                                  const checkedCount = insts.filter((_:any, i:number) => phChecks[String(i)]).length
                                  const mostChecked = insts.length > 0 && checkedCount >= Math.ceil(insts.length / 2)
                                  const isCurrent = idx === currentPhaseIdx
                                  const isPast = idx < currentPhaseIdx
                                  const isFuture = idx > currentPhaseIdx
                                  let bg = 'bg-slate-200'
                                  if(isCurrent) bg = 'bg-green-300'
                                  else if(isPast && mostChecked) bg = 'bg-green-700'
                                  else if(isPast && !mostChecked) bg = 'bg-amber-400'
                                  return (
                                    <div
                                      key={ph.key}
                                      className={`flex-1 h-5 ${bg} ${idx===0?'rounded-l':''} ${idx===3?'rounded-r':''} cursor-pointer relative group/pl`}
                                      title={`${ph.label} (Day ${ph.start}+)`}
                                      onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect()
                                        setPlHover({ key: campaignKey, phase: ph.key, rect })
                                      }}
                                      onMouseLeave={() => setPlHover(null)}
                                    >
                                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/80 select-none">{ph.label}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-1.5 py-0.5">
                          <input
                            value={noteVal}
                            onChange={(e)=>{
                              const v = e.target.value
                              setGroupNotes(prev=>{ const next={...prev, [pid]: v}; try{ localStorage.setItem('ptos_ads_group_notes_by_product', JSON.stringify(next)) }catch{}; return next })
                            }}
                            placeholder="Group notes"
                            className="w-24 rounded border px-1 py-0.5 text-xs bg-white"
                          />
                        </td>
                        <td className="px-1.5 py-0.5 text-right">
                          <button
                            onClick={async()=>{
                              setPerfOpen(true)
                              setPerfLoading(true)
                              try{
                                const ids = (d.rows||[]).map(r=> String(r.campaign_id||'')).filter(Boolean)
                                const results = await Promise.all(ids.map(cid=> fetchCampaignPerformance(cid, 6, browserTz).catch(()=> null as any)))
                                const daysByDate: Record<string, { date:string, spend:number, purchases:number, add_to_cart:number }> = {}
                                for(const res of results){
                                  const days = (((res as any)?.data||{}).days)||[]
                                  for(const dd of (days||[])){
                                    const date = String(dd.date||'')
                                    if(!date) continue
                                    const cur = (daysByDate[date] ||= { date, spend:0, purchases:0, add_to_cart:0 })
                                    cur.spend += Number(dd.spend||0)
                                    cur.purchases += Number(dd.purchases||0)
                                    cur.add_to_cart += Number((dd as any).add_to_cart||0)
                                  }
                                }
                                const dates = Object.keys(daysByDate).sort()
                                const mergedDays = dates.map(date=>{
                                  const x = daysByDate[date]
                                  const cpp = (x.purchases||0)>0 ? (x.spend / x.purchases) : null
                                  return { date, spend: x.spend, purchases: x.purchases, cpp, ctr: null, add_to_cart: x.add_to_cart }
                                })
                                setPerfMetrics(mergedDays)
                                setPerfCampaign({ id: pid, name: `Merged (${d.rows.length} campaigns)` })
                                // Orders per day: use the product id once (avoid double counting)
                                const mergedOrders: number[] = []
                                for(const day of mergedDays){
                                  let o1 = 0
                                  try{
                                    const oc = await shopifyOrdersCountByTitle({ names: [pid], start: day.date, end: day.date, include_closed: true, date_field: 'processed' })
                                    o1 = Number(((oc as any)?.data||{})[pid] ?? 0)
                                  }catch{}
                                  mergedOrders.push((o1||0))
                                }
                                setPerfOrders(mergedOrders)
                              }finally{
                                setPerfLoading(false)
                              }
                            }}
                            className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-xs"
                          >Performance</button>
                          <button
                            disabled={analysisLoading===pid}
                            onClick={async()=>{
                              setAnalysisLoading(pid)
                              setAnalysisError(null)
                              try{
                                const ids = (d.rows||[]).map((r:any)=> String(r.campaign_id||'')).filter(Boolean)
                                // Compute campaign age from first campaign's created_time
                                const firstCt = (d.rows[0] as any)?.created_time
                                let ageDays: number|undefined = undefined
                                if(firstCt){
                                  const diff = Date.now() - new Date(firstCt).getTime()
                                  ageDays = Math.max(0, Math.floor(diff / (1000*60*60*24)))
                                }
                                const campaignKey = ids[0] || pid
                                const res = await campaignAnalyze({
                                  campaign_ids: ids,
                                  product_id: pid||undefined,
                                  metrics: {
                                    spend: Number(m.spend||0),
                                    purchases: Number(m.purchases||0),
                                    ctr: m.ctr!=null? m.ctr : undefined,
                                    cpp: m.cpp!=null? m.cpp : undefined,
                                    add_to_cart: Number(m.add_to_cart||0),
                                    shopify_orders: orders,
                                    true_cpp: trueCppVal,
                                    status: statusLabel,
                                  },
                                  campaign_age_days: ageDays,
                                  campaign_key: campaignKey,
                                })
                                if(res?.error){ setAnalysisError(res.error) }
                                else if(res?.data){
                                  setAnalysisResult(res.data); setAnalysisOpen(true)
                                  // Refresh campaign meta to pick up new timeline entry
                                  try{
                                    const metaRes = await campaignMetaList(store)
                                    if((metaRes as any)?.data) setCampaignMeta((metaRes as any).data)
                                  }catch{}
                                }
                              }catch(e:any){ setAnalysisError(e?.message||'Analysis failed') }
                              finally{ setAnalysisLoading(null) }
                            }}
                            className={`ml-1 px-2 py-1 rounded text-xs font-semibold transition-all ${
                              analysisLoading===pid
                                ? 'bg-gradient-to-r from-violet-200 to-fuchsia-200 text-violet-500 animate-pulse cursor-wait'
                                : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white shadow-sm hover:shadow-md'
                            }`}
                          >{analysisLoading===pid ? '⏳ Analyzing…' : '✨ Analyze'}</button>
                          {analysisError && analysisLoading===null && <span className="ml-1 text-[10px] text-rose-500">{analysisError.slice(0,40)}</span>}
                        </td>
                      </tr>
                    </Fragment>
                  )
                }
                const c = d.row
                const isChild = !!d.isChild
                const cpp = c.cpp!=null? `$${c.cpp.toFixed(2)}` : '—'
                const ctr = c.ctr!=null? `${(c.ctr*1).toFixed(2)}%` : '—'
                const rowKey = String(c.campaign_id||c.name||'')
                const orders = isChild ? null : getOrders(c)
                const trueCppVal = (!isChild && orders!=null && orders>0)? ((Number(c.spend||0)) / orders) : null
                const trueCpp = trueCppVal!=null? `$${trueCppVal.toFixed(2)}` : '—'
                // Resolve product id from manual mapping (product) or numeric id in name
                const rkSelf = (c.campaign_id || c.name || '') as any
                const confSelf = (manualIds as any)[rkSelf]
                const pidSelf = (confSelf && confSelf.kind==='product' && confSelf.id)? confSelf.id : extractNumericId((c.name||'').trim())
                const briefSelf = pidSelf? productBriefs[pidSelf] : undefined
                const img = briefSelf? briefSelf.image : null
                const invSelf = briefSelf? briefSelf.total_available : null
                const zerosSelf = briefSelf? briefSelf.zero_variants : null
                const inv = (invSelf==null || invSelf==undefined)? null : Number(invSelf||0)
                const zeros = (zerosSelf==null || zerosSelf==undefined)? null : Number(zerosSelf||0)
                const hasAnyPid = !!pidSelf
                const severityAccent = trueCppVal==null? 'border-l-2 border-l-transparent' : (trueCppVal < 2 ? 'border-l-4 border-l-emerald-400' : (trueCppVal < 3 ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-rose-400'))
                const colorClass = trueCppVal==null? (isChild? 'bg-slate-50' : '') : (trueCppVal < 2 ? 'bg-emerald-50' : (trueCppVal < 3 ? 'bg-amber-50' : 'bg-rose-50'))
                return (
                  <Fragment key={(c.campaign_id || c.name) + (isChild? `-child-${d.groupProductId||''}` : '')}>
                  <tr className={`border-b last:border-b-0 ${colorClass} ${severityAccent} ${isChild? 'opacity-95' : ''}`}>
                    <td className="px-1.5 py-0.5">
                      <input
                        type="checkbox"
                        checked={!!selectedKeys[String(rowKey)]}
                        onChange={(e)=> toggleSelect(String(rowKey), e.target.checked)}
                      />
                    </td>
                    <td className="px-1.5 py-0.5">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="product" className="w-[72px] h-[72px] rounded-lg object-cover border shadow-sm" />
                      ) : (
                        hasAnyPid ? (
                          <span className="inline-block w-[72px] h-[72px] rounded-lg bg-slate-100 border animate-pulse" />
                        ) : (
                          <span className="inline-block w-[72px] h-[72px] rounded-lg bg-slate-50 border" />
                        )
                      )}
                    </td>
                    <td className="px-1.5 py-0.5 whitespace-nowrap">
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
                                  const rowStore = (c as any)._store || store
                                  const ord = await fetchCampaignAdsetOrders(cid, rng, rowStore, selectedStores.length > 1 ? selectedStores : undefined)
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
                    <td className="px-1.5 py-0.5">
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
                                      const res = await metaSetCampaignStatus(String(cid), next as any)
                                      if((res as any)?.error){
                                        alert(`Failed: ${(res as any).error}`)
                                      } else {
                                        setItems(prev=> prev.map(row=> row.campaign_id===c.campaign_id? { ...row, status: next } : row))
                                      }
                                    }catch(e:any){ alert(`Failed to update status: ${e?.message||e}`) }
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
                    <td className="px-1 py-0.5 text-right">${(c.spend||0).toFixed(2)}</td>
                    <td className="px-1 py-0.5 text-right">{c.purchases||0}</td>
                    <td className="px-1 py-0.5 text-right">{cpp}</td>
                    <td className="px-1 py-0.5 text-right">{ctr}</td>
                    <td className="px-1 py-0.5 text-right">{c.add_to_cart||0}</td>
                    <td className="px-1 py-0.5">
                      {orders==null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">{orders}</span>
                      )}
                    </td>
                    <td className="px-1 py-0.5 text-right">
                      {isChild ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        orders==null ? <span className="inline-block h-3 w-8 bg-slate-100 rounded animate-pulse" /> : trueCpp
                      )}
                    </td>
                    <td className="px-1 py-0.5 text-right">
                      {hasAnyPid ? (
                        <div className="flex items-center justify-end gap-0.5">
                          {inv===null || inv===undefined ? (
                            <span className="inline-block h-3 w-6 bg-indigo-50 rounded animate-pulse" />
                          ) : (
                            <span className="inline-flex items-center px-1 py-0 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">{inv}</span>
                          )}
                          <span className="text-slate-300">/</span>
                          {zeros===null || zeros===undefined ? (
                            <span className="inline-block h-3 w-6 bg-rose-50 rounded animate-pulse" />
                          ) : (
                            <span className={`inline-flex items-center px-1 py-0 rounded text-[10px] font-semibold ${zeros>0? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{zeros}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    {/* Product Life */}
                    <td className="px-1.5 py-0.5">
                      {(()=>{
                        const ct = (c as any)?.created_time
                        if(!ct) return <span className="text-slate-400 text-xs">—</span>
                        const startDate = new Date(ct)
                        const now = new Date()
                        const daysSinceCreation = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / (1000*60*60*24)))
                        const phases = [
                          { key: 'testing', label: 'Test', days: 3, start: 0 },
                          { key: 'action1', label: 'Act1', days: 3, start: 3 },
                          { key: 'micro_scaling', label: 'Micro', days: 7, start: 6 },
                          { key: 'macro_scaling', label: 'Macro', days: 999, start: 13 },
                        ]
                        const currentPhaseIdx = daysSinceCreation >= 13 ? 3 : daysSinceCreation >= 6 ? 2 : daysSinceCreation >= 3 ? 1 : 0
                        const campaignKey = String(c.campaign_id || rowKey)
                        const checks = (campaignMeta[campaignKey]?.product_life_checks || {}) as Record<string, Record<string, boolean>>
                        return (
                          <div className="flex gap-0.5 relative" style={{minWidth:'120px'}}>
                            {phases.map((ph, idx) => {
                              const phChecks = checks[ph.key] || {}
                              const insts = plInstructions[ph.key] || []
                              const checkedCount = insts.filter((_:any, i:number) => phChecks[String(i)]).length
                              const mostChecked = insts.length > 0 && checkedCount >= Math.ceil(insts.length / 2)
                              const isCurrent = idx === currentPhaseIdx
                              const isPast = idx < currentPhaseIdx
                              let bg = 'bg-slate-200'
                              if(isCurrent) bg = 'bg-green-300'
                              else if(isPast && mostChecked) bg = 'bg-green-700'
                              else if(isPast && !mostChecked) bg = 'bg-amber-400'
                              return (
                                <div
                                  key={ph.key}
                                  className={`flex-1 h-5 ${bg} ${idx===0?'rounded-l':''} ${idx===3?'rounded-r':''} cursor-pointer relative`}
                                  title={`${ph.label} (Day ${ph.start}+)`}
                                  onMouseEnter={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setPlHover({ key: campaignKey, phase: ph.key, rect })
                                  }}
                                  onMouseLeave={() => setPlHover(null)}
                                >
                                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/80 select-none">{ph.label}</span>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-1.5 py-0.5">
                      <input
                        value={notes[rowKey as any]||''}
                        onChange={(e)=>{
                          const v = e.target.value
                          setNotes(prev=>{ const next={...prev, [rowKey as any]: v}; try{ localStorage.setItem('ptos_notes', JSON.stringify(next)) }catch{}; return next })
                        }}
                        placeholder={isChild? 'Notes' : 'Notes'}
                        className="w-24 rounded border px-1 py-0.5 text-xs bg-white"
                      />
                    </td>
                    <td className="px-1.5 py-0.5 text-right">
                      <button
                        onClick={async()=>{
                          const cid = String(c.campaign_id||'')
                          setPerfOpen(true)
                          setPerfLoading(true)
                          try{
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
                      <button
                        disabled={analysisLoading===rowKey}
                        onClick={async()=>{
                          const cid = String(c.campaign_id||'')
                          if(!cid) return
                          setAnalysisLoading(rowKey)
                          setAnalysisError(null)
                          try{
                            const rk = (c.campaign_id || c.name || '') as any
                            const conf = (manualIds as any)[rk]
                            const prodId = (conf && conf.kind==='product' && conf.id)? conf.id : (pidSelf||undefined)
                            // Compute campaign age from created_time
                            const ct = (c as any)?.created_time
                            let ageDays: number|undefined = undefined
                            if(ct){
                              const diff = Date.now() - new Date(ct).getTime()
                              ageDays = Math.max(0, Math.floor(diff / (1000*60*60*24)))
                            }
                            const res = await campaignAnalyze({
                              campaign_id: cid,
                              product_id: prodId,
                              metrics: {
                                spend: Number(c.spend||0),
                                purchases: Number(c.purchases||0),
                                ctr: c.ctr!=null? c.ctr : undefined,
                                cpp: c.cpp!=null? c.cpp : undefined,
                                add_to_cart: Number((c as any).add_to_cart||0),
                                shopify_orders: orders,
                                true_cpp: trueCppVal,
                                status: (c.status||'').toUpperCase()==='ACTIVE'? 'Active' : 'Paused',
                              },
                              campaign_age_days: ageDays,
                              campaign_key: cid,
                            })
                            if(res?.error){ setAnalysisError(res.error) }
                            else if(res?.data){
                              setAnalysisResult(res.data); setAnalysisOpen(true)
                              // Refresh campaign meta to pick up new timeline entry
                              try{
                                const metaRes = await campaignMetaList(store)
                                if((metaRes as any)?.data) setCampaignMeta((metaRes as any).data)
                              }catch{}
                            }
                          }catch(e:any){ setAnalysisError(e?.message||'Analysis failed') }
                          finally{ setAnalysisLoading(null) }
                        }}
                        className={`ml-1 px-2 py-1 rounded text-xs font-semibold transition-all ${
                          analysisLoading===rowKey
                            ? 'bg-gradient-to-r from-violet-200 to-fuchsia-200 text-violet-500 animate-pulse cursor-wait'
                            : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white shadow-sm hover:shadow-md'
                        }`}
                      >{analysisLoading===rowKey ? '⏳ Analyzing…' : '✨ Analyze'}</button>
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
                          <td className="px-1.5 py-0.5 bg-slate-50" colSpan={colSpan}>
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
                                                    const res = await metaSetAdsetStatus(aid, next as any)
                                                    if((res as any)?.error){
                                                      alert(`Failed: ${(res as any).error}`)
                                                    } else {
                                                      setAdsetsByCampaign(prev=> ({ ...prev, [cid]: (prev[cid]||[]).map(x=> x.adset_id===aid? { ...x, status: next } : x) }))
                                                    }
                                                  }catch(e:any){
                                                    alert(`Failed to update ad set status: ${e?.message||e}`)
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
                                  {/* Campaign-level orders (matched by utm_campaign but not attributable to a specific ad set) */}
                                  {(()=>{
                                    const campOrders = ((adsetOrdersByCampaign[cid]||{})['__campaign__'])
                                    if(!campOrders || (campOrders.count||0)===0) return null
                                    const campExpKey = `__camp_${cid}`
                                    return (
                                      <Fragment>
                                        <div className="px-2 py-1 border-t bg-blue-50 flex items-center gap-2 text-[11px] text-blue-700">
                                          <span>Campaign-level UTM orders (not matched to specific ad set):</span>
                                          <button
                                            onClick={()=> setAdsetOrdersExpanded(prev=> ({ ...prev, [campExpKey]: !prev[campExpKey] }))}
                                            className="px-1 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200"
                                          >{campOrders.count} orders {adsetOrdersExpanded[campExpKey]? '▾' : '▸'}</button>
                                        </div>
                                        {adsetOrdersExpanded[campExpKey] && (
                                          <div className="px-2 py-1 border-t bg-blue-50/50 text-slate-700">
                                            <div className="overflow-x-auto">
                                              <table className="min-w-full text-xs">
                                                <thead>
                                                  <tr className="text-left text-slate-500">
                                                    <th className="px-1 py-1">Order</th>
                                                    <th className="px-1 py-1">Processed</th>
                                                    <th className="px-1 py-1">Total</th>
                                                    <th className="px-1 py-1">utm_content</th>
                                                    <th className="px-1 py-1">utm_source</th>
                                                    <th className="px-1 py-1">Store</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {(campOrders.orders||[]).map((o: any,idx: number)=> (
                                                    <tr key={String(o.order_id||idx)} className="border-t">
                                                      <td className="px-1 py-1 font-mono">{String(o.order_id||'')}</td>
                                                      <td className="px-1 py-1">{(o.processed_at||'').replace('T',' ').replace('Z','')}</td>
                                                      <td className="px-1 py-1">{typeof o.total_price==='number'? `$${(o.total_price||0).toFixed(2)}` : '-'}</td>
                                                      <td className="px-1 py-1">{(o.utm||{}).utm_content||''}</td>
                                                      <td className="px-1 py-1">{(o.utm||{}).utm_source||''}</td>
                                                      <td className="px-1 py-1">{o.store||''}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </div>
                                        )}
                                      </Fragment>
                                    )
                                  })()}
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
                        <td className="px-1.5 py-0.5 bg-slate-50" colSpan={15}>
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
      <AnalysisModal open={analysisOpen} onClose={()=>{ setAnalysisOpen(false); setAnalysisResult(null) }} result={analysisResult} />
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
        onViewAnalysis={(data:any)=>{
          setAnalysisResult(data as CampaignAnalysisResult)
          setAnalysisOpen(true)
        }}
      />

      {/* Product Life Hover Tooltip */}
      {plHover && plHover.rect && (()=>{
        const phaseLabels: Record<string,string> = { testing: 'Testing Phase', action1: 'Action 1 Phase', micro_scaling: 'Micro Scaling', macro_scaling: 'Macro Scaling' }
        const insts = plInstructions[plHover.phase] || []
        const campaignKey = plHover.key
        const checks = ((campaignMeta[campaignKey] as any)?.product_life_checks || {}) as Record<string, Record<string, boolean>>
        const phChecks = checks[plHover.phase] || {}
        const top = plHover.rect.bottom + 8
        const left = Math.max(8, Math.min(plHover.rect.left, window.innerWidth - 340))
        return (
          <div
            className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-2xl p-4"
            style={{ top, left, minWidth: 280, maxWidth: 340 }}
            onMouseEnter={() => {/* keep open */}}
            onMouseLeave={() => setPlHover(null)}
          >
            <div className="font-semibold text-sm text-violet-700 mb-2">{phaseLabels[plHover.phase] || plHover.phase}</div>
            {insts.length === 0 ? (
              <p className="text-xs text-slate-400">No instructions set. Use the ⚙ Settings button to add phase instructions.</p>
            ) : (
              <ul className="space-y-1.5">
                {insts.map((inst: string, i: number) => {
                  const checked = !!phChecks[String(i)]
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={async (e) => {
                          const val = e.target.checked
                          const newPhChecks = { ...phChecks, [String(i)]: val }
                          const newChecks = { ...checks, [plHover.phase]: newPhChecks }
                          setCampaignMeta(prev => ({
                            ...prev,
                            [campaignKey]: { ...(prev[campaignKey] || {}), product_life_checks: newChecks }
                          }))
                          try {
                            await campaignMetaUpsert({ campaign_key: campaignKey, product_life_checks: newChecks, store } as any)
                          } catch {}
                        }}
                        className="mt-0.5 accent-violet-600 w-4 h-4 rounded"
                      />
                      <span className={`text-xs ${checked ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{inst}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })()}

      {/* Product Life Settings Modal */}
      {plSettingsOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center" onClick={() => setPlSettingsOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">Product Life Settings</h2>
              <button onClick={() => setPlSettingsOpen(false)} className="text-slate-400 hover:text-slate-700 text-xl">✕</button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Configure instructions for each phase. These instructions will appear when hovering over the Product Life progress bar.</p>
            {(['testing', 'action1', 'micro_scaling', 'macro_scaling'] as const).map(phase => {
              const labels: Record<string,string> = { testing: '🧪 Testing Phase (Day 0-2)', action1: '⚡ Action 1 Phase (Day 3-5)', micro_scaling: '📈 Micro Scaling (Day 6-12)', macro_scaling: '🚀 Macro Scaling (Day 13+)' }
              const insts = plInstructions[phase] || []
              return (
                <div key={phase} className="mb-4 p-3 border rounded-xl bg-slate-50">
                  <div className="font-semibold text-sm text-slate-800 mb-2">{labels[phase]}</div>
                  {insts.map((inst, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-slate-500 w-5">{i+1}.</span>
                      <input
                        value={inst}
                        onChange={(e) => {
                          const newInsts = [...insts]
                          newInsts[i] = e.target.value
                          setPlInstructions(prev => ({ ...prev, [phase]: newInsts }))
                        }}
                        className="flex-1 rounded border px-2 py-1 text-sm bg-white"
                      />
                      <button
                        onClick={() => {
                          const newInsts = insts.filter((_: any, j: number) => j !== i)
                          setPlInstructions(prev => ({ ...prev, [phase]: newInsts }))
                        }}
                        className="text-rose-400 hover:text-rose-600 text-xs px-1"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    onClick={() => setPlInstructions(prev => ({ ...prev, [phase]: [...(prev[phase] || []), ''] }))}
                    className="mt-1 text-xs text-violet-600 hover:text-violet-800"
                  >+ Add instruction</button>
                </div>
              )
            })}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPlSettingsOpen(false)} className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-sm">Cancel</button>
              <button
                onClick={async () => {
                  try {
                    // Filter out empty instructions
                    const cleaned: Record<string, string[]> = {}
                    for (const [k, v] of Object.entries(plInstructions)) {
                      cleaned[k] = (v || []).filter((s: string) => s.trim() !== '')
                    }
                    setPlInstructions(cleaned)
                    await productLifeInstructionsSet({ phases: cleaned, store })
                    setPlSettingsOpen(false)
                  } catch (e: any) {
                    alert('Failed to save: ' + (e?.message || e))
                  }
                }}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm"
              >Save Instructions</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// Timeline Modal
function TimelineModal({ open, onClose, campaign, meta, onAdd, adding, draft, setDraft, onViewAnalysis }:{ open:boolean, onClose:()=>void, campaign:{id:string,name?:string}|null, meta?:{ timeline?: Array<{text:string, at:string}> }, onAdd:(text:string)=>Promise<void>, adding:boolean, draft:string, setDraft:(v:string)=>void, onViewAnalysis?:(data:any)=>void }){
  if(!open) return null
  const entries = (meta?.timeline||[]).slice().sort((a,b)=> String(b.at||'').localeCompare(String(a.at||'')))
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
  // Try to parse analysis entries from JSON text
  function parseAnalysis(text:string): { type:'analysis', verdict?:string, confidence?:string, summary?:string, age_days?:number, analysis?:any } | null {
    try{
      const obj = JSON.parse(text)
      if(obj && obj.type === 'analysis') return obj
    }catch{}
    return null
  }
  const verdictColors: Record<string, string> = {
    'kill': 'from-rose-500 to-red-600',
    'optimize': 'from-amber-400 to-orange-500',
    'scale': 'from-emerald-400 to-green-500',
    'scale_aggressively': 'from-green-500 to-emerald-600',
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
              className="px-1.5 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-60"
            >{adding? 'Adding…' : 'Add'}</button>
          </div>
          <div className="space-y-3">
            {entries.map((e, idx)=> {
              const next = idx<entries.length-1? entries[idx+1] : undefined
              const analysisData = parseAnalysis(e.text||'')
              if(analysisData){
                // Render analysis entry as a special card
                const vc = verdictColors[analysisData.verdict||''] || 'from-slate-400 to-slate-500'
                return (
                  <div key={String(e.at||idx)} className="border rounded-lg overflow-hidden shadow-sm">
                    <div className={`bg-gradient-to-r ${vc} px-3 py-2 text-white flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">✨</span>
                        <span className="font-semibold text-sm">AI Analysis</span>
                        {analysisData.verdict && (
                          <span className="px-2 py-0.5 rounded-full bg-white/20 text-[11px] font-bold uppercase tracking-wider">{analysisData.verdict.replace('_',' ')}</span>
                        )}
                        {analysisData.age_days != null && (
                          <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px]">Day {analysisData.age_days}</span>
                        )}
                      </div>
                      <span className="text-[10px] opacity-80">{String(e.at||'').replace('T',' ').replace('Z','').slice(0,16)}</span>
                    </div>
                    <div className="px-3 py-2 bg-slate-50">
                      {analysisData.confidence && (
                        <div className="text-[10px] text-slate-500 mb-1">Confidence: <span className="font-semibold">{analysisData.confidence}</span></div>
                      )}
                      {analysisData.summary && (
                        <p className="text-xs text-slate-700 leading-relaxed">{analysisData.summary}</p>
                      )}
                      {onViewAnalysis && analysisData.analysis && (
                        <button
                          onClick={()=> onViewAnalysis(analysisData.analysis)}
                          className="mt-2 px-3 py-1 rounded bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white text-xs font-semibold shadow-sm"
                        >View Full Analysis</button>
                      )}
                    </div>
                  </div>
                )
              }
              // Regular text note
              return (
                <div key={String(e.at||idx)} className="border rounded p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 flex items-center justify-between">
                    <span>{String(e.at||'').replace('T',' ').replace('Z','')}</span>
                    <span className="font-mono">{fmtDelta(next?.at, e.at||'')}</span>
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


// -------- AI Campaign Analysis Modal --------
function AnalysisModal({ open, onClose, result }:{ open:boolean, onClose:()=>void, result:CampaignAnalysisResult|null }){
  if(!open || !result) return null
  const verdictColors: Record<string,string> = {
    kill: 'from-rose-500 to-red-600',
    optimize: 'from-amber-400 to-orange-500',
    scale: 'from-emerald-400 to-green-500',
    scale_aggressively: 'from-emerald-500 to-teal-500',
  }
  const verdictLabels: Record<string,string> = {
    kill: '🛑 Kill Campaign',
    optimize: '⚡ Optimize',
    scale: '🚀 Scale',
    scale_aggressively: '🔥 Scale Aggressively',
  }
  const catIcons: Record<string,string> = {
    creative: '🎨', targeting: '🎯', budget: '💰', pricing: '💵',
    landing_page: '🌐', offer: '🎁', ad_copy: '✍️', product: '📦',
  }
  const catColors: Record<string,string> = {
    creative: 'bg-pink-50 border-pink-200 text-pink-800',
    targeting: 'bg-blue-50 border-blue-200 text-blue-800',
    budget: 'bg-amber-50 border-amber-200 text-amber-800',
    pricing: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    landing_page: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    offer: 'bg-violet-50 border-violet-200 text-violet-800',
    ad_copy: 'bg-cyan-50 border-cyan-200 text-cyan-800',
    product: 'bg-orange-50 border-orange-200 text-orange-800',
  }
  const ov = result.overall_verdict||'optimize'
  const cp = result.customer_profile||{}
  const sp = result.scaling_plan||{}
  const ca = result.creative_analysis||{}
  const cu = result.customer_alignment||{}
  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-8" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden" onClick={e=> e.stopPropagation()}>
        {/* Header */}
        <div className={`bg-gradient-to-r ${verdictColors[ov]||'from-slate-500 to-slate-600'} px-6 py-5 text-white`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold">{verdictLabels[ov]||ov}</div>
              <div className="text-white/80 text-sm mt-1">{result.confidence_level||''}</div>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors">✕</button>
          </div>
          {result.summary && <p className="mt-3 text-sm text-white/90 leading-relaxed">{result.summary}</p>}
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Customer Profile Card */}
          {cp && Object.keys(cp).length>0 && !cp.error && (
            <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">👤 Target Customer Profile</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {cp.target_gender && <div><span className="text-slate-500">Gender:</span> <span className="font-semibold text-slate-800">{cp.target_gender}</span></div>}
                {cp.age_range && <div><span className="text-slate-500">Age:</span> <span className="font-semibold text-slate-800">{cp.age_range}</span></div>}
                {cp.market_segment && <div className="col-span-2"><span className="text-slate-500">Segment:</span> <span className="font-semibold text-slate-800">{cp.market_segment}</span></div>}
                {cp.buyer_persona && <div className="col-span-2"><span className="text-slate-500">Buyer:</span> <span className="font-semibold text-slate-800">{cp.buyer_persona}</span></div>}
                {cp.price_sensitivity && <div><span className="text-slate-500">Price sensitivity:</span> <span className="font-semibold text-slate-800">{cp.price_sensitivity}</span></div>}
                {cp.purchase_channel_preference && <div><span className="text-slate-500">Channel:</span> <span className="font-semibold text-slate-800">{cp.purchase_channel_preference}</span></div>}
              </div>
              {cp.psychographics && (
                <div className="mt-3 space-y-2 text-xs">
                  {cp.psychographics.pain_points && <div><span className="text-slate-500 font-medium">Pain points:</span> <span className="text-slate-700">{(cp.psychographics.pain_points||[]).join(' · ')}</span></div>}
                  {cp.psychographics.buying_triggers && <div><span className="text-slate-500 font-medium">Buying triggers:</span> <span className="text-slate-700">{(cp.psychographics.buying_triggers||[]).join(' · ')}</span></div>}
                  {cp.psychographics.values && <div><span className="text-slate-500 font-medium">Values:</span> <span className="text-slate-700">{(cp.psychographics.values||[]).join(' · ')}</span></div>}
                </div>
              )}
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations && result.recommendations.length>0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">📋 Recommendations <span className="text-xs font-normal text-slate-400">(sorted by impact)</span></h3>
              <div className="space-y-2">
                {result.recommendations.map((r,i)=> (
                  <div key={i} className={`border rounded-xl p-3 ${catColors[r.category]||'bg-slate-50 border-slate-200 text-slate-800'}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-lg">{catIcons[r.category]||'📌'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/60 text-[10px] font-bold border">P{r.priority}</span>
                          <span className="text-xs font-bold uppercase tracking-wide">{r.category.replace('_',' ')}</span>
                        </div>
                        <p className="text-xs leading-relaxed"><span className="font-semibold">Finding:</span> {r.finding}</p>
                        <p className="text-xs leading-relaxed mt-1"><span className="font-semibold">Action:</span> {r.recommendation}</p>
                        {r.expected_impact && <p className="text-[11px] mt-1 opacity-80">📈 {r.expected_impact}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creative Analysis */}
          {ca && (ca.headline_score || ca.ad_copy_score) && (
            <div className="bg-gradient-to-br from-cyan-50 to-white border border-cyan-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-slate-700 mb-3">✍️ Creative Analysis</h3>
              <div className="grid grid-cols-2 gap-4 text-xs">
                {ca.headline_score!=null && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">Headline Score</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ca.headline_score>=7? 'bg-emerald-100 text-emerald-700' : ca.headline_score>=4? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{ca.headline_score}/10</span>
                    </div>
                    {ca.headline_feedback && <p className="text-slate-600 leading-relaxed">{ca.headline_feedback}</p>}
                  </div>
                )}
                {ca.ad_copy_score!=null && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">Ad Copy Score</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ca.ad_copy_score>=7? 'bg-emerald-100 text-emerald-700' : ca.ad_copy_score>=4? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{ca.ad_copy_score}/10</span>
                    </div>
                    {ca.ad_copy_feedback && <p className="text-slate-600 leading-relaxed">{ca.ad_copy_feedback}</p>}
                  </div>
                )}
              </div>
              {ca.suggested_headlines && ca.suggested_headlines.length>0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-600 mb-1">💡 Suggested Headlines:</div>
                  <div className="space-y-1">
                    {ca.suggested_headlines.map((h,i)=> <div key={i} className="text-xs bg-white/60 rounded-lg px-3 py-1.5 border border-cyan-100">{h}</div>)}
                  </div>
                </div>
              )}
              {ca.suggested_ad_copy && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-600 mb-1">💡 Suggested Ad Copy:</div>
                  <div className="text-xs bg-white/60 rounded-lg px-3 py-2 border border-cyan-100 whitespace-pre-wrap">{ca.suggested_ad_copy}</div>
                </div>
              )}
            </div>
          )}

          {/* Customer Alignment */}
          {cu && cu.score!=null && (
            <div className="bg-gradient-to-br from-violet-50 to-white border border-violet-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">🎯 Customer Alignment <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cu.score>=7? 'bg-emerald-100 text-emerald-700' : cu.score>=4? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{cu.score}/10</span></h3>
              {cu.gaps && cu.gaps.length>0 && (
                <div className="mb-2"><span className="text-xs font-semibold text-slate-600">Gaps:</span>
                  <ul className="list-disc list-inside text-xs text-slate-600 mt-1 space-y-0.5">{cu.gaps.map((g,i)=> <li key={i}>{g}</li>)}</ul>
                </div>
              )}
              {cu.opportunities && cu.opportunities.length>0 && (
                <div><span className="text-xs font-semibold text-slate-600">Opportunities:</span>
                  <ul className="list-disc list-inside text-xs text-emerald-700 mt-1 space-y-0.5">{cu.opportunities.map((o,i)=> <li key={i}>{o}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {/* Scaling Plan */}
          {sp && (sp.verdict || sp.next_steps) && (
            <div className={`bg-gradient-to-br ${ov==='kill'? 'from-rose-50 to-white border-rose-200' : 'from-emerald-50 to-white border-emerald-200'} border rounded-xl p-4`}>
              <h3 className="text-sm font-bold text-slate-700 mb-2">🗺️ Scaling Plan — <span className="capitalize">{sp.current_phase?.replace('_',' ')||'N/A'}</span></h3>
              {sp.verdict && <p className="text-xs text-slate-700 leading-relaxed mb-3">{sp.verdict}</p>}
              {sp.next_steps && sp.next_steps.length>0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-600 mb-1">Next Steps:</div>
                  <ol className="list-decimal list-inside text-xs text-slate-700 space-y-1">{sp.next_steps.map((s,i)=> <li key={i}>{s}</li>)}</ol>
                </div>
              )}
              {sp.budget_recommendation && <p className="text-xs"><span className="font-semibold">💰 Budget:</span> {sp.budget_recommendation}</p>}
              {sp.timeline && <p className="text-xs mt-1"><span className="font-semibold">⏱ Timeline:</span> {sp.timeline}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t flex justify-end">
          <button onClick={onClose} className="px-6 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
