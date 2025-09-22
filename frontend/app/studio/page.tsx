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
import { launchTest, getTest, getTestSlim, fetchSavedAudiences, llmGenerateAngles, llmTitleDescription, llmLandingCopy, metaDraftImageCampaign, uploadImages, shopifyCreateProductFromTitleDesc, shopifyCreatePageFromCopy, shopifyUploadProductFiles, shopifyUpdateDescription, saveDraft, updateDraft, geminiGenerateAdImages, geminiGenerateVariantSetWithDescriptions, shopifyUploadProductImages, geminiGenerateFeatureBenefitSet, productFromImage, shopifyConfigureVariants, getGlobalPrompts, setGlobalPrompts, shopifyUpdateTitle } from '@/lib/api'
import { useSearchParams } from 'next/navigation'

// Resolve displayable image URLs: avoid proxy for same-origin and trusted hosts
const __API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || ''
function toDisplayUrl(u: string){
  try{
    if(!u) return u
    if(u.startsWith('/')) return u
    if(!/^https?:\/\//i.test(u)) return u
    const urlHost = new URL(u).host
    let ownHost = ''
    try{ ownHost = __API_BASE? new URL(__API_BASE).host : (typeof window!=='undefined'? window.location.host : '') }catch{}
    const allowed = ['cdn.shopify.com','images.openai.com','oaidalleapiprodscus.blob.core.windows.net']
    const isAllowed = allowed.some(d=> urlHost===d || urlHost.endsWith('.'+d))
    const isOwn = !!ownHost && urlHost===ownHost
    return (isAllowed || isOwn)? u : `${__API_BASE}/proxy/image?url=${encodeURIComponent(u)}`
  }catch{ return u }
}

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
  const td = makeNode('action', 420, 120, { label:'Title & Description', type:'title_desc', value:{ title:'', description:'' }, landingPrompt:'Generate a concise landing page section (headline, subheadline, 2-3 bullets) based on the title and description.' })
  const edges = [ makeEdge(t.id, 'out', td.id, 'in') ]
  return { nodes:[t,td], edges }
}

function defaultPromotionFlow(){
  const t = makeNode('trigger', 120, 140, { name:'Promotion', topic:'promotion_start' })
  const gen = makeNode('action', 420, 120, { label:'Generate Offers', type:'promotion_generate_offers', numOffers:3 })
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

function StudioPage({ forcedMode }: { forcedMode?: string }){
  const params = useSearchParams()
  const mode = forcedMode || params.get('mode')
  const isPromotionMode = mode==='promotion'
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
  const productGidRef = useRef<string|null>(null)
  const [productHandle,setProductHandle] = useState<string|undefined>(undefined)

  // Fast hydration helper from a payload snapshot (DB or cache)
  function hydrateFromPayload(p:any){
    try{
      if(p?.audience) setAudience(p.audience)
      if(p?.title) setTitle(p.title)
      if(p?.base_price!=null) setPrice(Number(p.base_price))
      if(Array.isArray((p as any)?.sizes)) setSizes((p as any).sizes)
      if(Array.isArray((p as any)?.colors)) setColors((p as any).colors)
      if(Array.isArray((p as any)?.variant_descriptions)) setVariantDescriptions((p as any).variant_descriptions)
      if(Array.isArray(p?.benefits)) setBenefits(p.benefits)
      if(Array.isArray(p?.pain_points)) setPains(p.pain_points)
      if(Array.isArray(p?.uploaded_images)) setUploadedUrls(p.uploaded_images)
      if(p?.flow && Array.isArray(p.flow.nodes) && Array.isArray(p.flow.edges)){
        try{
          const galleryImages = Array.isArray((p?.ui||{}).gallery_images)? (p.ui as any).gallery_images : undefined
          const nodes = (p.flow.nodes as any[]).map((n:any)=>{
            if(n?.data?.type==='image_gallery' && Array.isArray(galleryImages)){
              const baseRun = n.run || { status:'idle', output:null, error:null, startedAt:null, finishedAt:null, ms:0 }
              return { ...n, run:{ ...baseRun, output:{ ...(baseRun?.output||{}), images: galleryImages } } }
            }
            return n
          })
          setFlow({ nodes, edges: p.flow.edges })
        }catch{
          setFlow({ nodes: p.flow.nodes, edges: p.flow.edges })
        }
      }
      if(p?.ui){
        if(typeof p.ui.zoom==='number') setZoom(p.ui.zoom)
        if(p.ui.pan && typeof p.ui.pan.x==='number' && typeof p.ui.pan.y==='number') setPan({x:p.ui.pan.x,y:p.ui.pan.y})
        if(typeof p.ui.selected==='string' || p.ui.selected===null) setSelected(p.ui.selected)
        if(typeof (p.ui as any).promotion_free_image_url==='string') setPromotionImageUrl((p.ui as any).promotion_free_image_url)
        if(typeof (p.ui as any).active_left_tab==='string'){
          const v = String((p.ui as any).active_left_tab)
          if(v==='inputs' || v==='prompts') setActiveLeftTab(v)
        }
      }
      if(p?.prompts){
        if(typeof p.prompts.angles_prompt==='string') setAnglesPrompt(p.prompts.angles_prompt)
        if(typeof p.prompts.title_desc_prompt==='string') setTitleDescPrompt(p.prompts.title_desc_prompt)
        if(typeof p.prompts.landing_copy_prompt==='string') setLandingCopyPrompt(p.prompts.landing_copy_prompt)
        if(typeof (p.prompts as any).gemini_ad_prompt==='string') setGeminiAdPrompt((p.prompts as any).gemini_ad_prompt)
        if(typeof (p.prompts as any).gemini_variant_style_prompt==='string') setGeminiVariantStylePrompt((p.prompts as any).gemini_variant_style_prompt)
      }
      if(p?.settings){
        if(typeof p.settings.model==='string') setModel(p.settings.model)
        if(typeof p.settings.advantage_plus==='boolean') setAdvantagePlus(p.settings.advantage_plus)
        if(typeof p.settings.adset_budget==='number') setAdsetBudget(p.settings.adset_budget)
        if(Array.isArray(p.settings.countries)) setCountries(p.settings.countries)
        if(typeof p.settings.saved_audience_id==='string') setSelectedSavedAudience(p.settings.saved_audience_id)
        if(typeof (p.settings as any).product_gid==='string'){ productGidRef.current = (p.settings as any).product_gid }
        if(typeof (p.settings as any).product_handle==='string'){ setProductHandle((p.settings as any).product_handle) }
      }
    }catch{}
  }

  // preload from existing test when id provided
  useEffect(()=>{
    (async()=>{
      if(!testParam){
        // Fallback: hydrate from last cached draft if available
        try{
          const lastId = sessionStorage.getItem('ptos_last_test_id')
          if(lastId){
            const cached = sessionStorage.getItem(`flow_cache_${lastId}`)
            if(cached){
              const p = JSON.parse(cached)
              hydrateFromPayload(p)
              setTestId(lastId)
            }
          }
        }catch{}
        return
      }
      try{
        // 1) Hydrate instantly from session cache if available
        try{
          const cached = sessionStorage.getItem(`flow_cache_${testParam}`)
          if(cached){
            const p = JSON.parse(cached)
            hydrateFromPayload(p)
            setTestId(testParam || undefined)
          }
        }catch{}
        // 2) Fetch authoritative payload from API in background
        const t = await getTestSlim(testParam)
        const p = (t as any)?.payload||{}
        hydrateFromPayload(p)
        setTestId((t as any)?.id)
        // Persist to cache for instant subsequent opens
        try{ sessionStorage.setItem(`flow_cache_${(t as any)?.id}`, JSON.stringify(p)) }catch{}
      }catch{}
    })()
  },[testParam])

  // History removed for performance and simplicity

  // If in promotion mode and still on the generic default flow, switch to a promotion-specific seed
  useEffect(()=>{
    if(!isPromotionMode) return
    setFlow(f=>{
      try{
        const looksDefault = (f.nodes.length===2 && f.nodes[0].type==='trigger' && (f.nodes[1].data?.type==='generate_angles'))
        if(looksDefault){ const next = defaultPromotionFlow(); flowRef.current = next; return next }
      }catch{}
      return f
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isPromotionMode])

  const [audience,setAudience]=useState('Parents of toddlers in Morocco')
  const [targetCategory,setTargetCategory]=useState<string>('unisex')
  const [title,setTitle]=useState('')
  const [price,setPrice]=useState<number|''>('')
  const [benefits,setBenefits]=useState<string[]>(['Comfy all-day wear'])
  const [pains,setPains]=useState<string[]>(['Kids scuff shoes'])
  const [sizes,setSizes]=useState<string[]>([])
  const [colors,setColors]=useState<string[]>([])
  const [files,setFiles]=useState<File[]>([])
  const [analysisImageUrl,setAnalysisImageUrl]=useState<string>('')
  const [promotionImageFiles,setPromotionImageFiles]=useState<File[]>([])
  const [promotionImageUrl,setPromotionImageUrl]=useState<string>('')
  const [variantDescriptions,setVariantDescriptions]=useState<{name:string, description?:string}[]>([])
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
    + "- Match language in PRODUCT_INFO (\"ar\" Fus'ha, \"fr\", or \"en\").\n"
    + "- If region == \"MA\", add Morocco trust signals (Cash on Delivery, fast city delivery, easy returns, WhatsApp support).\n"
    + "- Be concrete and benefit-led. Avoid vague hype.\n\n"
    + "CRITICAL: Output must be a single valid json object only (no markdown, no explanations).\n\n"
    + "Variables available: {title}, {audience}, {benefits}, {pain_points}."
  )
  const [titleDescPrompt,setTitleDescPrompt]=useState<string>(
    "You are a CRO copywriter. From the given angle, write 5 HIGH-CONVERTING product title options for {audience}. Each ≤60 characters, plus one extra ultra-short option ≤30 characters. Include the primary keyword, 1 concrete benefit/outcome, and a unique differentiator (material/feature/offer). Use specific power words, no fluff, no emojis, no ALL CAPS.\n"
    + "Then pick the single best option and output ONLY valid JSON: {\\\"title\\\": string, \\\"description\\\": string}. The description should be 1–2 sentences, brand-safe, concrete, and benefit-led."
  )
  const [landingCopyPrompt,setLandingCopyPrompt]=useState<string>(`You are a CRO specialist and landing‑page copy engineer.

GOAL
Return ONE valid JSON object (no markdown, no prose) that contains persuasive copy AND a fully self‑contained HTML page styled with the ELEGANT MINIMAL design system below. The HTML MUST be a complete document (<!DOCTYPE html><html>…</html>) with one <style> block using only inline CSS. DO NOT return loose <section> fragments.

OUTPUT CONTRACT
Return a single JSON object with keys:
- headline (string)
- subheadline (string)
- sections (array of { id, title, body, image_url|null, image_alt })
  Recommended IDs: "hero", "highlights", "colors", "feature_gallery", "quick_specs", "trust_badges", "reviews", "cta_block"
- faq (array of { q, a })
- cta ({ primary_label, primary_url, secondary_label, secondary_url })
- html (string) — a COMPLETE, mobile‑first page using INLINE CSS ONLY (no external CSS/JS)
- assets_used (object) mapping provided images used. Keys: { hero: string|null, feature_gallery: string[] }

IMAGE RULES
- Use ONLY image URLs provided by the user. NEVER invent URLs.
- Prefer an image labeled "hero" (or the first wide image) for the hero.
- Map remaining images to feature_gallery (≤10).
- If "colors" are provided in input, render a Colors section with named pills only (no images).
- Every meaningful image MUST have descriptive image_alt. If no suitable image, set image_url = null.

AUDIENCE & COPY
- Default audience: parents in Morocco (warm, trustworthy, concise).
- Focus on benefits and outcomes (comfort, durability, safety, easy care). Use short paragraphs and bullets.
- If region == "MA": include trust signals (Cash on Delivery, 24–48h city delivery, easy returns, WhatsApp support).
- Match requested language if specified ("ar" for Fus’ha, "fr", or "en").

ELEGANT MINIMAL — REQUIRED DESIGN SYSTEM (implement in <style>)
Use these tokens, classes, and layout primitives exactly so pages render with the desired elegance:
:root { --brand:#004AAD; --ink:#222; --muted:#666; --bg:#fafafa; --card:#fff; --pill:#f1f7ff; --shadow:0 8px 28px rgba(0,0,0,.08); }
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5} a{color:inherit;text-decoration:none} img{display:block;width:100%;height:auto;border-radius:12px} .container{max-width:1080px;margin:0 auto;padding:20px} .grid{display:grid;gap:18px} .g-2{grid-template-columns:repeat(2,minmax(0,1fr))} .g-3{grid-template-columns:repeat(3,minmax(0,1fr))} @media(max-width:840px){.g-2,.g-3{grid-template-columns:1fr}} .section{padding:34px 0} .card{background:var(--card);border-radius:16px;box-shadow:var(--shadow);padding:18px} .pill{background:var(--pill);border-radius:999px;padding:10px 14px;font-weight:600;color:var(--brand);display:inline-block} .badge{background:#eef4ff;border:1px solid #dfe9ff;color:var(--brand);border-radius:10px;padding:10px 12px;font-weight:700;display:inline-block} h1{font-size:clamp(28px,4vw,42px);margin:0 0 8px} h2.section-title{font-size:clamp(22px,3.2vw,30px);margin:0 0 12px} p.section-sub{margin:0 0 18px;color:var(--muted)} header{position:sticky;top:0;background:#fff;border-bottom:1px solid #eee;z-index:10} header .bar{display:flex;align-items:center;gap:12px;height:64px} .brand{width:40px;height:40px;border-radius:10px;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700} .hero{padding:40px 0;background:linear-gradient(135deg,#fef9f9,#f1f7ff)} .cta-row{display:flex;gap:12px;flex-wrap:wrap} .btn{padding:14px 22px;border-radius:999px;font-weight:700;border:0;cursor:pointer} .btn-primary{background:var(--brand);color:#fff} .btn-secondary{background:#ffd700;color:#333} .kpis{display:grid;gap:12px;grid-template-columns:repeat(4,minmax(0,1fr))} @media(max-width:900px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}} .kpi{background:var(--card);border-radius:14px;box-shadow:var(--shadow);padding:16px;display:flex;gap:12px;align-items:center} .kpi-icon{width:36px;height:36px;border-radius:10px;background:var(--pill);display:grid;place-items:center;color:var(--brand);font-weight:900} .shape{position:absolute;inset:auto auto -20px -20px;width:120px;height:120px;background:radial-gradient(120px 120px at 50% 50%,rgba(0,74,173,.12),transparent 60%);filter:blur(2px);border-radius:50%} .specs{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))} @media(max-width:760px){.specs{grid-template-columns:1fr}} .spec{background:var(--card);border-radius:12px;box-shadow:var(--shadow);padding:14px} .review{background:var(--card);border-radius:16px;box-shadow:var(--shadow);padding:16px} .footer{color:#888;border-top:1px solid #eee;padding:24px 0;margin-top:24px;text-align:center}

HTML LAYOUT ORDER (must follow)
1) Hero: gradient background, big headline + subhead, CTA buttons (primary+secondary), optional hero image inside .card with a .shape overlay.
2) Highlights: 4–6 benefit "KPIs" using .kpi items with minimalist text icons (use glyphs: ◎, ✓, ↺, ≡; NO external icon files).
3) Colors (optional): render color name pills (.pill).
4) Feature Gallery: up to 10 .card items each with <img> (loading="lazy") + short copy (h3 + p.section-sub).
5) Quick Specs: two‑column grid using .specs and .spec.
6) Trust Badges: 3–5 .badge items (Cash on Delivery, 24–48h City Delivery, Easy Returns, WhatsApp Support).
7) Reviews: 2–3 .review cards (use generic labels if names missing).
8) CTA Block: strong headline + buttons.
9) Footer: small print + contact.

ACCESSIBILITY & SEO
- Provide <title> from headline and a concise <meta name="description"> from subheadline.
- All images MUST have alt text describing the content.
- Buttons are <a> links styled as buttons; use CTA URLs (fallback "#").

STRICT VALIDATION
- The html string MUST include: <!DOCTYPE html>, <html>, <head> with <style>, and <body>.
- Do NOT return raw <section> blocks. If your draft begins with <section>, REBUILD as a full document.
- Use only provided image URLs.
- Return exactly ONE JSON object and nothing else.

RETURN
Return the JSON object with all required keys and the complete HTML in the html string.`)
  const [geminiAdPrompt,setGeminiAdPrompt]=useState<string>(
    "Ultra eye‑catching ecommerce ad image derived ONLY from the provided product photo.\n"
    + "Rules: Do NOT change product identity (colors/materials/shape/branding). No text or logos.\n"
    + "Look: premium, high-contrast hero lighting, subtle rim light, soft gradient background, tasteful glow,\n"
    + "clean reflections/shadow, product-first composition (rule of thirds/center), social-feed ready."
  )
  async function dataUrlToFileSimple(dataUrl:string, filename:string): Promise<File>{
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const type = blob.type || 'image/png'
    return new File([blob], filename, { type })
  }

  async function ensureHttpUrls(urls:string[]): Promise<string[]>{
    try{
      if(!urls || urls.length===0) return []
      const out:string[] = []
      const files: File[] = []
      const mapIdx: number[] = []
      urls.forEach((u, i)=>{
        if(typeof u==='string' && u.startsWith('data:')){ mapIdx.push(i) }
      })
      for(const i of mapIdx){ files.push(await dataUrlToFileSimple(urls[i], `gen-${i+1}.jpg`)) }
      let uploaded:string[] = []
      if(files.length>0){ try{ const up = await uploadImages(files); uploaded = Array.isArray(up?.urls)? up.urls : [] }catch{ uploaded = [] } }
      let j=0
      for(let i=0;i<urls.length;i++){
        if(urls[i].startsWith('data:')){ out.push(uploaded[j]||urls[i]); j++ }
        else{ out.push(urls[i]) }
      }
      return out
    }catch{ return urls }
  }

  const [geminiVariantStylePrompt,setGeminiVariantStylePrompt]=useState<string>(
    'Professional, clean background, soft studio lighting, crisp focus, 45° angle'
  )
  const [landingPreview,setLandingPreview]=useState<{ html?:string, json?:any, error?:string }|null>(null)
  const [landingPreviewMode,setLandingPreviewMode]=useState<'preview'|'html'>('preview')
  const [landingPreviewLoading,setLandingPreviewLoading]=useState<boolean>(false)
  const landingPromptLabel = 'Create Landing (Elegant v3 · STRICT)'
  const landingPromptType = 'create_landing'
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
  // Load app-wide defaults from server and apply to state (and persist to localStorage)
  useEffect(()=>{
    (async()=>{
      try{
        const gp = await getGlobalPrompts()
        if(gp && typeof gp==='object'){
          if(typeof gp.angles_prompt==='string'){ setAnglesPrompt(gp.angles_prompt); try{ localStorage.setItem('ptos_prompts_angles', gp.angles_prompt) }catch{} }
          if(typeof gp.title_desc_prompt==='string'){ setTitleDescPrompt(gp.title_desc_prompt); try{ localStorage.setItem('ptos_prompts_title_desc', gp.title_desc_prompt) }catch{} }
          if(typeof gp.landing_copy_prompt==='string'){ setLandingCopyPrompt(gp.landing_copy_prompt); try{ localStorage.setItem('ptos_prompts_landing_copy', gp.landing_copy_prompt) }catch{} }
          if(typeof gp.gemini_ad_prompt==='string'){ setGeminiAdPrompt(gp.gemini_ad_prompt); try{ localStorage.setItem('ptos_prompts_gemini_ad', gp.gemini_ad_prompt) }catch{} }
          if(typeof gp.gemini_variant_style_prompt==='string'){ setGeminiVariantStylePrompt(gp.gemini_variant_style_prompt); try{ localStorage.setItem('ptos_prompts_gemini_variant_style', gp.gemini_variant_style_prompt) }catch{} }
        }
      }catch{}
    })()
  },[])
  // Persist prompts to localStorage when changed
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_angles', anglesPrompt) }catch{} },[anglesPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_title_desc', titleDescPrompt) }catch{} },[titleDescPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_landing_copy', landingCopyPrompt) }catch{} },[landingCopyPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_gemini_ad', geminiAdPrompt) }catch{} },[geminiAdPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_prompts_gemini_variant_style', geminiVariantStylePrompt) }catch{} },[geminiVariantStylePrompt])

  // Keep Gemini nodes in sync with Prompts tab unless explicitly overridden on node
  useEffect(()=>{
    setFlow(f=> ({
      ...f,
      nodes: f.nodes.map(n=> {
        if(n.data?.type==='gemini_ad_images'){
          const useGlobal = (n.data?.use_global_prompt!==false)
          if(useGlobal){
            return { ...n, data:{ ...n.data, prompt: geminiAdPrompt } }
          }
        }
        return n
      })
    }))
  },[geminiAdPrompt])
  useEffect(()=>{
    setFlow(f=> ({
      ...f,
      nodes: f.nodes.map(n=> {
        if(n.data?.type==='gemini_variant_set'){
          const useGlobal = (n.data?.use_global_style!==false)
          if(useGlobal){
            return { ...n, data:{ ...n.data, style_prompt: geminiVariantStylePrompt } }
          }
        }
        return n
      })
    }))
  },[geminiVariantStylePrompt])

  const [testId,setTestId]=useState<string|undefined>(undefined)
  const [latestStatus,setLatestStatus]=useState<any>(null)

  const selectedNode = flow.nodes.find(n=>n.id===selected)||null
  const [previewImage,setPreviewImage]=useState<string|null>(null)
  const [showLeaveProtect,setShowLeaveProtect]=useState<boolean>(false)
  const [pendingHref,setPendingHref]=useState<string|undefined>(undefined)

  function log(level:'info'|'error', msg:string, nodeId?:string){ setRunLog(l=>[...l,{time:now(),level,msg,nodeId}]) }

  function updateNodeRun(nodeId:string, patch:Partial<RunState>){
    setFlow(f=>({...f, nodes: f.nodes.map(n=> n.id===nodeId ? ({...n, run:{...n.run, ...patch}}) : n)}))
  }
  function finish(nodeId:string, started:number){
    const ms = Math.max(1, Math.round(performance.now()-started))
    updateNodeRun(nodeId, { finishedAt: now(), ms })
  }

  // Persist last draft id for cross-tab navigation (e.g., return from Ads)
  useEffect(()=>{ try{ if(testId){ sessionStorage.setItem('ptos_last_test_id', testId) } }catch{} },[testId])

  // Exit protection: warn on unload/navigate away
  useEffect(()=>{
    const handler = (e: BeforeUnloadEvent)=>{
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return ()=> window.removeEventListener('beforeunload', handler)
  },[])

  // Helper: Save draft then navigate to Ads, ensuring state is in DB when leaving
  async function handleGoToAds(){
    try{
      await onSaveDraft()
    }catch{}
    try{ window.location.href = '/ads' }catch{}
  }

  const dragRef = useRef<{id:string|null,offsetX:number,offsetY:number}>({id:null,offsetX:0,offsetY:0})
  function onNodeMouseDown(e:React.MouseEvent<HTMLDivElement>, node:FlowNode){
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    dragRef.current = { id: node.id, offsetX: e.clientX-rect.left, offsetY: e.clientY-rect.top }
    setSelected(node.id)
  }
  const panRef = useRef<{active:boolean,startX:number,startY:number,origX:number,origY:number}>({active:false,startX:0,startY:0,origX:0,origY:0})
  function onCanvasMouseDown(e:React.MouseEvent<HTMLDivElement>){
    if(e.button===0 || e.button===1 || e.button===2){
      e.preventDefault();
      panRef.current = { active:true, startX:e.clientX, startY:e.clientY, origX:pan.x, origY:pan.y }
    }
  }
  const rafRef = useRef<number|null>(null)
  const pendingPosRef = useRef<{id:string,x:number,y:number}|null>(null)
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
    pendingPosRef.current = { id: d.id, x: newX, y: newY }
    if(rafRef.current==null){
      rafRef.current = requestAnimationFrame(()=>{
        const pending = pendingPosRef.current
        rafRef.current = null
        if(!pending) return
        setFlow(f=>({...f, nodes:f.nodes.map(n=> n.id===pending.id? {...n, x:pending.x, y:pending.y } : n)}))
      })
    }
  }
  function onMouseUp(){
    dragRef.current = { id:null, offsetX:0, offsetY:0 };
    panRef.current.active=false;
    if(rafRef.current){ cancelAnimationFrame(rafRef.current); rafRef.current = null }
    pendingPosRef.current = null
  }

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
      const out = await llmTitleDescription({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory }, angle: n.data?.angle, prompt, model, image_urls: (urls||[]).slice(0,1) })
      updateNodeRun(nodeId, { status:'success', output: out })
    }catch(err:any){
      updateNodeRun(nodeId, { status:'error', error:String(err?.message||err) })
    }
  }

  async function onSaveDraft(){
    try{
      let urls = uploadedUrls
      // Ensure Shopify CDN URLs as soon as user uploads files: create product if needed, then upload files to Shopify
      if((files||[]).length>0 && !urls){
        try{
          // Keep a product GID reference across actions
          if(!isPromotionMode && !productGidRef.current){
            const vTitle = title || 'Product'
            const vDesc = ''
            const prod = await shopifyCreateProductFromTitleDesc({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: vTitle, sizes, colors, target_category: targetCategory }, angle: undefined, title: vTitle, description: vDesc })
            productGidRef.current = (prod as any)?.product_gid
            const handle = (prod as any)?.handle
            if(handle){ setProductHandle(handle) }
          }
          if(!isPromotionMode && productGidRef.current){
            const up = await shopifyUploadProductFiles({ product_gid: productGidRef.current, files, title: title||'Product', description: '' })
            const urlsFromResponse = Array.isArray(up?.urls)? up.urls : []
            const urlsFromImages = Array.isArray(up?.images)? (up.images.map((it:any)=> it?.src).filter(Boolean)) : []
            urls = (urlsFromResponse.length>0? urlsFromResponse : urlsFromImages)
            setUploadedUrls(urls)
            if(urls[0]){ setAnalysisImageUrl(urls[0]) }
          }
        }catch{
          // Fallback to local upload if Shopify path fails
          const res = await uploadImages(files)
          urls = res.urls||[]
          setUploadedUrls(urls)
        }
      }
      // Compact flow snapshot to avoid oversized payloads (413)
      const slimNodes = flowRef.current.nodes.map(n=> ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
        data: n.data,
        // reset run to a lightweight default; outputs can be regenerated
        run: { status:'idle', output:null, error:null, startedAt:null, finishedAt:null, ms:0 }
      }))
      const flowSnap = { nodes: slimNodes, edges: flowRef.current.edges }
      const galNode = flowRef.current.nodes.find(x=> x.data?.type==='image_gallery')
      const galOut:any = (galNode?.run?.output||{})
      const galImages:string[] = Array.isArray(galOut?.images)? galOut.images : []
      const galSelected = (galNode?.data?.selected||{})
      const uiSnap = { pan, zoom, selected, promotion_free_image_url: promotionImageUrl, gallery_images: galImages, gallery_selected: galSelected, active_left_tab: activeLeftTab }
      let targeting: any = undefined
      if(!advantagePlus){
        if(selectedSavedAudience){ targeting = { saved_audience_id: selectedSavedAudience } }
        else if(countries.length>0){ targeting = { geo_locations: { countries: countries.map(c=>c.toUpperCase()) } } }
      }
      // If we have Shopify CDN URLs from gallery approval or uploads, prefer the first one for card preview
      let cardImage: string | undefined = undefined
      try{
        const gallery = flowRef.current.nodes.find(x=> x.data?.type==='image_gallery')
        const out = (gallery?.run?.output||{}) as any
        const cdn = Array.isArray(out?.selected_shopify_urls)? out.selected_shopify_urls : Array.isArray(out?.images)? out.images.filter((u:string)=> u.startsWith('https://cdn.shopify.com')) : []
        if(Array.isArray(cdn) && cdn.length>0){ cardImage = cdn[0] }
      }catch{}
      // If no gallery-derived image, use first uploaded Shopify CDN URL
      if(!cardImage){
        try{ if(Array.isArray(urls) && urls[0] && urls[0].startsWith('https://cdn.shopify.com')) cardImage = urls[0] }catch{}
      }
      const payload = {
        product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, variant_descriptions: variantDescriptions, target_category: targetCategory },
        image_urls: urls||[],
        flow: flowSnap,
        ui: uiSnap,
        prompts: { angles_prompt: anglesPrompt, title_desc_prompt: titleDescPrompt, landing_copy_prompt: landingCopyPrompt, gemini_ad_prompt: geminiAdPrompt, gemini_variant_style_prompt: geminiVariantStylePrompt },
        settings: { flow_type: (isPromotionMode? 'promotion' : undefined), model, advantage_plus: advantagePlus, adset_budget: adsetBudget===''?undefined:Number(adsetBudget), targeting, countries, saved_audience_id: selectedSavedAudience||undefined },
        ...(cardImage? { card_image: cardImage } : {})
      }
      let res
      if(testId){ res = await updateDraft(testId, payload as any) }
      else { res = await saveDraft(payload as any) }
      setTestId(res.id)
      // Persist a compact snapshot locally for instant reopen
      try{
        const snapshot = { ...(payload.product||{}), uploaded_images: payload.image_urls||[], flow: payload.flow, ui: payload.ui, prompts: payload.prompts, settings: payload.settings }
        sessionStorage.setItem(`flow_cache_${res.id}`, JSON.stringify(snapshot))
      }catch{}
      // silent save (no alerts)
    }catch(e:any){
      // silent failure
    }
  }

  // Autosave when changes detected (debounced, silent)
  useEffect(()=>{
    let timer: any
    let last: string | null = null
    const tick = async ()=>{
      try{
        const slimNodes = flowRef.current.nodes.map(n=> ({ id:n.id, type:n.type, x:n.x, y:n.y, data:n.data, run:{ status:'idle', output:null, error:null, startedAt:null, finishedAt:null, ms:0 } }))
        const flowSnap = { nodes: slimNodes, edges: flowRef.current.edges }
        const galNode = flowRef.current.nodes.find(x=> x.data?.type==='image_gallery')
        const galOut:any = (galNode?.run?.output||{})
        const galImages:string[] = Array.isArray(galOut?.images)? galOut.images : []
        const galSelected = (galNode?.data?.selected||{})
        const uiSnap = { pan, zoom, selected, promotion_free_image_url: promotionImageUrl, gallery_images: galImages, gallery_selected: galSelected, active_left_tab: activeLeftTab }
        let targeting: any = undefined
        if(!advantagePlus){
          if(selectedSavedAudience){ targeting = { saved_audience_id: selectedSavedAudience } }
          else if(countries.length>0){ targeting = { geo_locations: { countries: countries.map(c=>c.toUpperCase()) } } }
        }
      // Derive card image similarly to manual save
      let cardImage: string | undefined = undefined
      try{
        const gallery = flowRef.current.nodes.find(x=> x.data?.type==='image_gallery')
        const out = (gallery?.run?.output||{}) as any
        const cdn = Array.isArray(out?.selected_shopify_urls)? out.selected_shopify_urls : Array.isArray(out?.images)? out.images.filter((u:string)=> u.startsWith('https://cdn.shopify.com')) : []
        if(Array.isArray(cdn) && cdn.length>0){ cardImage = cdn[0] }
      }catch{}
      if(!cardImage){
        try{ if(Array.isArray(uploadedUrls) && uploadedUrls[0] && uploadedUrls[0].startsWith('https://cdn.shopify.com')) cardImage = uploadedUrls[0] }catch{}
      }
      const payload = {
          product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, variant_descriptions: variantDescriptions, target_category: targetCategory },
          image_urls: uploadedUrls||[],
          flow: flowSnap,
          ui: uiSnap,
        prompts: { angles_prompt: anglesPrompt, title_desc_prompt: titleDescPrompt, landing_copy_prompt: landingCopyPrompt, gemini_ad_prompt: geminiAdPrompt, gemini_variant_style_prompt: geminiVariantStylePrompt },
        settings: { flow_type: (isPromotionMode? 'promotion' : undefined), model, advantage_plus: advantagePlus, adset_budget: adsetBudget===''?undefined:Number(adsetBudget), targeting, countries, saved_audience_id: selectedSavedAudience||undefined, ...(productGidRef.current? { product_gid: productGidRef.current } : {}), ...(productHandle? { product_handle: productHandle } : {}) },
        ...(cardImage? { card_image: cardImage } : {}),
        }
        const snapshot = JSON.stringify(payload)
        if(snapshot!==last){
          last = snapshot
          try{
            if(testId){ await updateDraft(testId, payload as any) }
            else{ const res = await saveDraft(payload as any); setTestId(res.id) }
          }catch{}
        }
      }catch{}
    }
    if(timer) clearInterval(timer)
    timer = setTimeout(tick, 800)
    return ()=>{ if(timer) clearTimeout(timer) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[audience, benefits, pains, price, title, sizes, colors, model, advantagePlus, adsetBudget, countries, selectedSavedAudience, pan, zoom, selected, geminiAdPrompt, geminiVariantStylePrompt, anglesPrompt, titleDescPrompt, landingCopyPrompt])

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
      if(isPromotionMode){
        updateNodeRun(nodeId, { status:'error', error:'Product creation is disabled in Promotion mode.' })
        return
      }
      let productNodeId:string|undefined
      setFlow(f=>{
        const pn = makeNode('action', n.x+300, n.y, { label:'Create Product', type:'create_product' })
        const edges = [...f.edges, makeEdge(nodeId, 'out', pn.id, 'in')]
        const next = { nodes:[...f.nodes, pn], edges }
        flowRef.current = next
        productNodeId = pn.id
        return next
      })
      // Reuse an existing product when available; otherwise create a new one
      let product_gid = productGidRef.current
      let product_handle_local = productHandle
      if(!product_gid){
        const productRes = await shopifyCreateProductFromTitleDesc({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: v.title, sizes, colors, target_category: targetCategory }, angle: undefined, title: v.title, description: v.description })
        product_gid = productRes.product_gid || null
        product_handle_local = productRes.handle || undefined
        productGidRef.current = product_gid
        if(product_handle_local){ setProductHandle(product_handle_local) }
      }else{
        // If we already have a product, update its title to the new approved one
        const newTitle = String(v.title||'').trim()
        if(newTitle){ try{ await shopifyUpdateTitle({ product_gid, title: newTitle }) }catch{} }
      }
      if(productNodeId){ updateNodeRun(productNodeId, { status:'success', output:{ product_gid } }) }
      // Ensure variants/options/pricing/inventory are configured
      try{ if(product_gid){ await shopifyConfigureVariants({ product_gid: product_gid, base_price: price===''?undefined:Number(price), sizes, colors }) } }catch{}

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

      // Set flow-level uploaded URLs for downstream nodes and drafts
      if(shopifyCdnUrls.length>0){
        setUploadedUrls(shopifyCdnUrls)
        // Ensure analysis image URL uses Shopify CDN for consistent LLM access
        setAnalysisImageUrl(shopifyCdnUrls[0])
      }

      // After images, add Gemini generation nodes as before (suggester removed)
      try{
        const sourceUrl = (shopifyCdnUrls||[])[0]
        if(sourceUrl){
          // Include midpoint size if sizes contain numeric range
          let adPrompt = String(geminiAdPrompt||'Create a high‑quality ad image from this product photo.')
          try{
            const nums:number[] = []
            for(const s of (sizes||[])){
              const m = String(s||'').match(/[-+]?[0-9]*\.?[0-9]+/g)
              if(m){ m.forEach(x=>{ const v = Number(x); if(!Number.isNaN(v)) nums.push(v) }) }
            }
            if(nums.length>0){
              const lo = Math.min(...nums), hi = Math.max(...nums)
              const mid = lo===hi? lo : (lo+hi)/2
              const midStr = Math.abs(mid-Math.round(mid))<1e-6? String(Math.round(mid)) : String(Number(mid.toFixed(1)))
              adPrompt += ` Ensure the product shown is size ${midStr} (midpoint of provided range).`
            }
          }catch{}
          let geminiNodeId:string|undefined
          setFlow(f=>{
            const imgNode = f.nodes.find(x=>x.id===imagesNodeId!) || { x:(n.x+300), y:(n.y+140) }
            // Append category guidance to prompt
            let promptWithCategory = adPrompt
            try{
              const cat = String(targetCategory||'').toLowerCase()
              if(cat){
                const subject = cat==='girl'? 'girl' : cat==='boy'? 'boy' : cat==='unisex_kids'? 'child' : cat==='men'? 'man' : cat==='women'? 'woman' : 'person'
                promptWithCategory += ` If a human model is shown, ensure it matches this category: ${subject}.`
              }
            }catch{}
            const gn = makeNode('action', imgNode.x, (imgNode.y+240), { label:'Gemini Ad Images', type:'gemini_ad_images', prompt: promptWithCategory, source_image_url: sourceUrl, neutral_background: true, use_global_prompt: true })
            const edges = [...f.edges, makeEdge(imagesNodeId!, 'out', gn.id, 'in')]
            const next = { nodes:[...f.nodes, gn], edges }
            flowRef.current = next
            geminiNodeId = gn.id
            return next
          })
          // Add a second Ad Images node with the requested kids-model natural street scene instruction
          setFlow(f=>{
            const base = f.nodes.find(x=>x.id===geminiNodeId!) || { x:(n.x+300), y:(n.y+380) }
            // Build model line based on target category
            const modelSubject = (()=>{
              const cat = String(targetCategory||'').toLowerCase()
              if(cat==='girl') return 'girl (approx. 2–6 years)'
              if(cat==='boy') return 'boy (approx. 2–6 years)'
              if(cat==='unisex_kids') return 'child (approx. 2–6 years)'
              if(cat==='men') return 'adult man'
              if(cat==='women') return 'adult woman'
              return 'person'
            })()
            const promptStreet = (
              "Instruction\n"
              + "From the provided source image, detect every distinct visible variant (color/pattern/material) and generate exactly one ad image per variant featuring exactly ONE child (no groups) wearing the product. Do not redesign the product—match silhouette, seams, textures, prints, and colors precisely.\n\n"
              + `Source: ${sourceUrl}\n`
              + `Product type: ${title? String(title) : 'from the source image'}\n`
              + `Model: ${modelSubject}. Only one character in frame.\n\n`
              + "Ad style (must follow):\n\n"
              + "Look & pose: Professional yet spontaneous; elegant and stylish but natural (mid-step, slight turn, tying laces, casual smile). No exaggerated poses.\n\n"
              + "Wardrobe: Product is the hero; pair with neutral basics only (no logos).\n\n"
              + "Environment (choose one and keep consistent across variants): quiet school corridor, residential street sidewalk, or cozy home interior. Shallow depth-of-field, uncluttered.\n\n"
              + "Lighting & color: Soft, realistic lighting, even exposure, minimal shadows, true color; no color cast.\n\n"
              + "Global constraints: No added text, watermarks, or logos. Keep framing consistent across variants. Skin tones and lighting must be photorealistic."
            )
            const gn2 = makeNode('action', (base as any).x, (base as any).y+140, { label:'Gemini Ad Images — Natural Street Scene', type:'gemini_ad_images', prompt: promptStreet, source_image_url: sourceUrl, neutral_background: false, use_global_prompt: false })
            const edges = [...f.edges, makeEdge(imagesNodeId!, 'out', gn2.id, 'in')]
            const next = { nodes:[...f.nodes, gn2], edges }
            flowRef.current = next
            geminiNodeId = gn2.id
            return next
          })
          // Add a Feature/Benefit Close-ups node below the Ad Images node
          setFlow(f=>{
            const base = f.nodes.find(x=>x.id===geminiNodeId!) || { x:(n.x+300), y:(n.y+280) }
            const fb = makeNode('action', (base as any).x, (base as any).y+140, { label:'Gemini Feature/Benefit Close-ups', type:'gemini_feature_benefit_set', source_image_url: sourceUrl, count: 6 })
            const edges = [...f.edges, makeEdge(imagesNodeId!, 'out', fb.id, 'in')]
            const next = { nodes:[...f.nodes, fb], edges }
            flowRef.current = next
            return next
          })
          // Also add a Variant Set node just below
          setFlow(f=>{
            const base = f.nodes.find(x=>x.id===geminiNodeId!) || { x:(n.x+300), y:(n.y+280) }
            const vs = makeNode('action', (base as any).x, (base as any).y+300, { label:'Gemini Variant Set', type:'gemini_variant_set', source_image_url: sourceUrl, style_prompt: String(geminiVariantStylePrompt||''), max_variants: 5, use_global_style: true })
            const edges = [...f.edges, makeEdge(imagesNodeId!, 'out', vs.id, 'in')]
            const next = { nodes:[...f.nodes, vs], edges }
            flowRef.current = next
            return next
          })
        }
      }catch{}

      // Create Image Gallery node to collect images and gate landing page generation until approval
      let galleryNodeId:string|undefined
      setFlow(f=>{
        // Position gallery below the last Gemini node if present, else below images
        const gemNodes = f.nodes.filter(x=> x.data?.type && String(x.data.type).startsWith('gemini_'))
        const base = gemNodes[gemNodes.length-1] || f.nodes.find(x=>x.id===imagesNodeId!) || { x:(n.x+300), y:(n.y+140) }
        const gal = makeNode('action', (base as any).x+300, (base as any).y, { label:'Select Images', type:'image_gallery', product_gid, product_handle: product_handle_local, title: v.title, description: v.description, landing_prompt: landingCopyPrompt, selected:{} })
        let edges = [...f.edges, makeEdge(imagesNodeId!, 'out', gal.id, 'in')]
        // Connect all existing Gemini nodes to gallery for visual path
        gemNodes.forEach(gn=> { edges = [...edges, makeEdge(gn.id, 'out', gal.id, 'in')] })
        const next = { nodes:[...f.nodes, gal], edges }
        flowRef.current = next
        galleryNodeId = gal.id
        return next
      })
      // Initialize gallery with any Shopify CDN URLs we already have
      if(galleryNodeId){ updateNodeRun(galleryNodeId, { status:'idle', output:{ images: shopifyCdnUrls||[] } }) }

      updateNodeRun(nodeId, { status:'success', output:{ message: 'Product created. Select images in gallery to generate landing.' } })
    }catch(err:any){
      updateNodeRun(nodeId, { status:'error', error:String(err?.message||err) })
    }
  }

  async function appendImagesToGallery(galleryNodeId:string, newImages:string[]){
    try{
      if(!newImages || newImages.length===0) return
      const snap = flowRef.current
      const g = snap.nodes.find(n=> n.id===galleryNodeId)
      if(!g) return
      const cur: string[] = Array.isArray(g.run?.output?.images)? g.run.output.images : []
      const nextImgs = Array.from(new Set([...(cur||[]), ...newImages]))
      setFlow(f=> ({...f, nodes: f.nodes.map(n=> n.id===galleryNodeId? ({...n, run:{...n.run, output:{ ...(n.run?.output||{}), images: nextImgs }}}) : n)}))
    }catch{}
  }
  async function appendImagesToGalleryAuto(newImages:string[]){
    try{
      if(!newImages || newImages.length===0) return
      const snap = flowRef.current
      const gal = snap.nodes.find(x=> x.data?.type==='image_gallery')
      if(gal){ await appendImagesToGallery(gal.id, newImages) }
    }catch{}
  }
  

  async function geminiGenerate(nodeId:string, opts?: { variantOverride?: { name:string, description?:string }[] }){
    const n = flowRef.current.nodes.find(x=>x.id===nodeId); if(!n) return
    const sourceUrl = n.data?.source_image_url
    if(!sourceUrl){ updateNodeRun(nodeId, { status:'error', error:'Missing source_image_url' }); return }
    updateNodeRun(nodeId, { status:'running', startedAt: now() })
    try{
      let resp: any = null
      if(n.data?.type==='gemini_variant_set'){
        const stylePrompt = String(n.data?.style_prompt||geminiVariantStylePrompt||'')
        const maxVariants = typeof n.data?.max_variants==='number'? n.data.max_variants : undefined
        let variantsPayload = (variantDescriptions||[]).map(v=> ({ name: v.name, description: v.description }))
        if(opts?.variantOverride && Array.isArray(opts.variantOverride) && opts.variantOverride.length>0){
          variantsPayload = opts.variantOverride.map(v=> ({ name: v.name, description: v.description }))
        }
        resp = await geminiGenerateVariantSetWithDescriptions({ image_url: sourceUrl, style_prompt: stylePrompt||undefined, max_variants: maxVariants, variant_descriptions: variantsPayload.length? variantsPayload : undefined })
        // Persist data URLs to server uploads for durability
        try{
          const items = Array.isArray(resp?.items)? resp.items : []
          const images = items.map((it:any)=> it?.image).filter(Boolean)
          const http = await ensureHttpUrls(images)
          const updated = items.map((it:any, idx:number)=> ({ ...it, image: http[idx]||it.image }))
          resp = { ...(resp||{}), items: updated }
        }catch{}
        updateNodeRun(nodeId, { status:'success', output: resp })
      }else if(n.data?.type==='gemini_feature_benefit_set'){
        resp = await geminiGenerateFeatureBenefitSet({
          product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory },
          image_url: sourceUrl,
          count: typeof n.data?.count==='number'? n.data.count : 6
        })
        try{
          const items = Array.isArray(resp?.items)? resp.items : []
          const images = items.map((it:any)=> it?.image).filter(Boolean)
          const http = await ensureHttpUrls(images)
          const updated = items.map((it:any, idx:number)=> ({ ...it, image: http[idx]||it.image }))
          resp = { ...(resp||{}), items: updated }
        }catch{}
        updateNodeRun(nodeId, { status:'success', output: resp })
      }else{
        const useGlobal = (n.data?.use_global_prompt!==false)
        let adPrompt = String((useGlobal? geminiAdPrompt : n.data?.prompt)||geminiAdPrompt||'Create a high-quality ad image from this product photo.')
        try{
          const nums:number[] = []
          for(const s of (sizes||[])){
            const m = String(s||'').match(/[-+]?[0-9]*\.?[0-9]+/g)
            if(m){ m.forEach(x=>{ const v = Number(x); if(!Number.isNaN(v)) nums.push(v) }) }
          }
          if(nums.length>0){
            const lo = Math.min(...nums), hi = Math.max(...nums)
            const mid = lo===hi? lo : (lo+hi)/2
            const midStr = Math.abs(mid-Math.round(mid))<1e-6? String(Math.round(mid)) : String(Number(mid.toFixed(1)))
            adPrompt += ` Ensure the product shown is size ${midStr} (midpoint of provided range).`
          }
        }catch{}
        const numImages = (typeof n.data?.num_images==='number' && n.data.num_images>0)? n.data.num_images : 4
        resp = await geminiGenerateAdImages({ image_url: sourceUrl, prompt: adPrompt, num_images: numImages, neutral_background: (n.data?.neutral_background===false? false : true) })
        try{
          const images = Array.isArray(resp?.images)? resp.images : []
          const http = await ensureHttpUrls(images)
          resp = { ...(resp||{}), images: http }
        }catch{}
        updateNodeRun(nodeId, { status:'success', output: resp })
        // Auto-run the Feature/Benefit node if present
        try{
          const fbNode = flowRef.current.nodes.find(x=> x.data?.type==='gemini_feature_benefit_set' && x.data?.source_image_url===sourceUrl)
          if(fbNode && fbNode.run?.status==='idle'){
            await geminiGenerate(fbNode.id)
          }
        }catch{}
      }
      // After any Gemini generation, append images to the gallery node if present
      try{
        const snap = flowRef.current
        const gallery = snap.nodes.find(x=> x.data?.type==='image_gallery')
        if(gallery){
          let newImgs: string[] = []
          if(n.data?.type==='gemini_variant_set' || n.data?.type==='gemini_feature_benefit_set'){
            const items = Array.isArray((resp||{}).items)? (resp as any).items : []
            newImgs = items.map((it:any)=> it?.image).filter(Boolean)
          }else{
            const images = Array.isArray((resp||{}).images)? (resp as any).images : []
            newImgs = images
          }
          await appendImagesToGallery(gallery.id, newImgs)
        }
      }catch{}
      // Best-effort: save immediately so actions are persisted like Meta Ads Manager
      try{ await onSaveDraft() }catch{}
    }catch(e:any){
      updateNodeRun(nodeId, { status:'error', error:String(e?.message||e) })
    }
  }

  function summarizeProductForPrompt(){
    const info = {
      audience,
      benefits,
      pain_points: pains,
      base_price: (price===''? undefined : Number(price)),
      title: (title||undefined),
      sizes,
      colors,
      target_category: targetCategory,
    }
    return JSON.stringify(info)
  }

  function buildOffersPrompt(){
    const productJson = summarizeProductForPrompt()
    const refImage = promotionImageUrl || (uploadedUrls||[])[0] || ''
    return (
      "You are a senior direct-response marketer and offer strategist.\n"
      + "Task: Based on PRODUCT_INFO, propose exactly three distinct promotional offers for a test campaign. Each offer must be concrete, believable, and easy to execute in e‑commerce. Include one value-led discount offer, one bundle/BOGO offer, and one urgency/limited-time add-on offer. If PRODUCT_INFO has a reference image, consider what visuals would best sell each offer.\n\n"
      + "Output: Return ONE valid json object only with fields: instructions (string, 3–6 sentences with marketing ideas and tips to make the offers succeed), offers[3] each with { name, headline, subheadline, mechanics, price_anchor, risk_reversal, visual_idea }.\n\n"
      + `PRODUCT_INFO: ${productJson}\n`
      + (refImage? `REFERENCE_IMAGE_URL: ${refImage}\n` : '')
      + "CRITICAL: No markdown. JSON only."
    )
  }

  async function startPromotionGenerator(){
    try{
      // Seed node if not present
      let seedId:string|undefined
      setFlow(f=>{
        const trigger = f.nodes.find(n=> n.type==='trigger') || { id: nextId(), type:'trigger', x:120, y:140, data:{ name:'Promotion', topic:'promotion_start' }, selected:false, run:{status:'idle',output:null,error:null,startedAt:null,finishedAt:null,ms:0} }
        const existing = f.nodes.find(n=> n.data?.type==='promotion_generate_offers')
        if(existing){ seedId = existing.id; return f }
        const n = makeNode('action', (trigger.x+300), trigger.y, { label:'Generate Offers', type:'promotion_generate_offers', numOffers:3, prompt: buildOffersPrompt() })
        const edges = [...f.edges, makeEdge(trigger.id, 'out', n.id, 'in')]
        const next = { nodes:[...f.nodes, n], edges }
        flowRef.current = next
        seedId = n.id
        return next
      })
      if(!seedId) return
      const nodeId = seedId
      const prompt = buildOffersPrompt()
      // Persist latest prompt on the node so UI can display/edit it
      setFlow(f=> ({
        ...f,
        nodes: f.nodes.map(n=> n.id===nodeId? ({...n, data:{...n.data, prompt: String(prompt)}}) : n)
      }))
      updateNodeRun(nodeId, { status:'running', startedAt: now() })
      const formatted = String(prompt)
      const res = await llmGenerateAngles({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory }, num_angles: 3, model, prompt: formatted })
      // Map generic angles -> offers structure if needed
      let offers:any[] = []
      try{
        if(Array.isArray((res as any)?.offers)) offers = (res as any)?.offers
        else if(Array.isArray((res as any)?.angles)) offers = (res as any)?.angles.map((a:any)=> ({ name: a?.name||'Offer', headline: (a?.headlines||[])[0]||a?.big_idea||a?.promise||'Offer', subheadline: a?.lp_snippet?.subheadline||'', mechanics: a?.promise||'', price_anchor: (a?.ksp||[]).join('; '), risk_reversal: (Array.isArray(a?.objections)? (a.objections.map((o:any)=> o?.rebuttal).filter(Boolean).join(' • ')) : ''), visual_idea: a?.image_map?.notes||'' }))
      }catch{}
      const instructions = (res as any)?.instructions || (res as any)?.diagnosis?.why_these_angles || 'Follow CRO best practices and ensure clarity, proof, and risk reversal.'
      updateNodeRun(nodeId, { status:'success', output:{ count: offers.length, instructions, offers } })
      // Create three child offer nodes
      setFlow(f=>{
        let nodes = f.nodes
        let edges = f.edges
        const base = nodes.find(n=> n.id===nodeId) || { x:420, y:120 }
        const count = Math.min(3, Math.max(0, offers.length||3))
        for(let i=0;i<count;i++){
          const off = offers[i] || { name:`Offer ${i+1}`, headline:'', subheadline:'' }
          const child = makeNode('action', base.x+300, base.y + i*160, { label:`Offer ${i+1}`, type:'promotion_offer', offer: off })
          nodes = [...nodes, child]
          edges = [...edges, makeEdge(nodeId, 'out', child.id, 'in')]
        }
        const next = { nodes, edges }
        flowRef.current = next
        return next
      })
    }catch(e:any){
      // Best-effort error marker on seed node if present
      try{ const n = flowRef.current.nodes.find(x=> x.data?.type==='promotion_generate_offers'); if(n){ updateNodeRun(n.id, { status:'error', error:String(e?.message||e) }) } }catch{}
    }
  }

  async function offerGenerateImage(offerNodeId:string){
    const n = flowRef.current.nodes.find(x=> x.id===offerNodeId); if(!n) return
    const mainImage = (uploadedUrls||[])[0] || analysisImageUrl
    const freeImage = promotionImageUrl || ''
    const src = mainImage || freeImage
    if(!src){ alert('Upload or provide a main product image in Product inputs.'); return }
    const baseOffer = n.data?.offer || n.data?.offer_full || {}
    const parts:string[] = []
    if(baseOffer?.name) parts.push(String(baseOffer.name))
    if(baseOffer?.headline) parts.push('Headline: '+ String(baseOffer.headline))
    if(baseOffer?.subheadline) parts.push('Subheadline: '+ String(baseOffer.subheadline))
    if(Array.isArray(baseOffer?.bullets)) parts.push('Bullets: '+ String((baseOffer.bullets||[]).join(' • ')))
    if(baseOffer?.visual_idea) parts.push('Visual idea: '+ String(baseOffer.visual_idea))
    if(Array.isArray(baseOffer?.creative_text)) parts.push('On-image banners: '+ String((baseOffer.creative_text||[]).join(' | ')))
    const prompt = (
      'You are a senior media buyer and ecommerce marketing art director. Create three distinct, super eye-catching promotional ad images with bold banners and clear discount tags based on this offer. Keep product identity identical to the reference photo (shape, color, print, materials). Match the target audience and category.\n\n'
      + parts.join('\n') + '\n\n'
      + (freeImage? `Include a small secondary picture-in-picture using FREE_PRODUCT_IMAGE_URL as a “Free gift” badge when compositionally appropriate. FREE_PRODUCT_IMAGE_URL: ${freeImage}\n` : '')
      + (mainImage? `MAIN_IMAGE_URL: ${mainImage}\n` : '')
      + 'Ensure conversion-focused layout, strong callouts, and legible on-image text if included. Use vibrant accents that fit the brand. Provide high-contrast hero lighting and clean composition. Social-feed ready.'
    )
    let newId:string|undefined
    setFlow(f=>{
      const child = makeNode('action', n.x+300, n.y, { label:'Gemini Offer Image', type:'gemini_ad_images', prompt, source_image_url: src, neutral_background: false, use_global_prompt: false, num_images: 3 })
      const edges = [...f.edges, makeEdge(offerNodeId, 'out', child.id, 'in')]
      const next = { nodes:[...f.nodes, child], edges }
      flowRef.current = next
      newId = child.id
      return next
    })
    if(newId){ await geminiGenerate(newId) }
  }

  async function offerGenerateFull(offerNodeId:string){
    const n = flowRef.current.nodes.find(x=> x.id===offerNodeId); if(!n) return
    const offer = n.data?.offer||{}
    // Default expert prompt; users can edit per-node in Inspector
    const defaultPrompt = (
      'You are a highly skilled, knowledgeable direct-response marketing expert. Expand the following OFFER_IDEA into a complete, compelling promotional offer ready for Meta ads.\n'
      + 'Return ONE valid json object only with fields: offer { name, headline, subheadline, bullets[3-6], mechanics, price_anchor, risk_reversal, guarantee, urgency, CTA_label, creative_text[3-6] }.\n'
      + 'Rules: headlines ≤ 12 words; subheadline ≤ 18 words; bullets are concrete benefits; no emojis; clear, believable, specific; English only.'
    )
    const productJson = summarizeProductForPrompt()
    const prompt = (
      `${String(n.data?.offer_prompt||defaultPrompt)}\n\nPRODUCT_INFO: ${productJson}\nOFFER_IDEA: ${JSON.stringify(offer)}`
    )
    // Call angles API with custom prompt; backend returns full JSON
    const res = await llmGenerateAngles({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory }, num_angles: 1, model, prompt })
    let full:any = null
    try{
      if((res as any)?.offer) full = (res as any).offer
      else if((res as any)?.offers && Array.isArray((res as any).offers)) full = (res as any).offers[0]
      else if(typeof (res as any)?.headline==='string' || typeof (res as any)?.subheadline==='string') full = res
    }catch{}
    if(!full){ alert('Offer generation failed.'); return }
    setFlow(f=>{
      const child = makeNode('action', n.x+300, n.y, { label:'Offer Copy', type:'promotion_offer_copy', offer_full: full })
      const edges = [...f.edges, makeEdge(offerNodeId, 'out', child.id, 'in')]
      const next = { nodes:[...f.nodes, child], edges }
      flowRef.current = next
      return next
    })
  }

  // removed image prompt suggester flow

  async function galleryApprove(nodeId:string){
    const n = flowRef.current.nodes.find(x=>x.id===nodeId); if(!n) return
    const product_gid: string|undefined = n.data?.product_gid
    const product_handle: string|undefined = n.data?.product_handle
    const vTitle: string = n.data?.title||title
    const vDesc: string = n.data?.description||''
    const sel: Record<string,boolean> = n.data?.selected||{}
    const allImages: string[] = Array.isArray(n.run?.output?.images)? n.run.output.images : []
    const chosen = allImages.filter(u=> sel[u])
    if(chosen.length===0){ updateNodeRun(nodeId, { status:'error', error:'Select at least one image.' }); return }
    if(!product_gid){ updateNodeRun(nodeId, { status:'error', error:'Missing product GID.' }); return }
    updateNodeRun(nodeId, { status:'running', startedAt: now() })
    try{
      // Separate data URLs and http URLs
      const dataUrls = chosen.filter(u=> u.startsWith('data:'))
      const httpUrls = chosen.filter(u=> !u.startsWith('data:'))
      let cdnUrls: string[] = []
      // Upload data URLs as files directly to Shopify for CDN (with compression to avoid 413)
      if(dataUrls.length>0){
        const filesToUpload = await Promise.all(dataUrls.map((u,i)=> dataUrlToCompressedFile(u, `gallery-${i+1}.jpg`, 1600, 1600, 850*1024)))
        const up = await shopifyUploadProductFiles({ product_gid, files: filesToUpload, title: vTitle, description: vDesc })
        const urlsFromResponse = Array.isArray(up?.urls)? up.urls : []
        const urlsFromImages = Array.isArray(up?.images)? (up.images.map((it:any)=> it?.src).filter(Boolean)) : []
        cdnUrls = [...cdnUrls, ...(urlsFromResponse.length>0? urlsFromResponse : urlsFromImages)]
      }
      // Ensure any non-Shopify http URLs are attached to product to get CDN URLs
      if(httpUrls.length>0){
        const up2 = await shopifyUploadProductImages({ product_gid, image_urls: httpUrls, title: vTitle, description: vDesc })
        const urls2 = Array.isArray(up2?.urls)? up2.urls : []
        const urlsFromImages2 = Array.isArray(up2?.images)? (up2.images.map((it:any)=> it?.src).filter(Boolean)) : []
        cdnUrls = [...cdnUrls, ...(urls2.length>0? urls2 : urlsFromImages2)]
      }
      // Deduplicate
      cdnUrls = Array.from(new Set(cdnUrls))
      // Generate landing copy with selected images
      const landingPromptFinal = String(n.data?.landing_prompt||landingCopyPrompt)
      const lcRaw = await llmLandingCopy({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: vTitle||undefined, sizes, colors, target_category: targetCategory }, angle: undefined, title: vTitle, description: vDesc, model, image_urls: cdnUrls, prompt: landingPromptFinal, product_handle })
      // Sanitize landing copy to ensure only provided CDN URLs are referenced
      const sanitizeLandingCopy = (base:any, urls:string[], titleText:string)=>{
        const imgs = (urls||[]).filter(Boolean).slice(0,10)
        const sections = Array.isArray(base?.sections)? base.sections : []
        const outSections = sections.map((sec:any, idx:number)=> ({
          ...sec,
          image_url: imgs[idx % Math.max(imgs.length,1)] || null,
          image_alt: sec?.image_alt || titleText
        }))
        const hasHeroIdx = outSections.findIndex((s:any)=> s?.id==='hero')
        if(hasHeroIdx>=0){ outSections[hasHeroIdx].image_url = imgs[0] || null }
        return {
          ...base,
          sections: outSections,
          assets_used: { ...(base?.assets_used||{}), hero: imgs[0]||null, feature_gallery: imgs }
        }
      }
      const lc = sanitizeLandingCopy(lcRaw, cdnUrls, vTitle)
      // Create landing page and also update product description server-side with full landing body
      const page = await shopifyCreatePageFromCopy({ title: vTitle, landing_copy: lc, image_urls: cdnUrls, product_gid })
      // Append Create Landing and Meta nodes to show path
      let landingNodeId:string|undefined
      setFlow(f=>{
        const ln = makeNode('action', n.x+300, n.y, { label:'Create Landing', type:'create_landing', prompt: n.data?.landing_prompt||landingCopyPrompt, image_urls: cdnUrls })
        const edges = [...f.edges, makeEdge(nodeId, 'out', ln.id, 'in')]
        const next = { nodes:[...f.nodes, ln], edges }
        flowRef.current = next
        landingNodeId = ln.id
        return next
      })
      if(landingNodeId){
        updateNodeRun(landingNodeId, {
          status:'success',
          output:{
            url: page.page_url||null,
            prompt: n.data?.landing_prompt||landingCopyPrompt,
            image_urls: cdnUrls,
            landing_copy: lc,
            title: vTitle,
            description: vDesc,
          }
        })
        // Push the created landing into Ads tab and navigate
        try{
          const transfer = { landing_url: page.page_url||null, title: vTitle, images: cdnUrls }
          sessionStorage.setItem('ptos_transfer_landing', JSON.stringify(transfer))
        }catch{}
        try{ window.location.href = '/ads' }catch{}
      }
      updateNodeRun(nodeId, { status:'success', output:{ images: allImages, selected: cdnUrls, selected_shopify_urls: cdnUrls, page_url: page.page_url||null } })
    }catch(e:any){
      updateNodeRun(nodeId, { status:'error', error:String(e?.message||e) })
    }
  }

  async function dataUrlToCompressedFile(dataUrl:string, filename:string, maxW:number=1600, maxH:number=1600, maxBytes:number=850*1024): Promise<File>{
    const img = await new Promise<HTMLImageElement>((resolve, reject)=>{
      const im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = ()=> resolve(im)
      im.onerror = reject
      im.src = dataUrl
    })
    const ratio = Math.min(1, maxW / (img.naturalWidth||img.width||1), maxH / (img.naturalHeight||img.height||1))
    const targetW = Math.max(1, Math.round((img.naturalWidth||img.width)*ratio))
    const targetH = Math.max(1, Math.round((img.naturalHeight||img.height)*ratio))
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, targetW, targetH)
    // Try reducing quality until under maxBytes or min quality reached
    let quality = 0.92
    let blob: Blob | null = await new Promise(res=> canvas.toBlob(b=> res(b), 'image/jpeg', quality))
    while(blob && blob.size > maxBytes && quality > 0.6){
      quality -= 0.08
      blob = await new Promise(res=> canvas.toBlob(b=> res(b), 'image/jpeg', quality))
    }
    if(!blob){
      // Fallback to original fetch method
      const resp = await fetch(dataUrl)
      const b = await resp.blob()
      return new File([b], filename, { type: b.type||'image/jpeg' })
    }
    return new File([blob], filename, { type: 'image/jpeg' })
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
    // history disabled
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
        if(node.data?.type==='image_gallery'){
          log('info', 'Waiting for image selection…', nodeId)
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
      const outs = (flowRef.current.edges||[]).filter(e=>e.from===nodeId)
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
    if(type==='promotion_generate_offers'){
      const prompt = buildOffersPrompt()
      const formatted = String(prompt)
      // Keep node's prompt in sync for UI visibility
      setFlow(f=> ({
        ...f,
        nodes: f.nodes.map(n=> n.id===node.id? ({...n, data:{...n.data, prompt: formatted}}) : n)
      }))
      const desired = Math.max(1, Math.min(5, Number(node.data?.numOffers||3)))
      const res = await llmGenerateAngles({
        product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory },
        num_angles: desired,
        model,
        prompt: formatted
      })
      let offers:any[] = []
      try{
        if(Array.isArray((res as any)?.offers)) offers = (res as any).offers
        else if(Array.isArray((res as any)?.angles)){
          offers = (res as any).angles.map((a:any)=> ({
            name: a?.name||'Offer',
            headline: (a?.headlines||[])[0]||a?.big_idea||a?.promise||'Offer',
            subheadline: a?.lp_snippet?.subheadline||'',
            mechanics: a?.promise||'',
            price_anchor: (a?.ksp||[]).join('; '),
            risk_reversal: (Array.isArray(a?.objections)? (a.objections.map((o:any)=> o?.rebuttal).filter(Boolean).join(' • ')) : ''),
            visual_idea: a?.image_map?.notes||''
          }))
        }
      }catch{}
      // Replace existing child offer nodes connected to this generator
      setFlow(f=>{
        const existingChildIds = f.nodes
          .filter(n=> n.data?.type==='promotion_offer' && f.edges.some(e=> e.from===node.id && e.to===n.id))
          .map(n=>n.id)
        let nodes = f.nodes.filter(n=> !existingChildIds.includes(n.id))
        let edges = f.edges.filter(e=> e.from!==node.id && !existingChildIds.includes(e.to))
        const base = nodes.find(n=> n.id===node.id) || { x:420, y:120 }
        const count = Math.min(desired, Math.max(0, offers.length||desired))
        for(let i=0;i<count;i++){
          const off = offers[i] || { name:`Offer ${i+1}`, headline:'', subheadline:'' }
          const child = makeNode('action', (base as any).x+300, (base as any).y + i*160, { label:`Offer ${i+1}`, type:'promotion_offer', offer: off })
          nodes = [...nodes, child]
          edges = [...edges, makeEdge(node.id, 'out', child.id, 'in')]
        }
        const next = { nodes, edges }
        flowRef.current = next
        return next
      })
      const instructions = (res as any)?.instructions || (res as any)?.diagnosis?.why_these_angles || 'Follow CRO best practices and ensure clarity, proof, and risk reversal.'
      return { count: (offers||[]).length, instructions }
    }
    if(type==='generate_angles'){
      // Expand variables in angles prompt
      const formattedAnglesPrompt = String(anglesPrompt||'')
        .replaceAll('{title}', String(title||''))
        .replaceAll('{audience}', String(audience||''))
        .replaceAll('{benefits}', JSON.stringify(benefits||[]))
        .replaceAll('{pain_points}', JSON.stringify(pains||[]))
      const res = await llmGenerateAngles({ product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory }, num_angles: Number(node.data.numAngles||2), model, prompt: formattedAnglesPrompt })
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
    if(type==='angle_variant'){
      // Auto-generate title & description and auto-approve by creating the next node
      let urls = uploadedUrls
      try{
        if((files||[]).length>0 && !urls){
          const up = await uploadImages(files)
          urls = up.urls||[]
          setUploadedUrls(urls)
        }
      }catch{}
      const prompt = String(node.data?.prompt||titleDescPrompt)
      const out = await llmTitleDescription({
        product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory },
        angle: node.data?.angle,
        prompt,
        model,
        image_urls: (urls||[]).slice(0,1)
      })
      // Auto-approve and create Title & Description node
      setFlow(f=>{
        const nodes = f.nodes.map(x=> x.id===node.id? ({...x, data:{...x.data, approved:true}}) : x)
        const base = nodes.find(x=> x.id===node.id)!
        const td = makeNode('action', base.x+300, base.y, { label:'Title & Description', type:'title_desc', value:{ title: out.title, description: out.description }, landingPrompt:'Generate a concise landing page section (headline, subheadline, 2-3 bullets) based on the title and description.' })
        const edges = [...f.edges, makeEdge(node.id, 'out', td.id, 'in')]
        const next = { nodes:[...nodes, td], edges }
        flowRef.current = next
        return next
      })
      return out
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
        sizes,
        colors,
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

  function handleExternalNav(href:string){
    setPendingHref(href)
    setShowLeaveProtect(true)
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
              {/* New: analyze image to prefill inputs */}
              <div className="space-y-2">
                <div className="text-xs text-slate-500 mb-1">Analyze product image to prefill</div>
                <input className="w-full rounded-xl border px-3 py-2" placeholder="Paste image URL (or upload below)" value={analysisImageUrl} onChange={e=> setAnalysisImageUrl(e.target.value)} />
                {analysisImageUrl && (
                  <div className="w-full bg-slate-50 border rounded-xl overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={toDisplayUrl(analysisImageUrl)} alt="analysis" className="w-full h-40 object-cover" />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={async()=>{
                    try{
                      if(!analysisImageUrl){ alert('Paste an image URL first.'); return }
                      const res = await productFromImage({ image_url: analysisImageUrl, model })
                      if((res as any)?.error){
                        alert('Analyze error: ' + String((res as any).error))
                        return
                      }
                      const p = (res as any)?.product||{}
                      if(p.title) setTitle(p.title)
                      if(p.audience) setAudience(p.audience)
                      if(Array.isArray(p.benefits)) setBenefits(p.benefits)
                      if(Array.isArray(p.pain_points)) setPains(p.pain_points)
                      if(Array.isArray(p.colors)) setColors(p.colors)
                      if(Array.isArray(p.sizes)) setSizes(p.sizes)
                      if(Array.isArray(p.variants)) setVariantDescriptions(p.variants)
                      if(!p.title && !p.audience && !Array.isArray(p.benefits) && !Array.isArray(p.pain_points)){
                        alert('Analyze completed but no structured product info was detected.')
                      }
                    }catch(e:any){ alert('Analyze failed: '+ String(e?.message||e)) }
                  }}>Analyze</Button>
                </div>
                {variantDescriptions.length>0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">Variant descriptions</div>
                    {variantDescriptions.map((v, i)=> (
                      <div key={i} className="grid grid-cols-2 gap-2">
                        <Input value={v.name||''} onChange={e=> setVariantDescriptions(arr=> arr.map((x,idx)=> idx===i? ({...x, name:e.target.value}):x))} placeholder="Variant name" />
                        <Input value={v.description||''} onChange={e=> setVariantDescriptions(arr=> arr.map((x,idx)=> idx===i? ({...x, description:e.target.value}):x))} placeholder="Variant description" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Audience</div>
                <Input value={audience} onChange={e=>setAudience(e.target.value)} placeholder="Parents of toddlers in Morocco" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Target category</div>
                <select value={targetCategory} onChange={e=>setTargetCategory(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm">
                  <option value="girl">Girl</option>
                  <option value="boy">Boy</option>
                  <option value="unisex_kids">Unisex kids</option>
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                  <option value="unisex">Unisex</option>
                </select>
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
              {/* Budget moved to Meta Ads card */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Sizes (variants)</div>
                  <TagsInput value={sizes} onChange={setSizes} placeholder="Add size & Enter (e.g., S, M, L)" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Colors (variants)</div>
                  <TagsInput value={colors} onChange={setColors} placeholder="Add color & Enter (e.g., Red, Blue)" />
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
                <div className="text-xs text-slate-500 mb-1">Main product image</div>
                <Dropzone files={files} onFiles={(incoming)=>{
                  (async()=>{
                    try{
                      const newFiles = incoming
                      setFiles(newFiles)
                      // Try to find a created product to attach images to Shopify
                      const snap = flowRef.current
                      const productNode = snap.nodes.find(n=> n.data?.type==='create_product')
                      let productGid = (productNode?.run?.output||{} as any).product_gid
                      let urls: string[] = []
                      // If no product exists yet, create a minimal product to host images on Shopify
                      if(!isPromotionMode && !productGid){
                        try{
                          const created = await shopifyCreateProductFromTitleDesc({
                            product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: (title||undefined), sizes, colors, target_category: targetCategory },
                            angle: undefined,
                            title: ((title||'').trim()||'Offer'),
                            description: ''
                          })
                          productGid = (created as any)?.product_gid || productGid
                          try{
                            // Persist the created product so subsequent steps update instead of creating anew
                            if(productGid){ productGidRef.current = productGid }
                            const handle = (created as any)?.handle
                            if(handle){ setProductHandle(handle) }
                          }catch{}
                          // Optionally reflect creation in UI by seeding a create_product node output if the node exists
                          if(productGid && productNode){
                            updateNodeRun(productNode.id, { status:'success', output:{ product_gid: productGid } })
                          }
                        }catch{}
                      }
                      if(!isPromotionMode && productGid){
                        const up = await shopifyUploadProductFiles({ product_gid: productGid, files: newFiles, title: title||undefined, description: '' })
                        const urlsFromResponse = Array.isArray(up?.urls)? up.urls : []
                        const urlsFromImages = Array.isArray(up?.images)? (up.images.map((it:any)=> it?.src).filter(Boolean)) : []
                        urls = (urlsFromResponse.length>0? urlsFromResponse : urlsFromImages)
                      }else{
                        // Fallback to generic upload when no product exists yet and no title to create product
                        const up = await uploadImages(newFiles)
                        urls = Array.isArray(up?.urls)? up.urls : []
                      }
                      if(urls.length>0){
                        setUploadedUrls(urls)
                        // Prefill/replace Analyze image URL with Shopify/local URL
                        setAnalysisImageUrl(urls[0])
                        // If gallery node exists, append newly available images
                        try{
                          const gal = (flowRef.current.nodes.find(n=> n.data?.type==='image_gallery'))
                          if(gal){ await appendImagesToGallery(gal.id, urls) }
                        }catch{}
                        // Best-effort: save draft so Home can show flow card with this image immediately
                        try{ await onSaveDraft() }catch{}
                      }
                    }catch(e){ /* silent */ }
                  })()
                }} />
              </div>
              {isPromotionMode && (
              <div>
                <div className="text-xs text-slate-500 mb-1">Second offer product image (promotion)</div>
                <Dropzone files={promotionImageFiles} onFiles={(incoming)=>{
                  (async()=>{
                    try{
                      const newFiles = incoming
                      setPromotionImageFiles(newFiles)
                      const up = await uploadImages(newFiles)
                      const urls = Array.isArray(up?.urls)? up.urls : []
                      if(urls.length>0){ setPromotionImageUrl(urls[0]); try{ await onSaveDraft() }catch{} }
                    }catch{}
                  })()
                }} />
                {promotionImageUrl && (
                  <div className="mt-2 w-full bg-slate-50 border rounded-xl overflow-hidden">
                    <img src={toDisplayUrl(promotionImageUrl)} alt="promotion" className="w-full h-40 object-cover" />
                  </div>
                )}
              </div>
              )}
              <div>
                <div className="text-xs text-slate-500 mb-1">LLM model</div>
                <select value={model} onChange={e=>setModel(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm">
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4.1">gpt-4.1</option>
                  <option value="gpt-5">gpt-5</option>
                </select>
              </div>
              {/* In promotion mode, the Generate Offers node is seeded by default; button removed */}
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
                <div className="mt-1 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={async()=>{ try{ await setGlobalPrompts({ angles_prompt: anglesPrompt }); localStorage.setItem('ptos_prompts_angles', anglesPrompt) }catch{} }}>Make app default</Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Title & Description prompt</div>
                <Textarea rows={4} value={titleDescPrompt} onChange={e=>setTitleDescPrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Used when generating title and description.</div>
                <div className="mt-1 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={async()=>{ try{ await setGlobalPrompts({ title_desc_prompt: titleDescPrompt }); localStorage.setItem('ptos_prompts_title_desc', titleDescPrompt) }catch{} }}>Make app default</Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1 flex items-center gap-2"><span className="font-medium text-slate-700">{landingPromptLabel}</span><span className="text-[10px] px-2 py-0.5 rounded border">{landingPromptType}</span></div>
                <Textarea rows={8} value={landingCopyPrompt} onChange={e=>setLandingCopyPrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Generates a complete page using the Elegant Minimal design system. Uses only provided image URLs.</div>
                <div className="mt-1 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={async()=>{ try{ await setGlobalPrompts({ landing_copy_prompt: landingCopyPrompt }); localStorage.setItem('ptos_prompts_landing_copy', landingCopyPrompt) }catch{} }}>Make app default</Button>
                  <Button size="sm" variant="outline" onClick={async()=>{
                    try{
                      setLandingPreviewLoading(true)
                      const imgs = (uploadedUrls||[])
                      const res = await llmLandingCopy({
                        product:{ audience, benefits, pain_points: pains, base_price: price===''?undefined:Number(price), title: title||undefined, sizes, colors, target_category: targetCategory },
                        title: title||undefined,
                        description: '',
                        model,
                        image_urls: imgs,
                        prompt: landingCopyPrompt,
                        product_handle: productHandle,
                      })
                      setLandingPreview({ html: String((res as any)?.html||''), json: res })
                      setLandingPreviewMode('preview')
                    }catch(e:any){ setLandingPreview({ error: String(e?.message||e) }) }
                    finally{ setLandingPreviewLoading(false) }
                  }}>Preview</Button>
                </div>
                {landingPreviewLoading && (
                  <div className="text-[11px] text-slate-500 mt-2">Generating preview…</div>
                )}
                {landingPreview?.html && (
                  <div className="mt-2 border rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-2 py-1 border-b bg-slate-50">
                      <div className="text-[11px] text-slate-600">Landing preview</div>
                      <div className="flex items-center gap-1">
                        <button onClick={()=> setLandingPreviewMode('preview')} className={`text-[11px] px-2 py-0.5 rounded ${landingPreviewMode==='preview'?'bg-white border':'border-transparent'}`}>Preview</button>
                        <button onClick={()=> setLandingPreviewMode('html')} className={`text-[11px] px-2 py-0.5 rounded ${landingPreviewMode==='html'?'bg-white border':'border-transparent'}`}>HTML</button>
                      </div>
                    </div>
                    <div className="max-h-[420px] overflow-auto">
                      {landingPreviewMode==='preview' ? (
                        <iframe title="landing-preview" srcDoc={landingPreview.html} className="w-full h-[400px] bg-white" />
                      ) : (
                        <pre className="text-[11px] p-3 whitespace-pre-wrap overflow-auto">{landingPreview.html}</pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <Separator/>
              <div>
                <div className="text-xs text-slate-500 mb-1">Gemini ad image prompt</div>
                <Textarea rows={3} value={geminiAdPrompt} onChange={e=>setGeminiAdPrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Default prompt used for Gemini ad images.</div>
                <div className="mt-1 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={async()=>{ try{ await setGlobalPrompts({ gemini_ad_prompt: geminiAdPrompt }); localStorage.setItem('ptos_prompts_gemini_ad', geminiAdPrompt) }catch{} }}>Make app default</Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Gemini variant style prompt</div>
                <Textarea rows={2} value={geminiVariantStylePrompt} onChange={e=>setGeminiVariantStylePrompt(e.target.value)} />
                <div className="text-[11px] text-slate-500 mt-1">Default style used for Gemini variant-set images.</div>
                <div className="mt-1 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={async()=>{ try{ await setGlobalPrompts({ gemini_variant_style_prompt: geminiVariantStylePrompt }); localStorage.setItem('ptos_prompts_gemini_variant_style', geminiVariantStylePrompt) }catch{} }}>Make app default</Button>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Meta targeting moved to Meta Ads card */}

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

          <div ref={canvasRef} className="relative h-[calc(100%-3rem)] bg-white rounded-2xl shadow-inner overflow-hidden border" onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseDown={onCanvasMouseDown} onContextMenu={(e)=>e.preventDefault()} onWheel={(e)=>{ if(e.ctrlKey){ e.preventDefault() } }}>
            <GridBackdrop/>
            <div className="absolute left-0 top-0 origin-top-left" style={{transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin:'0 0', willChange:'transform'}}>
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
                  onGalleryApprove={(id)=> galleryApprove(id)}
                  onSuggestPrompts={(id)=> {}}
                  onApplyAdPrompt={(id)=> {}}
                  onOfferGenerateImage={(id)=> offerGenerateImage(id)}
                  onOffersGenerate={()=> startPromotionGenerator()}
                  onOfferGenerateFull={(id)=> offerGenerateFull(id)}
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
                <InspectorContent
                  node={selectedNode}
                  latestTrace={(latestStatus as any)?.result?.trace||[]}
                  onPreview={(url)=> setPreviewImage(url)}
                  onUpdateNodeData={(id,patch)=> setFlow(f=> ({...f, nodes: f.nodes.map(n=> n.id===id? ({...n, data:{...n.data, ...patch}}) : n)}))}
                  onUpdateRun={(id,patch)=> updateNodeRun(id, patch)}
                  savedAudiences={savedAudiences}
                  onAngleGenerate={(id)=> angleGenerate(id)}
                  onAngleApprove={(id)=> angleApprove(id)}
                  onTitleContinue={(id)=> titleContinue(id)}
                  onGeminiGenerate={(id, opts)=> geminiGenerate(id, opts)}
                  onSuggestPrompts={(id)=> {}}
                  onApplyAdPrompt={(id)=> {}}
                  onGalleryApprove={(id)=> galleryApprove(id)}
                  onExternalNav={(href)=> handleExternalNav(href)}
                  onOfferGenerateFull={(id)=> offerGenerateFull(id)}
                  onAppendToGallery={(urls)=> appendImagesToGalleryAuto(urls)}
                  productColors={colors}
                />
              )}
            </CardContent>
          </Card>

          {/* Simplified right sidebar: only Inspector remains */}
        </aside>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center" onClick={()=> setPreviewImage(null)}>
          <div className="max-w-5xl max-h-[90vh] p-2" onClick={(e)=> e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDisplayUrl(previewImage)} alt="preview" className="max-w-full max-h-[85vh] rounded shadow-lg" />
            <div className="mt-2 flex justify-end gap-2">
              <a href={previewImage} download className="rounded-xl font-semibold px-3 py-1.5 bg-white text-slate-700">Download</a>
              <button className="rounded-xl font-semibold px-3 py-1.5 bg-blue-600 text-white" onClick={()=> setPreviewImage(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showLeaveProtect && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center" onClick={()=> setShowLeaveProtect(false)}>
          <div className="bg-white rounded-xl shadow-lg p-4 w-[92vw] max-w-md" onClick={(e)=> e.stopPropagation()}>
            <div className="font-semibold mb-2">Leave this flow?</div>
            <div className="text-sm text-slate-600 mb-4">You have unsaved changes. Save your draft before leaving.</div>
            <div className="flex justify-end gap-2">
              <button className="rounded-xl px-3 py-1.5 border" onClick={()=>{ setShowLeaveProtect(false); setPendingHref(undefined) }}>Stay</button>
              <button className="rounded-xl px-3 py-1.5 border" onClick={async()=>{ try{ await onSaveDraft() }catch{}; const href=pendingHref; setShowLeaveProtect(false); setPendingHref(undefined); if(href){ try{ window.location.href = href }catch{} } }}>Save & leave</button>
              <button className="rounded-xl px-3 py-1.5 bg-rose-600 text-white" onClick={()=>{ const href=pendingHref; setShowLeaveProtect(false); setPendingHref(undefined); if(href){ try{ window.location.href = href }catch{} } }}>Leave without saving</button>
            </div>
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

function NodeShell({ node, selected, onMouseDown, onDelete, active, trace, payload, onUpdateNode, onAngleGenerate, onAngleApprove, onTitleContinue, onGeminiGenerate, onGalleryApprove, onSuggestPrompts, onApplyAdPrompt, onOfferGenerateImage, onOffersGenerate, onOfferGenerateFull }:{ node:FlowNode, selected:boolean, onMouseDown:(e:React.MouseEvent<HTMLDivElement>, n:FlowNode)=>void, onDelete:(id:string)=>void, active:boolean, trace:any[], payload:any, onUpdateNode:(patch:any)=>void, onAngleGenerate:(id:string)=>void, onAngleApprove:(id:string)=>void, onTitleContinue:(id:string)=>void, onGeminiGenerate:(id:string, opts?: any)=>void, onGalleryApprove:(id:string)=>void, onSuggestPrompts:(id:string)=>void, onApplyAdPrompt:(id:string)=>void, onOfferGenerateImage:(id:string)=>void, onOffersGenerate:()=>void, onOfferGenerateFull:(id:string)=>void }){
  const style = { left: node.x, top: node.y } as React.CSSProperties
  const ring = selected ? 'ring-2 ring-blue-500' : 'ring-1 ring-slate-200'
  const glow = active ? 'shadow-[0_0_0_4px_rgba(59,130,246,0.15)]' : ''
  return (
    <div className="absolute select-none" style={style} onMouseDown={(e)=>{ e.stopPropagation(); onMouseDown(e,node) }}>
      <motion.div className={`rounded-2xl bg-white border ${ring} shadow ${glow} w-[220px]`}>
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
        {renderNodeBody(node, selected, trace, payload, onUpdateNode, onAngleGenerate, onAngleApprove, onTitleContinue, onGeminiGenerate, onGalleryApprove, onSuggestPrompts, onApplyAdPrompt, onOfferGenerateImage, onOffersGenerate, onOfferGenerateFull)}
        </div>
      </motion.div>
      {/* Visual input/output ports for clarity */}
      <div className="absolute w-2 h-2 rounded-full bg-slate-300 border border-slate-400" style={{ left: -8, top: 96 }} />
      <div className="absolute w-2 h-2 rounded-full bg-slate-300 border border-slate-400" style={{ right: -8, top: 96 }} />
    </div>
  )
}

function statusLabel(s:RunState['status']){ return s==='idle'?'idle': s==='running'?'running': s==='success'?'ok':'error' }
function statusColor(s:RunState['status']){
  return s==='idle'? 'bg-slate-100 text-slate-600' : s==='running'? 'bg-amber-100 text-amber-700' : s==='success'? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
}

function renderNodeBody(node:FlowNode, expanded:boolean, trace:any[], payload:any, onUpdateNode:(patch:any)=>void, onAngleGenerate:(id:string)=>void, onAngleApprove:(id:string)=>void, onTitleContinue:(id:string)=>void, onGeminiGenerate:(id:string, opts?: any)=>void, onGalleryApprove:(id:string)=>void, onSuggestPrompts:(id:string)=>void, onApplyAdPrompt:(id:string)=>void, onOfferGenerateImage:(id:string)=>void, onOffersGenerate:()=>void, onOfferGenerateFull:(id:string)=>void){
  // Minimal card content: headline only
  if(node.type==='trigger'){
    return (
      <div className="text-xs text-slate-600">
        {String(node.data?.topic||'start')}
      </div>
    )
  }
  const out = node.run?.output
  const type = node.data?.type
  if(type==='promotion_generate_offers'){
    const count = typeof out?.count==='number'? out.count : undefined
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label||'Generate Offers'}
        <div className="text-[11px] text-slate-500">{count!=null? `Generated: ${count}` : `To generate: ${String(node.data?.numOffers||3)}`}</div>
        {node.data?.prompt && (
          <div className="mt-1 text-[11px] text-slate-600 whitespace-pre-wrap max-h-28 overflow-hidden">{String(node.data.prompt)}</div>
        )}
        <div className="mt-1 flex justify-end">
          <Button size="sm" onClick={()=> onOffersGenerate()} disabled={node.run?.status==='running'}>Generate</Button>
        </div>
      </div>
    )
  }
  if(type==='promotion_offer'){
    const offer = node.data?.offer||{}
    const title = offer?.name || offer?.headline || 'Offer'
    return (
      <div className="text-xs text-slate-700">
        {title}
        <div className="text-[11px] text-slate-500 truncate">{offer?.subheadline? String(offer.subheadline) : ''}</div>
        <div className="mt-1 flex items-center gap-1 justify-end">
          <Button size="sm" variant="outline" onClick={()=> onOfferGenerateFull(node.id)} disabled={node.run?.status==='running'}>Generate offer</Button>
          <Button size="sm" onClick={()=> onOfferGenerateImage(node.id)} disabled={node.run?.status==='running'}>Generate image</Button>
        </div>
      </div>
    )
  }
  if(type==='promotion_offer_copy'){
    const off = node.data?.offer_full||{}
    return (
      <div className="text-xs text-slate-700">
        {off?.headline||off?.name||'Offer'}
        <div className="text-[11px] text-slate-500 truncate">{off?.subheadline? String(off.subheadline) : ''}</div>
        <div className="mt-1 flex items-center gap-1 justify-end">
          <Button size="sm" onClick={()=> onOfferGenerateImage(node.id)} disabled={node.run?.status==='running'}>Generate image</Button>
        </div>
      </div>
    )
  }
  if(type==='generate_angles'){
    const count = typeof out?.count==='number'? out.count : undefined
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label||'Generate Angles'}
        <div className="text-[11px] text-slate-500">{count!=null? `Generated: ${count}` : `To generate: ${String(node.data?.numAngles||2)}`}</div>
      </div>
    )
  }
  if(type==='angle_variant'){
    const title = out?.title
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label||'Angle'}
        <div className="text-[11px] text-slate-500 truncate">{title? String(title) : 'No title yet'}</div>
        <div className="mt-1 flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={()=> onAngleGenerate(node.id)} disabled={node.run?.status==='running'}>Gen</Button>
          <Button size="sm" variant={node.data?.approved? 'outline':'default'} disabled={!node.run?.output || !!node.data?.approved} onClick={()=> onAngleApprove(node.id)}>
            {node.data?.approved? '✓' : 'Approve'}
          </Button>
        </div>
      </div>
    )
  }
  if(type==='title_desc'){
    const v = node.data?.value||{}
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label||'Title & Description'}
        <div className="text-[11px] text-slate-500 truncate">{v?.title? String(v.title) : '-'}</div>
        <div className="mt-1 flex justify-end">
          <Button size="sm" onClick={()=> onTitleContinue(node.id)} disabled={node.run?.status==='running'}>Continue</Button>
        </div>
      </div>
    )
  }
  if(type==='gemini_ad_images'){
    const imgs: string[] = Array.isArray(out?.images)? out.images : []
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label||'Gemini Ad Images'}
        <div className="text-[11px] text-slate-500">Images: {imgs.length||0}</div>
        <div className="mt-1 flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={()=> onGeminiGenerate(node.id)} disabled={node.run?.status==='running'}>Generate</Button>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(node.run.status)}`}>{statusLabel(node.run.status)}</span>
        </div>
      </div>
    )
  }
  if(type==='gemini_feature_benefit_set' || type==='gemini_variant_set'){
    const items: any[] = Array.isArray(out?.items)? out.items : []
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label|| (type==='gemini_variant_set'? 'Gemini Variant Set':'Gemini Feature/Benefit Set')}
        <div className="text-[11px] text-slate-500">Items: {items.length||0}</div>
        <div className="mt-1 flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={()=> onGeminiGenerate(node.id)} disabled={node.run?.status==='running'}>Generate</Button>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(node.run.status)}`}>{statusLabel(node.run.status)}</span>
        </div>
      </div>
    )
  }
  if(type==='image_prompt_suggester'){
    const vps: any[] = Array.isArray(out?.variant_prompts)? out.variant_prompts : []
    const fps: any[] = Array.isArray(out?.feature_prompts)? out.feature_prompts : []
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label||'Image Prompt Suggester'}
        <div className="text-[11px] text-slate-500">Variants: {vps.length||0} • Features: {fps.length||0}</div>
        <div className="mt-1 flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={()=> onSuggestPrompts(node.id)} disabled={node.run?.status==='running'}>Suggest</Button>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(node.run.status)}`}>{statusLabel(node.run.status)}</span>
        </div>
      </div>
    )
  }
  if(type==='image_gallery'){
    const imgs: string[] = Array.isArray(out?.images)? out.images : []
    const selected: Record<string,boolean> = node.data?.selected||{}
    const selCount = Object.values(selected||{}).filter(Boolean).length
    return (
      <div className="text-xs text-slate-700">
        {node.data?.label||'Select Images'}
        <div className="text-[11px] text-slate-500">Images: {imgs.length||0} • Selected: {selCount}</div>
        <div className="mt-1 flex justify-end">
          <Button size="sm" onClick={()=> onGalleryApprove(node.id)} disabled={selCount===0 || node.run?.status==='running'}>Approve</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="text-xs text-slate-700">
      {node.data?.label||node.data?.type||node.type}
      {out? (<div className="text-[11px] text-slate-500">Done</div>) : null}
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

function InspectorContent({ node, latestTrace, onPreview, onUpdateNodeData, onUpdateRun, savedAudiences, onAngleGenerate, onAngleApprove, onTitleContinue, onGeminiGenerate, onSuggestPrompts, onApplyAdPrompt, onGalleryApprove, onExternalNav, onOfferGenerateFull, onAppendToGallery, productColors }:{ node:FlowNode, latestTrace:any[], onPreview:(url:string)=>void, onUpdateNodeData:(id:string, patch:any)=>void, onUpdateRun:(id:string, patch:Partial<RunState>)=>void, savedAudiences:{id:string,name:string}[], onAngleGenerate:(id:string)=>void, onAngleApprove:(id:string)=>void, onTitleContinue:(id:string)=>void, onGeminiGenerate:(id:string, opts?: any)=>void, onSuggestPrompts:(id:string)=>void, onApplyAdPrompt:(id:string)=>void, onGalleryApprove:(id:string)=>void, onExternalNav:(href:string)=>void, onOfferGenerateFull:(id:string)=>void, onAppendToGallery:(urls:string[])=>void, productColors: string[] }){
  const [productGid,setProductGid]=useState<string>('')
  const [selectedUrls,setSelectedUrls]=useState<Record<string,boolean>>({})
  const [landingInspectorMode,setLandingInspectorMode] = useState<'preview'|'html'>('preview')
  const out = node.run?.output||{}
  const [selectedVariantColor, setSelectedVariantColor] = useState<string>('')
  const t = traceForNode(node, latestTrace)
  let images:string[] = []
  const isGallery = node.data?.type==='image_gallery'
  if(node.data?.type==='gemini_ad_images'){
    images = Array.isArray(out?.images)? out.images : []
  }else if(node.data?.type==='gemini_variant_set'){
    try{ images = (Array.isArray(out?.items)? out.items : []).map((it:any)=> it?.image).filter(Boolean) }catch{ images=[] }
  }else if(node.data?.type==='gemini_feature_benefit_set'){
    try{ images = (Array.isArray(out?.items)? out.items : []).map((it:any)=> it?.image).filter(Boolean) }catch{ images=[] }
  }else if(isGallery){
    try{ images = (Array.isArray(out?.images)? out.images : []).filter(Boolean) }catch{ images=[] }
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
        const files = await Promise.all(dataUrls.map((u,i)=> dataUrlToCompressedFile(u, `gemini-${i+1}.png`, 1600, 1600, 850*1024)))
        const up = await uploadImages(files)
        uploaded = Array.isArray(up?.urls)? up.urls : []
      }
      const finalUrls = [...httpUrls, ...uploaded]
      if(finalUrls.length===0){ alert('No usable URLs to upload.'); return }
      const res = await shopifyUploadProductImages({ product_gid: productGid, image_urls: finalUrls })
      try{
        const cdn = Array.isArray(res?.urls)? res.urls : Array.isArray((res as any)?.images)? ((res as any).images.map((it:any)=> it?.src).filter(Boolean)) : []
        if(cdn.length>0){ onAppendToGallery(cdn) }
      }catch{}
      alert(`Uploaded ${res.urls?.length||0} image(s) to Shopify.`)
    }catch(e:any){
      alert('Upload failed: '+ String(e?.message||e))
    }
  }

  function toggleSelect(u:string){ setSelectedUrls(s=> ({...s, [u]: !s[u]})) }

  async function dataUrlToFile(dataUrl:string, filename:string): Promise<File>{
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const type = blob.type || 'image/png'
    return new File([blob], filename, { type })
  }

  async function dataUrlToCompressedFile(dataUrl:string, filename:string, maxWidth:number, maxHeight:number, maxBytes:number): Promise<File>{
    return new Promise<File>((resolve)=>{
      try{
        const img = new Image()
        img.onload = async ()=>{
          try{
            const origW = img.width
            const origH = img.height
            let w = origW
            let h = origH
            const scale = Math.min(1, Math.min(maxWidth / Math.max(1, origW), maxHeight / Math.max(1, origH)))
            w = Math.max(1, Math.round(origW * scale))
            h = Math.max(1, Math.round(origH * scale))
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0, w, h)
            let quality = 0.9
            const mime = 'image/jpeg'
            const tryBlob = async(q:number)=> new Promise<Blob|null>(r=> canvas.toBlob(b=> r(b), mime, q))
            let blob = await tryBlob(quality)
            while(blob && blob.size > maxBytes && quality > 0.5){
              quality = Math.max(0.5, quality - 0.1)
              blob = await tryBlob(quality)
            }
            if(!blob){
              // Fallback to original data URL fetch
              const f = await dataUrlToFile(dataUrl, filename)
              resolve(f)
              return
            }
            const file = new File([blob], filename, { type: mime })
            resolve(file)
          }catch{
            // Fallback: no compression
            dataUrlToFile(dataUrl, filename).then(resolve)
          }
        }
        img.onerror = ()=>{ dataUrlToFile(dataUrl, filename).then(resolve) }
        img.src = dataUrl
      }catch{
        dataUrlToFile(dataUrl, filename).then(resolve)
      }
    })
  }

  async function approveMetaCampaign(){
    try{
      onUpdateRun(node.id, { status:'running', startedAt: now() })
      const payload:any = {
        headline: String(node.data?.headline||''),
        primary_text: String(node.data?.primary_text||''),
        description: String(node.data?.description||''),
        image_url: String(node.data?.image_url||''),
        landing_url: String(node.data?.landing_url||''),
        call_to_action: (String(node.data?.call_to_action||'SHOP_NOW')||'SHOP_NOW').toUpperCase(),
        adset_budget: typeof node.data?.adset_budget==='number'? node.data.adset_budget : Number(node.data?.adset_budget||9),
        title: String((node.data?.headline||'')||''),
      }
      // Targeting controls
      const adv = !!node.data?.advantage_plus
      const savedId = String(node.data?.saved_audience_id||'')
      const countries = Array.isArray(node.data?.countries)? node.data.countries : []
      if(!adv){
        if(savedId){ payload.saved_audience_id = savedId }
        else if(countries.length>0){ payload.targeting = { geo_locations: { countries: countries.map((c:string)=> String(c||'').toUpperCase()) } } }
      }
      const res = await metaDraftImageCampaign(payload)
      if((res as any)?.error){ throw new Error((res as any).error) }
      onUpdateRun(node.id, { status:'success', output:{ campaign_id: res.campaign_id||null, adsets: res.adsets||[], requests: res.requests||[] }, finishedAt: now(), ms: 1 })
    }catch(e:any){
      onUpdateRun(node.id, { status:'error', error: String(e?.message||e), finishedAt: now(), ms: 1 })
    }
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
        {node.data?.type==='meta_ads_launch' && (
          <div className="space-y-2">
            <div>
              <div className="text-[11px] text-slate-500 mb-1">Primary text</div>
              <Textarea rows={3} value={String(node.data?.primary_text||'')} onChange={e=> onUpdateNodeData(node.id,{ primary_text: e.target.value })} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-1">Headline</div>
              <Input value={String(node.data?.headline||'')} onChange={e=> onUpdateNodeData(node.id,{ headline: e.target.value })} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-1">Description (optional)</div>
              <Textarea rows={2} value={String(node.data?.description||'')} onChange={e=> onUpdateNodeData(node.id,{ description: e.target.value })} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-1">Landing URL</div>
              <Input value={String(node.data?.landing_url||'')} onChange={e=> onUpdateNodeData(node.id,{ landing_url: e.target.value })} />
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-1">CTA</div>
              <select value={String(node.data?.call_to_action||'SHOP_NOW')} onChange={e=> onUpdateNodeData(node.id,{ call_to_action: e.target.value })} className="w-full rounded-xl border px-3 py-2">
                {['SHOP_NOW','LEARN_MORE','SIGN_UP','SUBSCRIBE','GET_OFFER','BUY_NOW','CONTACT_US'].map(x=> (<option key={x} value={x}>{x.replaceAll('_',' ')}</option>))}
              </select>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-1">Ad image</div>
              <select value={String(node.data?.image_url||'')} onChange={e=> onUpdateNodeData(node.id,{ image_url: e.target.value })} className="w-full rounded-xl border px-3 py-2">
                <option value="">Select image…</option>
                {(Array.isArray(node.data?.candidate_images)? node.data.candidate_images : []).map((u:string,i:number)=> (<option key={i} value={u}>{u}</option>))}
              </select>
            </div>
            <Separator/>
            <div>
              <div className="text-[11px] text-slate-500 mb-1">Ad set daily budget (USD)</div>
              <Input type="number" min={1} value={String(node.data?.adset_budget||9)} onChange={e=> onUpdateNodeData(node.id,{ adset_budget: (e.target.value===''? 9 : Number(e.target.value)) })} placeholder="9" />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!node.data?.advantage_plus} onChange={e=> onUpdateNodeData(node.id,{ advantage_plus: e.target.checked })} />
                <span>Advantage+ audience (let Meta expand targeting)</span>
              </label>
            </div>
            {!node.data?.advantage_plus && (
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Saved audience</div>
                  <select value={String(node.data?.saved_audience_id||'')} onChange={e=> onUpdateNodeData(node.id,{ saved_audience_id: e.target.value })} className="w-full rounded-xl border px-3 py-2">
                    <option value="">None</option>
                    {savedAudiences.map(a=> (<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Countries (ISO codes, e.g., US, MA)</div>
                  <TagsInput value={Array.isArray(node.data?.countries)? node.data.countries : []} onChange={(vals)=> onUpdateNodeData(node.id,{ countries: vals })} placeholder="Add country & Enter" />
                </div>
                <div className="text-[11px] text-slate-500">If both saved audience and countries are provided, the saved audience takes precedence.</div>
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={approveMetaCampaign} disabled={node.run?.status==='running'}>Approve & Create Draft</Button>
            </div>
          </div>
        )}
        {/* Offer copy generation controls */}
        {node.data?.type==='promotion_offer' && (
          <div className="space-y-2">
            <div className="text-[11px] text-slate-500 mb-1">Offer expansion prompt</div>
            <Textarea
              rows={4}
              value={String(node.data?.offer_prompt||'You are a highly skilled, knowledgeable direct-response marketing expert. Expand the OFFER_IDEA into a complete, compelling promotional offer ready for Meta ads. Return ONE valid json object only with fields: offer { name, headline, subheadline, bullets[3-6], mechanics, price_anchor, risk_reversal, guarantee, urgency, CTA_label, creative_text[3-6] }. Rules: headlines ≤ 12 words; subheadline ≤ 18 words; bullets are concrete benefits; no emojis; clear, believable, specific; English only.')}
              onChange={e=> onUpdateNodeData(node.id,{ offer_prompt: e.target.value })}
            />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={()=> onOfferGenerateFull(node.id)} disabled={node.run?.status==='running'}>Generate Offer</Button>
            </div>
          </div>
        )}
        {!(node.data?.type==='gemini_ad_images' || node.data?.type==='gemini_variant_set' || node.data?.type==='image_gallery' || node.data?.type==='meta_ads_launch' || node.data?.type==='promotion_offer') && (
          <pre className="bg-slate-50 p-2 rounded overflow-x-auto max-h-[200px]">{JSON.stringify(node.data,null,2)}</pre>
        )}
      </div>

      {/* Angle variant controls */}
      {node.data?.type==='angle_variant' && (
        <div className="space-y-2">
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Prompt for title + description</div>
            <Textarea rows={4} value={String(node.data?.prompt||'')} onChange={e=> onUpdateNodeData(node.id,{ prompt: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={()=> onAngleGenerate(node.id)} disabled={node.run?.status==='running'}>Generate</Button>
            <Button size="sm" variant={node.data?.approved? 'outline':'default'} disabled={!node.run?.output || !!node.data?.approved} onClick={()=> onAngleApprove(node.id)}>
              {node.data?.approved? 'Approved' : 'Approve'}
            </Button>
          </div>
        </div>
      )}

      {/* Title & Description controls */}
      {node.data?.type==='title_desc' && (
        <div className="space-y-2">
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Landing page prompt</div>
            <Textarea rows={4} value={String(node.data?.landingPrompt||'')} onChange={e=> onUpdateNodeData(node.id,{ landingPrompt: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={()=> onTitleContinue(node.id)} disabled={node.run?.status==='running'}>Continue</Button>
          </div>
        </div>
      )}

      {/* Generate Angles settings */}
      {node.data?.type==='generate_angles' && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-500 mb-1">Angles to generate</div>
          <Input type="number" min={1} max={5} value={String(node.data?.numAngles||2)} onChange={e=> onUpdateNodeData(node.id,{ numAngles: Math.max(1, Math.min(5, Number(e.target.value)||2)) })} />
        </div>
      )}

      {/* Create Landing controls */}
      {node.data?.type==='create_landing' && (
        <div className="space-y-2">
          <div className="text-[11px] text-slate-500">Landing page created.</div>
          {(()=>{
            try{
              const url = String((node.run?.output||{} as any)?.url||'')
              const lc = ((node.run?.output||{} as any)?.landing_copy)||null
              const html = String((lc||{} as any)?.html||'')
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-1">
                      <button onClick={()=> setLandingInspectorMode('preview')} className={`text-[11px] px-2 py-0.5 rounded ${landingInspectorMode==='preview'?'bg-white border':'border-transparent'}`}>Preview</button>
                      <button onClick={()=> setLandingInspectorMode('html')} className={`text-[11px] px-2 py-0.5 rounded ${landingInspectorMode==='html'?'bg-white border':'border-transparent'}`}>HTML</button>
                    </div>
                    {url && (<button onClick={()=> onExternalNav(url)} className="text-xs px-3 py-1.5 rounded border hover:bg-slate-50">Open page</button>)}
                  </div>
                  {html && (
                    <div className="max-h-[320px] overflow-auto border rounded-lg">
                      {landingInspectorMode==='preview' ? (
                        <iframe title="landing-inline-preview" srcDoc={html} className="w-full h-[300px] bg-white" />
                      ) : (
                        <pre className="text-[11px] p-3 whitespace-pre-wrap overflow-auto">{html}</pre>
                      )}
                    </div>
                  )}
                </div>
              )
            }catch{return null}
          })()}
        </div>
      )}

      {/* Gemini ad images controls */}
      {node.data?.type==='gemini_ad_images' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={(node.data?.use_global_prompt!==false)} onChange={e=> onUpdateNodeData(node.id,{ use_global_prompt: e.target.checked })} />
            <span>Use global default prompt</span>
          </label>
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Prompt</div>
            <Textarea rows={3} value={String(node.data?.prompt||'')} onChange={e=> onUpdateNodeData(node.id,{ prompt: e.target.value, use_global_prompt: false })} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={()=> onGeminiGenerate(node.id)} disabled={node.run?.status==='running'}>Generate</Button>
          </div>
        </div>
      )}

      {/* Gemini variant set controls */}
      {node.data?.type==='gemini_variant_set' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={(node.data?.use_global_style!==false)} onChange={e=> onUpdateNodeData(node.id,{ use_global_style: e.target.checked })} />
            <span>Use global default style</span>
          </label>
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Style prompt</div>
            <Textarea rows={3} value={String(node.data?.style_prompt||'')} onChange={e=> onUpdateNodeData(node.id,{ style_prompt: e.target.value, use_global_style: false })} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={()=> onGeminiGenerate(node.id)} disabled={node.run?.status==='running'}>Generate</Button>
          </div>
        </div>
      )}

      {/* Image prompt suggester controls */}
      {/* image_prompt_suggester removed */}

      {isGallery ? (
        <div>
          <div className="text-slate-500 mb-1">Gallery images</div>
          {images.length>0 ? (
            <div>
              <div className="grid grid-cols-2 gap-2">
                {images.map((u,i)=> (
                  <div key={i} className={`relative border rounded p-1 ${(node.data?.selected||{})[u]? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`}>
                    <label className="absolute top-1 left-1 bg-white/80 rounded p-0.5">
                      <input type="checkbox" checked={!!(node.data?.selected||{})[u]} onChange={()=> onUpdateNodeData(node.id,{ selected: { ...(node.data?.selected||{}), [u]: !(node.data?.selected||{})[u] } })} />
                    </label>
                    <button className="absolute top-1 right-1 bg-white/85 text-slate-700 rounded px-1 text-[10px]" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); const a=document.createElement('a'); a.href=u; a.download='image'; document.body.appendChild(a); a.click(); a.remove(); }}>Download</button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={toDisplayUrl(u)} alt={`img-${i}`} className="w-full h-24 object-cover rounded" onClick={()=> onPreview(u)} />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 justify-end mt-2">
                <Button size="sm" onClick={()=> onGalleryApprove(node.id)} disabled={!Object.values(node.data?.selected||{}).some(Boolean)}>Approve</Button>
              </div>
            </div>
          ) : (
            <div className="text-slate-500">No images yet. Generate with Gemini or upload to product.</div>
          )}
        </div>
      ) : (
        images.length>0 ? (
          <div>
            <div className="text-slate-500 mb-1">Output images</div>
            <div className="grid grid-cols-2 gap-2">
              {images.map((u,i)=> (
                <div key={i} className={`relative border rounded p-1 ${selectedUrls[u]? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`}>
                  <label className="absolute top-1 left-1 bg-white/80 rounded p-0.5">
                    <input type="checkbox" checked={!!selectedUrls[u]} onChange={()=> toggleSelect(u)} />
                  </label>
                  <button className="absolute top-1 right-1 bg-white/85 text-slate-700 rounded px-1 text-[10px]" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); const a=document.createElement('a'); a.href=u; a.download='image'; document.body.appendChild(a); a.click(); a.remove(); }}>Download</button>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={toDisplayUrl(u)} alt={`img-${i}`} className="w-full h-24 object-cover rounded" onClick={()=> onPreview(u)} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end mt-2">
              <button className="rounded-xl font-semibold px-3 py-1.5 border" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); try{ images.forEach((u,idx)=>{ const a=document.createElement('a'); a.href=u; a.download=`image-${idx+1}`; document.body.appendChild(a); a.click(); a.remove(); }) }catch{} }}>Download All</button>
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
          (node.run?.output) ? (
            <div>
              <div className="text-slate-500 mb-1">Results</div>
              <pre className="bg-slate-50 p-2 rounded overflow-x-auto max-h-[200px]">{JSON.stringify(node.run.output,null,2)}</pre>
            </div>
          ) : null
        )
      )}

      {/* Specific Variant Generator (color) */}
      {node.data?.type==='gemini_variant_set' && Array.isArray(productColors) && productColors.length>0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-[11px] text-slate-500 mb-1">Generate a specific color variant</div>
          <div className="flex items-center gap-2">
            <select value={selectedVariantColor} onChange={e=> setSelectedVariantColor(e.target.value)} className="w-full rounded-xl border px-3 py-2">
              <option value="">Select color…</option>
              {productColors.map((c, i)=> (<option key={i} value={c}>{c}</option>))}
            </select>
            <Button size="sm" variant="outline" disabled={!selectedVariantColor || node.run?.status==='running'} onClick={async()=>{
              const color = selectedVariantColor
              const desc = `Exact colorway: ${color}. CRITICAL: Strictly render the ${color} color variant only; do not change materials, shape, or branding. Neutral studio background.`
              onGeminiGenerate(node.id, { variantOverride: [{ name: color, description: desc }] })
            }}>Generate</Button>
          </div>
        </div>
      )}

      {/* Requests view removed to keep sidebar minimal and responsive */}
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
  const x1 = from.x + 200
  const y1 = from.y + 100
  const x2 = to.x + 20
  const y2 = to.y + 100
  const d = makePath(x1,y1,x2,y2)
  return (
    <svg className="absolute overflow-visible pointer-events-none" style={{left:0, top:0}}>
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">
          <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
        </marker>
        <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">
          <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
        </marker>
      </defs>
      <path d={d} className={`fill-none ${active? 'edge edge-active':'edge'}`} strokeWidth={active?3:2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" markerEnd={active? 'url(#arrowhead-active)' : 'url(#arrowhead)'} />
    </svg>
  )
}
function makePath(x1:number,y1:number,x2:number,y2:number){
  const c = 0.4 * Math.abs(x2-x1)
  return `M ${x1} ${y1} C ${x1+c} ${y1}, ${x2-c} ${y2}, ${x2} ${y2}`
}


