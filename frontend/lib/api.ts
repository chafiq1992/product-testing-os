import axios from 'axios'
// When the frontend is served by FastAPI on the same domain we can use a relative URL.
const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
export async function launchTest(payload:{audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, images?:File[], targeting?:any, advantage_plus?:boolean, adset_budget?:number, model?:string}){
  const form = new FormData()
  form.append('audience', payload.audience)
  form.append('benefits', JSON.stringify(payload.benefits))
  form.append('pain_points', JSON.stringify(payload.pain_points))
  if(payload.base_price!=null) form.append('base_price', String(payload.base_price))
  if(payload.title) form.append('title', payload.title)
  if(payload.targeting) form.append('targeting', typeof payload.targeting==='string'? payload.targeting : JSON.stringify(payload.targeting))
  if(typeof payload.advantage_plus==='boolean') form.append('advantage_plus', String(payload.advantage_plus))
  if(typeof payload.adset_budget==='number') form.append('adset_budget', String(payload.adset_budget))
  if(payload.model) form.append('model', payload.model)
  for(const f of (payload.images||[])) form.append('images', f)
  const {data} = await axios.post(`${base}/api/tests`, form, { headers:{'Content-Type':'multipart/form-data'} })
  return data as { test_id:string, status:string }
}

export async function getTest(id: string){
  const {data} = await axios.get(`${base}/api/tests/${id}`)
  return data as { id:string, status:string, page_url?:string|null, campaign_id?:string|null, error?:any|null, payload?:any|null, result?:any|null }
}

export async function fetchSavedAudiences(){
  const {data} = await axios.get(`${base}/api/meta/audiences`)
  return data as { data: Array<{id:string,name:string,description?:string}>, error?:string }
}

// LLM interactive endpoints
export async function llmGenerateAngles(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string },
  num_angles:number,
  model?:string
}){
  const {data} = await axios.post(`${base}/api/llm/angles`, payload)
  return data as { angles: any[] }
}

export async function llmTitleDescription(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string },
  angle:any,
  prompt?:string,
  model?:string,
  image_urls?:string[]
}){
  const {data} = await axios.post(`${base}/api/llm/title_desc`, payload)
  return data as { title:string, description:string }
}

export async function llmLandingCopy(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string },
  angle?:any,
  title?:string,
  description?:string,
  model?:string,
  image_urls?: string[]
}){
  const {data} = await axios.post(`${base}/api/llm/landing_copy`, payload)
  return data as { headline?:string, subheadline?:string, sections?:any[], faq?:any[], cta?:string, html?:string }
}

export async function shopifyCreateFromCopy(payload:{
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string },
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
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string },
  page_url:string,
  creatives?:any[]
}){
  const {data} = await axios.post(`${base}/api/meta/launch_from_page`, payload)
  return data as { campaign_id?:string|null, error?:string }
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
  product:{ audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string },
  angle?: any,
  title: string,
  description?: string
}){
  const {data} = await axios.post(`${base}/api/shopify/product_create_from_title_desc`, payload)
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