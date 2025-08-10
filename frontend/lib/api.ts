import axios from 'axios'
const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
export async function launchTest(payload:{audience:string, benefits:string[], pain_points:string[], base_price?:number, title?:string, images?:File[]}){
  const form = new FormData()
  form.append('audience', payload.audience)
  form.append('benefits', JSON.stringify(payload.benefits))
  form.append('pain_points', JSON.stringify(payload.pain_points))
  if(payload.base_price!=null) form.append('base_price', String(payload.base_price))
  if(payload.title) form.append('title', payload.title)
  for(const f of (payload.images||[])) form.append('images', f)
  const {data} = await axios.post(`${base}/api/tests`, form, { headers:{'Content-Type':'multipart/form-data'} })
  return data as { test_id:string, status:string }
}
