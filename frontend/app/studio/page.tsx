'use client'
import { useEffect, useRef, useState, Suspense } from 'react'
import { motion } from 'framer-motion'
import {
  Rocket,
  Play,
  Save,
  CirclePlay,
  AlertCircle,
  CheckCircle2,
  FileText,
  Megaphone,
  Image as ImageIcon,
  Trash,
} from 'lucide-react'

import Dropzone from '@/components/Dropzone'
import TagsInput from '@/components/TagsInput'
import { launchTest, getTest, fetchSavedAudiences, llmGenerateAngles, llmTitleDescription, llmLandingCopy, metaLaunchFromPage, uploadImages, shopifyCreateProductFromTitleDesc, shopifyCreatePageFromCopy, shopifyUploadProductFiles, shopifyUpdateDescription, saveDraft, updateDraft, geminiGenerateAdImages, geminiGenerateVariantSet, shopifyUploadProductImages } from '@/lib/api'
import { useSearchParams } from 'next/navigation'

function Button({ children, onClick, disabled, variant = 'default', size = 'md' }:{children:React.ReactNode,onClick?:()=>void,disabled?:boolean,variant?:'default'|'outline',size?:'sm'|'md'}){
  const base='rounded-xl font-semibold transition inline-flex items-center justify-center'
  const sz = size==='sm' ? 'text-sm px-3 py-1.5' : 'px-4 py-2'
  const vr = variant==='outline' ? 'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60' : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60'
  return <button onClick={onClick} disabled={disabled} className={`${base} ${sz} ${vr}`}>{children}</button>
}
function Card({ children }:{children:React.ReactNode}){ return <div className="bg-white border rounded-2xl shadow-sm">{children}</div> }
function CardHeader({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pt-4 ${className}`}>{children}</div> }
function CardTitle({ children, className='' }:{children:React.ReactNode,className?:string}){ return <h3 className={`font-semibold ${className}`}>{children}</h3> }
function CardContent({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pb-4 ${className}`}>{children}</div> }
function Badge({ children, className='' }:{children:React.ReactNode,className?:string}){ return <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${className}`}>{children}</span> }
function Input(props: React.InputHTMLAttributes<HTMLInputElement>){ return <input {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>){ return <textarea {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }
function Separator({ className='' }:{className?:string}){ return <div className={`border-t ${className}`} /> }

type NodeType = 'trigger'|'action'|'delay'|'exit'
type Port = 'in'|'out'
type RunState = { status:'idle'|'running'|'success'|'error', output:any, error:any, startedAt:string|null, finishedAt:string|null, ms:number }
type FlowNode = { id:string, type:NodeType, x:number, y:number, data:any, selected?:boolean, run:RunState }
type FlowEdge = { id:string, from:string, fromPort:Port|string, to:string, toPort:Port|string }

let idSeq=1; const nextId=()=> `n${idSeq++}`
const now = () => new Date().toISOString()
const wait = (ms:number) => new Promise(res=>setTimeout(res, ms))

function makeNode(type:NodeType, x:number, y:number, data:any={}) : FlowNode {
  return { id: nextId(), type, x, y, data, selected:false, run:{status:'idle',output:null,error:null,startedAt:null,finishedAt:null,ms:0} }
}
function makeEdge(from:string, fromPort:Port|string, to:string, toPort:Port|string) : FlowEdge {
  return { id: nextId(), from, fromPort, to, toPort }
}

function defaultFlow(){
  const t = makeNode('trigger', 120, 140, { name:'New Product', topic:'new_product' })
  const gen = makeNode('action', 420, 120, { label:'Generate Angles', type:'generate_angles', numAngles:2 })
  const edges = [ makeEdge(t.id, 'out', gen.id, 'in') ]
  return { nodes:[t,gen], edges }
}

export default function Page(){
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading…</div>}>
      <StudioPage/>
    </Suspense>
  )
}

function StudioPage(){
  const params = useSearchParams()
  const testParam = params.get('id')

  const [flow,setFlow]=useState<{nodes:FlowNode[],edges:FlowEdge[]}>(defaultFlow())
  const [selected,setSelected]=useState<string|null>(null)
  const [zoom,setZoom]=useState(1)
  const [pan,setPan]=useState<{x:number,y:number}>({x:0,y:0})
  const [running,setRunning]=useState(false)
  const [activeNodeId,setActiveNodeId]=useState<string|null>(null)
  const [runLog,setRunLog]=useState<{time:string,level:'info'|'error',msg:string,nodeId?:string}[]>([])
  const canvasRef = useRef<HTMLDivElement|null>(null)
  const flowRef = useRef(flow)
  useEffect(()=>{ flowRef.current = flow },[flow])

  // preload from existing test when id provided
  useEffect(()=>{
    (async()=>{
      if(!testParam) return
      try{
        const t = await getTest(testParam)
        const p = (t as any)?.payload||{}
        if(p?.audience) setAudience(p.audience)
        if(p?.title) setTitle(p.title)
        if(p?.base_price!=null) setPrice(Number(p.base_price))
        if(Array.isArray(p?.benefits)) setBenefits(p.benefits)
        if(Array.isArray(p?.pain_points)) setPains(p.pain_points)
        if(Array.isArray(p?.uploaded_images)) setUploadedUrls(p.uploaded_images)
        // Restore flow snapshot if present
        if(p?.flow && Array.isArray(p.flow.nodes) && Array.isArray(p.flow.edges)){
          setFlow({ nodes: p.flow.nodes, edges: p.flow.edges })
        }
        // Restore UI state
        if(p?.ui){
          if(typeof p.ui.zoom==='number') setZoom(p.ui.zoom)
          if(p.ui.pan && typeof p.ui.pan.x==='number' && typeof p.ui.pan.y==='number') setPan({x:p.ui.pan.x,y:p.ui.pan.y})
          if(typeof p.ui.selected==='string' || p.ui.selected===null) setSelected(p.ui.selected)
        }
        // Restore prompts
        if(p?.prompts){
          if(typeof p.prompts.angles_prompt==='string') setAnglesPrompt(p.prompts.angles_prompt)
          if(typeof p.prompts.title_desc_prompt==='string') setTitleDescPrompt(p.prompts.title_desc_prompt)
          if(typeof p.prompts.landing_copy_prompt==='string') setLandingCopyPrompt(p.prompts.landing_copy_prompt)
          if(typeof (p.prompts as any).gemini_ad_prompt==='string') setGeminiAdPrompt((p.prompts as any).gemini_ad_prompt)
          if(typeof (p.prompts as any).gemini_variant_style_prompt==='string') setGeminiVariantStylePrompt((p.prompts as any).gemini_variant_style_prompt)
        }
        // Restore settings
        if(p?.settings){
          if(typeof p.settings.model==='string') setModel(p.settings.model)
          if(typeof p.settings.advantage_plus==='boolean') setAdvantagePlus(p.settings.advantage_plus)
          if(typeof p.settings.adset_budget==='number') setAdsetBudget(p.settings.adset_budget)
          if(Array.isArray(p.settings.countries)) setCountries(p.settings.countries)
          if(typeof p.settings.saved_audience_id==='string') setSelectedSavedAudience(p.settings.saved_audience_id)
        }
        setTestId((t as any)?.id)
      }catch{}
    })()
  },[testParam])

  type RunHistoryEntry = {
    id:string,
    time:string,
    inputs:{ audience:string, title:string, price:number|'', benefits:string[], pains:string[], files:string[] },
    nodes:Array<{ id:string, type:NodeType, data:any, run:RunState }>,
    edges:FlowEdge[],
    log:{time:string,level:'info'|'error',msg:string,nodeId?:string}[]
  }
  const [history,setHistory]=useState<RunHistoryEntry[]>([])
  useEffect(()=>{ try{ const raw=localStorage.getItem('flow_history'); if(raw){ setHistory(JSON.parse(raw)) } }catch{} },[])
  function saveHistory(entry:RunHistoryEntry){ const next=[entry, ...history].slice(0,20); setHistory(next); try{ localStorage.setItem('flow_history', JSON.stringify(next)) }catch{} }

  const [audience,setAudience]=useState('Parents of toddlers in Morocco')
  const [title,setTitle]=useState('')
  const [price,setPrice]=useState<number|''>('')
  const [benefits,setBenefits]=useState<string[]>(['Comfy all-day wear'])
  const [pains,setPains]=useState<string[]>(['Kids scuff shoes'])
  const [files,setFiles]=useState<File[]>([])
  const [adsetBudget,setAdsetBudget]=useState<number|''>(9)
  const [model,setModel]=useState<string>('gpt-4o-mini')
  const [uploadedUrls,setUploadedUrls]=useState<string[]|null>(null)
  const [anglesPrompt,setAnglesPrompt]=useState<string>(
    "You are a senior CRO & direct-response strategist.\n"
    + "Task: From the provided PRODUCT_INFO (and optional IMAGES), identify the dominant buying driver and primary friction, then generate 2–5 distinct ad angles that are most likely to convert. Prioritize angles with clear proof, risk reversal, and a concrete, specific promise. Use only facts present in PRODUCT_INFO; if you must infer, mark it [ASSUMPTION].\n\n"
    + "Method:\n"
    + "1) Diagnose Fit (audience, pains, outcomes, offer, price, guarantees, constraints/region/language).\n"
    + "2) Choose 2–5 angle patterns (PAS, Social Proof, Risk Reversal, Speed/Convenience, Value, Emotional/Why-Now).\n"
    + "3) Map proof to each claim (reviews, numbers, materials, policies).\n"
    + "4) Pre-empt 2–3 objections per angle.\n"
    + "5) If IMAGES provided, map them to angle/hooks by URL (never invent URLs).\n\n"
    + "Output:\n"
    + "Return ONE valid json object with:\n"
    + "- diagnosis { dominant_driver, primary_friction, why_these_angles }\n"
    + "- angles[] each with:\n"
    + "  name, big_idea, promise, ksp[3-5], headlines[5-8], titles[3-5],\n"
    + "  primaries { short, medium, long }, objections[{q,rebuttal}],\n"
    + "  proof[], cta{label,url}, image_map{used[],notes}, lp_snippet{hero_headline,subheadline,bullets[]}\n"
    + "- scores per angle: relevance, desire_intensity, differentiation, proof_strength, objection_coverage, clarity, visual_fit, total\n"
    + "- recommendation { best_angle, why, first_test_assets[], next_tests[] }\n\n"
    + "Style & Localization:\n"
    + "- Match language in PRODUCT_INFO (\"ar\" Fus’ha, \"fr\", or \"en\").\n"
    + "- If region == \"MA\", add Morocco trust signals (Cash on Delivery, fast city delivery, easy returns, WhatsApp support).\n"
    + "- Be concrete and benefit-led. Avoid vague hype.\n\n"
    + "CRITICAL: Output must be a single valid json object only (no markdown, no explanations)."
  )
  const [titleDescPrompt,setTitleDescPrompt]=useState<string>(
    "You are a CRO copywriter. From the given angle, write 5 HIGH-CONVERTING product title options for {audience}. Each ≤60 characters, plus one extra ultra-short option ≤30 characters. Include the primary keyword, 1 concrete benefit/outcome, and a unique differentiator (material/feature/offer). Use specific power words, no fluff, no emojis, no ALL CAPS.\n"
    + "Then pick the single best option and output ONLY valid JSON: {\\\"title\\\": string, \\\"description\\\": string}. The description should be 1–2 sentences, brand-safe, concrete, and benefit-led."
  )
  const [landingCopyPrompt,setLandingCopyPrompt]=useState<string>(
    "You are a CRO specialist and landing-page copy engineer.\n"
    + "Goal: Produce a single json object with high-converting landing copy and a complete HTML page (inline styles) that embeds only the image URLs provided by the user.\n\n"
    + "Output Contract\n"
    + "Return one valid json object (no markdown, no prose) with these keys:\n"
    + "- headline (string)\n"
    + "- subheadline (string)\n"
    + "- sections (array of { id, title, body, image_url|null, image_alt })\n"
    + "  Recommended IDs: \"hero\",\"highlights\",\"colors\",\"feature_gallery\",\"quick_specs\",\"trust_badges\",\"reviews\",\"cta_block\"\n"
    + "- faq (array of { q, a })\n"
    + "- cta ({ primary_label, primary_url, secondary_label, secondary_url })\n"
    + "- html (string) — a complete, self-contained page using inline CSS, mobile-first\n"
    + "- assets_used (object) mapping provided images actually used\n\n"
    + "Image Mapping Rules\n"
    + "- Use only provided image URLs; never invent URLs.\n"
    + "- Prefer an image labeled \"hero\" for the hero section; else first wide image.\n"
    + "- Map remaining images to \"feature_gallery\" (≤10) and \"reviews\" if labels include \"review\".\n"
    + "- If input includes \"colors\", render a \"colors\" section with pills (no images).\n"
    + "- Always set meaningful image_alt; if no suitable image for a section, image_url = null.\n\n"
    + "Copy Guidelines\n"
    + "- Follow audience & tone from input; default to parents in Morocco (warm, trustworthy).\n"
    + "- Focus on benefits, differentiation, clear outcomes; short paragraphs; bullets where helpful.\n"
    + "- If region is \"MA\", include trust signals: Cash on Delivery, fast city delivery, easy returns, WhatsApp support.\n"
    + "- Match requested language (\"ar\" for Fus’ha, \"fr\", or \"en\").\n\n"
    + "Layout Spec for html\n"
    + "1) Hero (gradient, big headline, subhead, primary CTA, optional hero image)\n"
    + "2) Highlights (4–6 bullet benefits)\n"
    + "3) Color Options (if provided)\n"
    + "4) Feature Gallery (up to 10 cards with image + short copy)\n"
    + "5) Quick Specs (compact two-column list/table)\n"
    + "6) Trust Badges (styled text badges, no external icons)\n"
    + "7) Reviews (2–3 short testimonials; generic labels if names missing)\n"
    + "8) CTA Block (bold final CTA + optional secondary CTA)\n"
    + "9) Footer (small print, contact)\n\n"
    + "Styling constraints (inline CSS only):\n"
    + "- Use brand primary (fallback #004AAD); rounded cards, soft shadows, generous spacing, system fonts.\n"
    + "- Buttons large & mobile-first; accessible contrast.\n"
    + "- All images: loading=\"lazy\", width:100%, height:auto, border-radius:12px.\n\n"
    + "Validation:\n"
    + "- html must be valid and self-contained (no external CSS/JS).\n"
    + "- Use only provided image URLs.\n"
    + "- Ensure all CTAs use provided URLs; if missing, use \"#\".\n"
    + "- CRITICAL: Output must be a single valid json object only (no markdown, no explanations)."
  )
  const [geminiAdPrompt,setGeminiAdPrompt]=useState<string>(
    "Create a high‑quality, very attractive ecommerce ad image from this product photo. Keep the product realistic, enhance lighting/background for social feeds, and make it pop without adding text or logos."
  )
  const [geminiVariantStylePrompt,setGeminiVariantStylePrompt]=useState<string>(
    'Professional, clean background, soft studio lighting, crisp focus, 45° angle'
  )
  const [activeLeftTab,setActiveLeftTab]=useState<'inputs'|'prompts'>('inputs')
  const [advantagePlus,setAdvantagePlus]=useState<boolean>(true)
  const [countries,setCountries]=useState<string[]>([])
  const [savedAudiences,setSavedAudiences]=useState<{id:string,name:string}[]>([])
  const [selectedSavedAudience,setSelectedSavedAudience]=useState<string>('')
  useEffect(()=>{ (async()=>{ try{ const res=await fetchSavedAudiences(); if((res as any)?.data){ setSavedAudiences((res as any).data) } }catch{} })() },[])

  // Load persisted default prompts from localStorage on first mount
  useEffect(()=>{
    try{
      const a = localStorage.getItem('ptos_prompts_angles'); if(a) setAnglesPrompt(a)
      const t = localStorage.getItem('ptos_prompts_title_desc'); if(t) setTitleDescPrompt(t)
      const l = localStorage.getItem('ptos_prompts_landing_copy'); if(l) setLandingCopyPrompt(l)
      const gA = localStorage.getItem('ptos_prompts_gemini_ad'); if(gA) setGeminiAdPrompt(gA)
      const gV = localStorage.getItem('ptos_prompts_gemini_variant_style'); if(gV) setGeminiVariantStylePrompt(gV)
    }catch{}
  },[])
  // Persist prompts to localStorage when changed
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_angles', anglesPrompt) }catch{} },[anglesPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_title_desc', titleDescPrompt) }catch{} },[titleDescPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_landing_copy', landingCopyPrompt) }catch{} },[landingCopyPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_gemini_ad', geminiAdPrompt) }catch{} },[geminiAdPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_gemini_variant_style', geminiVariantStylePrompt) }catch{} },[geminiVariantStylePrompt])

  const [testId,setTestId]=useState<string|undefined>(undefined)
  const [latestStatus,setLatestStatus]=useState<any>(null)

  const selectedNode = flow.nodes.find(n=>n.id===selected)||null
  const [previewImage,setPreviewImage]=useState<string|null>(null)

  function log(level:'info'|'error', msg:string, nodeId?:string){ setRunLog(l=>[...l,{time:now(),level,msg,nodeId}]) }

  function updateNodeRun(nodeId:string, patch:Partial<RunState>){
    setFlow(f=>({...f, nodes: f.nodes.map(n=> n.id===nodeId ? ({...n, run:{...n.run, ...patch}}) : n)}))
  }
  function finish(nodeId:string, started:number){
    const ms = Math.max(1, Math.round(performance.now()-started))
    updateNodeRun(nodeId, { finishedAt: now(), ms })
  }

  const dragRef = useRef<{id:string|null,offsetX:number,offsetY:number}>({id:null,offsetX:0,offsetY:0})
  function onNodeMouseDown(e:React.MouseEvent<HTMLDivElement>, node:FlowNode){
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    dragRef.current = { id: node.id, offsetX: e.clientX-rect.left, offsetY: e.clientY-rect.top }
    setSelected(node.id)
  }
  const panRef = useRef<{active:boolean,startX:number,startY:number,origX:number,origY:number}>({active:false,startX:0,startY:0,origX:0,origY:0})
  function onCanvasMouseDown(e:React.MouseEvent<HTMLDivElement>){
    if(e.button===1 || e.button===2){
      e.preventDefault();
      panRef.current = { active:true, startX:e.clientX, startY:e.clientY, origX:pan.x, origY:pan.y }
    }
  }
  function onMouseMove(e:React.MouseEvent<HTMLDivElement>){
    if(panRef.current.active){
      const dx = (e.clientX - panRef.current.startX)/zoom
      const dy = (e.clientY - panRef.current.startY)/zoom
      setPan({ x: panRef.current.origX + dx, y: panRef.current.origY + dy })
      return
    }
    const d=dragRef.current; if(!d.id) return; const rect = canvasRef.current?.getBoundingClientRect(); if(!rect) return;
    const newX = (e.clientX - rect.left - d.offsetX)/zoom - pan.x
    const newY = (e.clientY - rect.top - d.offsetY)/zoom - pan.y
    setFlow(f=>({...f, nodes:f.nodes.map(n=> n.id===d.id? {...n, x:newX, y:newY } : n)}))
  }
  function onMouseUp(){ dragRef.current = { id:null, offsetX:0, offsetY:0 }; panRef.current.active=false }

  async function angleGenerate(nodeId:string){
    const n = flowRef.current.nodes.find(x=>x.id===nodeId); if(!n) return
    const prompt = String(n.data?.prompt||titleDescPrompt)
    updateNodeRun(nodeId, { status:'running', startedAt: now() })
    try{
      let urls = uploadedUrls
      if((files||[]).length>0 && !urls){
        const res = await uploadImages(files)
        urls = res.urls||[]
        setUploadedUrls(urls)
      }
      const out = await llmTitleDescription({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined }, angle: n.data?.angle, prompt, model, image_urls: (urls||[]).slice(0,1) })
      updateNodeRun(nodeId, { status:'success', output: out })
    }catch(err:any){
      updateNodeRun(nodeId, { status:'error', error:String(err?.message||err) })
    }
  }

  async function onSaveDraft(){
    try{
      let urls = uploadedUrls
      if((files||[]).length>0 && !urls){
        const res = await uploadImages(files)
        urls = res.urls||[]
        setUploadedUrls(urls)
      }
      const flowSnap = { nodes: flowRef.current.nodes, edges: flowRef.current.edges }
      const uiSnap = { pan, zoom, selected }
      let targeting: any = undefined
      if(!advantagePlus){
        if(selectedSavedAudience){ targeting = { saved_audience_id: selectedSavedAudience } }
        else if(countries.length>0){ targeting = { geo_locations: { countries: countries.map(c=>c.toUpperCase()) } } }
      }
      const payload = {
        product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined },
        image_urls: urls||[],
        flow: flowSnap,
        ui: uiSnap,
        prompts: { angles_prompt: anglesPrompt, title_desc_prompt: titleDescPrompt, landing_copy_prompt: landingCopyPrompt, gemini_ad_prompt: geminiAdPrompt, gemini_variant_style_prompt: geminiVariantStylePrompt },
        settings: { model, advantage_plus: advantagePlus, adset_budget: adsetBudget===''?undefined:Number(adsetBudget), targeting, countries, saved_audience_id: selectedSavedAudience||undefined }
      }
      let res
      if(testId){ res = await updateDraft(testId, payload as any) }
      else { res = await saveDraft(payload as any) }
      setTestId(res.id)
      alert('Saved draft')
    }catch(e:any){
      alert('Failed to save draft: '+ String(e?.message||e))
    }
  }

  function angleApprove(nodeId:string){
    const n = flowRef.current.nodes.find(x=>x.id===nodeId); if(!n) return
    const out = n.run?.output
    if(!out?.title){ return }
    setFlow(f=>{
      const nodes = f.nodes.map(x=> x.id===nodeId? ({...x, data:{...x.data, approved:true}}) : x)
      const base = nodes.find(x=> x.id===nodeId)!
      const td = makeNode('action', base.x+300, base.y, { label:'Title & Description', type:'title_desc', value:{ title: out.title, description: out.description }, landingPrompt:'Generate a concise landing page section (headline, subheadline, 2-3 bullets) based on the title and description.' })
      const edges = [...f.edges, makeEdge(nodeId, 'out', td.id, 'in')]
      const next = { nodes:[...nodes, td], edges }
      flowRef.current = next
      return next
    })
  }

  async function titleContinue(nodeId:string){
    const n = flowRef.current.nodes.find(x=>x.id===nodeId); if(!n) return
    const v = n.data?.value||{}
    updateNodeRun(nodeId, { status:'running', startedAt: now() })
    try{
      let productNodeId:string|undefined
      setFlow(f=>{
        const pn = makeNode('action', n.x+300, n.y, { label:'Create Product', type:'create_product' })
        const edges = [...f.edges, makeEdge(nodeId, 'out', pn.id, 'in')]
        const next = { nodes:[...f.nodes, pn], edges }
        flowRef.current = next
        productNodeId = pn.id
        return next
      })
      const productRes = await shopifyCreateProductFromTitleDesc({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: v.title }, angle: undefined, title: v.title, description: v.description })
      const product_gid = productRes.product_gid
      const product_handle = productRes.handle
      if(productNodeId){ updateNodeRun(productNodeId, { status:'success', output:{ product_gid } }) }

      let imagesNodeId:string|undefined
      setFlow(f=>{
        const im = makeNode('action', (n.x+300), n.y+140, { label:'Upload Images to Product', type:'upload_images' })
        const edges = [...f.edges, makeEdge(productNodeId!, 'out', im.id, 'in')]
        const next = { nodes:[...f.nodes, im], edges }
        flowRef.current = next
        imagesNodeId = im.id
        return next
      })
      let shopifyCdnUrls:string[] = []
      let shopifyImages:any[]|undefined
      let perImage:any[]|undefined
      if((files||[]).length>0 && product_gid){
        const up = await shopifyUploadProductFiles({ product_gid, files, title: v.title, description: v.description })
        const urlsFromResponse = Array.isArray(up?.urls)? up.urls : []
        const urlsFromImages = Array.isArray(up?.images)? (up.images.map((it:any)=> it?.src).filter(Boolean)) : []
        shopifyCdnUrls = (urlsFromResponse.length>0? urlsFromResponse : urlsFromImages)
        shopifyImages = up.images
        perImage = up.per_image
      }
      if(imagesNodeId){ updateNodeRun(imagesNodeId, { status:'success', output:{ images_shopify: shopifyCdnUrls, shopify_images: shopifyImages||[], per_image: perImage||[] } }) }

      const lc = await llmLandingCopy({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined }, angle: undefined, title: v.title, description: v.description, model, image_urls: shopifyCdnUrls, prompt: landingCopyPrompt, product_handle })
      if(product_gid && lc?.html){
        await shopifyUpdateDescription({ product_gid, description_html: lc.html })
      }

      let landingNodeId:string|undefined
      setFlow(f=>{
        const ln = makeNode('action', (n.x+300)+300, n.y, { label:'Create Landing', type:'create_landing' })
        const edges = [...f.edges, makeEdge(imagesNodeId!, 'out', ln.id, 'in')]
        const next = { nodes:[...f.nodes, ln], edges }
        flowRef.current = next
        landingNodeId = ln.id
        return next
      })
      const page = await shopifyCreatePageFromCopy({ title: v.title, landing_copy: lc, image_urls: shopifyCdnUrls })
      if(landingNodeId){ updateNodeRun(landingNodeId, { status:'success', output:{ url: page.page_url||null } }) }
      let metaNodeId:string|undefined
      setFlow(f=>{
        const mn = makeNode('action', ((n.x+300)+300)+300, n.y, { label:'Meta Ads', type:'meta_ads_launch' })
        const edges = [...f.edges, makeEdge(landingNodeId!, 'out', mn.id, 'in')]
        const next = { nodes:[...f.nodes, mn], edges }
        flowRef.current = next
        metaNodeId = mn.id
        return next
      })
      if(page.page_url){
        const meta = await metaLaunchFromPage({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: v.title }, page_url: page.page_url, creatives: [] })
        if(metaNodeId){ updateNodeRun(metaNodeId, { status:'success', output:{ campaign_id: meta.campaign_id||null } }) }
      }
      updateNodeRun(nodeId, { status:'success', output:{ landing_copy: lc } })

      // In parallel: spawn a Gemini ad-image generation node directly below the images node
      try{
        const sourceUrl = (shopifyCdnUrls||[])[0]
        if(sourceUrl){
          const adPrompt = String(geminiAdPrompt||'Create a high‑quality ad image from this product photo.')
          let geminiNodeId:string|undefined
          setFlow(f=>{
            const imgNode = f.nodes.find(x=>x.id===imagesNodeId!) || { x:(n.x+300), y:(n.y+140) }
            const gn = makeNode('action', imgNode.x, (imgNode.y+140), { label:'Gemini Ad Images', type:'gemini_ad_images', prompt: adPrompt, source_image_url: sourceUrl })
            const next = { nodes:[...f.nodes, gn], edges: f.edges }
            flowRef.current = next
            geminiNodeId = gn.id
            return next
          })
          // Do not auto-run; user can click Generate on the node
          // Also add a Variant Set node just below
          setFlow(f=>{
            const base = f.nodes.find(x=>x.id===geminiNodeId!) || { x:(n.x+300), y:(n.y+280) }
            const vs = makeNode('action', (base as any).x, (base as any).y+140, { label:'Gemini Variant Set', type:'gemini_variant_set', source_image_url: sourceUrl, style_prompt: String(geminiVariantStylePrompt||''), max_variants: 5 })
            const next = { nodes:[...f.nodes, vs], edges: f.edges }
            flowRef.current = next
            return next
          })
        }
      }catch{}
    }catch(err:any){
      updateNodeRun(nodeId, { status:'error', error:String(err?.message||err) })
    }
  }

  async function geminiGenerate(nodeId:string){
    const n = flowRef.current.nodes.find(x=>x.id===nodeId); if(!n) return
    const sourceUrl = n.data?.source_image_url
    if(!sourceUrl){ updateNodeRun(nodeId, { status:'error', error:'Missing source_image_url' }); return }
    updateNodeRun(nodeId, { status:'running', startedAt: now() })
    try{
      if(n.data?.type==='gemini_variant_set'){
        const stylePrompt = String(n.data?.style_prompt||geminiVariantStylePrompt||'')
        const maxVariants = typeof n.data?.max_variants==='number'? n.data.max_variants : undefined
        const resp = await geminiGenerateVariantSet({ image_url: sourceUrl, style_prompt: stylePrompt||undefined, max_variants: maxVariants })
        updateNodeRun(nodeId, { status:'success', output: resp })
      }else{
        const adPrompt = String(n.data?.prompt||geminiAdPrompt||'Create a high-quality ad image from this product photo.')
        const resp = await geminiGenerateAdImages({ image_url: sourceUrl, prompt: adPrompt, num_images: 2 })
        updateNodeRun(nodeId, { status:'success', output: resp })
      }
    }catch(e:any){
      updateNodeRun(nodeId, { status:'error', error:String(e?.message||e) })
    }
  }

  async function simulate(){
    if(running) return
    setRunLog([])
    setFlow(f=>({...f, nodes: f.nodes.map(n=> ({...n, run:{status:'idle',output:null,error:null,startedAt:null,finishedAt:null,ms:0}}))}))
    setRunning(true)
    setTestId(undefined)
    setLatestStatus(null)

    const start = flow.nodes.find(n=>n.type==='trigger')
    if(!start){ setRunning(false); return }
    await visit(start.id, { refs:{} })
    setRunning(false)
    const snap = flowRef.current
    const entry:RunHistoryEntry = {
      id: `r${Date.now()}`,
      time: now(),
      inputs: { audience, title, price, benefits, pains, files: files.map(f=>f.name) },
      nodes: snap.nodes.map(n=> ({ id:n.id, type:n.type, data:n.data, run:n.run })),
      edges: snap.edges,
      log: runLog,
    }
    saveHistory(entry)
  }

  async function visit(nodeId:string, bag:any){
    setActiveNodeId(nodeId)
    const node = flow.nodes.find(n=>n.id===nodeId); if(!node) return
    const started = performance.now()
    updateNodeRun(nodeId, { status:'running', startedAt: now() })
    try{
      if(node.type==='action'){
        const result = await executeAction(node, bag)
        updateNodeRun(nodeId, { status:'success', output: result })
        log('info', `✓ ${node.data.label||node.data.type} → done`, nodeId)
        if(node.data?.type==='generate_angles'){
          log('info', 'Waiting for angle approval…', nodeId)
          setRunning(false)
          return
        }
      }else if(node.type==='trigger'){
        log('info', `▶ trigger: ${node.data.topic||'start'}`, nodeId)
      }else if(node.type==='delay'){
        const mins = Number(node.data.minutes||0)
        log('info', `⏱ waiting ${mins} minute(s) (simulated)`, nodeId)
        await wait(600)
        updateNodeRun(nodeId, { status:'success', output:{ waited_minutes: mins } })
      }
      const outs = flow.edges.filter(e=>e.from===nodeId)
      for(const edge of outs){ await visit(edge.to, bag) }
    }catch(err:any){
      updateNodeRun(nodeId, { status:'error', error: String(err?.message||err) })
      log('error', `✗ ${node.data.label||node.data.type} → ${String(err?.message||err)}`, nodeId)
    }
    finish(nodeId, started)
  }

  async function executeAction(node:FlowNode, bag:any){
    const type = node.data.type
    await wait(300+Math.random()*300)
    if(type==='generate_angles'){
      const res = await llmGenerateAngles({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined }, num_angles: Number(node.data.numAngles||2), model, prompt: anglesPrompt })
      setFlow(f=>{
        const existingChildIds = f.nodes
          .filter(n=> n.data?.type==='angle_variant' && f.edges.some(e=> e.from===node.id && e.to===n.id))
          .map(n=>n.id)
        let nodes = f.nodes.filter(n=> !existingChildIds.includes(n.id))
        let edges = f.edges.filter(e=> e.from!==node.id && !existingChildIds.includes(e.to))
        ;(res.angles||[]).forEach((a:any, i:number)=>{
          const child = makeNode('action', node.x+300, node.y + i*160, { label:`Angle ${i+1}`, type:'angle_variant', angle:a, prompt:"Generate a concise product title (<=30 chars) and a 1-2 sentence description from this angle." })
          nodes = [...nodes, child]
          edges = [...edges, makeEdge(node.id, 'out', child.id, 'in')]
        })
        const next = { nodes, edges }
        flowRef.current = next
        return next
      })
      return { count: (res.angles||[]).length }
    }
    if(type==='launch_test'){
      let targeting: any = undefined
      if(!advantagePlus){
        if(selectedSavedAudience){ targeting = { saved_audience_id: selectedSavedAudience } }
        else if(countries.length>0){ targeting = { geo_locations: { countries: countries.map(c=>c.toUpperCase()) } } }
      }
      const res = await launchTest({
        audience,
        benefits,
        pain_points: pains,
        base_price: price===''?undefined:Number(price),
        title: title||undefined,
        images: files,
        targeting,
        advantage_plus: advantagePlus,
        adset_budget: adsetBudget===''? undefined : Number(adsetBudget),
        model,
        angles_prompt: anglesPrompt,
        title_desc_prompt: titleDescPrompt,
        landing_copy_prompt: landingCopyPrompt,
      })
      setTestId(res.test_id)
      log('info', `Launched test ${res.test_id}`, node.id)
      const info = await pollUntilDone(res.test_id)
      bag.refs.test = info
      return { test_id: res.test_id, status: info.status, request: { method:'POST', endpoint:'/api/tests' }, response: info }
    }
    if(type==='create_landing'){
      const info = bag.refs.test
      return { url: info?.page_url || null }
    }
    if(type==='meta_ads_launch'){
      const info = bag.refs.test
      return { campaign_id: info?.campaign_id || null }
    }
    throw new Error(`Unknown action type: ${type}`)
  }

  async function pollUntilDone(id:string){
    let final:any = null
    for(;;){
      try{
        const s = await getTest(id)
        setLatestStatus(s)
        const landing = flow.nodes.find(n=>n.data?.type==='create_landing')
        const ads = flow.nodes.find(n=>n.data?.type==='meta_ads_launch')
        const copy = flow.nodes.find(n=>n.data?.type==='generate_copy')
        if(copy && (s as any).result?.angles){ updateNodeRun(copy.id, { status:'success', output:{ angles: (s as any).result.angles, creatives: (s as any).result.creatives } }) }
        if(landing && s.page_url){ updateNodeRun(landing.id, { status:'success', output:{ url: s.page_url } }) }
        if(ads && s.campaign_id){ updateNodeRun(ads.id, { status:'success', output:{ campaign_id: s.campaign_id } }) }
        if(s.status==='completed' || s.status==='failed') { final=s; break }
        await wait(2000)
      }catch(err){ await wait(3000) }
    }
    return final
  }

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Product Testing OS — Flow Studio</h1>
          <Badge className="bg-blue-100 text-blue-700">New UI</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={simulate} disabled={running}><Play className="w-4 h-4 mr-1"/>Run flow</Button>
          <Button variant="outline" size="sm" onClick={onSaveDraft}><Save className="w-4 h-4 mr-1"/>Save draft</Button>
          <Button size="sm" onClick={()=>alert('Published (wire CI/CD)')}><CirclePlay className="w-4 h-4 mr-1"/>Publish</Button>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-3 p-3 h-[calc(100vh-4rem)]">
        <aside className="col-span-12 md:col-span-3 space-y-3 overflow-y-auto pb-24">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <button className={`text-sm px-3 py-1.5 rounded ${activeLeftTab==='inputs'?'bg-blue-600 text-white':'border'}`} onClick={()=>setActiveLeftTab('inputs')}>Inputs</button>
                <button className={`text-sm px-3 py-1.5 rounded ${activeLeftTab==='prompts'?'bg-blue-600 text-white':'border'}`} onClick={()=>setActiveLeftTab('prompts')}>Prompts</button>
              </div>
            </CardHeader>
          </Card>
          {activeLeftTab==='inputs' && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><ImageIcon className="w-4 h-4"/>Product inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Audience</div>
                <Input value={audience} onChange={e=>setAudience(e.target.value)} placeholder="Parents of toddlers in Morocco" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Title (optional)</div>
                  <Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Doll Sneakers – Pink" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Base price (MAD)</div>
                  <Input type="number" value={price} onChange={e=> setPrice(e.target.value===''? '': Number(e.target.value))} placeholder="189" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Ad set daily budget (USD)</div>
                  <Input type="number" min={1} value={adsetBudget} onChange={e=> setAdsetBudget(e.target.value===''? '': Number(e.target.value))} placeholder="9" />
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Key benefits</div>
                <TagsInput value={benefits} onChange={setBenefits} placeholder="Add benefit & Enter" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Pain points</div>
                <TagsInput value={pains} onChange={setPains} placeholder="Add pain & Enter" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Images (optional)</div>
                <Dropzone files={files} onFiles={setFiles} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">LLM model</div>
                <select value={model} onChange={e=>setModel(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm">
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4.1">gpt-4.1</option>
                  <option value="gpt-5">gpt-5</option>
                </select>
              </div>
            </CardContent>
          </Card>
          )}
          {activeLeftTab==='prompts' && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Prompts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Angles prompt</div>
                <Textarea rows={4} value={anglesPrompt} onChange={e=>setAnglesPrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Used when generating angles.</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Title & Description prompt</div>
                <Textarea rows={4} value={titleDescPrompt} onChange={e=>setTitleDescPrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Used when generating title and description.</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Landing copy prompt</div>
                <Textarea rows={5} value={landingCopyPrompt} onChange={e=>setLandingCopyPrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Images (Shopify CDN URLs) are also sent to map section.image_url.</div>
              </div>
              <Separator/>
              <div>
                <div className="text-xs text-slate-500 mb-1">Gemini ad image prompt</div>
                <Textarea rows={3} value={geminiAdPrompt} onChange={e=>setGeminiAdPrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Default prompt used for Gemini ad images.</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Gemini variant style prompt</div>
                <Textarea rows={2} value={geminiVariantStylePrompt} onChange={e=>setGeminiVariantStylePrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Default style used for Gemini variant-set images.</div>
              </div>
            </CardContent>
          </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Megaphone className="w-4 h-4"/>Meta targeting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={advantagePlus} onChange={e=>setAdvantagePlus(e.target.checked)} />
                <span>Advantage+ audience (let Meta expand targeting)</span>
              </label>
              {!advantagePlus && (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Saved audience</div>
                    <select value={selectedSavedAudience} onChange={e=>setSelectedSavedAudience(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm">
                      <option value="">None</option>
                      {savedAudiences.map(a=> (<option key={a.id} value={a.id}>{a.name}</option>))}
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Countries (ISO codes, e.g., US, MA)</div>
                    <TagsInput value={countries} onChange={setCountries} placeholder="Add country & Enter" />
                  </div>
                </div>
              )}
              <div className="text-[11px] text-slate-500">If both saved audience and countries are provided, the saved audience takes precedence.</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Flow settings</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-500">
              <div>• Run executes: Generate copy → Launch test → Landing → Meta Ads</div>
              <div>• Status is polled from your backend and updates nodes/log.</div>
            </CardContent>
          </Card>
        </aside>

        <section className="col-span-12 md:col-span-6 relative">
          <div className="flex items-center justify-between px-2 py-1">
            <div className="text-sm text-slate-500">Flow canvas</div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-500">Zoom</div>
              <input type="range" min={50} max={140} step={10} value={zoom*100} onChange={e=>setZoom(Number(e.target.value)/100)} className="w-40"/>
            </div>
          </div>
          <Separator className="mb-2"/>

          <div ref={canvasRef} className="relative h-[calc(100%-3rem)] bg-white rounded-2xl shadow-inner overflow-hidden border" onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseDown={onCanvasMouseDown} onContextMenu={(e)=>e.preventDefault()}>
            <GridBackdrop/>
            <div className="absolute left-0 top-0 origin-top-left" style={{transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin:'0 0'}}>
              {flow.edges.map(e=> (
                <Edge key={e.id} edge={e} nodes={flow.nodes} active={running && activeNodeId===e.from} />
              ))}
              {flow.nodes.map(n=> (
                <NodeShell
                  key={n.id}
                  node={n}
                  selected={selected===n.id}
                  onMouseDown={onNodeMouseDown}
                  onDelete={(id)=> setFlow(f=>({...f, nodes:f.nodes.filter(x=>x.id!==id), edges:f.edges.filter(e=>e.from!==id && e.to!==id)}))}
                  active={running && activeNodeId===n.id}
                  trace={(latestStatus as any)?.result?.trace||[]}
                  payload={(latestStatus as any)?.payload||null}
                  onUpdateNode={(patch)=> setFlow(f=>({...f, nodes:f.nodes.map(x=> x.id===n.id? ({...x, data:{...x.data, ...patch}}) : x)}))}
                  onAngleGenerate={(id)=> angleGenerate(id)}
                  onAngleApprove={(id)=> angleApprove(id)}
                  onTitleContinue={(id)=> titleContinue(id)}
                  onGeminiGenerate={(id)=> geminiGenerate(id)}
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="col-span-12 md:col-span-3 space-y-3 overflow-y-auto pb-24">
          <Card>
            <CardHeader className="pb-2 flex items-center justify-between">
              <CardTitle className="text-base">Inspector</CardTitle>
              {selectedNode && (
                <button className="p-1 rounded hover:bg-slate-50" onClick={()=> setFlow(f=>({...f, nodes:f.nodes.filter(n=>n.id!==selectedNode.id), edges:f.edges.filter(e=>e.from!==selectedNode.id && e.to!==selectedNode.id)})) }>
                  <Trash className="w-4 h-4 text-slate-500"/>
                </button>
              )}
            </CardHeader>
            <CardContent>
              {!selectedNode && <div className="text-sm text-slate-500">Select a node to see details.</div>}
              {selectedNode && (
                <InspectorContent node={selectedNode} latestTrace={(latestStatus as any)?.result?.trace||[]} onPreview={(url)=> setPreviewImage(url)} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4"/>Run log</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-[280px] overflow-y-auto">
              {runLog.length===0 && <div className="text-xs text-slate-500">No logs yet. Click <span className="font-medium">Run flow</span>.</div>}
              {runLog.map((l,i)=> (
                <div key={i} className="text-xs flex items-start gap-2">
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full ${l.level==='error'?'bg-rose-500':'bg-emerald-500'}`} />
                  <div>
                    <div className="text-slate-500">{new Date(l.time).toLocaleTimeString()} • <span className="font-mono">{l.nodeId}</span></div>
                    <div className={l.level==='error'? 'text-rose-600':'text-slate-700'}>{l.msg}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Status</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {testId && <div className="text-slate-600">Test <span className="font-mono">{testId}</span></div>}
              {latestStatus && (
                <div className="text-xs text-slate-500 mt-2 space-y-1">
                  <div>Status: <span className="font-semibold">{latestStatus.status}</span></div>
                  {latestStatus.page_url && (<div>Page: <a className="underline" href={latestStatus.page_url} target="_blank">{latestStatus.page_url}</a></div>)}
                  {latestStatus.campaign_id && (<div>Meta campaign: <span className="font-mono">{latestStatus.campaign_id}</span></div>)}
                  {latestStatus.status==='failed' && (<div className="text-rose-600">Failed: {String(latestStatus.error?.message||'Unknown error')}</div>)}
                </div>
              )}
              {!latestStatus && <div className="text-xs text-slate-500">Ready.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">History</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-[240px] overflow-y-auto">
              {history.length===0 && (<div className="text-xs text-slate-500">No runs yet.</div>)}
              {history.map(h=> (
                <details key={h.id} className="border rounded-lg p-2">
                  <summary className="text-xs cursor-pointer text-slate-600">{new Date(h.time).toLocaleString()}</summary>
                  <div className="mt-2 space-y-2 text-xs">
                    <div className="text-slate-500">Inputs</div>
                    <pre className="bg-slate-50 p-2 rounded overflow-x-auto">{JSON.stringify(h.inputs,null,2)}</pre>
                    <div className="text-slate-500">Node results</div>
                    <pre className="bg-slate-50 p-2 rounded overflow-x-auto max-h-[160px]">{JSON.stringify(h.nodes.map(n=>({id:n.id, type:n.type, label:n.data?.label||n.data?.type, run:n.run})),null,2)}</pre>
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center" onClick={()=> setPreviewImage(null)}>
          <div className="max-w-5xl max-h-[90vh] p-2" onClick={(e)=> e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImage} alt="preview" className="max-w-full max-h-[85vh] rounded shadow-lg" />
          </div>
        </div>
      )}

      <footer className="fixed bottom-3 left-0 right-0 flex justify-center">
        <div className="flex items-center gap-2 bg-white/80 backdrop-blur rounded-full shadow px-3 py-2 border">
          <StatusBadge nodes={flow.nodes} />
          <Separator className="mx-1 w-px h-5"/>
          <Button variant="outline" size="sm" onClick={simulate} disabled={running}><Play className="w-4 h-4 mr-1"/>Run</Button>
          <Button variant="outline" size="sm" onClick={onSaveDraft}><Save className="w-4 h-4 mr-1"/>Save</Button>
          <Button size="sm" onClick={()=>alert('Published!')}><CirclePlay className="w-4 h-4 mr-1"/>Publish</Button>
        </div>
      </footer>
    </div>
  )
}

function StatusBadge({ nodes }:{nodes:FlowNode[]}){
  const hasErr = nodes.some(n=>n.run.status==='error')
  const allOk = nodes.every(n=> n.run.status==='idle' || n.run.status==='success')
  if (hasErr) return <Badge className="bg-rose-100 text-rose-700"><AlertCircle className="w-3 h-3"/>Errors</Badge>
  if (allOk) return <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-3 h-3"/>Ready</Badge>
  return <Badge className="bg-amber-100 text-amber-700">Running…</Badge>
}

function NodeShell({ node, selected, onMouseDown, onDelete, active, trace, payload, onUpdateNode, onAngleGenerate, onAngleApprove, onTitleContinue, onGeminiGenerate }:{ node:FlowNode, selected:boolean, onMouseDown:(e:React.MouseEvent<HTMLDivElement>, n:FlowNode)=>void, onDelete:(id:string)=>void, active:boolean, trace:any[], payload:any, onUpdateNode:(patch:any)=>void, onAngleGenerate:(id:string)=>void, onAngleApprove:(id:string)=>void, onTitleContinue:(id:string)=>void, onGeminiGenerate:(id:string)=>void }){
  const style = { left: node.x, top: node.y } as React.CSSProperties
  const ring = selected ? 'ring-2 ring-blue-500' : 'ring-1 ring-slate-200'
  const glow = active ? 'shadow-[0_0_0_4px_rgba(59,130,246,0.15)]' : ''
  return (
    <div className="absolute select-none" style={style} onMouseDown={(e)=>onMouseDown(e,node)}>
      <motion.div layout className={`rounded-2xl bg-white border ${ring} shadow ${glow} w-[260px]`}>
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge className="border border-blue-200 text-blue-700 bg-blue-50">{node.type==='trigger'?'Trigger':'Action'}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(node.run.status)}`}>{statusLabel(node.run.status)}</span>
            <button className="p-1 rounded hover:bg-slate-50" onClick={(e)=>{e.stopPropagation(); onDelete(node.id) }}><Trash className="w-3.5 h-3.5 text-slate-500"/></button>
          </div>
        </div>
        <Separator/>
        <div className="p-3 text-sm text-slate-700 min-h-[64px]">
          {renderNodeBody(node, selected, trace, payload, onUpdateNode, onAngleGenerate, onAngleApprove, onTitleContinue, onGeminiGenerate)}
        </div>
      </motion.div>
    </div>
  )
}

function statusLabel(s:RunState['status']){ return s==='idle'?'idle': s==='running'?'running': s==='success'?'ok':'error' }
function statusColor(s:RunState['status']){
  return s==='idle'? 'bg-slate-100 text-slate-600' : s==='running'? 'bg-amber-100 text-amber-700' : s==='success'? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
}

function renderNodeBody(node:FlowNode, expanded:boolean, trace:any[], payload:any, onUpdateNode:(patch:any)=>void, onAngleGenerate:(id:string)=>void, onAngleApprove:(id:string)=>void, onTitleContinue:(id:string)=>void, onGeminiGenerate:(id:string)=>void){
  if(node.type==='trigger'){
    return (
      <div className="space-y-1 text-xs">
        <div className="text-slate-500">{node.data.topic}</div>
        <div className="text-slate-500">Start when product input is ready.</div>
        {payload && (
          <details className="text-xs mt-1" open={expanded}>
            <summary className="cursor-pointer text-slate-500">Inputs</summary>
            <pre className="bg-slate-50 p-2 rounded mt-1 overflow-x-auto max-h-[160px]">{JSON.stringify(payload,null,2)}</pre>
          </details>
        )}
      </div>
    )
  }
  const t = traceForNode(node, trace)
  if(node.data?.type==='generate_angles'){
    return (
      <div className="text-xs space-y-2">
        <div className="text-slate-500">{node.data.label}</div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Angles to generate</div>
          <Input type="number" min={1} max={5} value={String(node.data.numAngles||2)} onChange={e=> onUpdateNode({numAngles: Math.max(1, Math.min(5, Number(e.target.value)||2))})} />
        </div>
        {node.run?.output && (
          <details className="text-xs mt-1" open={expanded}>
            <summary className="cursor-pointer text-slate-500">Results</summary>
            <pre className="bg-slate-50 p-2 rounded mt-1 overflow-x-auto max-h-[160px]">{JSON.stringify(node.run.output,null,2)}</pre>
          </details>
        )}
      </div>
    )
  }
  if(node.data?.type==='angle_variant'){
    const a = node.data?.angle
    return (
      <div className="text-xs space-y-2">
        <div className="text-slate-500">{node.data.label}</div>
        <details className="text-xs" open={expanded}>
          <summary className="cursor-pointer text-slate-500">Angle</summary>
          <pre className="bg-slate-50 p-2 rounded mt-1 overflow-x-auto max-h-[160px]">{JSON.stringify(a,null,2)}</pre>
        </details>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Prompt for title + description</div>
          <Textarea rows={3} value={node.data?.prompt||''} onChange={e=> onUpdateNode({prompt: e.target.value})} />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={()=> onAngleGenerate(node.id)}>Generate</Button>
          <Button size="sm" variant={node.data?.approved? 'outline':'default'} disabled={!node.run?.output || !!node.data?.approved} onClick={()=> onAngleApprove(node.id)}>
            {node.data?.approved? 'Approved' : 'Approve'}
          </Button>
        </div>
        {node.run?.output && (
          <details className="text-xs mt-1" open={expanded}>
            <summary className="cursor-pointer text-slate-500">Title & description</summary>
            <pre className="bg-slate-50 p-2 rounded mt-1 overflow-x-auto max-h-[160px]">{JSON.stringify(node.run.output,null,2)}</pre>
          </details>
        )}
      </div>
    )
  }
  if(node.data?.type==='title_desc'){
    const v = node.data?.value||{}
    return (
      <div className="text-xs space-y-2">
        <div className="text-slate-500">{node.data.label||'Title & Description'}</div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Title</div>
          <div className="font-medium text-slate-800">{v.title||'-'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Description</div>
          <div className="text-slate-700">{v.description||'-'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Prompt for landing page</div>
          <Textarea rows={4} value={node.data?.landingPrompt||''} onChange={e=> onUpdateNode({landingPrompt:e.target.value})} />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={()=> onTitleContinue(node.id)}>Continue</Button>
        </div>
      </div>
    )
  }
  if(node.data?.type==='gemini_ad_images'){
    const out = node.run?.output||{}
    const imgs: string[] = Array.isArray(out?.images)? out.images : []
    return (
      <div className="text-xs space-y-2">
        <div className="text-slate-500">{node.data.label||'Gemini Ad Images'}</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={()=> onGeminiGenerate(node.id)} disabled={node.run?.status==='running'}>Generate</Button>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(node.run.status)}`}>{statusLabel(node.run.status)}</span>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Source image</div>
          <a href={node.data?.source_image_url} target="_blank" className="underline text-blue-600 break-all">{node.data?.source_image_url}</a>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Prompt</div>
          <div className="text-slate-700 whitespace-pre-wrap">{node.data?.prompt||'-'}</div>
        </div>
        {imgs.length>0 && (
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Results</div>
            <div className="grid grid-cols-2 gap-2">
              {imgs.map((u,i)=> (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt={`gemini-${i}`} className="w-full h-24 object-cover rounded border"/>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
  if(node.data?.type==='gemini_variant_set'){
    const out = node.run?.output||{}
    const items: Array<{kind:'variant'|'composite',name?:string,description?:string,image:string,prompt:string}> = Array.isArray(out?.items)? out.items : []
    return (
      <div className="text-xs space-y-2">
        <div className="text-slate-500">{node.data.label||'Gemini Variant Set'}</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={()=> onGeminiGenerate(node.id)} disabled={node.run?.status==='running'}>Generate</Button>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(node.run.status)}`}>{statusLabel(node.run.status)}</span>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Source image</div>
          <a href={node.data?.source_image_url} target="_blank" className="underline text-blue-600 break-all">{node.data?.source_image_url}</a>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Style prompt</div>
          <Textarea rows={2} value={String(node.data?.style_prompt||'')} onChange={e=> onUpdateNode({style_prompt: e.target.value})} />
        </div>
        {items.length>0 && (
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Results</div>
            <div className="grid grid-cols-2 gap-2">
              {items.map((it,i)=> (
                <div key={i} className="border rounded p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.image} alt={it.kind} className="w-full h-24 object-cover rounded"/>
                  <div className="text-[10px] mt-1 text-slate-600 truncate">{it.kind==='variant'? (it.name||'Variant') : 'Composite'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="text-xs space-y-1">
      <div className="text-slate-500">{node.data.label||node.data.type}</div>
      {node.run?.output && (
        <details className="text-xs mt-1" open={expanded}>
          <summary className="cursor-pointer text-slate-500">Results</summary>
          <pre className="bg-slate-50 p-2 rounded mt-1 overflow-x-auto max-h-[160px]">{JSON.stringify(node.run.output,null,2)}</pre>
        </details>
      )}
      {!!t?.length && (
        <details className="text-xs mt-1">
          <summary className="cursor-pointer text-slate-500">Requests</summary>
          <pre className="bg-slate-50 p-2 rounded mt-1 overflow-x-auto max-h-[160px]">{JSON.stringify(t,null,2)}</pre>
        </details>
      )}
      {node.run?.error && (<div className="text-rose-600">{String(node.run.error)}</div>)}
    </div>
  )
}

function traceForNode(node:FlowNode, trace:any[]){
  if(!trace) return []
  const type = node.data?.type||node.type
  if(type==='generate_copy') return trace.filter((x:any)=>x.step==='generate_copy')
  if(type==='create_landing') return trace.filter((x:any)=>x.step==='landing_copy' || x.step==='shopify')
  if(type==='meta_ads_launch') return trace.filter((x:any)=>x.step==='meta')
  return []
}

function InspectorContent({ node, latestTrace, onPreview }:{ node:FlowNode, latestTrace:any[], onPreview:(url:string)=>void }){
  const [productGid,setProductGid]=useState<string>('')
  const [selectedUrls,setSelectedUrls]=useState<Record<string,boolean>>({})
  const out = node.run?.output||{}
  const t = traceForNode(node, latestTrace)
  let images:string[] = []
  if(node.data?.type==='gemini_ad_images'){
    images = Array.isArray(out?.images)? out.images : []
  }else if(node.data?.type==='gemini_variant_set'){
    try{ images = (Array.isArray(out?.items)? out.items : []).map((it:any)=> it?.image).filter(Boolean) }catch{ images=[] }
  }

  async function onUploadSelected(){
    try{
      const chosen = images.filter(u=> selectedUrls[u])
      if(chosen.length===0){ alert('Select image(s) to upload.'); return }
      if(!productGid){ alert('Enter Shopify product GID.'); return }
      const dataUrls = chosen.filter(u=> u.startsWith('data:'))
      const httpUrls = chosen.filter(u=> !u.startsWith('data:'))
      let uploaded:string[] = []
      if(dataUrls.length>0){
        const files = dataUrls.map((u,i)=> dataUrlToFile(u, `gemini-${i+1}.png`))
        const up = await uploadImages(files)
        uploaded = Array.isArray(up?.urls)? up.urls : []
      }
      const finalUrls = [...httpUrls, ...uploaded]
      if(finalUrls.length===0){ alert('No usable URLs to upload.'); return }
      const res = await shopifyUploadProductImages({ product_gid: productGid, image_urls: finalUrls })
      alert(`Uploaded ${res.urls?.length||0} image(s) to Shopify.`)
    }catch(e:any){
      alert('Upload failed: '+ String(e?.message||e))
    }
  }

  function toggleSelect(u:string){ setSelectedUrls(s=> ({...s, [u]: !s[u]})) }

  function dataUrlToFile(dataUrl:string, filename:string): File{
    const parts = dataUrl.split(',')
    const mime = (parts[0].match(/:(.*?);/)||[])[1] || 'image/png'
    const bstr = atob(parts[1]||'')
    let n = bstr.length
    const u8 = new Uint8Array(n)
    while(n--){ u8[n] = bstr.charCodeAt(n) }
    return new File([u8], filename, { type: mime })
  }

  return (
    <div className="text-xs space-y-3">
      <div className="text-slate-500">{node.data.label||node.data.type||node.type}</div>
      <div>
        <div className="text-slate-500 mb-1">Inputs</div>
        {node.data?.type==='gemini_ad_images' && (
          <div className="space-y-1">
            <div className="break-all"><span className="text-slate-500">source_image_url:</span> {String(node.data?.source_image_url||'-')}</div>
            <div className="whitespace-pre-wrap"><span className="text-slate-500">prompt:</span> {String(node.data?.prompt||'-')}</div>
          </div>
        )}
        {node.data?.type==='gemini_variant_set' && (
          <div className="space-y-1">
            <div className="break-all"><span className="text-slate-500">source_image_url:</span> {String(node.data?.source_image_url||'-')}</div>
            <div className="whitespace-pre-wrap"><span className="text-slate-500">style_prompt:</span> {String(node.data?.style_prompt||'')}</div>
          </div>
        )}
        {!(node.data?.type==='gemini_ad_images' || node.data?.type==='gemini_variant_set') && (
          <pre className="bg-slate-50 p-2 rounded overflow-x-auto max-h-[200px]">{JSON.stringify(node.data,null,2)}</pre>
        )}
      </div>

      {images.length>0 ? (
        <div>
          <div className="text-slate-500 mb-1">Output images</div>
          <div className="grid grid-cols-2 gap-2">
            {images.map((u,i)=> (
              <div key={i} className={`relative border rounded p-1 ${selectedUrls[u]? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`}>
                <label className="absolute top-1 left-1 bg-white/80 rounded p-0.5">
                  <input type="checkbox" checked={!!selectedUrls[u]} onChange={()=> toggleSelect(u)} />
                </label>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`img-${i}`} className="w-full h-24 object-cover rounded" onClick={()=> onPreview(u)} />
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1">
            <div className="text-[11px] text-slate-500">Shopify product GID</div>
            <input className="w-full rounded-xl border px-3 py-2" placeholder="gid://shopify/Product/1234567890" value={productGid} onChange={e=>setProductGid(e.target.value)} />
            <div className="flex justify-end">
              <button className="rounded-xl font-semibold px-3 py-1.5 bg-blue-600 text-white disabled:opacity-60" onClick={onUploadSelected} disabled={!productGid || !Object.values(selectedUrls).some(Boolean)}>Upload selected to Shopify</button>
            </div>
          </div>
        </div>
      ) : (
        node.run?.output && (
          <div>
            <div className="text-slate-500 mb-1">Results</div>
            <pre className="bg-slate-50 p-2 rounded overflow-x-auto max-h-[200px]">{JSON.stringify(node.run.output,null,2)}</pre>
          </div>
        )
      )}

      {t && t.length>0 && (
        <div>
          <div className="text-slate-500 mb-1">Requests</div>
          <pre className="bg-slate-50 p-2 rounded overflow-x-auto max-h-[200px]">{JSON.stringify(t,null,2)}</pre>
        </div>
      )}
      {node.run?.error && (
        <div className="text-rose-600">{String(node.run.error)}</div>
      )}
    </div>
  )
}

function GridBackdrop(){
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,_#eef2ff_1px,transparent_1px),linear-gradient(to_bottom,_#eef2ff_1px,transparent_1px)] bg-[size:24px_24px]"/>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.06),transparent_30%),radial-gradient(circle_at_80%_60%,rgba(14,165,233,0.06),transparent_35%)]"/>
    </div>
  )
}

function Edge({ edge, nodes, active }:{ edge:FlowEdge, nodes:FlowNode[], active:boolean }){
  const from = nodes.find(n=>n.id===edge.from)
  const to = nodes.find(n=>n.id===edge.to)
  if(!from||!to) return null
  const x1 = from.x + 240
  const y1 = from.y + 100
  const x2 = to.x + 20
  const y2 = to.y + 100
  const d = makePath(x1,y1,x2,y2)
  return (
    <svg className="absolute overflow-visible pointer-events-none" style={{left:0, top:0}}>
      <path d={d} className={`fill-none ${active? 'edge edge-active':'edge'}`} strokeWidth={active?3:2} />
    </svg>
  )
}
function makePath(x1:number,y1:number,x2:number,y2:number){
  const c = 0.4 * Math.abs(x2-x1)
  return `M ${x1} ${y1} C ${x1+c} ${y1}, ${x2-c} ${y2}, ${x2} ${y2}`
}


