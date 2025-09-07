import axios from 'axios'
// When the frontend is served by FastAPI on the same domain we can use a relative URL.
const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
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
  settings?: { model?:string, advantage_plus?:boolean, adset_budget?:number, targeting?:any, countries?:string[], saved_audience_id?:string }
}){
  const {data} = await axios.post(`${base}/api/flows/draft`, payload)
  return data as { id:string, status:string }
}

export async function updateDraft(id: string, payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
  image_urls?: string[],
  flow?: any,
  ui?: any,
  prompts?: { angles_prompt?:string, title_desc_prompt?:string, landing_copy_prompt?:string },
  settings?: { model?:string, advantage_plus?:boolean, adset_budget?:number, targeting?:any, countries?:string[], saved_audience_id?:string }
}){
  const {data} = await axios.put(`${base}/api/flows/draft/${id}`, payload)
  return data as { id:string, status:string }
}

export async function fetchSavedAudiences(){
  const {data} = await axios.get(`${base}/api/meta/audiences`)
  return data as { data: Array<{id:string,name:string,description?:string}>, error?:string }
}

// LLM interactive endpoints
export async function llmGenerateAngles(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
  num_angles:number,
  model?:string,
  prompt?:string
}){
  const {data} = await axios.post(`${base}/api/llm/angles`, payload)
  return data as { angles: any[] }
}

export async function llmTitleDescription(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
  angle:any,
  prompt?:string,
  model?:string,
  image_urls?:string[]
}){
  const {data} = await axios.post(`${base}/api/llm/title_desc`, payload)
  return data as { title:string, description:string }
}

export async function llmLandingCopy(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
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

export async function shopifyCreateFromCopy(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
  angle?:any,
  title:string,
  description:string,
  landing_copy:any,
  image_urls?:string[]
}){
  const {data} = await axios.post(`${base}/api/shopify/create_from_copy`, payload)
  return data as { page_url?:string|null, test_id?:string }
}

export async function metaLaunchFromPage(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
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
  const {data} = await axios.post(`${base}/api/shopify/upload_images`, payload)
  return data as { urls: string[], images?: any[] }
}

export async function shopifyCreateProductFromTitleDesc(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, sizes?:string[], colors?:string[] },
  angle?: any,
  title: string,
  description?: string
}){
  const {data} = await axios.post(`${base}/api/shopify/product_create_from_title_desc`, payload)
  return data as { product_gid?: string, handle?: string }
}

export async function shopifyUpdateDescription(payload:{ product_gid:string, description_html:string }){
  const {data} = await axios.post(`${base}/api/shopify/update_description`, payload)
  return data as { product_gid?: string, handle?: string }
}

export async function shopifyCreatePageFromCopy(payload:{
  title: string,
  landing_copy: any,
  image_urls?: string[]
}){
  const {data} = await axios.post(`${base}/api/shopify/create_page_from_copy`, payload)
  return data as { page_url?: string }
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
  for(const f of (payload.files||[])) form.append('files', f)
  const {data} = await axios.post(`${base}/api/shopify/upload_files`, form, { headers:{'Content-Type':'multipart/form-data'} })
  return data as { urls: string[], images?: any[], per_image?: any[] }
}

// Gemini image generation (ad image from source image + prompt)
export async function geminiGenerateAdImages(payload:{ image_url:string, prompt:string, num_images?:number, neutral_background?: boolean }){
  const {data} = await axios.post(`${base}/api/gemini/ad_image`, payload)
  return data as { images: string[], prompt: string, input_image_url: string, error?: string }
}

export async function geminiGeneratePromotionalSet(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, currency?:string, sizes?:string[], colors?:string[] },
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
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, currency?:string, sizes?:string[], colors?:string[] },
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