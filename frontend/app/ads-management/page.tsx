"use client"
import { useEffect, useMemo, useRef, useState, Fragment, useCallback } from 'react'
import Link from 'next/link'
import { Rocket, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, DollarSign, ShoppingCart, Calculator, ChevronDown, Check, Settings, Search, X, Sparkles, BarChart3, Clock, ClipboardList, Zap } from 'lucide-react'
import { fetchMetaCampaigns, type MetaCampaignRow, shopifyOrdersCountByTitle, shopifyProductsBrief, shopifyProductVariantsInventory, shopifyOrdersCountByCollection, shopifyCollectionProducts, campaignMappingsList, campaignMappingUpsert, metaGetAdAccount, metaSetAdAccount, metaSetCampaignStatus, fetchCampaignAdsets, metaSetAdsetStatus, type MetaAdsetRow, fetchCampaignPerformance, shopifyOrdersCountTotal, metaListAdAccounts, fetchCampaignAdsetOrders, type AttributedOrder, campaignMetaList, campaignMetaUpsert, campaignTimelineAdd, fetchAdsManagementBundle, productLifeInstructionsGet, productLifeInstructionsSet, campaignAnalyze, type CampaignAnalysisResult, campaignAnalysisChecksSave, campaignAnalysisChecksGet, generateActionTasks, getActionTasks, saveActionTasks, clearActionTasks, type ActionTask, type ActionTasksResult } from '@/lib/api'

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
  const [analysisChecks, setAnalysisChecks] = useState<Record<string, boolean>>({})
  const [analysisCampaignKey, setAnalysisCampaignKey] = useState<string|null>(null)
  const [analysisSaving, setAnalysisSaving] = useState<boolean>(false)
  // Multi-campaign analysis state
  const [multiAnalysisResults, setMultiAnalysisResults] = useState<Record<string, CampaignAnalysisResult>>({})
  const [multiAnalysisLoading, setMultiAnalysisLoading] = useState<boolean>(false)
  const [multiAnalysisProgress, setMultiAnalysisProgress] = useState<{ done: number, total: number }>({ done: 0, total: 0 })
  const multiAnalysisAbortRef = useRef<AbortController|null>(null)
  const multiAnalysisCancelledRef = useRef<boolean>(false)
  // Action Tasks state
  const [actionTasks, setActionTasks] = useState<ActionTask[]>([])
  const [actionTasksSummary, setActionTasksSummary] = useState<string>('')
  const [actionTasksOpen, setActionTasksOpen] = useState<boolean>(false)
  const [actionTasksLoading, setActionTasksLoading] = useState<boolean>(false)
  const [actionTasksLoaded, setActionTasksLoaded] = useState<boolean>(false)
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
  // Inventory hover tooltip state
  const [invHover, setInvHover] = useState<{ pid: string, rect?: DOMRect }|null>(null)
  const [variantInventoryCache, setVariantInventoryCache] = useState<Record<string, { sizes: string[], colors: string[], matrix: Record<string, Record<string, number>>, total_available: number }>>({})
  const [variantInventoryLoading, setVariantInventoryLoading] = useState<Record<string, boolean>>({})

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
      // Load saved action tasks
      if(!actionTasksLoaded){
        try{
          const res = await getActionTasks(store)
          if(res?.data){
            setActionTasks(res.data.tasks || [])
            setActionTasksSummary(res.data.summary || '')
            setActionTasksLoaded(true)
          }
        }catch{}
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
  function campaignKeysForRows(rows: MetaCampaignRow[]): string[]{
    const keys: string[] = []
    for(const r of (rows||[])){
      const rk = rowKeyOf(r)
      if(rk) keys.push(rk)
    }
    return keys
  }
  function getGroupSelectionState(rows: MetaCampaignRow[]){
    const keys = campaignKeysForRows(rows)
    const total = keys.length
    if(total===0) return { checked: false, indeterminate: false, selected: 0, total: 0 }
    let selected = 0
    for(const k of keys){
      if(!!selectedKeys[k]) selected += 1
    }
    return {
      checked: selected>0 && selected===total,
      indeterminate: selected>0 && selected<total,
      selected,
      total,
    }
  }
  function toggleGroupSelect(rows: MetaCampaignRow[], v?: boolean){
    const keys = campaignKeysForRows(rows)
    if(keys.length===0) return
    setSelectedKeys(prev=>{
      const next = { ...prev }
      const shouldSelect = v==null ? !keys.every(k=> !!prev[k]) : !!v
      for(const k of keys){
        next[k] = shouldSelect
      }
      try{ localStorage.setItem('ptos_ads_selected', JSON.stringify(next)) }catch{}
      return next
    })
  }
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

  async function loadVariantInventory(pid: string){
    if(variantInventoryCache[pid] || variantInventoryLoading[pid]) return
    setVariantInventoryLoading(prev => ({ ...prev, [pid]: true }))
    try{
      // Try all selected stores in parallel – use the first one that returns real data
      const storesToTry = selectedStores.length > 0 ? selectedStores : [store]
      const results = await Promise.allSettled(
        storesToTry.map(st => shopifyProductVariantsInventory({ product_id: pid, store: st }))
      )
      let best: any = null
      for(const r of results){
        if(r.status === 'fulfilled'){
          const d = (r.value as any)?.data
          if(d && (d.sizes?.length > 0 || d.total_available > 0)){
            best = d
            break
          }
          if(!best && d) best = d
        }
      }
      if(best){
        setVariantInventoryCache(prev => ({ ...prev, [pid]: best }))
      }
    }catch{}
    finally{ setVariantInventoryLoading(prev => ({ ...prev, [pid]: false })) }
  }

  function InventoryTooltip(){
    if(!invHover || !invHover.rect) return null
    const pid = invHover.pid
    const data = variantInventoryCache[pid]
    const loading = variantInventoryLoading[pid]
    const rect = invHover.rect
    // Position tooltip below the hovered element
    const top = rect.bottom + 4
    const left = Math.max(4, rect.left - 60)
    return (
      <div
        className="fixed z-[999] bg-white border border-slate-200 rounded-lg shadow-xl p-2 text-xs"
        style={{ top, left, maxWidth: '420px', maxHeight: '320px', overflowY: 'auto' }}
        onMouseEnter={() => {}} // keep tooltip visible
        onMouseLeave={() => setInvHover(null)}
      >
        {loading && <div className="text-slate-400 py-2 px-3">Loading variants…</div>}
        {!loading && !data && <div className="text-slate-400 py-2 px-3">No data</div>}
        {!loading && data && data.sizes.length === 0 && <div className="text-slate-400 py-2 px-3">No variants</div>}
        {!loading && data && data.sizes.length > 0 && (
          <table className="border-collapse w-full">
            <thead>
              <tr>
                <th className="px-1.5 py-1 text-left text-slate-500 font-medium border-b border-slate-100" style={{minWidth:'44px'}}></th>
                {data.sizes.map(s => (
                  <th key={s} className="px-1.5 py-1 text-center text-slate-600 font-semibold border-b border-slate-100 whitespace-nowrap" style={{minWidth:'28px'}}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.colors.map(color => (
                <tr key={color} className="border-b border-slate-50 last:border-b-0">
                  <td className="px-1.5 py-0.5 text-slate-600 font-medium whitespace-nowrap">{color}</td>
                  {data.sizes.map(size => {
                    const qty = (data.matrix[color] || {})[size] ?? 0
                    const bg = qty === 0 ? 'bg-red-100 text-red-700' : qty <= 2 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    return (
                      <td key={size} className="px-1.5 py-0.5 text-center">
                        <span className={`inline-block min-w-[22px] px-1 py-0.5 rounded text-[10px] font-bold ${bg}`}>{qty}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <InventoryTooltip />
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
          {/* ── Analyze Selected button ── */}
          {(selectedCount > 0 || multiAnalysisLoading) && (
            <button
              disabled={multiAnalysisLoading}
              onClick={async()=>{
                const keys = Object.keys(selectedKeys).filter(k => !!selectedKeys[k])
                if(keys.length === 0) return
                const controller = new AbortController()
                multiAnalysisAbortRef.current = controller
                multiAnalysisCancelledRef.current = false
                setMultiAnalysisLoading(true)
                setMultiAnalysisResults({})
                setMultiAnalysisProgress({ done: 0, total: keys.length })
                const results: Record<string, CampaignAnalysisResult> = {}
                for(let i = 0; i < keys.length; i++){
                  if(multiAnalysisCancelledRef.current) break
                  const rk = keys[i]
                  // Find the campaign row
                  const row = (items||[]).find(r => String(r.campaign_id||r.name||'') === rk)
                  if(!row) { setMultiAnalysisProgress(p => ({ ...p, done: p.done+1 })); continue }
                  try{
                    const cid = String(row.campaign_id||'')
                    const rkSelf = (row.campaign_id || row.name || '') as any
                    const confSelf = (manualIds as any)[rkSelf]
                    const pidSelf = (confSelf && confSelf.kind==='product' && confSelf.id) ? confSelf.id : extractNumericId((row.name||'').trim())
                    const ct = (row as any)?.created_time
                    let ageDays: number|undefined = undefined
                    if(ct){ const diff = Date.now() - new Date(ct).getTime(); ageDays = Math.max(0, Math.floor(diff / (1000*60*60*24))) }
                    const orders = getOrders(row)
                    const trueCppVal = (orders!=null && orders>0)? ((Number(row.spend||0)) / orders) : null
                    const res = await campaignAnalyze({
                      campaign_id: cid || undefined,
                      campaign_name: row.name || undefined,
                      product_id: pidSelf || undefined,
                      metrics: {
                        spend: Number(row.spend||0),
                        purchases: Number(row.purchases||0),
                        ctr: row.ctr!=null? row.ctr : undefined,
                        cpp: row.cpp!=null? row.cpp : undefined,
                        add_to_cart: Number((row as any).add_to_cart||0),
                        shopify_orders: orders,
                        true_cpp: trueCppVal,
                        status: (row.status||'').toUpperCase()==='ACTIVE'? 'Active' : 'Paused',
                      },
                      campaign_age_days: ageDays,
                      campaign_key: cid || rk,
                    }, { signal: controller.signal })
                    if(res?.data){
                      results[rk] = { ...res.data, campaign_name: row.name||cid, campaign_key: cid||rk } as any
                    }
                  }catch(e:any){
                    if(controller.signal.aborted || multiAnalysisCancelledRef.current) break
                  }
                  setMultiAnalysisProgress(p => ({ ...p, done: p.done+1 }))
                  setMultiAnalysisResults({ ...results })
                }
                setMultiAnalysisResults(results)
                multiAnalysisAbortRef.current = null
                setMultiAnalysisLoading(false)
              }}
              className={`rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 text-white text-sm transition-all ${
                multiAnalysisLoading
                  ? 'bg-gradient-to-r from-violet-300 to-fuchsia-300 cursor-wait animate-pulse'
                  : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 shadow-sm hover:shadow-md'
              }`}
            >
              <Sparkles className="w-4 h-4"/>
              {multiAnalysisLoading
                ? `Analyzing ${multiAnalysisProgress.done}/${multiAnalysisProgress.total}…`
                : `Analyze ${selectedCount} selected`
              }
            </button>
          )}
          {multiAnalysisLoading && (
            <button
              onClick={()=>{
                multiAnalysisCancelledRef.current = true
                multiAnalysisAbortRef.current?.abort()
                setMultiAnalysisLoading(false)
              }}
              className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-sm shadow-sm hover:shadow-md transition-all"
              title="Cancel selected campaign analysis"
            >
              <X className="w-4 h-4"/>
              Cancel analysis
            </button>
          )}
          {/* ── Generate Actions button (after multi-analysis) ── */}
          {Object.keys(multiAnalysisResults).length > 0 && !multiAnalysisLoading && (
            <button
              disabled={actionTasksLoading}
              onClick={async()=>{
                setActionTasksLoading(true)
                try{
                  const analyses = Object.values(multiAnalysisResults)
                  const res = await generateActionTasks({ analyses, store })
                  if(res?.data){
                    setActionTasks(res.data.tasks || [])
                    setActionTasksSummary(res.data.summary || '')
                    setActionTasksOpen(true)
                    // Auto-add each task once to the product-group timeline, with campaign references inside the task.
                    const tasks = res.data.tasks || []
                    for(const task of tasks){
                      const campaignLabels = (task.campaigns || []).map((cn: string) => String(cn||'').trim()).filter(Boolean)
                      const matchedRows = campaignLabels.map((cn: string) => {
                        const lc = cn.toLowerCase()
                        return (items||[]).find((r: any) => {
                          const name = String(r.name||'')
                          const id = String(r.campaign_id||'')
                          const nameLc = name.toLowerCase()
                          const idLc = id.toLowerCase()
                          return name === cn || id === cn || (!!id && idLc === lc) || (!!name && (nameLc.includes(lc) || lc.includes(nameLc)))
                        })
                      }).filter(Boolean) as MetaCampaignRow[]
                      const groupIds = [...new Set(matchedRows.map(r => getProductIdForRow(r)).filter(Boolean) as string[])]
                      for(const pid of groupIds){
                        const refs = matchedRows
                          .filter(r => getProductIdForRow(r) === pid)
                          .map((r: any) => ({ id: String(r.campaign_id||''), name: String(r.name||'') }))
                        try{
                          const taskEntry = JSON.stringify({
                            type: 'task',
                            id: task.id,
                            priority: task.priority,
                            urgency: task.urgency,
                            category: task.category,
                            title: task.title,
                            description: task.description,
                            campaigns: task.campaigns || [],
                            campaign_references: refs,
                            group_product_id: pid,
                            expected_impact: task.expected_impact,
                            done: false,
                          })
                          await campaignTimelineAdd({ campaign_key: `group:${pid}`, text: taskEntry, store })
                        }catch{}
                      }
                    }
                    // Refresh meta to show task badges
                    try{
                      const metaRes = await campaignMetaList(store)
                      if((metaRes as any)?.data) setCampaignMeta((metaRes as any).data)
                    }catch{}
                    setMultiAnalysisResults({})
                  }
                }catch{}
                finally{ setActionTasksLoading(false) }
              }}
              className={`rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-1.5 text-white text-sm transition-all ${
                actionTasksLoading
                  ? 'bg-gradient-to-r from-amber-300 to-orange-300 cursor-wait animate-pulse'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-sm hover:shadow-md'
              }`}
            >
              <Zap className="w-4 h-4"/>
              {actionTasksLoading ? 'Generating tasks…' : `Generate Actions (${Object.keys(multiAnalysisResults).length})`}
            </button>
          )}
          {/* ── Tasks icon with badge ── */}
          {(()=>{
            const incomplete = actionTasks.filter(t => !t.done).length
            return (
              <button
                onClick={()=> setActionTasksOpen(true)}
                className="relative rounded-xl inline-flex items-center gap-1 px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm transition-all"
                title="Action Tasks"
              >
                <ClipboardList className="w-4 h-4"/>
                {incomplete > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm animate-bounce" style={{animationDuration:'2s'}}>
                    {incomplete}
                  </span>
                )}
              </button>
            )
          })()}
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
                <th className="px-1 py-0.5 font-semibold text-violet-700" style={{minWidth:'80px', maxWidth:'100px'}}>Life</th>
                <th className="px-1 py-0.5 font-semibold text-right w-[70px]"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-slate-500">Loading…</td>
                </tr>
              )}
              {!loading && items.length===0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-slate-500">No active campaigns.</td>
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
                  const groupSelection = getGroupSelectionState(d.rows)
                  return (
                    <Fragment key={`group-${pid}`}>
                      <tr className={`border-b last:border-b-0 ${colorClass} ${severityAccent}`}>
                        <td className="px-1.5 py-0.5">
                          <input
                            type="checkbox"
                            checked={groupSelection.checked}
                            ref={(el)=>{ if(el) el.indeterminate = groupSelection.indeterminate }}
                            onChange={(e)=> toggleGroupSelect(d.rows, e.target.checked)}
                            aria-label={`Select product group ${pid}`}
                          />
                        </td>
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
                          <div className="flex items-center justify-end gap-0.5 cursor-pointer"
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setInvHover({ pid, rect })
                              loadVariantInventory(pid)
                            }}
                            onMouseLeave={() => setInvHover(null)}
                          >
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
                              <div className="flex gap-0.5 relative" style={{minWidth:'80px', maxWidth:'100px'}}>
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
                        <td className="px-1 py-0.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                          <button
                            title="Performance"
                            onClick={async()=>{
                              setPerfOpen(true)
                              setPerfLoading(true)
                              try{
                                const campaignIds = (d.rows||[]).map((r:any)=> String(r.campaign_id||'')).filter(Boolean)
                                setPerfCampaign({ id: pid, name: d.primary.name || `Product ${pid}` })
                                // Fetch performance for all campaigns in the group and merge by date
                                const allPerf = await Promise.all(campaignIds.map(cid =>
                                  fetchCampaignPerformance(cid, 6, browserTz).then(r => (((r as any)?.data||{}).days)||[]).catch(()=> [])
                                ))
                                // Merge by date: sum spend, purchases, add_to_cart per date
                                const dateMap: Record<string, {date:string, spend:number, purchases:number, cpp?:number|null, ctr?:number|null, add_to_cart:number}> = {}
                                for(const days of allPerf){
                                  for(const dd of days){
                                    if(!dateMap[dd.date]) dateMap[dd.date] = { date: dd.date, spend: 0, purchases: 0, add_to_cart: 0 }
                                    dateMap[dd.date].spend += Number(dd.spend||0)
                                    dateMap[dd.date].purchases += Number(dd.purchases||0)
                                    dateMap[dd.date].add_to_cart += Number(dd.add_to_cart||0)
                                  }
                                }
                                const mergedDays = Object.values(dateMap).sort((a,b) => a.date.localeCompare(b.date))
                                setPerfMetrics(mergedDays)
                                // Fetch Shopify orders per day by product ID
                                const ordersPerDay = await Promise.all(mergedDays.map(async (dd) => {
                                  try{
                                    const oc = await shopifyOrdersCountByTitle({ names: [pid], start: dd.date, end: dd.date, include_closed: true, date_field: 'processed' })
                                    return Number(((oc as any)?.data||{})[pid] ?? 0)
                                  }catch{ return 0 }
                                }))
                                setPerfOrders(ordersPerDay)
                              }finally{
                                setPerfLoading(false)
                              }
                            }}
                            className="p-1.5 rounded bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white shadow-sm hover:shadow-md transition-all"
                          ><BarChart3 className="w-3.5 h-3.5"/></button>
                          {/* Group Timeline button with red badge */}
                          {(()=>{
                            const groupKey = `group:${pid}`
                            const tl = (campaignMeta[groupKey] as any)?.timeline || []
                            const incompleteTasks = tl.filter((te: any) => { try { const o = JSON.parse(te.text||''); return o?.type==='task' && !o.done } catch { return false } }).length
                            return (
                              <button
                                title="Group Timeline"
                                onClick={()=>{
                                  setTimelineDraft('')
                                  setTimelineOpen({ open: true, campaign: { id: groupKey, name: d.primary.name || `Product ${pid}` } })
                                }}
                                className="relative p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-700 transition-colors"
                              >
                                <Clock className="w-3.5 h-3.5"/>
                                {incompleteTasks > 0 && (
                                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[9px] font-bold flex items-center justify-center shadow-sm animate-bounce" style={{animationDuration:'2s'}}>
                                    {incompleteTasks}
                                  </span>
                                )}
                              </button>
                            )
                          })()}
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
                                  campaign_name: d.primary.name || undefined,
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
                                  setAnalysisCampaignKey(campaignKey)
                                  // Load saved checks for this campaign
                                  try{
                                    const checksRes = await campaignAnalysisChecksGet(campaignKey, store)
                                    if(checksRes?.data) setAnalysisChecks(checksRes.data)
                                    else setAnalysisChecks({})
                                  }catch{ setAnalysisChecks({}) }
                                  // Refresh campaign meta to pick up new timeline entry
                                  try{
                                    const metaRes = await campaignMetaList(store)
                                    if((metaRes as any)?.data) setCampaignMeta((metaRes as any).data)
                                  }catch{}
                                }
                              }catch(e:any){ setAnalysisError(e?.message||'Analysis failed') }
                              finally{ setAnalysisLoading(null) }
                            }}
                            title="Analyze"
                            className={`p-1.5 rounded transition-all ${
                              analysisLoading===pid
                                ? 'bg-gradient-to-r from-violet-200 to-fuchsia-200 text-violet-500 animate-pulse cursor-wait'
                                : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white shadow-sm hover:shadow-md'
                            }`}
                          ><Sparkles className="w-3.5 h-3.5"/></button>
                          </div>
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
                        <div className="flex items-center justify-end gap-0.5 cursor-pointer"
                          onMouseEnter={(e) => {
                            if(pidSelf){
                              const rect = e.currentTarget.getBoundingClientRect()
                              setInvHover({ pid: pidSelf, rect })
                              loadVariantInventory(pidSelf)
                            }
                          }}
                          onMouseLeave={() => setInvHover(null)}
                        >
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
                          <div className="flex gap-0.5 relative" style={{minWidth:'80px', maxWidth:'100px'}}>
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
                    <td className="px-1 py-0.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                      {!isChild && <button
                        title="Performance"
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
                            const rk = (c.campaign_id || c.name || '') as any
                            const conf = (manualIds as any)[rk]
                            const useProduct = conf? (conf.kind==='product') : /^\d+$/.test((c.name||'').trim())
                            const prodId = useProduct? (conf? conf.id : (c.name||'').trim()) : undefined
                            const collId = (!useProduct && conf && conf.kind==='collection')? conf.id : undefined
                            // Batch all Shopify order requests in parallel for reliability
                            const ordersPerDay = await Promise.all((days||[]).map(async (dd: any) => {
                              const dayDate = dd.date
                              try{
                                if(prodId){
                                  const oc = await shopifyOrdersCountByTitle({ names: [prodId], start: dayDate, end: dayDate, include_closed: true, date_field: 'processed' })
                                  return Number(((oc as any)?.data||{})[prodId] ?? 0)
                                }else if(collId){
                                  const oc = await shopifyOrdersCountByCollection({ collection_id: collId, start: dayDate, end: dayDate, store, include_closed: true, aggregate: 'sum_product_orders', date_field: 'processed' })
                                  return Number(((oc as any)?.data||{})?.count ?? 0)
                                }
                                return 0
                              }catch{ return 0 }
                            }))
                            setPerfOrders(ordersPerDay)
                          }finally{
                            setPerfLoading(false)
                          }
                        }}
                        className="p-1.5 rounded bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white shadow-sm hover:shadow-md transition-all"
                      ><BarChart3 className="w-3.5 h-3.5"/></button>}
                      {(()=>{
                        const ck = String(c.campaign_id||c.name||'')
                        const tl = (campaignMeta[ck] as any)?.timeline || []
                        const incompleteTasks = tl.filter((te: any) => { try { const o = JSON.parse(te.text||''); return o?.type==='task' && !o.done } catch { return false } }).length
                        return (
                          <button
                            title="Timeline"
                            onClick={()=>{
                              setTimelineDraft('')
                              setTimelineOpen({ open: true, campaign: { id: String(c.campaign_id||''), name: c.name||'' } })
                            }}
                            className="relative p-1.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-700 transition-colors"
                          >
                            <Clock className="w-3.5 h-3.5"/>
                            {incompleteTasks > 0 && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[8px] font-bold flex items-center justify-center shadow-sm">
                                {incompleteTasks}
                              </span>
                            )}
                          </button>
                        )
                      })()}
                      <button
                        title="Analyze"
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
                            const ct = (c as any)?.created_time
                            let ageDays: number|undefined = undefined
                            if(ct){
                              const diff = Date.now() - new Date(ct).getTime()
                              ageDays = Math.max(0, Math.floor(diff / (1000*60*60*24)))
                            }
                            const res = await campaignAnalyze({
                              campaign_id: cid,
                              campaign_name: c.name || undefined,
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
                              setAnalysisCampaignKey(cid)
                              // Auto-add analysis result to campaign timeline
                              try{
                                const timelineEntry = JSON.stringify({
                                  type: 'analysis',
                                  verdict: res.data.overall_verdict||'',
                                  confidence: res.data.confidence_level||'',
                                  summary: res.data.summary||'',
                                  age_days: ageDays,
                                  analysis: res.data,
                                })
                                await campaignTimelineAdd({ campaign_key: cid, text: timelineEntry, store })
                              }catch{}
                              // Load saved checks for this campaign
                              try{
                                const checksRes = await campaignAnalysisChecksGet(cid, store)
                                if(checksRes?.data) setAnalysisChecks(checksRes.data)
                                else setAnalysisChecks({})
                              }catch{ setAnalysisChecks({}) }
                              try{
                                const metaRes = await campaignMetaList(store)
                                if((metaRes as any)?.data) setCampaignMeta((metaRes as any).data)
                              }catch{}
                            }
                          }catch(e:any){ setAnalysisError(e?.message||'Analysis failed') }
                          finally{ setAnalysisLoading(null) }
                        }}
                        className={`p-1.5 rounded transition-all ${
                          analysisLoading===rowKey
                            ? 'bg-gradient-to-r from-violet-200 to-fuchsia-200 text-violet-500 animate-pulse cursor-wait'
                            : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white shadow-sm hover:shadow-md'
                        }`}
                      ><Sparkles className="w-3.5 h-3.5"/></button>
                      </div>
                    </td>
                  </tr>
                  {(()=>{
                    const rk = (c.campaign_id || c.name || '') as any
                    const conf = (manualIds as any)[rk]
                    const colSpan = 13
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
                        <td className="px-1.5 py-0.5 bg-slate-50" colSpan={13}>
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
      <AnalysisModal
        open={analysisOpen}
        onClose={()=>{ setAnalysisOpen(false); setAnalysisResult(null); setAnalysisChecks({}); setAnalysisCampaignKey(null) }}
        result={analysisResult}
        checks={analysisChecks}
        onCheckChange={(key: string, val: boolean) => setAnalysisChecks(prev => ({ ...prev, [key]: val }))}
        saving={analysisSaving}
        onSave={async () => {
          if(!analysisCampaignKey) return
          setAnalysisSaving(true)
          try{ await campaignAnalysisChecksSave({ campaign_key: analysisCampaignKey, checks: analysisChecks, store }) }catch{}
          finally{ setAnalysisSaving(false) }
        }}
        campaignKey={analysisCampaignKey}
      />
      <TasksPopup
        open={actionTasksOpen}
        onClose={()=> setActionTasksOpen(false)}
        tasks={actionTasks}
        summary={actionTasksSummary}
        onToggleTask={async(taskId: string)=>{
          const updated = actionTasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t)
          setActionTasks(updated)
          try{
            await saveActionTasks({ tasks: updated, store })
            const metaRes = await campaignMetaList(store)
            if((metaRes as any)?.data) setCampaignMeta((metaRes as any).data)
          }catch{}
        }}
        onClearAll={async()=>{
          setActionTasks([])
          setActionTasksSummary('')
          try{ await clearActionTasks(store) }catch{}
        }}
      />
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
        onToggleTask={async(entryIdx: number, taskData: any)=>{
          if(!timelineOpen.campaign) return
          const ck = String(timelineOpen.campaign.id||timelineOpen.campaign.name||'')
          const timeline = [...((campaignMeta[ck] as any)?.timeline || [])]
          if(entryIdx < 0 || entryIdx >= timeline.length) return
          try{
            const entry = timeline[entryIdx]
            const parsed = JSON.parse(entry.text || '{}')
            const nowDone = !parsed.done
            const updated = { ...parsed, done: nowDone }
            if(nowDone) updated.completed_at = new Date().toISOString()
            else delete updated.completed_at
            // Update the timeline entry text with new done state
            timeline[entryIdx] = { ...entry, text: JSON.stringify(updated) }
            // Optimistically update local state
            setCampaignMeta(prev => ({
              ...prev,
              [ck]: { ...prev[ck], timeline }
            }))
            await campaignMetaUpsert({ campaign_key: ck, timeline, store })
            if(parsed.id){
              const updatedTasks = actionTasks.map(t => t.id === parsed.id ? { ...t, done: nowDone } : t)
              setActionTasks(updatedTasks)
              try{ await saveActionTasks({ tasks: updatedTasks, store }) }catch{}
            }
            try{
              const res = await campaignMetaList(store)
              if((res as any)?.data) setCampaignMeta((res as any).data)
            }catch{}
          }catch(err){
            console.error('Failed to toggle task:', err)
          }
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

function hasRtlText(value: unknown): boolean{
  return /[\u0590-\u08FF\uFB1D-\uFEFC]/.test(String(value||''))
}

function taskTextDirection(task: any): 'rtl'|'ltr'{
  const campaigns = Array.isArray(task?.campaigns) ? task.campaigns.join(' ') : ''
  const refs = Array.isArray(task?.campaign_references) ? task.campaign_references.map((r:any)=> `${r?.name||''} ${r?.id||''}`).join(' ') : ''
  return hasRtlText(`${task?.title||''} ${task?.description||''} ${task?.expected_impact||''} ${campaigns} ${refs}`) ? 'rtl' : 'ltr'
}

function splitTaskDescription(description: unknown): string[]{
  const raw = String(description||'').replace(/\r\n/g, '\n').trim()
  if(!raw) return []
  const normalized = raw.replace(/[•●]/g, '-')
  const explicitLines = normalized.split(/\n+/).map(s => s.trim()).filter(Boolean)
  if(explicitLines.length > 1) return explicitLines
  const punctuated = normalized.replace(/([.!?؛؟;])\s+/g, '$1\n')
  let lines = punctuated.split(/\n+/).map(s => s.trim()).filter(Boolean)
  if(lines.length <= 1 && normalized.length > 150){
    lines = normalized.split(/\s*[،,]\s+/).map(s => s.trim()).filter(Boolean)
  }
  return lines.length ? lines : [raw]
}

function taskLineParts(line: string, dir: 'rtl'|'ltr', index: number): { label: string, text: string }{
  const clean = line.replace(/^[-\s]+/, '').trim()
  const match = clean.match(/^([^:：-]{2,24})\s*[:：-]\s*(.+)$/)
  const labelsRtl = ['الخطوة', 'التفاصيل', 'المتابعة', 'ملاحظة']
  const labelsLtr = ['Action', 'Details', 'Check', 'Note']
  const fallback = dir === 'rtl' ? labelsRtl[Math.min(index, labelsRtl.length-1)] : labelsLtr[Math.min(index, labelsLtr.length-1)]
  if(!match) return { label: fallback, text: clean }
  const rawLabel = match[1].trim().toLowerCase()
  const labelMap: Record<string, string> = dir === 'rtl'
    ? { action: 'الخطوة', step: 'الخطوة', campaigns: 'الحملات', campaign: 'الحملات', details: 'التفاصيل', detail: 'التفاصيل', check: 'المتابعة', impact: 'النتيجة', why: 'السبب' }
    : { action: 'Action', step: 'Action', campaigns: 'Campaigns', campaign: 'Campaigns', details: 'Details', detail: 'Details', check: 'Check', impact: 'Impact', why: 'Why' }
  return { label: labelMap[rawLabel] || match[1].trim(), text: match[2].trim() }
}

function TaskDetailsBlock({ task, isDone=false, includeCampaigns=true }: { task: any, isDone?: boolean, includeCampaigns?: boolean }){
  const dir = taskTextDirection(task)
  const lines = splitTaskDescription(task?.description)
  const refs = Array.isArray(task?.campaign_references) && task.campaign_references.length
    ? task.campaign_references
    : (Array.isArray(task?.campaigns) ? task.campaigns.map((c:string)=> ({ name: c })) : [])
  const align = dir === 'rtl' ? 'text-right' : 'text-left'
  return (
    <div dir={dir} style={{ unicodeBidi: 'plaintext' }} className={`space-y-2 ${align}`}>
      {lines.map((line, idx) => {
        const part = taskLineParts(line, dir, idx)
        return (
          <div key={`${idx}-${line.slice(0,16)}`} className={`rounded-lg border px-2.5 py-2 ${isDone ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-slate-100'}`}>
            <div className="text-[10px] font-bold text-slate-400 mb-1">{part.label}</div>
            <div className={`${isDone ? 'text-emerald-700/70 line-through' : 'text-slate-700'} leading-relaxed whitespace-pre-wrap`}>{part.text}</div>
          </div>
        )
      })}
      {includeCampaigns && refs.length > 0 && (
        <div className={`rounded-lg border px-2.5 py-2 ${isDone ? 'bg-emerald-50/60 border-emerald-100' : 'bg-indigo-50/60 border-indigo-100'}`}>
          <div className="text-[10px] font-bold text-slate-400 mb-1">{dir === 'rtl' ? 'الحملات المرتبطة' : 'Referenced campaigns'}</div>
          <div className={`flex flex-wrap gap-1 ${dir === 'rtl' ? 'justify-end' : 'justify-start'}`}>
            {refs.map((ref:any, i:number) => {
              const label = String(ref?.name || ref || '').trim()
              const id = String(ref?.id || '').trim()
              return (
                <span key={`${label}-${id}-${i}`} dir="ltr" className="text-[10px] bg-white text-slate-600 px-2 py-0.5 rounded-full border border-slate-200 max-w-[220px] truncate" title={id ? `${label} (${id})` : label}>
                  {label || id}{id && label ? ` · ${id}` : ''}
                </span>
              )
            })}
          </div>
        </div>
      )}
      {task?.expected_impact && (
        <div className={`rounded-lg border px-2.5 py-2 ${isDone ? 'bg-emerald-50/60 border-emerald-100 text-emerald-700/70' : 'bg-violet-50/70 border-violet-100 text-violet-700'}`}>
          <div className="text-[10px] font-bold opacity-70 mb-1">{dir === 'rtl' ? 'السبب' : 'Why'}</div>
          <div className={`leading-relaxed ${isDone ? 'line-through' : ''}`}>{task.expected_impact}</div>
        </div>
      )}
    </div>
  )
}

// Timeline Modal
function TimelineModal({ open, onClose, campaign, meta, onAdd, adding, draft, setDraft, onViewAnalysis, onToggleTask }:{ open:boolean, onClose:()=>void, campaign:{id:string,name?:string}|null, meta?:{ timeline?: Array<{text:string, at:string}> }, onAdd:(text:string)=>Promise<void>, adding:boolean, draft:string, setDraft:(v:string)=>void, onViewAnalysis?:(data:any)=>void, onToggleTask?:(entryIdx:number, taskData:any)=>void }){
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({ analysis: true, tasks: true, notes: false })
  const [expandedTask, setExpandedTask] = useState<string|null>(null)
  const togglePanel = (key:string) => setOpenPanels(prev => ({ ...prev, [key]: !prev[key] }))
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
  // Try to parse structured entries from JSON text
  function parseStructured(text:string): { type:string, [k:string]:any } | null {
    try{
      const obj = JSON.parse(text)
      if(obj && obj.type) return obj
    }catch{}
    return null
  }
  const verdictColors: Record<string, string> = {
    'kill': 'from-rose-500 to-red-600',
    'optimize': 'from-amber-400 to-orange-500',
    'scale': 'from-emerald-400 to-green-500',
    'scale_aggressively': 'from-green-500 to-emerald-600',
  }
  const urgencyColors: Record<string, string> = {
    'critical': 'bg-rose-100 text-rose-700 border-rose-200',
    'high': 'bg-amber-100 text-amber-700 border-amber-200',
    'medium': 'bg-blue-100 text-blue-700 border-blue-200',
    'low': 'bg-slate-100 text-slate-600 border-slate-200',
  }
  const catIcons: Record<string, string> = {
    creative: '🎨', targeting: '🎯', budget: '💰', pricing: '💵',
    landing_page: '🌐', offer: '🎁', ad_copy: '✍️', product: '📦',
    scaling: '🚀', optimization: '⚡', kill: '🛑',
  }
  // Find original (unsorted) index for a sorted entry
  const originalTimeline = meta?.timeline || []
  function findOrigIndex(entry: {text:string, at:string}): number {
    return originalTimeline.findIndex(e => e.at === entry.at && e.text === entry.text)
  }
  const structuredEntries = entries.map((entry, idx) => ({ entry, idx, data: parseStructured(entry.text||''), origIdx: findOrigIndex(entry) }))
  const taskEntries = structuredEntries.filter(x => x.data?.type === 'task')
  const analysisEntries = structuredEntries.filter(x => x.data?.type === 'analysis')
  const noteEntries = structuredEntries.filter(x => !x.data)
  const incompleteTasks = taskEntries.filter(x => !x.data?.done).length
  const completedTasks = taskEntries.length - incompleteTasks
  const progressPct = taskEntries.length ? Math.round((completedTasks / taskEntries.length) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{animation:'perfFadeIn 0.2s ease-out'}}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gradient-to-b from-slate-50 to-white rounded-2xl shadow-2xl w-[94vw] max-w-2xl max-h-[92vh] overflow-auto border border-slate-200/60" style={{animation:'perfSlideUp 0.3s ease-out'}}>
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-4 rounded-t-2xl flex items-center justify-between relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(99,102,241,0.12),transparent_60%)]"/>
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg">
              <Clock className="w-5 h-5 text-white"/>
            </div>
            <div>
              <h2 className="text-white font-bold text-lg tracking-tight">Timeline</h2>
              <p className="text-white/50 text-xs">{campaign?.name||campaign?.id}</p>
            </div>
          </div>
          <div className="relative flex items-center gap-3">
            {taskEntries.length > 0 && (
              <div className="flex items-center gap-2">
                {incompleteTasks > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">{incompleteTasks} tasks pending</span>
                )}
                {completedTasks > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">{completedTasks} done</span>
                )}
              </div>
            )}
            <button onClick={onClose} className="text-white/60 hover:text-white w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors text-lg font-bold">✕</button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {taskEntries.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-slate-700">Task progress</span>
                <span className="font-bold text-slate-800">{completedTasks}/{taskEntries.length} done</span>
              </div>
              <div className="h-2 rounded-full bg-white border border-slate-200 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e)=> setDraft(e.target.value)}
              placeholder="Add a note…"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none transition-all"
              onKeyDown={(e)=>{ if(e.key==='Enter' && draft.trim()){ e.preventDefault(); onAdd(draft.trim()) }}}
            />
            <button
              onClick={async()=>{ if(draft.trim()){ await onAdd(draft.trim()) } }}
              disabled={adding || !draft.trim()}
              className="px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white text-sm font-semibold disabled:opacity-40 shadow-sm transition-all"
            >{adding? 'Adding…' : 'Add'}</button>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={()=>togglePanel('analysis')} className="w-full px-3 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-left">
                <span className="font-semibold text-sm text-slate-800">Full analysis</span>
                <span className="text-xs text-slate-500">{analysisEntries.length} saved {openPanels.analysis ? 'v' : '>'}</span>
              </button>
              {openPanels.analysis && (
                <div className="p-3 space-y-2">
                  {analysisEntries.length === 0 && <div className="text-sm text-slate-400">No analysis yet.</div>}
                  {analysisEntries.map(({ entry, data }, idx) => {
                    const vc = verdictColors[data?.verdict||''] || 'from-slate-400 to-slate-500'
                    return (
                      <div key={`${entry.at || ''}-analysis-${idx}`} className="border rounded-lg overflow-hidden">
                        <div className={`bg-gradient-to-r ${vc} px-3 py-2 text-white flex items-center justify-between`}>
                          <div className="font-semibold text-sm">{(data?.verdict||'Analysis').replace('_',' ')}</div>
                          <div className="text-[10px] opacity-80">{String(entry.at||'').replace('T',' ').replace('Z','').slice(0,16)}</div>
                        </div>
                        <div className="px-3 py-2 bg-white">
                          {data?.summary && <p className="text-xs text-slate-700 leading-relaxed">{data.summary}</p>}
                          {onViewAnalysis && data?.analysis && (
                            <button onClick={()=> onViewAnalysis(data.analysis)} className="mt-2 px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold">Open full analysis</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={()=>togglePanel('tasks')} className="w-full px-3 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-left">
                <span className="font-semibold text-sm text-slate-800">Tasks</span>
                <span className="text-xs text-slate-500">{completedTasks}/{taskEntries.length} done {openPanels.tasks ? 'v' : '>'}</span>
              </button>
              {openPanels.tasks && (
                <div className="p-3 space-y-2">
                  {taskEntries.length === 0 && <div className="text-sm text-slate-400">No tasks yet.</div>}
                  {taskEntries.map(({ entry, data, origIdx }, idx) => {
                    const task: any = data || {}
                    const isDone = !!task.done
                    const taskKey = String(task.id || `${entry.at}-${idx}`)
                    const expanded = expandedTask === taskKey
                    const dir = taskTextDirection(task)
                    return (
                      <div key={taskKey} className={`rounded-lg border p-3 ${isDone ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-start gap-2">
                          <button
                            onClick={()=> onToggleTask && onToggleTask(origIdx, task)}
                            className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${isDone ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 hover:border-emerald-500'}`}
                            title={isDone ? 'Mark as not done' : 'Mark as done'}
                          >
                            {isDone ? <span className="text-xs font-bold">✓</span> : null}
                          </button>
                          <button onClick={()=> setExpandedTask(expanded ? null : taskKey)} className={`flex-1 ${dir === 'rtl' ? 'text-right' : 'text-left'}`} dir={dir}>
                            <div className={`text-sm font-semibold ${isDone ? 'line-through text-emerald-700' : 'text-slate-800'}`} style={{ unicodeBidi: 'plaintext' }}>{task.title || 'Untitled task'}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">P{task.priority || '-'} · {task.category || 'task'} · {String(entry.at||'').replace('T',' ').replace('Z','').slice(0,16)}</div>
                          </button>
                        </div>
                        {expanded && (
                          <div className={`${dir === 'rtl' ? 'mr-7' : 'ml-7'} mt-2 rounded-lg bg-slate-50 border border-slate-100 p-2 text-xs text-slate-700 leading-relaxed`}>
                            <TaskDetailsBlock task={task} isDone={isDone} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {noteEntries.length > 0 && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={()=>togglePanel('notes')} className="w-full px-3 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-left">
                  <span className="font-semibold text-sm text-slate-800">Notes</span>
                  <span className="text-xs text-slate-500">{noteEntries.length} notes {openPanels.notes ? 'v' : '>'}</span>
                </button>
                {openPanels.notes && (
                  <div className="p-3 space-y-2">
                    {noteEntries.map(({ entry }, idx) => (
                      <div key={`${entry.at || ''}-note-${idx}`} className="rounded-lg border border-slate-200 p-3 bg-white">
                        <div className="text-xs text-slate-400 mb-1">{String(entry.at||'').replace('T',' ').replace('Z','').slice(0,16)}</div>
                        <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{entry.text||''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="hidden">
            {entries.map((e, idx)=> {
              const next = idx<entries.length-1? entries[idx+1] : undefined
              const structured = parseStructured(e.text||'')

              // Task entry
              if(structured && structured.type === 'task'){
                const isDone = !!structured.done
                const urgClass = urgencyColors[(structured.urgency||'').toLowerCase()] || urgencyColors.medium
                const catIcon = catIcons[(structured.category||'').toLowerCase()] || '📋'
                const origIdx = findOrigIndex(e)
                return (
                  <div key={String(e.at||'')+String(idx)} className={`rounded-xl border overflow-hidden transition-all ${isDone ? 'border-slate-200 bg-slate-50/50 opacity-75' : 'border-indigo-200/60 bg-white shadow-sm hover:shadow-md'}`}>
                    <div className="px-3 py-2.5 flex items-start gap-2.5">
                      {/* Checkbox */}
                      <button
                        onClick={()=> onToggleTask && onToggleTask(origIdx, structured)}
                        className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
                          isDone
                            ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-200'
                            : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'
                        }`}
                        title={isDone ? 'Mark as not done' : 'Mark as done'}
                      >
                        {isDone && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="text-sm">{catIcon}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${urgClass}`}>{structured.urgency||'medium'}</span>
                          {structured.priority && (
                            <span className="px-1 py-0.5 rounded bg-slate-100 text-[9px] text-slate-500 font-mono">P{structured.priority}</span>
                          )}
                          <span className="text-[9px] text-slate-400 ml-auto">{String(e.at||'').replace('T',' ').replace('Z','').slice(0,16)}</span>
                        </div>
                        <div className={`text-sm font-semibold ${isDone ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                          {structured.title||'Untitled task'}
                        </div>
                        {structured.description && (
                          <div className={`text-xs mt-0.5 ${isDone ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{structured.description}</div>
                        )}
                        {structured.expected_impact && (
                          <div className={`text-[10px] mt-1 italic ${isDone ? 'text-slate-400' : 'text-indigo-600'}`}>📈 {structured.expected_impact}</div>
                        )}
                        {isDone && structured.completed_at && (
                          <div className="text-[9px] text-emerald-500 mt-1 font-medium">✓ Completed {structured.completed_at}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              }

              // Analysis entry
              if(structured && structured.type === 'analysis'){
                const vc = verdictColors[structured.verdict||''] || 'from-slate-400 to-slate-500'
                return (
                  <div key={String(e.at||idx)} className="border rounded-xl overflow-hidden shadow-sm">
                    <div className={`bg-gradient-to-r ${vc} px-3 py-2 text-white flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">✨</span>
                        <span className="font-semibold text-sm">AI Analysis</span>
                        {structured.verdict && (
                          <span className="px-2 py-0.5 rounded-full bg-white/20 text-[11px] font-bold uppercase tracking-wider">{structured.verdict.replace('_',' ')}</span>
                        )}
                        {structured.age_days != null && (
                          <span className="px-1.5 py-0.5 rounded bg-white/20 text-[10px]">Day {structured.age_days}</span>
                        )}
                      </div>
                      <span className="text-[10px] opacity-80">{String(e.at||'').replace('T',' ').replace('Z','').slice(0,16)}</span>
                    </div>
                    <div className="px-3 py-2 bg-slate-50">
                      {structured.confidence && (
                        <div className="text-[10px] text-slate-500 mb-1">Confidence: <span className="font-semibold">{structured.confidence}</span></div>
                      )}
                      {structured.summary && (
                        <p className="text-xs text-slate-700 leading-relaxed">{structured.summary}</p>
                      )}
                      {onViewAnalysis && structured.analysis && (
                        <button
                          onClick={()=> onViewAnalysis(structured.analysis)}
                          className="mt-2 px-3 py-1 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white text-xs font-semibold shadow-sm"
                        >View Full Analysis</button>
                      )}
                    </div>
                  </div>
                )
              }

              // Regular text note
              return (
                <div key={String(e.at||idx)} className="rounded-xl border border-slate-200/60 p-3 bg-white hover:shadow-sm transition-shadow">
                  <div className="text-xs text-slate-400 flex items-center justify-between mb-1.5">
                    <span>{String(e.at||'').replace('T',' ').replace('Z','').slice(0,16)}</span>
                    <span className="font-mono text-[10px]">{fmtDelta(next?.at, e.at||'')}</span>
                  </div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{e.text||''}</div>
                </div>
              )
            })}
            {entries.length===0 && (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">📝</div>
                <div className="text-sm text-slate-500">No timeline entries yet.</div>
                <div className="text-xs text-slate-400 mt-1">Add notes, and AI analysis &amp; tasks will appear here.</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes perfFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes perfSlideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  )
}

// Performance Modal
function PerformanceModal({ open, onClose, loading, campaign, days, orders }:{ open:boolean, onClose:()=>void, loading:boolean, campaign:{id:string,name:string}|null, days:Array<{date:string,spend:number,purchases:number,cpp?:number|null,ctr?:number|null,add_to_cart:number}>, orders:number[] }){
  if(!open) return null
  const labels = (days||[]).map(d=> d.date)
  const spend = (days||[]).map(d=> d.spend||0)
  const atc = (days||[]).map(d=> d.add_to_cart||0)
  const ordersArr = (orders||[])
  const trueCpp = (days||[]).map((d,i)=> {
    const o = Number(ordersArr[i]||0)
    const s = Number(d.spend||0)
    return o>0? (s/o) : 0
  })
  const [showOrders, setShowOrders] = useState(true)
  const [showATC, setShowATC] = useState(true)
  // Totals for KPI summary
  const totalSpend = spend.reduce((a,b)=> a+b, 0)
  const totalOrders = ordersArr.reduce((a,b)=> a+b, 0)
  const totalATC = atc.reduce((a,b)=> a+b, 0)
  const totalPurchases = (days||[]).reduce((a,d)=> a+(d.purchases||0), 0)
  const avgTrueCpp = totalOrders>0? totalSpend/totalOrders : null
  const avgCtr = (()=>{ const ctrs = (days||[]).filter(d=> d.ctr!=null).map(d=> d.ctr||0); return ctrs.length>0? ctrs.reduce((a,b)=>a+b,0)/ctrs.length : null })()
  // Spend trend (last day vs first day)
  const spendTrend = spend.length>=2? (spend[spend.length-1] - spend[0]) : 0
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{animation:'perfFadeIn 0.2s ease-out'}}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gradient-to-b from-slate-50 to-white rounded-2xl shadow-2xl w-[94vw] max-w-5xl max-h-[92vh] overflow-auto border border-slate-200/60" style={{animation:'perfSlideUp 0.3s ease-out'}}>
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-4 rounded-t-2xl flex items-center justify-between relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(59,130,246,0.12),transparent_60%)]"/>
          <div className="relative flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <BarChart3 className="w-5 h-5 text-white"/>
            </div>
            <div>
              <h2 className="text-white font-bold text-lg tracking-tight">Performance</h2>
              <p className="text-white/50 text-xs">{campaign?.name||campaign?.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="relative text-white/60 hover:text-white w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors text-lg font-bold">✕</button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1,2,3,4].map(i=> <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse"/>)}
              </div>
              <div className="h-72 rounded-xl bg-slate-100 animate-pulse"/>
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(i=> <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse"/>)}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* KPI Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/60 p-4">
                  <div className="text-xs text-emerald-600 font-medium mb-1">Total Spend</div>
                  <div className="text-2xl font-bold text-emerald-800">${totalSpend.toFixed(2)}</div>
                  <div className={`text-[10px] mt-1 font-semibold ${spendTrend<=0?'text-emerald-600':'text-rose-500'}`}>
                    {spendTrend<=0?'↓':'↑'} ${Math.abs(spendTrend).toFixed(2)} trend
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/60 p-4">
                  <div className="text-xs text-blue-600 font-medium mb-1">Shopify Orders</div>
                  <div className="text-2xl font-bold text-blue-800">{totalOrders}</div>
                  <div className="text-[10px] mt-1 text-blue-500 font-semibold">{(days||[]).length} days tracked</div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-violet-50 to-violet-100/50 border border-violet-200/60 p-4">
                  <div className="text-xs text-violet-600 font-medium mb-1">True CPP</div>
                  <div className="text-2xl font-bold text-violet-800">{avgTrueCpp!=null? `$${avgTrueCpp.toFixed(2)}` : '—'}</div>
                  <div className="text-[10px] mt-1 text-violet-500 font-semibold">avg cost/order</div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/60 p-4">
                  <div className="text-xs text-amber-600 font-medium mb-1">Add to Cart</div>
                  <div className="text-2xl font-bold text-amber-800">{totalATC}</div>
                  <div className="text-[10px] mt-1 text-amber-500 font-semibold">
                    {avgCtr!=null? `${(avgCtr*1).toFixed(2)}% avg CTR` : ''}
                  </div>
                </div>
              </div>
              {/* Toggle Pills */}
              <div className="flex items-center gap-2">
                <button
                  onClick={()=> setShowOrders(!showOrders)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    showOrders ? 'bg-blue-600 text-white shadow-sm shadow-blue-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${showOrders?'bg-white':'bg-blue-400'}`}/>
                  Orders
                </button>
                <button
                  onClick={()=> setShowATC(!showATC)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    showATC ? 'bg-amber-500 text-white shadow-sm shadow-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${showATC?'bg-white':'bg-amber-400'}`}/>
                  Add to Cart
                </button>
              </div>
              {/* Chart */}
              <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <PerformanceChart labels={labels} spend={spend} trueCpp={trueCpp} orders={ordersArr} addToCart={atc} showOrders={showOrders} showATC={showATC} />
              </div>
              {/* Day-by-day detail cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {(days||[]).map((d,i)=> {
                  const dayTcpp = (ordersArr[i]||0)>0? ((d.spend||0)/(ordersArr[i]||1)) : null
                  const dayTcppColor = dayTcpp==null? 'text-slate-400' : dayTcpp<2? 'text-emerald-600' : dayTcpp<3? 'text-amber-600' : 'text-rose-600'
                  return (
                    <div key={d.date+String(i)} className="rounded-xl border border-slate-200/60 bg-gradient-to-b from-white to-slate-50/50 p-3 hover:shadow-md transition-shadow">
                      <div className="text-[11px] font-semibold text-slate-800 mb-2 pb-1 border-b border-slate-100">{d.date}</div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Spend</span><span className="font-bold text-emerald-700">${(d.spend||0).toFixed(2)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Purchases</span><span className="font-bold">{d.purchases||0}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">CPP</span><span className="font-bold">{d.cpp!=null? `$${(d.cpp||0).toFixed(2)}` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">CTR</span><span className="font-bold">{d.ctr!=null? `${(d.ctr*1).toFixed(2)}%` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">ATC</span><span className="font-bold text-amber-700">{d.add_to_cart||0}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Orders</span><span className="font-bold text-blue-700">{(ordersArr[i]||0)}</span></div>
                        <div className="flex justify-between border-t border-slate-100 pt-1 mt-1"><span className="text-slate-500 font-medium">True CPP</span><span className={`font-bold ${dayTcppColor}`}>{dayTcpp!=null? `$${dayTcpp.toFixed(2)}` : '—'}</span></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <style jsx>{`
        @keyframes perfFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes perfSlideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
    </div>
  )
}

function PerformanceChart({ labels, spend, trueCpp, orders, addToCart, showOrders, showATC }:{ labels:string[], spend:number[], trueCpp:number[], orders:number[], addToCart:number[], showOrders:boolean, showATC:boolean }){
  const [hoverIdx, setHoverIdx] = useState<number|null>(null)
  const TARGET_CPP = 2
  const w = 1000, h = 360, padL = 60, padR = 60, padT = 50, padB = 50
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = Math.max(1, labels.length)
  const xs = labels.map((_, i)=> padL + (i*(innerW))/Math.max(1, n-1))
  // Left axis: CPP-focused, centered around $2 target
  const maxCpp = Math.max(TARGET_CPP * 2, ...trueCpp.map(v=>Number(v||0)))
  const maxLeft = Math.max(4, Math.ceil(maxCpp * 1.2))
  // Right axis: Orders/ATC
  const maxDataRight = Math.max(1, ...orders.map(v=>Number(v||0)), ...addToCart.map(v=>Number(v||0)))
  const maxRight = Math.max(5, Math.ceil(maxDataRight * 1.15 / 5) * 5)
  const yLeft = (v:number)=> padT + innerH - (Math.max(0, Math.min(v, maxLeft))/maxLeft)*innerH
  const yRight = (v:number)=> padT + innerH - (Math.max(0, Math.min(v, maxRight))/maxRight)*innerH
  const leftTicks = Array.from({length:5}, (_,i)=> Number(((i/4)*maxLeft).toFixed(1)))
  const rightTicks = Array.from({length:5}, (_,i)=> Math.round((i/4)*maxRight))
  // Spend scale for background bars
  const maxSpend = Math.max(1, ...spend.map(v=>Number(v||0)))
  // Smooth curve helper (monotone cubic)
  function smoothPath(pts: [number,number][]): string {
    if(pts.length<2) return pts.length===1? `M ${pts[0][0]},${pts[0][1]}` : ''
    let d = `M ${pts[0][0]},${pts[0][1]}`
    for(let i=0;i<pts.length-1;i++){
      const x0=pts[i][0],y0=pts[i][1],x1=pts[i+1][0],y1=pts[i+1][1]
      const cx=(x0+x1)/2
      d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`
    }
    return d
  }
  // Build smooth paths
  const tcppPts: [number,number][] = xs.map((x,i)=> [x, yLeft(trueCpp[i]||0)])
  const ordersPts: [number,number][] = xs.map((x,i)=> [x, yRight(orders[i]||0)])
  const atcPts: [number,number][] = xs.map((x,i)=> [x, yRight(addToCart[i]||0)])
  const pathOrders = smoothPath(ordersPts)
  const pathATC = smoothPath(atcPts)
  const btm = padT + innerH
  const targetY = yLeft(TARGET_CPP)
  const uid = useRef(Math.random().toString(36).slice(2,8))
  // 3-tier CPP color: <$2 green, $2-$3 amber, >$3 red
  function cppColor(v: number): string { return v < 2 ? '#10b981' : v < 3 ? '#f59e0b' : '#ef4444' }
  function cppGradKey(v: number): string { return v < 2 ? 'cppGreen' : v < 3 ? 'cppAmber' : 'cppRed' }
  // Build segmented CPP line + area
  const cppSegments: Array<{path:string, areaPath:string, color:string, gradKey:string}> = []
  for(let i=0;i<tcppPts.length-1;i++){
    const [x0,y0] = tcppPts[i]
    const [x1,y1] = tcppPts[i+1]
    const v0 = trueCpp[i]||0, v1 = trueCpp[i+1]||0
    const avg = (v0+v1)/2
    const color = cppColor(avg)
    const gk = cppGradKey(avg)
    const cx = (x0+x1)/2
    const seg = `M ${x0},${y0} C ${cx},${y0} ${cx},${y1} ${x1},${y1}`
    const area = `${seg} L ${x1},${btm} L ${x0},${btm} Z`
    cppSegments.push({ path: seg, areaPath: area, color, gradKey: gk })
  }
  const barW = Math.max(8, Math.min(60, innerW / Math.max(1, n) * 0.5))
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto select-none" onMouseLeave={()=> setHoverIdx(null)}>
      <defs>
        <linearGradient id={`ordG_${uid.current}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02"/>
        </linearGradient>
        <linearGradient id={`atcG_${uid.current}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.12"/>
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02"/>
        </linearGradient>
        <linearGradient id={`cppGreen_${uid.current}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.03"/>
        </linearGradient>
        <linearGradient id={`cppAmber_${uid.current}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.03"/>
        </linearGradient>
        <linearGradient id={`cppRed_${uid.current}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.18"/>
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.03"/>
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={w} height={h} rx={12} fill="#fafbfc"/>
      {/* Subtle horizontal gridlines */}
      {leftTicks.map((tick,i)=> (
        <line key={`h${i}`} x1={padL} y1={yLeft(tick)} x2={w-padR} y2={yLeft(tick)} stroke="#f1f5f9" strokeWidth={0.8}/>
      ))}
      {/* Budget/Spend background bars — very faint */}
      {xs.map((x,i)=> {
        const barH = (Number(spend[i]||0) / maxSpend) * (innerH * 0.85)
        return <rect key={`sb${i}`} x={x - barW/2} y={btm - barH} width={barW} height={barH} rx={4} fill="#e2e8f0" opacity={0.35}/>
      })}
      {xs.map((x,i)=> {
        const val = spend[i]||0
        if(val <= 0) return null
        const barH = (val / maxSpend) * (innerH * 0.85)
        return <text key={`sl${i}`} x={x} y={btm - barH - 4} textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="500">${val.toFixed(0)}</text>
      })}
      {/* $2 Target line */}
      <line x1={padL} y1={targetY} x2={w-padR} y2={targetY} stroke="#64748b" strokeWidth={1.5} strokeDasharray="8 4" opacity={0.6}/>
      <rect x={w-padR+4} y={targetY-10} width={50} height={20} rx={4} fill="#f1f5f9" stroke="#e2e8f0" strokeWidth={0.5}/>
      <text x={w-padR+8} y={targetY+4} fontSize="10" fontWeight="700" fill="#475569">$2 avg</text>
      {/* Green/Amber/Red zone subtle fills */}
      <rect x={padL} y={targetY} width={innerW} height={btm - targetY} rx={0} fill="#10b981" opacity={0.03}/>
      <rect x={padL} y={yLeft(3)} width={innerW} height={targetY - yLeft(3)} rx={0} fill="#f59e0b" opacity={0.03}/>
      <rect x={padL} y={padT} width={innerW} height={yLeft(3) - padT} rx={0} fill="#ef4444" opacity={0.03}/>
      {/* CPP colored segments */}
      {cppSegments.map((seg,i)=> (
        <g key={`cpps${i}`}>
          <path d={seg.areaPath} fill={`url(#${seg.gradKey}_${uid.current})`}/>
          <path d={seg.path} fill="none" stroke={seg.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
        </g>
      ))}
      {showOrders && <>
        <path d={smoothPath(ordersPts) + ` L ${ordersPts[ordersPts.length-1]?.[0]||0},${btm} L ${ordersPts[0]?.[0]||0},${btm} Z`} fill={`url(#ordG_${uid.current})`}/>
        <path d={pathOrders} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.7}/>
      </>}
      {showATC && <>
        <path d={smoothPath(atcPts) + ` L ${atcPts[atcPts.length-1]?.[0]||0},${btm} L ${atcPts[0]?.[0]||0},${btm} Z`} fill={`url(#atcG_${uid.current})`}/>
        <path d={pathATC} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.7}/>
      </>}
      {/* Data points */}
      {xs.map((x,i)=> {
        const cppVal = trueCpp[i]||0
        const dotColor = cppColor(cppVal)
        return (
          <g key={`dp${i}`}>
            <circle cx={x} cy={yLeft(cppVal)} r={hoverIdx===i?6:4} fill={dotColor} stroke="white" strokeWidth={2.5} className="transition-all duration-150"/>
            {showOrders && <circle cx={x} cy={yRight(orders[i]||0)} r={hoverIdx===i?4:2.5} fill="#3b82f6" stroke="white" strokeWidth={1.5} opacity={0.7} className="transition-all duration-150"/>}
            {showATC && <circle cx={x} cy={yRight(addToCart[i]||0)} r={hoverIdx===i?4:2.5} fill="#f59e0b" stroke="white" strokeWidth={1.5} opacity={0.7} className="transition-all duration-150"/>}
          </g>
        )
      })}
      {/* CPP value labels */}
      {xs.map((x,i)=> {
        const cppVal = trueCpp[i]||0
        if(cppVal <= 0) return null
        const dotColor = cppColor(cppVal)
        return <text key={`cl${i}`} x={x} y={yLeft(cppVal)-10} textAnchor="middle" fontSize="10" fontWeight="700" fill={dotColor}>${cppVal.toFixed(2)}</text>
      })}
      {/* Left axis labels */}
      {leftTicks.map((tick,i)=> (
        <text key={`lt${i}`} x={padL-10} y={yLeft(tick)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#94a3b8" fontWeight="500">${tick}</text>
      ))}
      {rightTicks.map((tick,i)=> (
        <text key={`rt${i}`} x={w-padR+10} y={yRight(tick)} textAnchor="start" dominantBaseline="middle" fontSize="10" fill="#94a3b8" fontWeight="500">{tick}</text>
      ))}
      <text x={padL-10} y={padT-14} textAnchor="end" fontSize="9" fill="#94a3b8" fontWeight="600">True CPP $</text>
      <text x={w-padR+10} y={padT-14} textAnchor="start" fontSize="9" fill="#94a3b8" fontWeight="600">Count</text>
      {xs.map((x,i)=> (
        <text key={`x${i}`} x={x} y={h-14} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="500">{labels[i]?.slice(5)||''}</text>
      ))}
      {/* Hover zones */}
      {xs.map((x,i)=> {
        const colW = innerW / Math.max(1, n-1)
        return <rect key={`hz${i}`} x={x-colW/2} y={padT} width={colW} height={innerH} fill="transparent" onMouseEnter={()=> setHoverIdx(i)} onMouseMove={()=> setHoverIdx(i)}/>
      })}
      {hoverIdx!=null && <line x1={xs[hoverIdx]} y1={padT} x2={xs[hoverIdx]} y2={h-padB} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 2"/>}
      {hoverIdx!=null && (()=>{
        const tx = xs[hoverIdx]; const i = hoverIdx
        const ttW = 160, ttH = 120
        const ttX = (tx + ttW + 20 > w)? tx - ttW - 12 : tx + 12
        const ttY = Math.max(padT, Math.min(h - padB - ttH - 10, padT + 20))
        const cppVal = trueCpp[i]||0
        const cppClr = cppColor(cppVal)
        return (
          <g>
            <rect x={ttX} y={ttY} width={ttW} height={ttH} rx={10} fill="white" stroke="#e2e8f0" strokeWidth={1} filter="drop-shadow(0 4px 12px rgba(0,0,0,0.08))"/>
            <text x={ttX+12} y={ttY+18} fontSize="11" fontWeight="700" fill="#1e293b">{labels[i]||''}</text>
            <line x1={ttX+12} y1={ttY+24} x2={ttX+ttW-12} y2={ttY+24} stroke="#f1f5f9" strokeWidth={1}/>
            <circle cx={ttX+16} cy={ttY+38} r={4} fill={cppClr}/><text x={ttX+26} y={ttY+42} fontSize="10" fill="#64748b">True CPP</text><text x={ttX+ttW-12} y={ttY+42} textAnchor="end" fontSize="10" fontWeight="700" fill={cppClr}>{cppVal>0?`$${cppVal.toFixed(2)}`:'—'}</text>
            <circle cx={ttX+16} cy={ttY+56} r={4} fill="#94a3b8"/><text x={ttX+26} y={ttY+60} fontSize="10" fill="#64748b">Spend</text><text x={ttX+ttW-12} y={ttY+60} textAnchor="end" fontSize="10" fontWeight="600" fill="#94a3b8">${(spend[i]||0).toFixed(2)}</text>
            <circle cx={ttX+16} cy={ttY+74} r={4} fill="#3b82f6"/><text x={ttX+26} y={ttY+78} fontSize="10" fill="#64748b">Orders</text><text x={ttX+ttW-12} y={ttY+78} textAnchor="end" fontSize="10" fontWeight="700" fill="#3b82f6">{orders[i]||0}</text>
            <circle cx={ttX+16} cy={ttY+92} r={4} fill="#f59e0b"/><text x={ttX+26} y={ttY+96} fontSize="10" fill="#64748b">ATC</text><text x={ttX+ttW-12} y={ttY+96} textAnchor="end" fontSize="10" fontWeight="700" fill="#f59e0b">{addToCart[i]||0}</text>
          </g>
        )
      })()}
      <g>
        {[
          { color: '#10b981', label: 'CPP < $2', x: padL },
          { color: '#f59e0b', label: 'CPP $2-$3', x: padL + 90 },
          { color: '#ef4444', label: 'CPP > $3', x: padL + 190 },
          { color: '#e2e8f0', label: 'Budget', x: padL + 280 },
          { color: '#3b82f6', label: 'Orders', x: padL + 360 },
          { color: '#f59e0b', label: 'ATC', x: padL + 440 },
        ].map(leg=> (
          <g key={leg.label}>
            <circle cx={leg.x} cy={14} r={4} fill={leg.color}/>
            <text x={leg.x+10} y={17} fontSize="11" fill="#475569" fontWeight="500">{leg.label}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}


function TasksPopup({ open, onClose, tasks, summary, onToggleTask, onClearAll }:{
  open: boolean,
  onClose: ()=>void,
  tasks: ActionTask[],
  summary: string,
  onToggleTask: (taskId: string)=>void,
  onClearAll: ()=>void,
}){
  const [filter, setFilter] = useState<'all'|'urgent'|'done'>('all')

  if(!open) return null

  const filtered = tasks.filter(t => {
    if(filter === 'urgent') return !t.done && (t.priority <= 2 || t.urgency === 'immediate' || t.urgency === 'today')
    if(filter === 'done') return t.done
    return true
  })
  const doneCount = tasks.filter(t => t.done).length
  const totalCount = tasks.length
  const urgentCount = tasks.filter(t => !t.done && t.priority <= 2).length
  const pct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0

  const urgencyColors: Record<string,string> = {
    immediate: 'bg-rose-100 text-rose-700 border-rose-200',
    today: 'bg-amber-100 text-amber-700 border-amber-200',
    this_week: 'bg-blue-100 text-blue-700 border-blue-200',
    when_possible: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  const urgencyLabels: Record<string,string> = {
    immediate: '🔴 Immediate',
    today: '🟡 Today',
    this_week: '🔵 This week',
    when_possible: '⚪ When possible',
  }
  const catIcons: Record<string,string> = {
    kill: '🛑', scale: '🚀', creative: '🎨', budget: '💰',
    targeting: '🎯', inventory: '📦', pricing: '💵',
    optimization: '⚡', testing: '🧪',
  }
  const catColors: Record<string,string> = {
    kill: 'bg-rose-500', scale: 'bg-emerald-500', creative: 'bg-pink-500',
    budget: 'bg-amber-500', targeting: 'bg-blue-500', inventory: 'bg-indigo-500',
    pricing: 'bg-teal-500', optimization: 'bg-violet-500', testing: 'bg-cyan-500',
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white/95 backdrop-blur-xl shadow-2xl w-full max-w-lg h-full overflow-hidden flex flex-col border-l border-slate-200"
        style={{ animation: 'slideInRight 0.3s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-5 py-4 text-white relative overflow-hidden flex-shrink-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(139,92,246,0.15),transparent_60%)]"/>
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight">Action Tasks</h2>
                <div className="text-[11px] text-white/60">{totalCount} tasks · {doneCount} completed</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {urgentCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 text-[11px] font-bold animate-pulse">
                  {urgentCount} urgent
                </span>
              )}
              <button onClick={onClose} className="text-white/60 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-lg font-bold">✕</button>
            </div>
          </div>
          {/* Progress bar */}
          {totalCount > 0 && (
            <div className="relative mt-3 flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${pct >= 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-300' : 'bg-gradient-to-r from-violet-400 to-fuchsia-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`text-xs font-bold ${pct >= 100 ? 'text-emerald-300' : 'text-white/70'}`}>
                {pct >= 100 ? '✓ All done!' : `${Math.round(pct)}%`}
              </span>
            </div>
          )}
        </div>

        {/* Summary */}
        {summary && (
          <div className="px-5 py-3 bg-gradient-to-r from-violet-50 to-fuchsia-50 border-b border-violet-100 flex-shrink-0">
            <p className="text-xs text-violet-800 leading-relaxed">{summary}</p>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          {([
            { key: 'all' as const, label: 'All', count: totalCount },
            { key: 'urgent' as const, label: '🔴 Urgent', count: urgentCount },
            { key: 'done' as const, label: '✅ Done', count: doneCount },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === tab.key
                  ? 'bg-white text-slate-800 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
              }`}
            >
              {tab.label} <span className="text-[10px] opacity-60">({tab.count})</span>
            </button>
          ))}
          <div className="flex-1"/>
          {totalCount > 0 && (
            <button
              onClick={onClearAll}
              className="text-[10px] text-slate-400 hover:text-rose-500 font-medium transition-colors"
            >Clear all</button>
          )}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {filtered.length === 0 && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">{filter === 'done' ? '🎯' : filter === 'urgent' ? '🎉' : '📋'}</div>
              <div className="text-sm text-slate-500 font-medium">
                {filter === 'done' ? 'No completed tasks yet' : filter === 'urgent' ? 'No urgent tasks — great job!' : 'No tasks yet. Analyze campaigns to generate tasks.'}
              </div>
            </div>
          )}
          {filtered.map(task => {
            const isDone = task.done
            const dir = taskTextDirection(task)
            return (
              <div
                key={task.id}
                className={`group rounded-xl border p-3.5 transition-all duration-300 hover:shadow-md ${
                  isDone
                    ? 'bg-emerald-50/60 border-emerald-200/60 opacity-70'
                    : task.priority <= 2
                      ? 'bg-white border-rose-200 shadow-sm shadow-rose-100/50'
                      : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => onToggleTask(task.id)}
                    className={`flex-shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-300 mt-0.5 ${
                      isDone
                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-200'
                        : 'border-slate-300 hover:border-violet-400 hover:bg-violet-50 group-hover:border-violet-400'
                    }`}
                  >
                    {isDone && (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Top line: priority + category + urgency */}
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-black text-white ${
                        task.priority <= 1 ? 'bg-rose-500' : task.priority <= 2 ? 'bg-amber-500' : task.priority <= 3 ? 'bg-blue-500' : 'bg-slate-400'
                      }`}>P{task.priority}</span>
                      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${catColors[task.category] || 'bg-slate-500'}`}>
                        {catIcons[task.category] || '📌'} {task.category?.replace('_',' ')}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${urgencyColors[task.urgency] || urgencyColors.when_possible}`}>
                        {urgencyLabels[task.urgency] || task.urgency}
                      </span>
                    </div>

                    {/* Title */}
                    <div dir={dir} style={{ unicodeBidi: 'plaintext' }} className={`text-sm font-semibold leading-snug mb-2 ${dir === 'rtl' ? 'text-right' : 'text-left'} ${isDone ? 'line-through text-emerald-700' : 'text-slate-800'}`}>
                      {task.title}
                    </div>

                    {/* Description */}
                    <div className="text-xs mb-2">
                      <TaskDetailsBlock task={task} isDone={isDone} includeCampaigns={false} />
                    </div>

                    {/* Campaigns tags + impact */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {(task.campaigns||[]).slice(0, 3).map((c, i) => (
                        <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium truncate max-w-[140px]" title={c}>{c}</span>
                      ))}
                      {(task.campaigns||[]).length > 3 && (
                        <span className="text-[10px] text-slate-400">+{task.campaigns.length - 3} more</span>
                      )}
                    </div>
                    {task.expected_impact && (
                      <div className={`mt-1.5 text-[11px] italic ${isDone ? 'text-emerald-500/60' : 'text-violet-600'}`}>
                        📈 {task.expected_impact}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
// -------- AI Campaign Analysis Modal --------
function AnalysisModal({ open, onClose, result, checks, onCheckChange, saving, onSave, campaignKey }:{
  open:boolean,
  onClose:()=>void,
  result:CampaignAnalysisResult|null,
  checks: Record<string, boolean>,
  onCheckChange: (key: string, val: boolean) => void,
  saving: boolean,
  onSave: () => void,
  campaignKey: string|null,
}){
  const [openSections, setOpenSections] = useState<Record<string,boolean>>({ recommendations: true, scaling: true })
  const toggle = (key:string) => setOpenSections(p => ({ ...p, [key]: !p[key] }))

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
  const verdictBg: Record<string,string> = {
    kill: 'bg-rose-500',
    optimize: 'bg-amber-500',
    scale: 'bg-emerald-500',
    scale_aggressively: 'bg-teal-500',
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
  const lpd = result.landing_page_diagnosis||{}

  // Compute total checkable items and checked count
  const checkableKeys: string[] = []
  ;(result.recommendations||[]).forEach((_: any,i: number) => checkableKeys.push(`rec_${i}`))
  ;(sp.next_steps||[]).forEach((_: any,i: number) => checkableKeys.push(`step_${i}`))
  ;(ca.suggested_headlines||[]).forEach((_: any,i: number) => checkableKeys.push(`headline_${i}`))
  ;(cu.gaps||[]).forEach((_: any,i: number) => checkableKeys.push(`gap_${i}`))
  ;(cu.opportunities||[]).forEach((_: any,i: number) => checkableKeys.push(`opp_${i}`))
  const checkedCount = checkableKeys.filter(k => !!checks[k]).length
  const totalCheckable = checkableKeys.length

  // Checkmark component
  const CheckBox = ({ checkKey }: { checkKey: string }) => {
    const checked = !!checks[checkKey]
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onCheckChange(checkKey, !checked) }}
        className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
          checked
            ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-200'
            : 'border-slate-300 hover:border-emerald-400 hover:bg-emerald-50'
        }`}
        title={checked ? 'Mark as not done' : 'Mark as done'}
      >
        {checked && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        )}
      </button>
    )
  }

  // Score ring component
  const ScoreRing = ({ score, max=10, size=40, label }:{ score:number, max?:number, size?:number, label?:string }) => {
    const pct = Math.min(100, (score/max)*100)
    const color = score >= 7 ? '#10b981' : score >= 4 ? '#f59e0b' : '#ef4444'
    const r = (size-6)/2
    const circ = 2*Math.PI*r
    const offset = circ - (pct/100)*circ
    return (
      <div className="flex flex-col items-center gap-1">
        <svg width={size} height={size} className="transform -rotate-90">
          <circle cx={size/2} cy={size/2} r={r} stroke="#e5e7eb" strokeWidth={4} fill="none"/>
          <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={4} fill="none"
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition:'stroke-dashoffset 0.6s ease' }}/>
        </svg>
        <div className="absolute flex items-center justify-center" style={{ width:size, height:size }}>
          <span className="text-xs font-bold" style={{ color }}>{score}</span>
        </div>
        {label && <span className="text-[9px] text-slate-500 font-medium">{label}</span>}
      </div>
    )
  }

  // Section accordion
  const Section = ({ id, icon, title, badge, children, defaultOpen }:{ id:string, icon:string, title:string, badge?:React.ReactNode, children:React.ReactNode, defaultOpen?:boolean }) => {
    const isOpen = openSections[id] ?? (defaultOpen || false)
    return (
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <button
          onClick={() => toggle(id)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors group"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{icon}</span>
            <span className="text-sm font-semibold text-slate-800">{title}</span>
            {badge}
          </div>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        {isOpen && (
          <div className="px-4 pb-4 border-t border-slate-100">
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden" onClick={e=> e.stopPropagation()}>

        {/* ── Header with verdict ── */}
        <div className={`bg-gradient-to-r ${verdictColors[ov]||'from-slate-500 to-slate-600'} px-6 py-5 text-white relative overflow-hidden`}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.1),transparent_70%)]"/>
          <div className="relative flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold tracking-tight">{verdictLabels[ov]||ov}</div>
                {result.confidence_level && (
                  <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-[11px] font-semibold backdrop-blur-sm">{result.confidence_level}</span>
                )}
                {totalCheckable > 0 && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold backdrop-blur-sm ${
                    checkedCount === totalCheckable ? 'bg-emerald-400/30 text-emerald-100' :
                    checkedCount > 0 ? 'bg-white/20 text-white' : 'bg-white/10 text-white/70'
                  }`}>
                    {checkedCount === totalCheckable ? '✓ All done' : `${checkedCount}/${totalCheckable} done`}
                  </span>
                )}
              </div>
              {result.summary && <p className="mt-2.5 text-sm text-white/90 leading-relaxed max-w-xl">{result.summary}</p>}
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white text-xl font-bold w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors flex-shrink-0 ml-4">✕</button>
          </div>

          {/* Quick stats strip */}
          {result.meta_inputs && (
            <div className="relative mt-4 flex items-center gap-4 text-[11px] text-white/70">
              {result.meta_inputs.spend != null && <span>💵 Spend: <b className="text-white">${Number(result.meta_inputs.spend).toFixed(2)}</b></span>}
              {result.meta_inputs.purchases != null && <span>🛒 Purchases: <b className="text-white">{result.meta_inputs.purchases}</b></span>}
              {result.meta_inputs.ctr != null && <span>👆 CTR: <b className="text-white">{Number(result.meta_inputs.ctr).toFixed(2)}%</b></span>}
              {result.meta_inputs.cpp != null && <span>💰 CPP: <b className="text-white">${Number(result.meta_inputs.cpp).toFixed(2)}</b></span>}
              {result.meta_inputs.campaign_age_days != null && <span>📅 Day <b className="text-white">{result.meta_inputs.campaign_age_days}</b></span>}
            </div>
          )}
        </div>

        {/* ── Body: collapsible sections ── */}
        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto bg-slate-50/50">

          {/* Scaling Plan — always first and prominent */}
          {sp && (sp.verdict || sp.next_steps) && (
            <Section id="scaling" icon="🗺️" title={`Scaling Plan — ${sp.current_phase?.replace('_',' ')||'N/A'}`}
              badge={<span className={`px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${verdictBg[ov]||'bg-slate-500'}`}>{ov.replace('_',' ').toUpperCase()}</span>}
            >
              <div className="mt-3 space-y-3">
                {sp.verdict && <p className="text-sm text-slate-700 leading-relaxed bg-white rounded-lg p-3 border border-slate-100">{sp.verdict}</p>}
                {sp.next_steps && sp.next_steps.length>0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-2">Next Steps:</div>
                    <div className="space-y-1.5">
                      {sp.next_steps.map((s,i)=> {
                        const ck = `step_${i}`
                        const done = !!checks[ck]
                        return (
                          <div key={i} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 border transition-all duration-200 ${
                            done ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-100'
                          }`}>
                            <CheckBox checkKey={ck} />
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">{i+1}</span>
                            <span className={`text-xs leading-relaxed ${done ? 'text-emerald-700 line-through opacity-70' : 'text-slate-700'}`}>{s}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="flex gap-4">
                  {sp.budget_recommendation && (
                    <div className="flex-1 bg-white rounded-lg p-3 border border-slate-100">
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">💰 Budget</div>
                      <div className="text-xs text-slate-800">{sp.budget_recommendation}</div>
                    </div>
                  )}
                  {sp.timeline && (
                    <div className="flex-1 bg-white rounded-lg p-3 border border-slate-100">
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">⏱ Timeline</div>
                      <div className="text-xs text-slate-800">{sp.timeline}</div>
                    </div>
                  )}
                </div>
              </div>
            </Section>
          )}

          {/* Landing Page Diagnosis */}
          {lpd && (lpd.primary_issue || (lpd.evidence && lpd.evidence.length>0)) && (
            <Section id="landing_diagnosis" icon="LP" title="Landing Page Diagnosis"
              badge={lpd.primary_issue ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 ml-2">{String(lpd.primary_issue).replace(/_/g,' ')}</span> : undefined}
            >
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {lpd.primary_issue && (
                    <div className="bg-white rounded-lg p-3 border border-slate-100">
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Primary issue</div>
                      <div className="text-xs text-slate-800 capitalize">{String(lpd.primary_issue).replace(/_/g,' ')}</div>
                    </div>
                  )}
                  {lpd.confidence && (
                    <div className="bg-white rounded-lg p-3 border border-slate-100">
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Confidence</div>
                      <div className="text-xs text-slate-800 capitalize">{lpd.confidence}</div>
                    </div>
                  )}
                </div>
                {lpd.evidence && lpd.evidence.length>0 && (
                  <div className="bg-white rounded-lg p-3 border border-slate-100">
                    <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Evidence</div>
                    <div className="space-y-1.5">{lpd.evidence.map((e:string,i:number) => <div key={i} className="text-xs text-slate-700 leading-relaxed">- {e}</div>)}</div>
                  </div>
                )}
                {lpd.recommended_fixes && lpd.recommended_fixes.length>0 && (
                  <div className="bg-indigo-50/60 rounded-lg p-3 border border-indigo-100">
                    <div className="text-[10px] text-indigo-600 font-semibold uppercase tracking-wider mb-2">Recommended fixes</div>
                    <div className="space-y-1.5">{lpd.recommended_fixes.map((f:string,i:number) => <div key={i} className="text-xs text-indigo-800 leading-relaxed">- {f}</div>)}</div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Recommendations */}
          {result.recommendations && result.recommendations.length>0 && (
            <Section id="recommendations" icon="📋" title="Recommendations"
              badge={
                <span className="text-[10px] text-slate-400 font-normal ml-1">
                  {result.recommendations.length} items · {result.recommendations.filter((_: any,i: number)=> !!checks[`rec_${i}`]).length} done
                </span>
              }
            >
              <div className="mt-3 space-y-2">
                {result.recommendations.map((r,i)=> {
                  const ck = `rec_${i}`
                  const done = !!checks[ck]
                  return (
                    <div key={i} className={`border rounded-xl p-3 transition-all duration-200 hover:shadow-sm ${
                      done
                        ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                        : (catColors[r.category]||'bg-slate-50 border-slate-200 text-slate-800')
                    }`}>
                      <div className="flex items-start gap-2.5">
                        <CheckBox checkKey={ck} />
                        <span className="text-base flex-shrink-0">{catIcons[r.category]||'📌'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/70 text-[10px] font-bold border shadow-sm">P{r.priority}</span>
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">{r.category.replace('_',' ')}</span>
                            {done && <span className="text-[10px] text-emerald-600 font-semibold">✓ Implemented</span>}
                          </div>
                          <div className={`bg-white/50 rounded-lg p-2.5 space-y-1.5 ${done ? 'opacity-70' : ''}`}>
                            <p className="text-xs leading-relaxed"><span className="font-semibold text-slate-600">📊 Finding:</span> {r.finding}</p>
                            <p className={`text-xs leading-relaxed ${done ? 'line-through' : ''}`}><span className="font-semibold text-slate-600">✅ Action:</span> {r.recommendation}</p>
                            {r.expected_impact && <p className="text-[11px] opacity-75 italic">📈 Expected: {r.expected_impact}</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Creative Analysis */}
          {ca && (ca.headline_score || ca.ad_copy_score) && (
            <Section id="creative" icon="✍️" title="Creative Analysis"
              badge={
                <div className="flex items-center gap-2 ml-2">
                  {ca.headline_score!=null && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ca.headline_score>=7? 'bg-emerald-100 text-emerald-700' : ca.headline_score>=4? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>H: {ca.headline_score}/10</span>}
                  {ca.ad_copy_score!=null && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ca.ad_copy_score>=7? 'bg-emerald-100 text-emerald-700' : ca.ad_copy_score>=4? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>C: {ca.ad_copy_score}/10</span>}
                </div>
              }
            >
              <div className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {ca.headline_score!=null && (
                    <div className="bg-white rounded-lg p-3 border border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-700">Headline Score</span>
                        <div className="relative">
                          <ScoreRing score={ca.headline_score} />
                        </div>
                      </div>
                      {ca.headline_feedback && <p className="text-[11px] text-slate-600 leading-relaxed">{ca.headline_feedback}</p>}
                    </div>
                  )}
                  {ca.ad_copy_score!=null && (
                    <div className="bg-white rounded-lg p-3 border border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-700">Ad Copy Score</span>
                        <div className="relative">
                          <ScoreRing score={ca.ad_copy_score} />
                        </div>
                      </div>
                      {ca.ad_copy_feedback && <p className="text-[11px] text-slate-600 leading-relaxed">{ca.ad_copy_feedback}</p>}
                    </div>
                  )}
                </div>

                {ca.suggested_headlines && ca.suggested_headlines.length>0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-2">💡 Suggested Headlines</div>
                    <div className="space-y-1.5">
                      {ca.suggested_headlines.map((h,i)=> {
                        const ck = `headline_${i}`
                        const done = !!checks[ck]
                        return (
                          <div key={i} className={`text-xs rounded-lg px-3 py-2 border flex items-center gap-2 transition-all duration-200 ${
                            done ? 'bg-emerald-50 border-emerald-200' : 'bg-gradient-to-r from-cyan-50 to-white border-cyan-100'
                          }`}>
                            <CheckBox checkKey={ck} />
                            <span className="text-cyan-500 font-bold text-[10px]">H{i+1}</span>
                            <span className={`text-slate-700 ${done ? 'line-through opacity-70' : ''}`}>{h}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {ca.suggested_ad_copy && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-2">💡 Suggested Ad Copy</div>
                    <div className="text-xs bg-gradient-to-r from-cyan-50 to-white rounded-lg px-3 py-2.5 border border-cyan-100 whitespace-pre-wrap text-slate-700 leading-relaxed">{ca.suggested_ad_copy}</div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Customer Profile */}
          {cp && Object.keys(cp).length>0 && !cp.error && (
            <Section id="customer" icon="👤" title="Target Customer Profile">
              <div className="mt-3">
                <div className="grid grid-cols-2 gap-2.5">
                  {cp.target_gender && (
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Gender</div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5">{cp.target_gender}</div>
                    </div>
                  )}
                  {cp.age_range && (
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Age Range</div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5">{cp.age_range}</div>
                    </div>
                  )}
                  {cp.market_segment && (
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100 col-span-2">
                      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Market Segment</div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5">{cp.market_segment}</div>
                    </div>
                  )}
                  {cp.buyer_persona && (
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100 col-span-2">
                      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Buyer Persona</div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5">{cp.buyer_persona}</div>
                    </div>
                  )}
                  {cp.price_sensitivity && (
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Price Sensitivity</div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5 capitalize">{cp.price_sensitivity}</div>
                    </div>
                  )}
                  {cp.purchase_channel_preference && (
                    <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Channel</div>
                      <div className="text-xs font-semibold text-slate-800 mt-0.5">{cp.purchase_channel_preference}</div>
                    </div>
                  )}
                </div>
                {cp.psychographics && (
                  <div className="mt-3 space-y-2">
                    {cp.psychographics.pain_points && cp.psychographics.pain_points.length>0 && (
                      <div className="bg-rose-50/50 rounded-lg px-3 py-2 border border-rose-100">
                        <div className="text-[10px] text-rose-500 font-semibold uppercase tracking-wider mb-1">Pain Points</div>
                        <div className="flex flex-wrap gap-1.5">{cp.psychographics.pain_points.map((p:string,i:number) => <span key={i} className="text-[11px] bg-white rounded-full px-2.5 py-0.5 border border-rose-100 text-rose-700">{p}</span>)}</div>
                      </div>
                    )}
                    {cp.psychographics.buying_triggers && cp.psychographics.buying_triggers.length>0 && (
                      <div className="bg-emerald-50/50 rounded-lg px-3 py-2 border border-emerald-100">
                        <div className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider mb-1">Buying Triggers</div>
                        <div className="flex flex-wrap gap-1.5">{cp.psychographics.buying_triggers.map((t:string,i:number) => <span key={i} className="text-[11px] bg-white rounded-full px-2.5 py-0.5 border border-emerald-100 text-emerald-700">{t}</span>)}</div>
                      </div>
                    )}
                    {cp.psychographics.values && cp.psychographics.values.length>0 && (
                      <div className="bg-violet-50/50 rounded-lg px-3 py-2 border border-violet-100">
                        <div className="text-[10px] text-violet-600 font-semibold uppercase tracking-wider mb-1">Core Values</div>
                        <div className="flex flex-wrap gap-1.5">{cp.psychographics.values.map((v:string,i:number) => <span key={i} className="text-[11px] bg-white rounded-full px-2.5 py-0.5 border border-violet-100 text-violet-700">{v}</span>)}</div>
                      </div>
                    )}
                  </div>
                )}
                {cp.competing_alternatives && cp.competing_alternatives.length>0 && (
                  <div className="mt-2 bg-white rounded-lg px-3 py-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Competing Alternatives</div>
                    <div className="flex flex-wrap gap-1.5">{cp.competing_alternatives.map((a:string,i:number) => <span key={i} className="text-[11px] bg-slate-100 rounded-full px-2.5 py-0.5 text-slate-700">{a}</span>)}</div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Customer Alignment */}
          {cu && cu.score!=null && (
            <Section id="alignment" icon="🎯" title="Customer Alignment"
              badge={<span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ml-2 ${cu.score>=7? 'bg-emerald-100 text-emerald-700' : cu.score>=4? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{cu.score}/10</span>}
            >
              <div className="mt-3 space-y-3">
                {cu.gaps && cu.gaps.length>0 && (
                  <div className="bg-rose-50/50 rounded-lg px-3 py-2.5 border border-rose-100">
                    <div className="text-[10px] text-rose-500 font-semibold uppercase tracking-wider mb-1.5">⚠️ Gaps</div>
                    <div className="space-y-1.5">{cu.gaps.map((g,i)=> {
                      const ck = `gap_${i}`
                      const done = !!checks[ck]
                      return (
                        <div key={i} className={`text-xs flex items-start gap-2 transition-all duration-200 ${done ? 'text-emerald-600' : 'text-rose-700'}`}>
                          <CheckBox checkKey={ck} />
                          <span className={done ? 'line-through opacity-70' : ''}>{g}</span>
                        </div>
                      )
                    })}</div>
                  </div>
                )}
                {cu.opportunities && cu.opportunities.length>0 && (
                  <div className="bg-emerald-50/50 rounded-lg px-3 py-2.5 border border-emerald-100">
                    <div className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider mb-1.5">🌟 Opportunities</div>
                    <div className="space-y-1.5">{cu.opportunities.map((o,i)=> {
                      const ck = `opp_${i}`
                      const done = !!checks[ck]
                      return (
                        <div key={i} className={`text-xs flex items-start gap-2 transition-all duration-200 ${done ? 'text-slate-500' : 'text-emerald-700'}`}>
                          <CheckBox checkKey={ck} />
                          <span className={done ? 'line-through opacity-70' : ''}>{o}</span>
                        </div>
                      )
                    })}</div>
                  </div>
                )}
              </div>
            </Section>
          )}
        </div>

        {/* Footer with Save Progress */}
        <div className="px-6 py-3 bg-white border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {totalCheckable > 0 && (
              <>
                {/* Progress bar */}
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                      style={{ width: `${totalCheckable > 0 ? (checkedCount / totalCheckable) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-500 font-medium">{checkedCount}/{totalCheckable}</span>
                </div>
                <button
                  onClick={onSave}
                  disabled={saving}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    saving
                      ? 'bg-slate-100 text-slate-400 cursor-wait'
                      : 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-sm hover:shadow'
                  }`}
                >
                  {saving ? 'Saving…' : '💾 Save Progress'}
                </button>
              </>
            )}
          </div>
          <button onClick={onClose} className="px-6 py-2 rounded-xl bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-900 hover:to-black text-white text-sm font-semibold transition-all shadow-sm hover:shadow">Close</button>
        </div>
      </div>
    </div>
  )
}

