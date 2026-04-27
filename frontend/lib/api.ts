import axios from 'axios'
// When the frontend is served by FastAPI on the same domain we can use a relative URL.
const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''

// De-dupe identical in-flight requests (prevents duplicate expensive API calls on re-render).
const __inflight = new Map<string, Promise<any>>()
function __stableStringify(obj: any): string {
  try{
    if(obj==null) return ''
    if(typeof obj !== 'object') return String(obj)
    const seen = new WeakSet()
    const sorter = (v: any): any => {
      if(v==null) return v
      if(typeof v !== 'object') return v
      if(seen.has(v)) return '[Circular]'
      seen.add(v)
      if(Array.isArray(v)) return v.map(sorter)
      const out: any = {}
      for(const k of Object.keys(v).sort()){
        out[k] = sorter(v[k])
      }
      return out
    }
    return JSON.stringify(sorter(obj))
  }catch{
    try{ return JSON.stringify(obj) }catch{ return String(obj) }
  }
}
function __dedupe<T>(key: string, fn: ()=>Promise<T>): Promise<T> {
  const hit = __inflight.get(key)
  if(hit) return hit as Promise<T>
  const p = fn().finally(()=> { __inflight.delete(key) })
  __inflight.set(key, p as any)
  return p
}
function selectedStore(){
  try{
    if(typeof window==='undefined') return undefined
    // Check multi-store key first, fall back to legacy single key
    const multi = localStorage.getItem('ptos_stores_multi')
    if(multi){
      try{ const arr = JSON.parse(multi); if(Array.isArray(arr) && arr.length) return arr[0] }catch{}
    }
    return localStorage.getItem('ptos_store') || undefined
  }catch{ return undefined }
}
function confirmationToken(){
  try{ return typeof window!=='undefined'? (localStorage.getItem('ptos_confirmation_token')||'') : '' }catch{ return '' }
}
function confirmationHeaders(){
  const tok = confirmationToken()
  return tok? { Authorization: `Bearer ${tok}` } : {}
}

// -------- Confirmation (Order confirmation team) --------
export async function confirmationLogin(payload:{ email: string, password: string, remember?: boolean, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/confirmation/login`, body)
  return data as { data?: { token: string, agent: { email: string, name?: string|null } }, error?: string }
}

export async function confirmationListOrders(payload:{ store?: string, limit?: number, page_info?: string|null }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/confirmation/orders`, body, { headers: { ...confirmationHeaders() } })
  return data as { data?: { orders: any[], next_page_info?: string|null, prev_page_info?: string|null }, error?: string }
}

export async function confirmationOrderAction(payload:{ store?: string, order_id: string, action: 'phone'|'whatsapp'|'confirm', date?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/confirmation/order/action`, body, { headers: { ...confirmationHeaders() } })
  return data as { data?: { tags: string[], cod?: string }, error?: string }
}

export async function confirmationStats(payload?:{ store?: string }){
  const store = payload?.store ?? selectedStore()
  const qp = store? `?store=${encodeURIComponent(store)}` : ''
  const {data} = await axios.get(`${base}/api/confirmation/stats${qp}`, { headers: { ...confirmationHeaders() } })
  return data as { data?: Record<string, number>, error?: string }
}

export async function confirmationAgentAnalytics(payload?:{ store?: string }){
  const store = payload?.store ?? selectedStore()
  const qp = store? `?store=${encodeURIComponent(store)}` : ''
  const {data} = await axios.get(`${base}/api/confirmation/agent/analytics${qp}`, { headers: { ...confirmationHeaders() } })
  return data as {
    data?: {
      assigned_total?: number,
      n1?: number,
      n2?: number,
      n3?: number,
      any_n?: number,
      no_n?: number,
      all_n?: number,
      confirmed_total?: number,
      truncated?: boolean,
    },
    error?: string
  }
}

// -------- Confirmation Admin --------
function confirmationAdminToken(){
  try{ return typeof window!=='undefined'? (localStorage.getItem('ptos_confirmation_admin_token')||'') : '' }catch{ return '' }
}
function confirmationAdminHeaders(){
  const tok = confirmationAdminToken()
  return tok? { Authorization: `Bearer ${tok}` } : {}
}

export async function confirmationAdminLogin(payload:{ email: string, password: string, remember?: boolean }){
  const {data} = await axios.post(`${base}/api/confirmation/admin/login`, payload)
  return data as { data?: { token: string, admin: { email: string, name?: string|null } }, error?: string }
}

export async function confirmationAdminUsersList(payload?:{ store?: string }){
  const store = payload?.store ?? selectedStore()
  const qp = store? `?store=${encodeURIComponent(store)}` : ''
  const {data} = await axios.get(`${base}/api/confirmation/admin/users${qp}`, { headers: { ...confirmationAdminHeaders() } })
  return data as { data?: Array<{ email: string, name?: string|null }>, error?: string }
}

export async function confirmationAdminUserUpsert(payload:{ store?: string, email: string, name?: string, password?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/confirmation/admin/users/upsert`, body, { headers: { ...confirmationAdminHeaders() } })
  return data as { data?: { email: string, name?: string|null, generated_password?: string|null }, error?: string }
}

export async function confirmationAdminUserDelete(payload:{ store?: string, email: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/confirmation/admin/users/delete`, body, { headers: { ...confirmationAdminHeaders() } })
  return data as { data?: { ok: boolean }, error?: string }
}

export async function confirmationAdminUserResetPassword(payload:{ store?: string, email: string, password?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/confirmation/admin/users/reset_password`, body, { headers: { ...confirmationAdminHeaders() } })
  return data as { data?: { email: string, generated_password?: string|null }, error?: string }
}

export async function confirmationAdminAnalytics(payload?:{ store?: string, days?: number }){
  const store = payload?.store ?? selectedStore()
  const days = payload?.days
  const parts: string[] = []
  if(store) parts.push(`store=${encodeURIComponent(store)}`)
  if(typeof days === 'number') parts.push(`days=${days}`)
  const qp = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/confirmation/admin/analytics${qp}`, { headers: { ...confirmationAdminHeaders() } })
  return data as { data?: { totals: {confirm:number, phone:number, whatsapp:number}, agents: Record<string, {confirm:number, phone:number, whatsapp:number, last_at?: string|null}>, daily: Array<{date:string, confirm:number, phone:number, whatsapp:number}> }, error?: string }
}
export async function launchTest(payload:{audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, images?:File[], targeting?:any, advantage_plus?:boolean, adset_budget?:number, model?:string, angles_prompt?:string, title_desc_prompt?:string, landing_copy_prompt?:string, sizes?:string[], colors?:string[] }){
  const form = new FormData()
  form.append('audience', payload.audience)
  form.append('benefits', JSON.stringify(payload.benefits))
  form.append('pain_points', JSON.stringify(payload.pain_points))
  if(payload.base_price!=null) form.append('base_price', String(payload.base_price))
  if(payload.title) form.append('title', payload.title)
  if(Array.isArray(payload.sizes)) form.append('sizes', JSON.stringify(payload.sizes))
  if(Array.isArray(payload.colors)) form.append('colors', JSON.stringify(payload.colors))
  if(payload.targeting) form.append('targeting', typeof payload.targeting==='string'? payload.targeting : JSON.stringify(payload.targeting))
  if(typeof payload.advantage_plus==='boolean') form.append('advantage_plus', String(payload.advantage_plus))
  if(typeof payload.adset_budget==='number') form.append('adset_budget', String(payload.adset_budget))
  if(payload.model) form.append('model', payload.model)
  if(payload.angles_prompt) form.append('angles_prompt', payload.angles_prompt)
  if(payload.title_desc_prompt) form.append('title_desc_prompt', payload.title_desc_prompt)
  if(payload.landing_copy_prompt) form.append('landing_copy_prompt', payload.landing_copy_prompt)
  for(const f of (payload.images||[])) form.append('images', f)
  const {data} = await axios.post(`${base}/api/tests`, form, { headers:{'Content-Type':'multipart/form-data'} })
  return data as { test_id:string, status:string }
}

export async function getTest(id: string){
  const {data} = await axios.get(`${base}/api/tests/${id}`)
  return data as { id:string, status:string, page_url?:string|null, campaign_id?:string|null, error?:any|null, payload?:any|null, result?:any|null }
}

export async function getTestSlim(id: string){
  const {data} = await axios.get(`${base}/api/tests/${id}?slim=1`)
  return data as { id:string, status:string, page_url?:string|null, payload?:any|null, created_at?:string }
}

export async function listTests(limit?: number){
  const q = typeof limit==='number'? `?limit=${limit}` : ''
  const {data} = await axios.get(`${base}/api/tests${q}`)
  return data as { data: Array<{ id:string, status:string, page_url?:string|null, payload?:any|null, result?:any|null, created_at?:string, card_image?:string }>, error?:string }
}

export async function saveDraft(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
  image_urls?: string[],
  flow?: any,
  ui?: any,
  prompts?: { angles_prompt?:string, title_desc_prompt?:string, landing_copy_prompt?:string },
  settings?: { flow_type?: 'product'|'ads'|'promotion', model?:string, advantage_plus?:boolean, adset_budget?:number, targeting?:any, countries?:string[], saved_audience_id?:string, store?: string },
  ads?: any,
  card_image?: string,
}){
  const body = { ...payload, settings: { ...(payload.settings||{}), store: (payload as any)?.settings?.store ?? selectedStore() } }
  const {data} = await axios.post(`${base}/api/flows/draft`, body)
  return data as { id:string, status:string }
}

export async function updateDraft(id: string, payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
  image_urls?: string[],
  flow?: any,
  ui?: any,
  prompts?: { angles_prompt?:string, title_desc_prompt?:string, landing_copy_prompt?:string },
  settings?: { flow_type?: 'product'|'ads'|'promotion', model?:string, advantage_plus?:boolean, adset_budget?:number, targeting?:any, countries?:string[], saved_audience_id?:string, store?: string },
  ads?: any,
  card_image?: string,
}){
  const body = { ...payload, settings: { ...(payload.settings||{}), store: (payload as any)?.settings?.store ?? selectedStore() } }
  const {data} = await axios.put(`${base}/api/flows/draft/${id}`, body)
  return data as { id:string, status:string }
}

// Structured flows API
export async function getFlow(id: string){
  const {data} = await axios.get(`${base}/api/flows/${id}`)
  return data as { id:string, status:string, title?:string|null, card_image?:string|null, page_url?:string|null, product?:any, flow?:any, ui?:any, prompts?:any, settings?:any, ads?:any, created_at?:string }
}
export async function listFlows(limit?: number, store?: string){
  const parts: string[] = []
  if(typeof limit==='number') parts.push(`limit=${limit}`)
  const s = (store||selectedStore())
  if(s) parts.push(`store=${encodeURIComponent(s)}`)
  const q = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/flows${q}`)
  return data as { data: Array<{ id:string, status:string, title?:string|null, card_image?:string|null, page_url?:string|null, created_at?:string, flow_type?: 'product'|'ads'|'promotion', store?: string }>, error?:string }
}

export async function deleteFlow(id: string){
  const {data} = await axios.delete(`${base}/api/flows/${id}`)
  return data as { ok?: boolean, error?: string }
}

export async function fetchSavedAudiences(){
  const {data} = await axios.get(`${base}/api/meta/audiences`)
  return data as { data: Array<{id:string,name:string,description?:string}>, error?:string }
}

// Ads automation (background)
export async function launchAdsAutomation(payload:{
  flow_id: string,
  landing_url?: string,
  source_image?: string,
  num_angles?: number,
  prompts?: { analyze_landing_prompt?:string, angles_prompt?:string, headlines_prompt?:string, copies_prompt?:string, gemini_ad_prompt?:string },
  model?: string,
}){
  const {data} = await axios.post(`${base}/api/flows/ads/launch`, payload)
  return data as { flow_id?: string, status?: string, error?: string }
}

// LLM interactive endpoints
export async function llmGenerateAngles(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[], target_category?:string },
  num_angles:number,
  model?:string,
  prompt?:string
}){
  const {data} = await axios.post(`${base}/api/llm/angles`, payload)
  return data as { angles: any[] }
}

export async function llmTitleDescription(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[], target_category?:string },
  angle:any,
  prompt?:string,
  model?:string,
  image_urls?:string[]
}){
  const {data} = await axios.post(`${base}/api/llm/title_desc`, payload)
  return data as { title:string, description:string }
}

export async function llmLandingCopy(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[], target_category?:string },
  angle?:any,
  title?:string,
  description?:string,
  model?:string,
  image_urls?: string[],
  prompt?:string,
  product_url?: string,
  product_handle?: string,
}){
  const {data} = await axios.post(`${base}/api/llm/landing_copy`, payload)
  return data as { headline?:string, subheadline?:string, sections?:any[], faq?:any[], cta?:string, html?:string }
}

export async function llmAnalyzeLandingPage(payload:{ url:string, model?:string, prompt?:string }){
  const {data} = await axios.post(`${base}/api/llm/analyze_landing_page`, payload)
  return data as { url:string, title?:string, benefits?:string[], pain_points?:string[], offers?:string[], emotions?:string[], angles?: any[], images?: string[], prompt_used?: string, error?: string }
}

export async function shopifyCreateFromCopy(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[], target_category?:string },
  angle?:any,
  title:string,
  description:string,
  landing_copy:any,
  image_urls?:string[]
}){
  const {data} = await axios.post(`${base}/api/shopify/create_from_copy`, { ...payload, store: selectedStore() })
  return data as { page_url?:string|null, test_id?:string }
}

export async function metaLaunchFromPage(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[], target_category?:string },
  page_url:string,
  creatives?:any[]
}){
  const {data} = await axios.post(`${base}/api/meta/launch_from_page`, payload)
  return data as { campaign_id?:string|null, error?:string }
}

export async function metaDraftImageCampaign(payload:{
  headline: string,
  primary_text: string,
  description?: string,
  image_url: string,
  landing_url: string,
  call_to_action?: string,
  adset_budget?: number,
  targeting?: any,
  saved_audience_id?: string,
  campaign_name?: string,
  adset_name?: string,
  ad_name?: string,
  creative_name?: string,
  title?: string
}){
  const {data} = await axios.post(`${base}/api/meta/draft_image_campaign`, payload)
  return data as { campaign_id?: string, adsets?: { adset_id: string, ad_id: string, creative_id: string }[], requests?: any[], error?: string }
}

export async function metaDraftCarouselCampaign(payload:{
  primary_text: string,
  landing_url: string,
  cards: { image_url: string, headline?: string, description?: string, link?: string, call_to_action?: string }[],
  call_to_action?: string,
  adset_budget?: number,
  targeting?: any,
  saved_audience_id?: string,
  campaign_name?: string,
  adset_name?: string,
  ad_name?: string,
  creative_name?: string,
  title?: string
}){
  const {data} = await axios.post(`${base}/api/meta/draft_carousel_campaign`, payload)
  return data as { campaign_id?: string, adsets?: { adset_id: string, ad_id: string, creative_id: string }[], requests?: any[], error?: string }
}

export async function uploadImages(files: File[]){
  const form = new FormData()
  for(const f of (files||[])) form.append('files', f)
  const {data} = await axios.post(`${base}/api/uploads`, form, { headers:{'Content-Type':'multipart/form-data'} })
  return data as { urls: string[] }
}

export async function shopifyUploadProductImages(payload:{
  product_gid: string,
  image_urls: string[],
  title?: string,
  description?: string,
  landing_copy?: any
}){
  const {data} = await axios.post(`${base}/api/shopify/upload_images`, { ...payload, store: selectedStore() })
  return data as { urls: string[], images?: any[] }
}

export async function shopifyCreateProductFromTitleDesc(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[], target_category?:string, track_quantity?: boolean, quantity?: number, variants?: any[] },
  angle?: any,
  title: string,
  description?: string
}){
  const {data} = await axios.post(`${base}/api/shopify/product_create_from_title_desc`, { ...payload, store: selectedStore() })
  return data as { product_gid?: string, handle?: string, report?: { ok?: boolean, options_updated?:{size_count:number,color_count:number}, variants_created?: number, inventory_items_updated?: number, skipped?: {field:string, reason:string}[], errors?: string[] }, error?: string }
}

export async function shopifyUpdateDescription(payload:{ product_gid:string, description_html:string }){
  const {data} = await axios.post(`${base}/api/shopify/update_description`, { ...payload, store: selectedStore() })
  return data as { product_gid?: string, handle?: string }
}

export async function shopifyUpdateTitle(payload:{ product_gid:string, title:string }){
  const {data} = await axios.post(`${base}/api/shopify/update_title`, { ...payload, store: selectedStore() })
  return data as { product_gid?: string, handle?: string }
}

export async function shopifyCreatePageFromCopy(payload:{
  title: string,
  landing_copy: any,
  image_urls?: string[],
  product_gid?: string,
}){
  const {data} = await axios.post(`${base}/api/shopify/create_page_from_copy`, { ...payload, store: selectedStore() })
  const page_url = (data as any)?.page_url ?? (data as any)?.url ?? undefined
  return { page_url } as { page_url?: string }
}

export async function shopifyConfigureVariants(payload:{ product_gid:string, base_price?:number, sizes?:string[], colors?:string[], track_quantity?: boolean, quantity?: number, variants?: any[] }){
  const {data} = await axios.post(`${base}/api/shopify/configure_variants`, { ...payload, store: selectedStore() })
  return data as { ok?: boolean, options_updated?:{size_count:number,color_count:number}, variants_created?: number, inventory_items_updated?: number, skipped?: {field:string, reason:string}[], errors?: string[] }
}

export async function shopifyUploadProductFiles(payload:{
  product_gid: string,
  files: File[],
  title?: string,
  description?: string,
  landing_copy?: any
}){
  const form = new FormData()
  form.append('product_gid', payload.product_gid)
  if(payload.title) form.append('title', payload.title)
  if(payload.description) form.append('description', payload.description)
  if(payload.landing_copy) form.append('landing_copy', JSON.stringify(payload.landing_copy))
  const s = selectedStore(); if(s) form.append('store', s)
  for(const f of (payload.files||[])) form.append('files', f)
  const {data} = await axios.post(`${base}/api/shopify/upload_files`, form, { headers:{'Content-Type':'multipart/form-data'} })
  return data as { urls: string[], images?: any[], per_image?: any[] }
}

// Shopify: list product IDs in a collection
export async function shopifyCollectionProducts(payload:{ collection_id: string, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/shopify/collection_products`, body)
  return data as { data: { product_ids: string[] }, error?: string }
}

// Campaign mappings (persist manual product/collection IDs per campaign row)
export async function campaignMappingsList(store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/campaign_mappings${q}`)
  return data as { data: Record<string, { kind:'product'|'collection', id:string, store?:string }>, error?: string }
}

export async function campaignMappingUpsert(payload:{ campaign_key:string, kind:'product'|'collection', id:string, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/campaign_mappings`, body)
  return data as { data?: { store?:string, campaign_key:string, kind:'product'|'collection', id:string }, error?: string }
}

// Campaign meta (supplier fields + timeline)
export async function campaignMetaList(store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/campaign_meta${q}`)
  return data as { data: Record<string, { supplier_name?: string, supplier_alt_name?: string, supply_available?: string, timeline?: Array<{ text:string, at:string }> }>, error?: string }
}

export async function campaignMetaUpsert(payload:{ campaign_key:string, supplier_name?:string, supplier_alt_name?:string, supply_available?:string, timeline?: Array<{ text:string, at:string }>, product_life_checks?: Record<string, any>, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/campaign_meta`, body)
  return data as { data?: { supplier_name?: string, supplier_alt_name?: string, timeline?: Array<{ text:string, at:string }> }, error?: string }
}

export async function campaignTimelineAdd(payload:{ campaign_key:string, text:string, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/campaign_meta/timeline`, body)
  return data as { data?: { supplier_name?: string, supplier_alt_name?: string, timeline?: Array<{ text:string, at:string }> }, error?: string }
}

// Gemini image generation (ad image from source image + prompt)
export async function geminiGenerateAdImages(payload:{ image_url:string, prompt:string, num_images?:number, neutral_background?: boolean }){
  const {data} = await axios.post(`${base}/api/gemini/ad_image`, payload)
  return data as { images: string[], prompt: string, input_image_url: string, error?: string }
}

export async function geminiGeneratePromotionalSet(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, currency?:string, sizes?:string[], colors?:string[], target_category?:string },
  angles: any[],
  image_url: string,
  count?: number
}){
  const {data} = await axios.post(`${base}/api/gemini/promotional_set`, payload)
  return data as { items: { prompt:string, image:string }[], model: string, input_image_url: string, error?: string }
}

// Gemini variant-set generation (per-variant images + composite)
export async function geminiGenerateVariantSet(payload:{ image_url:string, style_prompt?:string, max_variants?:number }){
  const {data} = await axios.post(`${base}/api/gemini/variant_set`, payload)
  return data as { items: Array<{ kind:'variant'|'composite', name?:string, description?:string, image:string, prompt:string }>, model: string, input_image_url: string, error?: string }
}

// Gemini feature/benefit close-up set
export async function geminiGenerateFeatureBenefitSet(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, currency?:string, sizes?:string[], colors?:string[], target_category?:string },
  image_url: string,
  count?: number
}){
  const {data} = await axios.post(`${base}/api/gemini/feature_benefit_set`, payload)
  return data as { items: { prompt:string, image:string }[], model: string, input_image_url: string, error?: string }
}

// Gemini prompt suggestion (no generation)
export async function geminiSuggestPrompts(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, currency?:string, sizes?:string[], colors?:string[] },
  image_url: string,
  include_feature_benefit?: boolean,
  max_variants?: number,
}){
  const {data} = await axios.post(`${base}/api/gemini/suggest_prompts`, {
    product: payload.product,
    image_url: payload.image_url,
    include_feature_benefit: payload.include_feature_benefit,
    max_variants: payload.max_variants,
  })
  return data as { input_image_url: string, ad_prompt: string, variant_prompts: { name:string, description?:string, prompt:string }[], feature_prompts: string[], error?: string }
}

// Agent SDK (experimental). Execute a tool-calling loop with chat messages.
export async function agentExecute(payload:{ messages: any[], model?: string }){
  const {data} = await axios.post(`${base}/api/agent/execute`, payload)
  return data as { text?: string, messages?: any[], error?: string }
}

// Ads Agent (separate endpoint)
export async function agentAdsExecute(payload:{ messages: any[], model?: string }){
  const {data} = await axios.post(`${base}/api/agent/ads/execute`, payload)
  return data as { text?: string, messages?: any[], error?: string }
}

// Translation API
export async function translateTexts(payload:{ texts: string[], target: 'ar'|'fr'|'ary', locale?: string, domain?: string, model?: string }){
  const {data} = await axios.post(`${base}/api/translate`, payload)
  return data as { translations: string[], target: string, error?: string }
}

// -------- Agents & Runs --------
export async function agentsList(limit?: number){
  const q = typeof limit==='number'? `?limit=${limit}` : ''
  const {data} = await axios.get(`${base}/api/agents${q}`)
  return data as { data: Array<{ id:string, name:string, description?:string, created_at?:string }>, error?: string }
}

export async function agentCreate(payload:{ id:string, name:string, description?:string, instruction?:string, output_pref?:string }){
  const {data} = await axios.post(`${base}/api/agents`, payload)
  return data as { ok?: boolean, id?: string, error?: string }
}

export async function agentGet(agent_id: string){
  const {data} = await axios.get(`${base}/api/agents/${agent_id}`)
  return data as { id:string, name:string, description?:string, instruction?:string, output_pref?:string }
}

export async function agentUpdate(agent_id: string, payload:{ name?:string, description?:string, instruction?:string, output_pref?:string }){
  const {data} = await axios.put(`${base}/api/agents/${agent_id}`, payload)
  return data as { ok?: boolean, error?: string }
}

export async function agentRunsList(agent_id: string, limit?: number){
  const q = typeof limit==='number'? `?limit=${limit}` : ''
  const {data} = await axios.get(`${base}/api/agents/${agent_id}/runs${q}`)
  return data as { data: Array<{ id:string, title?:string, status?:string, created_at?:string }>, error?: string }
}

export async function agentRunCreate(agent_id: string, payload:{ title?:string, status?:string, input?: any }){
  const {data} = await axios.post(`${base}/api/agents/${agent_id}/runs`, payload)
  return data as { id?: string, error?: string }
}

export async function agentRunUpdate(agent_id: string, run_id: string, payload:{ title?:string, status?:string, input?: any, output?: any, messages?: any[] }){
  const {data} = await axios.put(`${base}/api/agents/${agent_id}/runs/${run_id}`, payload)
  return data as { ok?: boolean, error?: string }
}

export async function agentRunGet(agent_id: string, run_id: string){
  const {data} = await axios.get(`${base}/api/agents/${agent_id}/runs/${run_id}`)
  return data as { id:string, agent_id:string, status?:string, title?:string, input?: any, output?: any, messages?: any[] }
}

// Generate angles from url/text using server aggregation
export async function agentAnglesGenerate(payload:{ url?: string, text?: string, model?: string }){
  const { data } = await axios.post(`${base}/api/agent/angles`, payload)
  return data as { angles: { angle_title:string, headlines:string[], ad_copies:string[] }[], error?: string }
}

// Extract product inputs from a single product image (OpenAI multimodal)
export async function productFromImage(payload:{ image_url:string, model?:string, target_category?: string }){
  const {data} = await axios.post(`${base}/api/llm/product_from_image`, payload)
  return data as { product?: { title?:string, audience?:string, benefits?:string[], pain_points?:string[], colors?:string[], sizes?:string[], variants?:{name:string, description?:string}[] }, input_image_url?: string, error?: string }
}

// Extended: Gemini variant-set with explicit variant descriptions
export async function geminiGenerateVariantSetWithDescriptions(payload:{ image_url:string, style_prompt?:string, max_variants?:number, variant_descriptions?:{name:string, description?:string}[] }){
  const {data} = await axios.post(`${base}/api/gemini/variant_set`, payload)
  return data as { items: Array<{ kind:'variant'|'composite', name?:string, description?:string, image:string, prompt:string }>, model: string, input_image_url: string, error?: string }
}

// -------- App-wide prompts (global defaults) --------
export async function getGlobalPrompts(){
  const {data} = await axios.get(`${base}/api/prompts`)
  // API returns a plain object mapping keys to strings
  return data as { [key:string]: string }
}

export async function setGlobalPrompts(payload:{ angles_prompt?:string, title_desc_prompt?:string, landing_copy_prompt?:string, gemini_ad_prompt?:string, gemini_variant_style_prompt?:string }){
  const {data} = await axios.post(`${base}/api/prompts`, payload)
  return data as { [key:string]: string }
}

// Ads Management: aggregated bundle endpoint (single request for all data)
export type AdsManagementBundle = {
  campaigns: MetaCampaignRow[],
  mappings: Record<string, { kind: 'product'|'collection', id: string, store?: string }>,
  campaign_meta: Record<string, { supplier_name?: string, supplier_alt_name?: string, supply_available?: string, timeline?: Array<{ text: string, at: string }>, product_life_checks?: Record<string, Record<string, boolean>> }>,
  ad_account?: { id?: string, name?: string },
  product_life_instructions: { phases: Record<string, string[]> },
}
export async function fetchAdsManagementBundle(payload: {
  date_preset?: string,
  ad_account?: string,
  store?: string,
  start?: string,
  end?: string,
}){
  const url = `${base}/api/ads-management/bundle`
  const body = { ...payload }
  return __dedupe(`POST ${url} ${__stableStringify(body)}`, async ()=>{
    const {data} = await axios.post(url, body, { timeout: 60000 })
    return data as { data?: AdsManagementBundle, error?: string }
  })
}

// Meta Ads: list active campaigns with insights
export type MetaCampaignRow = {
  campaign_id?: string,
  name?: string,
  spend: number,
  purchases: number,
  cpp?: number|null,
  ctr?: number|null,
  add_to_cart: number,
  status?: string|null,
  created_time?: string|null,
}
export async function fetchMetaCampaigns(datePreset?: string, adAccount?: string, range?: { start?: string, end?: string }){
  const parts: string[] = []
  if(datePreset) parts.push(`date_preset=${encodeURIComponent(datePreset)}`)
  if(adAccount) parts.push(`ad_account=${encodeURIComponent(adAccount)}`)
  if(range?.start && range?.end){ parts.push(`start=${encodeURIComponent(range.start)}`); parts.push(`end=${encodeURIComponent(range.end)}`) }
  const s = selectedStore()
  if(s) parts.push(`store=${encodeURIComponent(s)}`)
  const qp = parts.length? `?${parts.join('&')}` : ''
  const url = `${base}/api/meta/campaigns${qp}`
  return __dedupe(`GET ${url}`, async ()=>{
    const {data} = await axios.get(url)
    return data as { data: MetaCampaignRow[], error?: string }
  })
}

// Ad account persistence per store
export async function metaGetAdAccount(store?: string){
  const parts: string[] = []
  const s = store ?? selectedStore()
  if(s) parts.push(`store=${encodeURIComponent(s)}`)
  const qp = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/meta/ad_account${qp}`)
  return data as { data?: { id?: string, name?: string }, error?: string }
}

export async function metaSetAdAccount(payload:{ id:string, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/meta/ad_account`, body)
  return data as { data?: { id?: string, name?: string }, error?: string }
}

export async function metaListAdAccounts(){
  const {data} = await axios.get(`${base}/api/meta/ad_accounts`)
  return data as { data: Array<{ id:string, name:string, account_status?: number }>, error?: string }
}

export async function metaSetCampaignStatus(campaign_id: string, status: 'ACTIVE'|'PAUSED'){
  const {data} = await axios.post(`${base}/api/meta/campaigns/${encodeURIComponent(campaign_id)}/status`, { status })
  return data as { data?: any, error?: string }
}

export type MetaAdsetRow = {
  adset_id?: string,
  name?: string,
  spend: number,
  purchases: number,
  cpp?: number|null,
  ctr?: number|null,
  add_to_cart: number,
  status?: string|null,
}

export async function fetchCampaignAdsets(campaign_id: string, datePreset?: string, range?: { start?: string, end?: string }){
  const parts: string[] = []
  if(datePreset) parts.push(`date_preset=${encodeURIComponent(datePreset)}`)
  if(range?.start && range?.end){ parts.push(`start=${encodeURIComponent(range.start)}`); parts.push(`end=${encodeURIComponent(range.end)}`) }
  const qp = parts.length? `?${parts.join('&')}` : ''
  const url = `${base}/api/meta/campaigns/${encodeURIComponent(campaign_id)}/adsets${qp}`
  return __dedupe(`GET ${url}`, async ()=>{
    const {data} = await axios.get(url)
    return data as { data: MetaAdsetRow[], error?: string }
  })
}

export async function metaSetAdsetStatus(adset_id: string, status: 'ACTIVE'|'PAUSED'){
  const {data} = await axios.post(`${base}/api/meta/adsets/${encodeURIComponent(adset_id)}/status`, { status })
  return data as { data?: any, error?: string }
}

export async function fetchCampaignPerformance(campaign_id: string, days?: number, tz?: string){
  const parts: string[] = []
  if(typeof days==='number') parts.push(`days=${days}`)
  if(tz) parts.push(`tz=${encodeURIComponent(tz)}`)
  const qp = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/meta/campaigns/${encodeURIComponent(campaign_id)}/performance${qp}`)
  return data as { data: { days: { date:string, spend:number, purchases:number, cpp?:number|null, ctr?:number|null, add_to_cart:number }[] }, error?: string }
}

export type AttributedOrder = {
  order_id?: string|number,
  name?: string,
  processed_at?: string,
  total_price?: number,
  currency?: string,
  landing_site?: string|null,
  utm?: Record<string,string>,
  ad_id?: string,
  campaign_id?: string,
  store?: string,
}

export async function fetchCampaignAdsetOrders(campaign_id: string, range: { start: string, end: string }, store?: string, stores?: string[]){
  const params: string[] = []
  if(range?.start) params.push(`start=${encodeURIComponent(range.start)}`)
  if(range?.end) params.push(`end=${encodeURIComponent(range.end)}`)
  // Multi-store support: pass comma-separated stores param
  if(stores && stores.length > 0){
    params.push(`stores=${encodeURIComponent(stores.join(','))}`)
  } else {
    const s = store ?? selectedStore()
    if(s) params.push(`store=${encodeURIComponent(s)}`)
  }
  const qp = params.length? `?${params.join('&')}` : ''
  const url = `${base}/api/meta/campaigns/${encodeURIComponent(campaign_id)}/adsets/orders${qp}`
  return __dedupe(`GET ${url}`, async ()=>{
    const {data} = await axios.get(url)
    return data as { data: Record<string, { count:number, orders: AttributedOrder[] }>, error?: string }
  })
}

// Shopify: count orders by line item title substring for a time range
export async function shopifyOrdersCountByTitle(payload:{ names: string[], start: string, end: string, store?: string, include_closed?: boolean, date_field?: 'processed'|'created' }){
  const body = { ...payload, store: payload.store ?? selectedStore(), include_closed: payload.include_closed ?? true, date_field: payload.date_field }
  const url = `${base}/api/shopify/orders_count_by_title`
  return __dedupe(`POST ${url} ${__stableStringify(body)}`, async ()=>{
    const {data} = await axios.post(url, body)
    return data as { data: { [name:string]: number }, error?: string }
  })
}

// Shopify: count PAID orders by line item product/variant id for a time range
export async function shopifyOrdersCountPaidByTitle(payload:{ names: string[], start: string, end: string, store?: string, include_closed?: boolean, date_field?: 'processed'|'created' }){
  const body = { ...payload, store: payload.store ?? selectedStore(), include_closed: payload.include_closed ?? true, date_field: payload.date_field }
  const url = `${base}/api/shopify/orders_count_paid_by_title`
  return __dedupe(`POST ${url} ${__stableStringify(body)}`, async ()=>{
    const {data} = await axios.post(url, body)
    return data as { data: { [name:string]: number }, error?: string }
  })
}

export async function shopifyProductsBrief(payload:{ ids: string[], store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const url = `${base}/api/shopify/products_brief`
  return __dedupe(`POST ${url} ${__stableStringify(body)}`, async ()=>{
    const {data} = await axios.post(url, body)
    return data as { data: { [id:string]: { image?: string|null, total_available: number, zero_variants: number, zero_sizes?: number, price?: number|null } }, error?: string }
  })
}

export async function shopifyProductVariantsInventory(payload:{ product_id: string, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const url = `${base}/api/shopify/product_variants_inventory`
  return __dedupe(`POST ${url} ${__stableStringify(body)}`, async ()=>{
    const {data} = await axios.post(url, body)
    return data as { data: { sizes: string[], colors: string[], matrix: Record<string, Record<string, number>>, total_available: number }, error?: string }
  })
}

export async function shopifyOrdersCountByCollection(payload:{ collection_id: string, start: string, end: string, store?: string, include_closed?: boolean, aggregate?: 'orders'|'items'|'sum_product_orders', date_field?: 'processed'|'created' }){
  const body = { ...payload, store: payload.store ?? selectedStore(), include_closed: payload.include_closed ?? true, aggregate: payload.aggregate, date_field: payload.date_field }
  const url = `${base}/api/shopify/orders_count_by_collection`
  return __dedupe(`POST ${url} ${__stableStringify(body)}`, async ()=>{
    const {data} = await axios.post(url, body)
    return data as { data: { count: number }, error?: string }
  })
}

// Shopify: count total orders for store over a time range
export async function shopifyOrdersCountTotal(payload:{ start: string, end: string, store?: string, include_closed?: boolean, date_field?: 'processed'|'created' }){
  const body = { ...payload, store: payload.store ?? selectedStore(), include_closed: payload.include_closed ?? true, date_field: payload.date_field }
  const url = `${base}/api/shopify/orders_count_total`
  return __dedupe(`POST ${url} ${__stableStringify(body)}`, async ()=>{
    const {data} = await axios.post(url, body)
    return data as { data: { count: number }, error?: string }
  })
}

// Profit Calculator costs (per product)
export async function profitCostsList(store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/profit_costs${q}`)
  return data as { data?: Record<string, { product_cost?: number|null, service_delivery_cost?: number|null }>, error?: string }
}

export async function profitCostsUpsert(payload:{ product_id: string, product_cost?: number|null, service_delivery_cost?: number|null, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/profit_costs`, body)
  return data as { data?: { product_cost?: number|null, service_delivery_cost?: number|null }, error?: string }
}

// Exchange rate (USD -> MAD)
export async function usdToMadRateGet(store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/exchange/usd_to_mad${q}`)
  return data as { data?: { rate: number }, error?: string }
}

export async function usdToMadRateSet(payload:{ rate: number, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/exchange/usd_to_mad`, body)
  return data as { data?: { rate: number }, error?: string }
}

// Profit cards (saved snapshots)
export type ProfitCard = {
  id: string
  store?: string|null
  product_id: string
  range: { start: string, end: string }
  usd_to_mad_rate?: number
  product?: { image?: string|null, inventory?: number|null, price_mad?: number|null }
  shopify?: { orders_total?: number, paid_orders_total?: number }
  costs?: { product_cost?: number, service_delivery_cost?: number }
  campaigns?: Array<{
    campaign_id?: string|null
    name?: string|null
    status?: string|null
    spend_usd?: number
    spend_mad?: number
    orders_total?: number
    paid_orders_total?: number
    product_price_mad?: number|null
    inventory?: number|null
    product_cost?: number
    service_delivery_cost?: number
    net_profit_mad?: number
  }>
  created_at?: string
  updated_at?: string
}

export async function profitCardsList(store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/profit_cards${q}`)
  return data as { data?: ProfitCard[], error?: string }
}

export async function profitCardCreate(payload:{ product_id: string, start: string, end: string, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/profit_cards`, body)
  return data as { data?: ProfitCard, error?: string }
}

export async function profitCardRefresh(payload:{ card_id: string, store?: string }){
  const params: string[] = []
  const s = payload.store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.post(`${base}/api/profit_cards/${encodeURIComponent(payload.card_id)}/refresh${q}`)
  return data as { data?: ProfitCard, error?: string }
}

export async function profitCardDelete(payload:{ card_id: string, store?: string }){
  const params: string[] = []
  const s = payload.store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.delete(`${base}/api/profit_cards/${encodeURIComponent(payload.card_id)}${q}`)
  return data as { data?: { ok: boolean }, error?: string }
}

// Profit campaign cards (saved per campaign_id + ad_account)
export type ProfitCampaignCard = {
  campaign_id: string
  campaign_name?: string|null
  status?: string|null
  ad_account?: string|null
  range?: { start: string, end: string }
  usd_to_mad_rate?: number
  spend_usd?: number
  spend_mad?: number
  product?: { id?: string|null, image?: string|null, inventory?: number|null, price_mad?: number|null }
  shopify?: { orders_total?: number, paid_orders_total?: number }
  costs?: { product_cost?: number, service_delivery_cost?: number }
  revenue_mad?: number
  net_profit_mad?: number
  profit_per_paid_order_mad?: number
  created_at?: string
  updated_at?: string
}

export async function profitCampaignCardsList(payload?: { store?: string, ad_account?: string }){
  const params: string[] = []
  const s = payload?.store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  if(payload?.ad_account) params.push(`ad_account=${encodeURIComponent(payload.ad_account)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/profit_campaign_cards${q}`)
  return data as { data?: Record<string, ProfitCampaignCard>, error?: string }
}

export async function profitCampaignCardCalculate(payload:{ campaign_id: string, start: string, end: string, store?: string, ad_account?: string, force?: boolean }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/profit_campaign_cards/calculate`, body)
  return data as { data?: ProfitCampaignCard, error?: string }
}

export async function profitCampaignCardDelete(payload:{ campaign_id: string, store?: string, ad_account?: string }){
  const params: string[] = []
  const s = payload.store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  if(payload.ad_account) params.push(`ad_account=${encodeURIComponent(payload.ad_account)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.delete(`${base}/api/profit_campaign_cards/${encodeURIComponent(payload.campaign_id)}${q}`)
  return data as { data?: { ok: boolean }, error?: string }
}

// -------- Page Builder (AI Agent) --------

export async function pageBuilderSearchProducts(query?: string, store?: string){
  const parts: string[] = []
  if(query) parts.push(`query=${encodeURIComponent(query)}`)
  const s = store ?? selectedStore()
  if(s) parts.push(`store=${encodeURIComponent(s)}`)
  const q = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/page-builder/products${q}`)
  return data as { data: Array<{ id:string, title:string, handle:string, image?:string|null, price?:string|null, status?:string }>, error?: string }
}

export async function pageBuilderGenerate(payload:{
  prompt: string,
  product_handle?: string,
  product_id?: string,
  product_title?: string,
  store?: string,
  model?: string,
  hide_header?: boolean,
  hide_footer?: boolean,
  messages?: any[],
  slug?: string,
}){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/page-builder/generate`, body, { timeout: 120000 })
  return data as { text?: string, page_url?: string, slug?: string, template_suffix?: string, messages?: any[], error?: string }
}

export async function pageBuilderToggleLayout(payload:{
  slug: string,
  show_header?: boolean,
  show_footer?: boolean,
  store?: string,
}){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/page-builder/toggle-layout`, body)
  return data as { data?: any, layout?: string, error?: string }
}

export async function pageBuilderStatus(slug: string, store?: string){
  const parts: string[] = []
  const s = store ?? selectedStore()
  if(s) parts.push(`store=${encodeURIComponent(s)}`)
  const q = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/page-builder/status/${encodeURIComponent(slug)}${q}`)
  return data as { data?: any, slug?: string, error?: string }
}

export async function pageBuilderWidgetInstall(store?: string){
  const body: any = {}
  const s = store ?? selectedStore()
  if(s) body.store = s
  const {data} = await axios.post(`${base}/api/page-builder/widget/install`, body)
  return data as { data?: { installed: boolean, snippet?: string, api_base?: string }, error?: string }
}

export async function pageBuilderWidgetUninstall(store?: string){
  const body: any = {}
  const s = store ?? selectedStore()
  if(s) body.store = s
  const {data} = await axios.post(`${base}/api/page-builder/widget/uninstall`, body)
  return data as { data?: { uninstalled: boolean }, error?: string }
}

export async function pageBuilderListPages(store?: string){
  const parts: string[] = []
  const s = store ?? selectedStore()
  if(s) parts.push(`store=${encodeURIComponent(s)}`)
  const q = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/page-builder/pages${q}`)
  return data as { data: Array<{ id:string, title:string, handle:string, template_suffix:string, slug:string, url:string, created_at?:string, updated_at?:string }>, error?: string }
}

export async function pageBuilderTranslate(payload:{
  slug: string,
  store?: string,
}){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/page-builder/translate`, body, { timeout: 180000 })
  return data as { ok?: boolean, translated_sections?: number, total_sections?: number, error?: string }
}

// -------- Marketing Hub (AI Agents) --------

export async function marketingStrategist(payload:{
  page_url?: string,
  product_info?: object,
  store?: string,
  model?: string,
}){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/page-builder/marketing/strategist`, body, { timeout: 90000 })
  return data as { data?: { product_summary?: string, angles: Array<{ name: string, big_idea: string, target_audience: { description: string, demographics: string, interests: string[], lookalike_suggestion: string }, method: { primary: string, secondary: string, budget_split: string, funnel_stage: string }, timing: { best_days: string[], best_hours: string, seasonality_note: string, launch_tip: string }, estimated_cpa_range: string, confidence_score: number }> }, error?: string }
}

export async function marketingCopywriter(payload:{
  angle: any,
  product_info?: object,
  page_url?: string,
  store?: string,
  model?: string,
}){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/page-builder/marketing/copywriter`, body, { timeout: 90000 })
  return data as { data?: { angle_name?: string, headlines: string[], sub_headlines: string[], ad_copy: { short: string, medium: string, long: string }, cta_options: string[], hooks: string[], hashtags: string[] }, error?: string }
}

export async function marketingMediaBuyer(payload:{
  angle: any,
  copy: any,
  product_info?: object,
  store?: string,
  model?: string,
}){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/page-builder/marketing/media-buyer`, body, { timeout: 90000 })
  return data as { data?: { image_prompts: Array<{ prompt: string, format: string, style: string, platform: string, headline_overlay: string }>, video_concepts: Array<{ title: string, duration: string, hook: string, body: string, cta: string, style: string, music_mood: string }>, format_recommendations: Array<{ format: string, why: string, platform: string }>, creative_notes: string }, error?: string }
}

// -------- Product Life --------
export async function productLifeInstructionsGet(store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const q = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/product_life/instructions${q}`)
  return data as { data?: { phases: Record<string, string[]> }, error?: string }
}

export async function productLifeInstructionsSet(payload:{ phases: Record<string, string[]>, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/product_life/instructions`, body)
  return data as { data?: { phases: Record<string, string[]> }, error?: string }
}

// -------- Campaign AI Analyzer --------
export type CampaignAnalysisResult = {
  customer_profile: Record<string, any>
  overall_verdict?: string
  confidence_level?: string
  summary?: string
  recommendations: Array<{
    priority: number
    category: string
    finding: string
    recommendation: string
    expected_impact: string
  }>
  scaling_plan: {
    current_phase?: string
    verdict?: string
    next_steps?: string[]
    budget_recommendation?: string
    timeline?: string
  }
  creative_analysis?: {
    headline_score?: number
    headline_feedback?: string
    ad_copy_score?: number
    ad_copy_feedback?: string
    suggested_headlines?: string[]
    suggested_ad_copy?: string
  }
  customer_alignment?: {
    score?: number
    gaps?: string[]
    opportunities?: string[]
  }
  meta_inputs?: Record<string, any>
  ad_creatives_input?: Array<Record<string, string>>
  product_info_input?: Record<string, any>
}

export async function campaignAnalyze(payload: {
  campaign_id?: string
  campaign_ids?: string[]
  product_id?: string
  store?: string
  ad_account?: string
  date_range?: { start: string, end: string }
  metrics?: Record<string, any>
  campaign_age_days?: number
  campaign_key?: string
}, options?: { signal?: AbortSignal }): Promise<{ data?: CampaignAnalysisResult, error?: string }>{
  const body = { ...payload, store: payload.store ?? selectedStore() }
  // Step 1: Start the job (returns immediately with job_id)
  const startRes = await axios.post(`${base}/api/campaign/analyze`, body, { timeout: 15000, signal: options?.signal })
  const jobId = startRes.data?.job_id
  if(!jobId){
    // Fallback: old-style response with data/error directly
    return startRes.data as { data?: CampaignAnalysisResult, error?: string }
  }
  // Step 2: Poll for result every 3 seconds (up to 5 minutes)
  const maxAttempts = 100  // 100 * 3s = 5 minutes
  for(let i = 0; i < maxAttempts; i++){
    if(options?.signal?.aborted) return { error: 'Analysis cancelled' }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 3000)
      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('Analysis cancelled', 'AbortError'))
      }, { once: true })
    })
    try{
      const statusRes = await axios.get(`${base}/api/campaign/analyze/status/${jobId}`, { timeout: 10000, signal: options?.signal })
      const job = statusRes.data
      if(job.status === 'done'){
        return { data: job.result as CampaignAnalysisResult }
      }
      if(job.status === 'error'){
        return { error: job.error || 'Analysis failed' }
      }
      if(job.status === 'not_found'){
        return { error: 'Job not found' }
      }
      // status === 'pending' → keep polling
    }catch(pollErr: any){
      // Network blip during polling — keep trying
      console.warn('Analysis poll error:', pollErr?.message)
    }
  }
  return { error: 'Analysis timed out after 5 minutes' }
}

// -------- Campaign Analysis Checks (implementation checkmarks) --------
export async function campaignAnalysisChecksSave(payload: { campaign_key: string, checks: Record<string, boolean>, store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/campaign/analysis_checks`, body)
  return data as { data?: any, error?: string }
}

export async function campaignAnalysisChecksGet(campaign_key: string, store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const qp = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/campaign/analysis_checks/${encodeURIComponent(campaign_key)}${qp}`)
  return data as { data?: Record<string, boolean>, error?: string }
}

// -------- Action Tasks (AI-generated management task list) --------
export type ActionTask = {
  id: string
  priority: number
  urgency: string
  category: string
  title: string
  description: string
  campaigns: string[]
  expected_impact: string
  done: boolean
}

export type ActionTasksResult = {
  summary: string
  urgent_count: number
  tasks: ActionTask[]
}

export async function generateActionTasks(payload: {
  analyses: any[]
  store?: string
}): Promise<{ data?: ActionTasksResult, error?: string }>{
  const body = { ...payload, store: payload.store ?? selectedStore() }
  // Step 1: Start the job
  const startRes = await axios.post(`${base}/api/campaign/generate_action_tasks`, body, { timeout: 15000 })
  const jobId = startRes.data?.job_id
  if(!jobId){
    return startRes.data as { data?: ActionTasksResult, error?: string }
  }
  // Step 2: Poll for result every 3 seconds (up to 3 minutes)
  const maxAttempts = 60
  for(let i = 0; i < maxAttempts; i++){
    await new Promise(r => setTimeout(r, 3000))
    try{
      const statusRes = await axios.get(`${base}/api/campaign/generate_action_tasks/status/${jobId}`, { timeout: 10000 })
      const job = statusRes.data
      if(job.status === 'done'){
        return { data: job.result as ActionTasksResult }
      }
      if(job.status === 'error'){
        return { error: job.error || 'Task generation failed' }
      }
    }catch(pollErr: any){
      console.warn('Action task poll error:', pollErr?.message)
    }
  }
  return { error: 'Task generation timed out after 3 minutes' }
}

export async function getActionTasks(store?: string): Promise<{ data?: ActionTasksResult, error?: string }>{
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const qp = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/campaign/action_tasks${qp}`)
  return data as { data?: ActionTasksResult, error?: string }
}

export async function saveActionTasks(payload: { tasks: ActionTask[], store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/campaign/action_tasks/save`, body)
  return data as { data?: any, error?: string }
}

export async function clearActionTasks(store?: string){
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const qp = params.length? `?${params.join('&')}` : ''
  const {data} = await axios.delete(`${base}/api/campaign/action_tasks${qp}`)
  return data as { data?: { ok: boolean }, error?: string }
}


// -------- Bulk Analyze All Active Campaigns --------
export type BulkAnalysisJob = {
  job_id?: string
  status: 'pending' | 'fetching_campaigns' | 'analyzing' | 'generating_tasks' | 'done' | 'error'
  progress?: { done: number, total: number, phase: string }
  error?: string
  result?: {
    task_count?: number
    incomplete_count?: number
    summary?: string
    analyses_count?: number
    groups_analyzed?: string[]
    message?: string
  }
  date_range?: { start: string, end: string }
  updated_at?: string
}

export async function analyzeAllCampaigns(payload: {
  store?: string
  ad_account?: string
  ad_accounts?: string[]
  date_range?: { start: string, end: string }
}): Promise<{ job_id?: string, error?: string }> {
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const { data } = await axios.post(`${base}/api/campaign/analyze_all`, body, { timeout: 15000 })
  return data as { job_id?: string, error?: string }
}

export async function getAnalyzeAllStatus(jobId: string, store?: string): Promise<BulkAnalysisJob> {
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const qp = params.length ? `?${params.join('&')}` : ''
  const { data } = await axios.get(`${base}/api/campaign/analyze_all/status/${encodeURIComponent(jobId)}${qp}`, { timeout: 10000 })
  return data as BulkAnalysisJob
}

export async function getLatestBulkAnalysis(store?: string): Promise<{ data?: BulkAnalysisJob | null, error?: string }> {
  const params: string[] = []
  const s = store ?? selectedStore()
  if(s) params.push(`store=${encodeURIComponent(s)}`)
  const qp = params.length ? `?${params.join('&')}` : ''
  const { data } = await axios.get(`${base}/api/campaign/analyze_all/latest${qp}`)
  return data as { data?: BulkAnalysisJob | null, error?: string }
}
