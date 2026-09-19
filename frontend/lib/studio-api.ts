import axios from 'axios'

const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
export type TokenPreview = {stage:string, model:string, input_tokens:number, max_output_tokens:number, warning_threshold:number, hard_input_limit:number, requires_confirmation:boolean, blocked:boolean, image_count:number, image_model?:string, image_quality?:string, note:string, ticket:string|null}
type ApprovalHandler = (preview:TokenPreview)=>Promise<boolean>
let approvalHandler:ApprovalHandler|null = null
export function setStudioApprovalHandler(handler:ApprovalHandler|null){ approvalHandler = handler }
export const TEXT_MODELS = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
export const IMAGE_MODELS = [
  {id:'gpt-image-2.5-flare', label:'Image 2.5 Flare · Fast'},
  {id:'gpt-image-2.5-sunburst', label:'Image 2.5 Sunburst · Precise edits'},
  {id:'gpt-image-2', label:'GPT Image 2'},
]

async function post(path:string, payload:any):Promise<any> {
  try {
    // Freeze the request: editing inputs while the dialog is open requires a new preview.
    const snapshot = JSON.parse(JSON.stringify(payload))
    const {data:preview} = await axios.post<TokenPreview>(`${base}/api/studio/preflight/${path}`, snapshot, {timeout:60000})
    if(!approvalHandler) throw new Error('Token approval is unavailable. Refresh Studio before generating.')
    const accepted = await approvalHandler(preview)
    if(preview.blocked || !accepted) throw new Error('Generation cancelled. No generation request was sent.')
    if(!preview.ticket) throw new Error('Token preview is invalid. Generation was blocked.')
    const {data} = await axios.post(`${base}/api/studio/${path}`, snapshot, {timeout: 900000, headers:{'X-Studio-Ticket':preview.ticket, ...(preview.requires_confirmation?{'X-Studio-Approve-High':'yes'}:{})}})
    if(data.error) throw new Error(data.error)
    window.dispatchEvent(new CustomEvent('studio-token-result',{detail:{stage:preview.stage, tokens:data._tokens}}))
    return data
  } catch(error:any) {
    const detail = error?.response?.data?.detail
    throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d:any)=>`${d.loc?.slice(1).join('.')}: ${d.msg}`).join('; ') : error.message || 'This step failed. Please retry.')
  }
}
export const llmGenerateAngles = (payload:any)=>post('steps/angles', payload)
export const llmTitleDescription = (payload:any)=>post('steps/title_desc', payload)
export const llmLandingCopy = (payload:any)=>post('steps/landing_copy', payload)
export const productFromImage = (payload:any)=>post('steps/product_from_image', payload)
export const generateStudioImages = (payload:any)=>post('images', payload)
