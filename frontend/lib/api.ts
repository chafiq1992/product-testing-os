import axios from 'axios'
// When the frontend is served by FastAPI on the same domain we can use a relative URL.
const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
function selectedStore(){
  try{ return typeof window!=='undefined'? (localStorage.getItem('ptos_store')||undefined) : undefined }catch{ return undefined }
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

// Meta Ads: list active campaigns with insights
export type MetaCampaignRow = {
  campaign_id?: string,
  name?: string,
  spend: number,
  purchases: number,
  cpp?: number|null,
  ctr?: number|null,
  add_to_cart: number,
}
export async function fetchMetaCampaigns(datePreset?: string, adAccount?: string){
  const parts: string[] = []
  if(datePreset) parts.push(`date_preset=${encodeURIComponent(datePreset)}`)
  if(adAccount) parts.push(`ad_account=${encodeURIComponent(adAccount)}`)
  const qp = parts.length? `?${parts.join('&')}` : ''
  const {data} = await axios.get(`${base}/api/meta/campaigns${qp}`)
  return data as { data: MetaCampaignRow[], error?: string }
}

// Shopify: count orders by line item title substring for a time range
export async function shopifyOrdersCountByTitle(payload:{ names: string[], start: string, end: string, store?: string, include_closed?: boolean, date_field?: 'processed'|'created' }){
  const body = { ...payload, store: payload.store ?? selectedStore(), include_closed: payload.include_closed ?? true, date_field: payload.date_field ?? 'created' }
  const {data} = await axios.post(`${base}/api/shopify/orders_count_by_title`, body)
  return data as { data: { [name:string]: number }, error?: string }
}

export async function shopifyProductsBrief(payload:{ ids: string[], store?: string }){
  const body = { ...payload, store: payload.store ?? selectedStore() }
  const {data} = await axios.post(`${base}/api/shopify/products_brief`, body)
  return data as { data: { [id:string]: { image?: string|null, total_available: number, zero_variants: number } }, error?: string }
}

export async function shopifyOrdersCountByCollection(payload:{ collection_id: string, start: string, end: string, store?: string, include_closed?: boolean, aggregate?: 'orders'|'items'|'sum_product_orders', date_field?: 'processed'|'created' }){
  const body = { ...payload, store: payload.store ?? selectedStore(), include_closed: payload.include_closed ?? true, aggregate: payload.aggregate ?? 'items', date_field: payload.date_field ?? 'created' }
  const {data} = await axios.post(`${base}/api/shopify/orders_count_by_collection`, body)
  return data as { data: { count: number }, error?: string }
}