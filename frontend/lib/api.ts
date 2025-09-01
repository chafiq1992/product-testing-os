import axios from 'axios'
// When the frontend is served by FastAPI on the same domain we can use a relative URL.
const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
export async function launchTest(payload:{audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, images?:File[], targeting?:any, advantage_plus?:boolean, adset_budget?:number}){
  const form = new FormData()
  form.append('audience', payload.audience)
  form.append('benefits', JSON.stringify(payload.benefits))
  form.append('pain_points', JSON.stringify(payload.pain_points))
  if(payload.base_price!=null) form.append('base_price', String(payload.base_price))
  if(payload.title) form.append('title', payload.title)
  if(payload.targeting) form.append('targeting', typeof payload.targeting==='string'? payload.targeting : JSON.stringify(payload.targeting))
  if(typeof payload.advantage_plus==='boolean') form.append('advantage_plus', String(payload.advantage_plus))
  if(typeof payload.adset_budget==='number') form.append('adset_budget', String(payload.adset_budget))
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