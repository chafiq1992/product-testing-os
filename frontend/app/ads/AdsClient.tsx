'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Rocket, FileText, Image as ImageIcon, Megaphone, Trash } from 'lucide-react'
import { llmGenerateAngles, geminiGenerateAdImages, metaDraftImageCampaign, getFlow, updateDraft, llmAnalyzeLandingPage } from '@/lib/api'

// Flow graph types used by canvas helpers
export type NodeType = 'landing'|'angles'|'angle_variant'|'headlines'|'copies'|'gemini_images'|'headlines_out'|'copies_out'|'images_out'|'meta_ad'
export type Port = 'in'|'out'
export type FlowNode = { id:string, type:NodeType, x:number, y:number, data:any }
export type FlowEdge = { id:string, from:string, fromPort:Port|string, to:string, toPort:Port|string }

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
function Input(props: React.InputHTMLAttributes<HTMLInputElement>){ return <input {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>){ return <textarea {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }
function Separator({ className='' }:{className?:string}){ return <div className={`border-t ${className}`} /> }

export default function AdsClient(){
  const params = useSearchParams()
  const flowId = params.get('id') || params.get('flow') || ''
  const prefillLanding = params.get('landing_url')||''
  const prefillTitle = params.get('title')||''
  const prefillImages = useMemo(()=>{
    const raw = params.get('images')||''
    if(!raw) return [] as string[]
    try{ return raw.split(',').map(s=> decodeURIComponent(s)).filter(Boolean) }catch{ return [] }
  },[params])

  const [landingUrl,setLandingUrl]=useState<string>(prefillLanding)
  const [audience,setAudience]=useState<string>('Shoppers likely to buy this product')
  const [title,setTitle]=useState<string>(prefillTitle)
  const [benefits,setBenefits]=useState<string>('')
  const [pains,setPains]=useState<string>('')
  const [offers,setOffers]=useState<string>('')
  const [emotions,setEmotions]=useState<string>('')
  const [sourceImage,setSourceImage]=useState<string>(prefillImages[0]||'')
  const [candidateImages,setCandidateImages]=useState<string[]>(prefillImages)

  const [numAngles,setNumAngles]=useState<number>(3)
  const [angles,setAngles]=useState<any[]>([])
  const [selectedAngleIdx,setSelectedAngleIdx]=useState<number>(0)
  const [adImages,setAdImages]=useState<string[]>([])
  const [selectedHeadline,setSelectedHeadline]=useState<string>('')
  const [selectedPrimary,setSelectedPrimary]=useState<string>('')
  const [selectedImage,setSelectedImage]=useState<string>('')
  const [cta,setCta]=useState<string>('SHOP_NOW')
  const [budget,setBudget]=useState<number>(9)
  const [advantagePlus,setAdvantagePlus]=useState<boolean>(true)
  const [countries,setCountries]=useState<string>('')
  const [savedAudienceId,setSavedAudienceId]=useState<string>('')
  const [running,setRunning]=useState<boolean>(false)
  // Load from linked flow when id provided
  useEffect(()=>{ (async()=>{
    if(!flowId) return
    try{
      const f = await getFlow(flowId)
      if((f as any)?.product){
        const prod = (f as any).product||{}
        if(typeof prod.title==='string' && !title) setTitle(prod.title)
        if(Array.isArray(prod.benefits) && prod.benefits.length>0) setBenefits((prod.benefits||[]).join('\n'))
        if(Array.isArray(prod.pain_points) && prod.pain_points.length>0) setPains((prod.pain_points||[]).join('\n'))
        if(typeof prod.audience==='string' && prod.audience) setAudience(prod.audience)
      }
      // Prefer images saved in flow (e.g., Shopify CDN URLs)
      try{
        const imgs = Array.isArray((f as any)?.settings?.assets_used?.feature_gallery)? (f as any).settings.assets_used.feature_gallery : []
        if(imgs.length>0){ setCandidateImages(imgs); if(!sourceImage) setSourceImage(imgs[0]) }
      }catch{}
      if(typeof (f as any)?.page_url==='string' && (f as any).page_url){ setLandingUrl((f as any).page_url) }
      // Restore prior ad inputs if present
      const ads = (f as any)?.ads||{}
      if(typeof ads.selectedHeadline==='string') setSelectedHeadline(ads.selectedHeadline)
      if(typeof ads.selectedPrimary==='string') setSelectedPrimary(ads.selectedPrimary)
      if(typeof ads.cta==='string') setCta(ads.cta)
      if(typeof ads.budget==='number') setBudget(ads.budget)
      if(typeof ads.advantagePlus==='boolean') setAdvantagePlus(ads.advantagePlus)
      if(typeof ads.savedAudienceId==='string') setSavedAudienceId(ads.savedAudienceId)
      if(typeof ads.countries==='string') setCountries(ads.countries)
      const adImgs = Array.isArray(ads.adImages)? ads.adImages : []
      if(adImgs.length>0) setAdImages(adImgs)
      // Restore prompts
      try{
        const prompts = (f as any)?.prompts||{}
        if(typeof prompts.headlines_prompt==='string') setHeadlinesPrompt(prompts.headlines_prompt)
        else if(typeof prompts.angles_prompt==='string') setHeadlinesPrompt(prompts.angles_prompt)
        if(typeof prompts.copies_prompt==='string') setCopiesPrompt(prompts.copies_prompt)
        if(typeof prompts.gemini_ad_prompt==='string') setGeminiAdPrompt(prompts.gemini_ad_prompt)
        if(typeof prompts.analyze_landing_prompt==='string') setAnalyzePrompt(prompts.analyze_landing_prompt)
      }catch{}
    }catch{}
  })() },[flowId])

  const [anglesPrompt,setAnglesPrompt]=useState<string>('You are a senior performance marketer. Based on PRODUCT_INFO, propose exactly 3 distinct ad angles, each targeting a different micro-audience and selling point. Each angle must specify: name, big_idea, promise, 6-10 headlines, and 3 primaries (short, medium, long). Avoid fluff; be specific and conversion-oriented.\n\nReturn ONE valid json object only with fields: angles[3] each with { name, big_idea, promise, headlines, primaries { short, medium, long } }.')
  const [headlinesPrompt,setHeadlinesPrompt]=useState<string>('You are a direct-response copywriter. From the selected ANGLE and PRODUCT_INFO, write 8 ultra-high-converting ad headlines. Each ≤ 12 words, concrete, specific, and benefit-led. No emojis, no ALL CAPS.\n\nReturn ONE valid json object only with fields: angles[1] each with { headlines[8] }.')
  const [copiesPrompt,setCopiesPrompt]=useState<string>('You are a direct-response copywriter. From the selected ANGLE and PRODUCT_INFO, write 3 compelling Meta primary texts (short ≤60 chars, medium ≤120 chars, long ≤220 chars). Use proof or specifics when possible. No emojis, avoid spammy claims.\n\nReturn ONE valid json object only with fields: angles[1] each with { primaries { short, medium, long } }.')
  const [geminiAdPrompt,setGeminiAdPrompt]=useState<string>('Create a high‑quality ad image from this product photo. No text, premium look.')
  const [analyzePrompt,setAnalyzePrompt]=useState<string>('You are a senior direct-response marketer. Analyze the landing page HTML to extract: title, benefits, pain_points, offers, emotions, and propose 3-5 marketing angles with headlines and primary texts. Respond only as compact JSON. Avoid prose.')
  const [lastAnalyzePromptUsed,setLastAnalyzePromptUsed]=useState<string>('')

  const [activeLeftTab,setActiveLeftTab]=useState<'inputs'|'prompts'>('inputs')

  const [zoom,setZoom]=useState<number>(1)
  const [pan,setPan]=useState<{x:number,y:number}>({x:0,y:0})
  const canvasRef = useRef<HTMLDivElement|null>(null)
  const [selectedNodeId,setSelectedNodeId]=useState<string|null>(null)
  const dragRef = useRef<{ id:string, startX:number, startY:number, nodeStartX:number, nodeStartY:number }|null>(null)
  const panningRef = useRef<{ startX:number, startY:number, panStartX:number, panStartY:number }|null>(null)

  // If arriving without transfer payload, try to re-open last saved draft
  useEffect(()=>{
    try{
      const cachedId = sessionStorage.getItem('ptos_last_test_id')
      if(!cachedId) return
      const cached = sessionStorage.getItem(`flow_cache_${cachedId}`)
      if(cached){
        const p = JSON.parse(cached||'{}')
        if(typeof p?.settings?.saved_audience_id==='string') setSavedAudienceId(p.settings.saved_audience_id)
        if(Array.isArray(p?.settings?.countries)) setCountries((p.settings.countries||[]).join(','))
        if(typeof p?.settings?.advantage_plus==='boolean') setAdvantagePlus(!!p.settings.advantage_plus)
        if(typeof p?.title==='string' && !title) setTitle(p.title)
        const imgs = Array.isArray(p?.uploaded_images)? p.uploaded_images : []
        if(imgs.length>0){ setCandidateImages(imgs); if(!sourceImage) setSourceImage(imgs[0]) }
      }
    }catch{}
  },[])

  // Fallback default analyze prompt from localStorage
  useEffect(()=>{
    try{
      if(!analyzePrompt){
        const def = localStorage.getItem('ptos_analyze_prompt_default')
        if(def) setAnalyzePrompt(def)
      }
    }catch{}
  },[analyzePrompt])

  // Load user default prompts for ads tools
  useEffect(()=>{
    try{ const v = localStorage.getItem('ptos_ads_headlines_prompt'); if(v) setHeadlinesPrompt(v) }catch{}
    try{ const v = localStorage.getItem('ptos_ads_copies_prompt'); if(v) setCopiesPrompt(v) }catch{}
    try{ const v = localStorage.getItem('ptos_ads_gemini_prompt'); if(v) setGeminiAdPrompt(v) }catch{}
  },[])
  // Persist prompts on change
  useEffect(()=>{ try{ localStorage.setItem('ptos_ads_headlines_prompt', headlinesPrompt) }catch{} },[headlinesPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_ads_copies_prompt', copiesPrompt) }catch{} },[copiesPrompt])
  useEffect(()=>{ try{ localStorage.setItem('ptos_ads_gemini_prompt', geminiAdPrompt) }catch{} },[geminiAdPrompt])

  // Accept handoff from Studio via sessionStorage (prefer structured landing copy/images over URL)
  useEffect(()=>{
    try{
      const raw = sessionStorage.getItem('ptos_transfer_landing')
      if(raw){
        const data = JSON.parse(raw||'{}')||{}
        if(typeof data.title==='string' && data.title){ setTitle(data.title) }
        if(Array.isArray(data.images) && data.images.length>0){
          const imgs = data.images.filter((u:string)=> typeof u==='string' && u)
          setCandidateImages(imgs)
          if(!sourceImage && imgs[0]) setSourceImage(imgs[0])
        }
        // If we received structured landing copy, extract key text benefits for ad input
        try{
          const lc = (data as any).landing_copy
          if(lc && typeof lc==='object'){
            const secBodies = Array.isArray(lc.sections)? lc.sections.map((s:any)=> String(s?.body||'').trim()).filter(Boolean) : []
            const bullets = secBodies.join('\n').split('\n').map((s:string)=> s.trim()).filter(Boolean).slice(0,8)
            if(bullets.length>0) setBenefits(bullets.join('\n'))
            // Prefill primary text from description-like fields
            const primary = String((lc as any)?.subheadline||'').trim() || String((lc as any)?.headline||'').trim()
            if(primary && !selectedPrimary) setSelectedPrimary(primary)
            if(!landingUrl) setLandingUrl('') // Explicitly avoid using URL as source when copy provided
          }
        }catch{}
        // Only fallback to URL if no images/copy were provided
        if(!Array.isArray((data as any).images) && typeof (data as any).landing_url==='string'){
          setLandingUrl((data as any).landing_url)
        }
        sessionStorage.removeItem('ptos_transfer_landing')
      }
    }catch{}
  },[])

  useEffect(()=>{
    if(!selectedImage && adImages.length>0){ setSelectedImage(adImages[0]) }
  },[adImages,selectedImage])

  async function analyzeLanding(){
    try{
      if(!landingUrl){ alert('Enter landing page URL first.'); return }
      setRunning(true)
      const out = await llmAnalyzeLandingPage({ url: landingUrl, prompt: analyzePrompt })
      if((out as any)?.error){ throw new Error((out as any).error) }
      if(typeof (out as any)?.prompt_used==='string') setLastAnalyzePromptUsed((out as any).prompt_used)
      if(typeof (out as any)?.title==='string' && !(title&&title.trim())) setTitle((out as any).title)
      const arr = Array.isArray((out as any)?.benefits)? (out as any).benefits : []
      if(arr.length>0) setBenefits(arr.join('\n'))
      const painsArr = Array.isArray((out as any)?.pain_points)? (out as any).pain_points : []
      if(painsArr.length>0) setPains(painsArr.join('\n'))
      const offersArr = Array.isArray((out as any)?.offers)? (out as any).offers : []
      if(offersArr.length>0) setOffers(offersArr.join('\n'))
      const emosArr = Array.isArray((out as any)?.emotions)? (out as any).emotions : []
      if(emosArr.length>0 && !selectedPrimary) setSelectedPrimary(emosArr[0])
      const imgs = Array.isArray((out as any)?.images)? (out as any).images : []
      if(imgs.length>0){ setCandidateImages(imgs.slice(0,10)); if(!sourceImage) setSourceImage(imgs[0]) }
      const angs = Array.isArray((out as any)?.angles)? (out as any).angles : []
      if(angs.length>0){ setAngles(angs); setSelectedAngleIdx(0) }
      alert('Analyzed landing page with AI. Prefilled inputs.')
    }catch(e:any){ alert('Analyze failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  // removed legacy runAngles

  let idSeq=1; const nextId=()=> `a${idSeq++}`
  const [nodes,setNodes]=useState<FlowNode[]>(()=>{
    const base = { id: nextId(), type:'landing' as const, x:120, y:160, data:{ url: prefillLanding||'', image: (prefillImages||[])[0]||'', title: prefillTitle||'' } }
    return [base]
  })
  const [edges,setEdges]=useState<FlowEdge[]>([])
  useEffect(()=>{
    setNodes(ns=> ns.map(n=> n.type==='landing'? ({...n, data:{ ...n.data, url: landingUrl, image: (candidateImages||[])[0]||n.data.image, title } }): n))
  },[landingUrl,candidateImages,title])

  function addOrGetNode(type:NodeType, near:{x:number,y:number}, data:any={}, pos?:{x:number,y:number}){
    const existing = nodes.find(n=> n.type===type)
    if(existing) return existing
    const n:FlowNode = { id: nextId(), type, x: (pos? pos.x : near.x+300), y: (pos? pos.y : near.y), data }
    setNodes(ns=> [...ns, n])
    return n
  }
  function addNodeUnique(type:NodeType, near:{x:number,y:number}, data:any={}, pos?:{x:number,y:number}){
    const n:FlowNode = { id: nextId(), type, x: (pos? pos.x : near.x+300), y: (pos? pos.y : near.y), data }
    setNodes(ns=> [...ns, n])
    return n
  }
  function connect(a:FlowNode, b:FlowNode){
    const e:FlowEdge = { id: nextId(), from:a.id, fromPort:'out', to:b.id, toPort:'in' }
    setEdges(es=> [...es, e])
  }

  function connectUnique(a:FlowNode, b:FlowNode){
    setEdges(es=> es.some(x=> x.from===a.id && x.to===b.id)? es : [...es, { id: nextId(), from:a.id, fromPort:'out', to:b.id, toPort:'in' }])
  }

  // Add only the Generate Angles node from the landing card (no API calls yet)
  function addAnglesCardOnly(){
    const landing = nodes.find(n=> n.type==='landing') || nodes[0]
    const existing = nodes.find(n=> n.type==='angles')
    if(existing){ setSelectedNodeId(existing.id); return }
    const gen = addNodeUnique('angles', landing, { }, { x: landing.x+300, y: landing.y })
    connect(landing, gen)
    setSelectedNodeId(gen.id)
  }

  function placeChild(parent:FlowNode, index:number, total:number){
    const dx = 300
    const dy = 180
    const mid = (total-1)/2
    return { x: parent.x + dx, y: Math.round(parent.y + (index - mid) * dy) }
  }

  function isColliding(pos:{x:number,y:number}, size={w:220,h:160}){
    return nodes.some(n=> {
      const a = { x: pos.x, y: pos.y, w: size.w, h: size.h }
      const b = { x: n.x, y: n.y, w: 220, h: 160 }
      const overlap = !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
      return overlap
    })
  }

  function findFreePosition(pos:{x:number,y:number}){
    let p = { ...pos }
    let guard = 0
    while(isColliding(p) && guard<50){
      p.y += 200
      guard++
    }
    return p
  }

  function createChildNode(type:NodeType, parent:FlowNode, data:any, index:number, total:number){
    const pos = findFreePosition(placeChild(parent, index, total))
    const child = addNodeUnique(type, parent, data, pos)
    connect(parent, child)
    return child
  }

  function ensureGenerator(type:Extract<NodeType,'headlines'|'copies'|'gemini_images'>, parent:FlowNode, index:number, total:number){
    const existing = nodes.find(n=> n.type===type)
    if(existing) return existing
    return createChildNode(type, parent, {}, index, total)
  }

  function aggregateFromAngles(arr:any[]){
    const headlines:string[] = []
    const primaries:string[] = []
    for(const a of (arr||[])){
      const hs = Array.isArray(a?.headlines)? a.headlines : []
      const ps = Array.isArray(a?.primaries)? a.primaries : Array.isArray(a?.primaries?.short)? [a.primaries.short, a.primaries.medium, a.primaries.long].filter(Boolean) : []
      for(const h of hs){ if(typeof h==='string' && h && headlines.length<12) headlines.push(h) }
      for(const p of ps){ if(typeof p==='string' && p && primaries.length<12) primaries.push(p) }
    }
    return { headlines, primaries }
  }

  function getOrCreateMetaForAngle(angleId:string, near:FlowNode){
    const existing = nodes.find(n=> n.type==='meta_ad' && n.data?.angleId===angleId)
    if(existing) return existing
    const meta = addNodeUnique('meta_ad', near, { angleId }, { x: near.x+300, y: near.y+300 })
    connectUnique(near, meta)
    return meta
  }

  async function generateHeadlinesForNode(nodeId:string){
    try{
      const genNode = nodes.find(n=> n.id===nodeId && n.type==='headlines')
      if(!genNode) return
      setRunning(true)
      const benefitsArr = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      const painsArr = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      const a = genNode.data?.angle
      const formatted = a? `${headlinesPrompt}\n\nPRODUCT_INFO: ${JSON.stringify({audience, benefits:benefitsArr, pain_points:painsArr, title})}\nANGLE: ${JSON.stringify(a)}` : headlinesPrompt
      const out = await llmGenerateAngles({ product:{ audience, benefits:benefitsArr, pain_points:painsArr, title: title||undefined } as any, num_angles: 1, prompt: formatted||undefined })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      const agg = aggregateFromAngles(arr)
      const outNode = createChildNode('headlines_out', genNode, { headlines: (agg.headlines||[]).slice(0,12), angleId: genNode.data?.angleId||genNode.id }, 0, 1)
      const meta = getOrCreateMetaForAngle(String(genNode.data?.angleId||genNode.id), genNode)
      connectUnique(outNode, meta)
    }catch(e:any){ alert('Generate failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function generateCopiesForNode(nodeId:string){
    try{
      const genNode = nodes.find(n=> n.id===nodeId && n.type==='copies')
      if(!genNode) return
      setRunning(true)
      const benefitsArr = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      const painsArr = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      const a = genNode.data?.angle
      const formatted = a? `${copiesPrompt}\n\nPRODUCT_INFO: ${JSON.stringify({audience, benefits:benefitsArr, pain_points:painsArr, title})}\nANGLE: ${JSON.stringify(a)}` : copiesPrompt
      const out = await llmGenerateAngles({ product:{ audience, benefits:benefitsArr, pain_points:painsArr, title: title||undefined } as any, num_angles: 1, prompt: formatted||undefined })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      const agg = aggregateFromAngles(arr)
      const outNode = createChildNode('copies_out', genNode, { primaries: (agg.primaries||[]).slice(0,12), angleId: genNode.data?.angleId||genNode.id }, 0, 1)
      const meta = getOrCreateMetaForAngle(String(genNode.data?.angleId||genNode.id), genNode)
      connectUnique(outNode, meta)
    }catch(e:any){ alert('Generate failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function runAdImagesForNode(nodeId:string){
    try{
      const genNode = nodes.find(n=> n.id===nodeId && n.type==='gemini_images')
      if(!genNode) return
      const src = genNode.data?.from || sourceImage || candidateImages[0]
      if(!src){ alert('Missing source image URL'); return }
      setRunning(true)
      const offerText = (offers||'').trim()
      const a = genNode.data?.angle
      const angleSuffix = a && a.name? ` Angle: ${String(a.name)}` : ''
      const prompt = `${geminiAdPrompt || 'Create a high‑quality ad image from this product photo. No text, premium look.'}${offerText? ` Emphasize the offer/promotion: ${offerText}.`: ''}${angleSuffix}`
      const resp = await geminiGenerateAdImages({ image_url: src, prompt, num_images: 4, neutral_background: true })
      const imgs = Array.isArray((resp as any)?.images)? (resp as any).images : []
      setAdImages(imgs)
      const outNode = createChildNode('images_out', genNode, { images: imgs, angleId: genNode.data?.angleId||genNode.id }, 0, 1)
      const meta = getOrCreateMetaForAngle(String(genNode.data?.angleId||genNode.id), genNode)
      connectUnique(outNode, meta)
    }catch(e:any){ alert('Image gen failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function generateHeadlines(){
    try{
      setRunning(true)
      const product = {
        audience,
        benefits: benefits.split('\n').map(s=>s.trim()).filter(Boolean),
        pain_points: pains.split('\n').map(s=>s.trim()).filter(Boolean),
        title: title||undefined,
      }
      const out = await llmGenerateAngles({ product: product as any, num_angles: numAngles, prompt: headlinesPrompt||undefined })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      setAngles(arr)
      const { headlines, primaries } = aggregateFromAngles(arr)
      const landing = nodes.find(n=> n.type==='landing') || nodes[0]
      const h = ensureGenerator('headlines', landing, 0, 3)
      const outNode = createChildNode('headlines_out', h, { headlines }, 0, 1)
      const meta = nodes.find(n=> n.type==='meta_ad') || addNodeUnique('meta_ad', h, {}, { x: h.x+300, y: h.y+300 })
      connectUnique(outNode, meta!)
    }catch(e:any){ alert('Generate failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function generateAngles(){
    try{
      setRunning(true)
      const product = {
        audience,
        benefits: benefits.split('\n').map(s=>s.trim()).filter(Boolean),
        pain_points: pains.split('\n').map(s=>s.trim()).filter(Boolean),
        title: title||undefined,
      }
      const out = await llmGenerateAngles({ product: product as any, num_angles: 3, prompt: anglesPrompt||undefined })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      setAngles(arr)
      const landing = nodes.find(n=> n.type==='landing') || nodes[0]
      const existing = nodes.find(n=> n.type==='angles')
      const gen = existing || addNodeUnique('angles', landing, { }, { x: landing.x+300, y: landing.y })
      connectUnique(landing, gen)
      const count = Math.min(3, Math.max(0, arr.length||3))
      for(let i=0;i<count;i++){
        const a = arr[i] || { name:`Angle ${i+1}` }
        createChildNode('angle_variant', gen, { angle: a }, i, count)
      }
    }catch(e:any){ alert('Angles generation failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function expandAngle(nodeId:string){
    const n = nodes.find(x=> x.id===nodeId)
    if(!n) return
    const a = (n.data||{}).angle||{}
    const angleId = n.id
    // Only add generator cards (no API calls here)
    createChildNode('headlines', n, { angle: a, angleId }, 0, 3)
    createChildNode('copies', n, { angle: a, angleId }, 1, 3)
    createChildNode('gemini_images', n, { from: sourceImage||candidateImages[0]||'', angle: a, angleId }, 2, 3)
    // Ensure a Meta Ad node exists for this angle
    const metaExisting = nodes.find(x=> x.type==='meta_ad' && x.data?.angleId===angleId)
    if(!metaExisting){
      const meta = addNodeUnique('meta_ad', n, { angleId }, { x: n.x+300, y: n.y+300 })
      connect(n, meta)
    }
  }
  async function generateCopies(){
    try{
      setRunning(true)
      const product = {
        audience,
        benefits: benefits.split('\n').map(s=>s.trim()).filter(Boolean),
        pain_points: pains.split('\n').map(s=>s.trim()).filter(Boolean),
        title: title||undefined,
      }
      const out = await llmGenerateAngles({ product: product as any, num_angles: numAngles, prompt: copiesPrompt||undefined })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      setAngles(arr)
      const { primaries } = aggregateFromAngles(arr)
      const landing = nodes.find(n=> n.type==='landing') || nodes[0]
      const c = ensureGenerator('copies', landing, 1, 3)
      const outNode = createChildNode('copies_out', c, { primaries }, 0, 1)
      const meta = nodes.find(n=> n.type==='meta_ad') || addNodeUnique('meta_ad', c, {}, { x: c.x+300, y: c.y+300 })
      connectUnique(outNode, meta!)
    }catch(e:any){ alert('Generate failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function runAdImages(){
    try{
      if(!sourceImage){ alert('Missing source image URL'); return }
      setRunning(true)
      const offerText = (offers||'').trim()
      const prompt = `${geminiAdPrompt || 'Create a high‑quality ad image from this product photo. No text, premium look.'}${offerText? ` Emphasize the offer/promotion: ${offerText}.`: ''}`
      const resp = await geminiGenerateAdImages({ image_url: sourceImage, prompt, num_images: 4, neutral_background: true })
      const imgs = Array.isArray((resp as any)?.images)? (resp as any).images : []
      setAdImages(imgs)
      const landing = nodes.find(n=> n.type==='landing') || nodes[0]
      const imgBuilder = ensureGenerator('gemini_images', landing, 2, 3)
      const outNode = createChildNode('images_out', imgBuilder, { images: imgs }, 0, 1)
      const meta = nodes.find(n=> n.type==='meta_ad') || addNodeUnique('meta_ad', imgBuilder, {}, { x: imgBuilder.x+300, y: imgBuilder.y+300 })
      connectUnique(outNode, meta!)
    }catch(e:any){ alert('Image gen failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function approveAndDraft(){
    try{
      if(!landingUrl || !selectedHeadline || !selectedPrimary || !selectedImage){ alert('Select headline, primary text, image, and landing URL.'); return }
      setRunning(true)
      const payload:any = {
        headline: selectedHeadline,
        primary_text: selectedPrimary,
        description: '',
        image_url: selectedImage,
        landing_url: landingUrl,
        call_to_action: cta,
        adset_budget: budget,
        title: selectedHeadline,
      }
      if(!advantagePlus){
        if(savedAudienceId){ payload.saved_audience_id = savedAudienceId }
        else if(countries){ payload.targeting = { geo_locations: { countries: countries.split(',').map(c=>c.trim().toUpperCase()).filter(Boolean) } } }
      }
      const res = await metaDraftImageCampaign(payload)
      if((res as any)?.error){ throw new Error((res as any).error) }
      alert('Meta draft created successfully.')
    }catch(e:any){ alert('Meta draft failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  // Autosave Ads inputs to linked flow when id present (debounced, silent)
  useEffect(()=>{
    if(!flowId) return
    let timer:any
    const schedule = ()=>{
      if(timer) clearTimeout(timer)
      timer = setTimeout(async()=>{
        try{
          const ads:any = {
            selectedHeadline, selectedPrimary, selectedImage, cta, budget, advantagePlus,
            countries, savedAudienceId, candidateImages, adImages,
          }
          const product = { audience, benefits: benefits.split('\n').filter(Boolean), pain_points: pains.split('\n').filter(Boolean), title: title||undefined }
          const prompts:any = { analyze_landing_prompt: analyzePrompt, headlines_prompt: headlinesPrompt, copies_prompt: copiesPrompt, gemini_ad_prompt: geminiAdPrompt }
          await updateDraft(flowId, { product: product as any, ads, prompts })
          try{ localStorage.setItem('ptos_analyze_prompt_default', analyzePrompt) }catch{}
        }catch{}
      }, 800)
    }
    schedule()
    return ()=>{ if(timer) clearTimeout(timer) }
  },[flowId, selectedHeadline, selectedPrimary, selectedImage, cta, budget, advantagePlus, countries, savedAudienceId, candidateImages, adImages, audience, benefits, pains, title, analyzePrompt, headlinesPrompt, copiesPrompt, geminiAdPrompt])

  const angle = angles[selectedAngleIdx]||null
  const headlines: string[] = useMemo(()=> Array.isArray(angle?.headlines)? angle.headlines : [], [angle])
  const primaries: string[] = useMemo(()=> Array.isArray(angle?.primaries)? angle.primaries : Array.isArray(angle?.primaries?.short)? [angle.primaries.short, angle.primaries.medium, angle.primaries.long].filter(Boolean) : [], [angle])
  const selectedNode = useMemo(()=> nodes.find(n=> n.id===selectedNodeId) || null, [nodes, selectedNodeId])

  function expandPrompt(template:string){
    const benefitsArr = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
    const painsArr = pains.split('\n').map(s=>s.trim()).filter(Boolean)
    return String(template||'')
      .replaceAll('{audience}', audience||'')
      .replaceAll('{benefits}', JSON.stringify(benefitsArr))
      .replaceAll('{pain_points}', JSON.stringify(painsArr))
      .replaceAll('{title}', title||'')
      .replaceAll('{offers}', offers||'')
      .replaceAll('{emotions}', emotions||'')
  }

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Product Testing OS</h1>
          <nav className="ml-4 flex items-center gap-1 text-sm">
            <Link href="/studio/" className="px-3 py-1.5 rounded hover:bg-slate-100">Create Product</Link>
            <span className="px-3 py-1.5 rounded bg-blue-600 text-white">Create Ads</span>
            <Link href="/promotion/" className="px-3 py-1.5 rounded hover:bg-slate-100">Create Promotion</Link>
          </nav>
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
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4"/>Ad inputs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Landing page URL</div>
                <Input value={landingUrl} onChange={e=>setLandingUrl(e.target.value)} placeholder="https://yourstore.com/pages/offer" />
                <div className="mt-2 flex items-center gap-2"><Button size="sm" variant="outline" onClick={analyzeLanding}>Analyze</Button><Button size="sm" onClick={addAnglesCardOnly}>Create Ad</Button></div>
                <div className="mt-2">
                  <div className="text-xs text-slate-500 mb-1">Analyze prompt</div>
                  <Textarea rows={4} value={analyzePrompt} onChange={e=>setAnalyzePrompt(e.target.value)} />
                  {lastAnalyzePromptUsed && (
                    <div className="text-[11px] text-slate-500 mt-1">Prompt used (last): {lastAnalyzePromptUsed.slice(0,160)}{lastAnalyzePromptUsed.length>160?'…':''}</div>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Audience</div>
                <Input value={audience} onChange={e=>setAudience(e.target.value)} placeholder="Shoppers likely to buy this product" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Product title</div>
                <Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Product title" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Key benefits (one per line)</div>
                <Textarea rows={3} value={benefits} onChange={e=>setBenefits(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Pain points (one per line)</div>
                <Textarea rows={3} value={pains} onChange={e=>setPains(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Offers / Promotions</div>
                <Textarea rows={2} value={offers} onChange={e=>setOffers(e.target.value)} placeholder="E.g., -20%, Free shipping, Bundle" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Emotional triggers</div>
                <Textarea rows={2} value={emotions} onChange={e=>setEmotions(e.target.value)} placeholder="Trust, novelty, safety, time-saving" />
              </div>
              <Separator/>
              <div>
                <div className="text-xs text-slate-500 mb-1">Source image for ad</div>
                <Input value={sourceImage} onChange={e=>setSourceImage(e.target.value)} placeholder="https://cdn.shopify.com/...jpg" />
                {candidateImages.length>0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {candidateImages.slice(0,9).map((u,i)=> (
                      <div key={i} className={`relative border rounded overflow-hidden ${u===sourceImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`}>
                        <button className="absolute top-1 right-1 z-10 bg-white/90 hover:bg-white text-slate-700 rounded px-1 text-xs" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); setCandidateImages(arr=> arr.filter((x,idx)=> idx!==i)); if(sourceImage===u) setSourceImage('') }}>
                          Delete
                        </button>
                        <button className="block w-full" onClick={()=> setSourceImage(u)}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt={`img-${i}`} className="w-full h-20 object-cover" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2"><Button size="sm" variant="outline" onClick={async()=>{ await analyzeLanding() }}>Analyze</Button></div>
              </div>
            </CardContent>
          </Card>
          )}

          {activeLeftTab==='prompts' && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Prompts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Angles prompt</div>
                <Textarea rows={4} value={anglesPrompt} onChange={e=>setAnglesPrompt(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Headlines prompt</div>
                <Textarea rows={4} value={headlinesPrompt} onChange={e=>setHeadlinesPrompt(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Ad copies prompt</div>
                <Textarea rows={4} value={copiesPrompt} onChange={e=>setCopiesPrompt(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Gemini ad image prompt</div>
                <Textarea rows={3} value={geminiAdPrompt} onChange={e=>setGeminiAdPrompt(e.target.value)} />
              </div>
            </CardContent>
          </Card>
          )}

        </aside>

        <section className="col-span-12 md:col-span-6 relative">
          <div className="flex items-center justify-between px-2 py-1">
            <div className="text-sm text-slate-500">Flow canvas</div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-500">Zoom</div>
              <input type="range" min={50} max={140} step={10} value={zoom*100} onChange={e=>setZoom(Number(e.target.value)/100)} className="w-40"/>
              <Button size="sm" variant="outline" onClick={generateAngles} disabled={running}>Generate angles</Button>
            </div>
          </div>
          <Separator className="mb-2"/>
          <div
            ref={canvasRef}
            className="relative h-[calc(100%-3rem)] bg-white rounded-2xl shadow-inner overflow-hidden border"
            onMouseDown={(e)=>{
              if(e.currentTarget === e.target){
                panningRef.current = { startX: e.clientX, startY: e.clientY, panStartX: pan.x, panStartY: pan.y }
              }
            }}
            onMouseUp={()=>{ dragRef.current = null; panningRef.current = null }}
            onMouseMove={(e)=>{
              if(dragRef.current){
                const { id, startX, startY, nodeStartX, nodeStartY } = dragRef.current
                const dx = (e.clientX - startX) / zoom
                const dy = (e.clientY - startY) / zoom
                setNodes(ns=> ns.map(n=> n.id===id? ({...n, x: Math.round(nodeStartX + dx), y: Math.round(nodeStartY + dy)}): n))
                return
              }
              if(panningRef.current){
                const { startX, startY, panStartX, panStartY } = panningRef.current
                setPan({ x: panStartX + (e.clientX - startX), y: panStartY + (e.clientY - startY) })
              }
            }}
            onContextMenu={(e)=> e.preventDefault()}
          >
            <GridBackdrop/>
            <div className="absolute left-0 top-0 origin-top-left" style={{transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin:'0 0', willChange:'transform'}}>
              <div className="relative z-0">
                {edges.map(e=> (
                  <Edge key={e.id} edge={e} nodes={nodes} active={false} />
                ))}
              </div>
              <div className="relative z-10">
                {nodes.map(n=> (
                  <div
                    key={n.id}
                    className={`absolute select-none ${selectedNodeId===n.id? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'} rounded-2xl bg-white border shadow w-[220px]`}
                    style={{ left:n.x, top:n.y }}
                    onMouseDown={(e)=>{
                      e.stopPropagation()
                      setSelectedNodeId(n.id)
                      dragRef.current = { id:n.id, startX:e.clientX, startY:e.clientY, nodeStartX:n.x, nodeStartY:n.y }
                    }}
                  >
                    <div className="px-3 py-2 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700">
                        {n.type==='landing'? 'Landing Page'
                          : n.type==='headlines'? 'Headlines (generator)'
                          : n.type==='copies'? 'Ad Copies (generator)'
                          : n.type==='gemini_images'? 'Images (generator)'
                          : n.type==='headlines_out'? 'Headlines'
                          : n.type==='copies_out'? 'Ad Copies'
                          : n.type==='images_out'? 'Images'
                          : 'Meta Ad'}
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">idle</span>
                    </div>
                    <Separator/>
                    <div className="p-3 text-sm text-slate-700 min-h-[64px]">
                      {n.type==='landing' && (
                        <div className="text-xs text-slate-500 break-words truncate max-w-[220px]">
                          {title ? (<div className="font-medium text-slate-700 truncate">{title}</div>) : null}
                          <div className="truncate">{landingUrl || 'No URL'}</div>
                        </div>
                      )}
                        {n.type==='angles' && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-600">Prepare angles prompt and generate 3 angle cards</div>
                          <Button size="sm" variant="outline" onClick={generateAngles} disabled={running}>Generate angles</Button>
                        </div>
                      )}
                      {n.type==='angle_variant' && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-600">Expand this angle into copies, headlines, and images</div>
                          <Button size="sm" variant="outline" onClick={()=> expandAngle(n.id)} disabled={running}>Expand angle</Button>
                        </div>
                      )}
                      {n.type==='headlines' && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-600">Prepare headlines prompt and generate outputs</div>
                          <Button size="sm" variant="outline" onClick={()=> generateHeadlinesForNode(n.id)} disabled={running}>Generate headlines</Button>
                        </div>
                      )}
                      {n.type==='copies' && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-600">Prepare ad copies prompt and generate outputs</div>
                          <Button size="sm" variant="outline" onClick={()=> generateCopiesForNode(n.id)} disabled={running}>Generate copies</Button>
                        </div>
                      )}
                      {n.type==='headlines_out' && (
                        <div className="text-xs text-slate-600">{Array.isArray(n.data?.headlines)? n.data.headlines.length : 0} headlines</div>
                      )}
                      {n.type==='copies_out' && (
                        <div className="text-xs text-slate-600">{Array.isArray(n.data?.primaries)? n.data.primaries.length : 0} copies</div>
                      )}
                      {n.type==='gemini_images' && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-600">{adImages.length||0} images</div>
                          <Button size="sm" variant="outline" onClick={()=> runAdImagesForNode(n.id)} disabled={running}>Generate images</Button>
                        </div>
                      )}
                      {n.type==='images_out' && (
                        <div className="text-xs text-slate-600">{adImages.length||0} images generated</div>
                      )}
                      {n.type==='meta_ad' && (
                        <div className="text-xs text-slate-600">Review and approve to create draft in Meta</div>
                      )}
                      {n.type==='landing' && candidateImages[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={candidateImages[0]} alt="cover" className="mt-2 w-[180px] h-24 object-cover rounded" />
                      )}
                    </div>
                    {/* Visual input/output ports for clarity */}
                    <div className="absolute w-2 h-2 rounded-full bg-slate-300 border border-slate-400" style={{ left: -8, top: 96 }} />
                    <div className="absolute w-2 h-2 rounded-full bg-slate-300 border border-slate-400" style={{ right: -8, top: 96 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="col-span-12 md:col-span-3 space-y-3 overflow-y-auto pb-24">
          <Card>
            <CardHeader className="pb-2 flex items-center justify-between">
              <CardTitle className="text-base">Inspector</CardTitle>
              {selectedNode && (
                <button className="p-1 rounded hover:bg-slate-50" onClick={()=> setNodes(ns=> ns.filter(n=> n.id!==selectedNode.id)) }>
                  <Trash className="w-4 h-4 text-slate-500"/>
                </button>
              )}
            </CardHeader>
            <CardContent>
              {!selectedNode && <div className="text-sm text-slate-500">Select a node to see details.</div>}
              {selectedNode && (
                <div className="space-y-3 text-sm">
                  {selectedNode.type==='landing' && (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Landing page URL</div>
                        <Input value={landingUrl} onChange={e=>setLandingUrl(e.target.value)} placeholder="https://yourstore.com/pages/offer" />
                        <div className="mt-2"><Button size="sm" variant="outline" onClick={analyzeLanding}>Analyze</Button></div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Title</div>
                        <Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Product title" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Images</div>
                        {candidateImages.length>0? (
                          <div className="grid grid-cols-3 gap-2">
                            {candidateImages.slice(0,9).map((u,i)=> (
                              <div key={i} className={`relative border rounded overflow-hidden ${u===sourceImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`}>
                                <button className="absolute top-1 right-1 z-10 bg-white/90 hover:bg-white text-slate-700 rounded px-1 text-xs" onClick={(e)=>{ e.preventDefault(); setCandidateImages(arr=> arr.filter((x,idx)=> idx!==i)); if(sourceImage===u) setSourceImage('') }}>Delete</button>
                                <button className="block w-full" onClick={()=> setSourceImage(u)}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={u} alt={`img-${i}`} className="w-full h-16 object-cover" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ): <div className="text-xs text-slate-500">No images parsed yet.</div>}
                      </div>
                    </div>
                  )}
                  {(selectedNode.type==='headlines' || selectedNode.type==='headlines_out') && (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Headlines prompt</div>
                        <Textarea rows={4} value={headlinesPrompt} onChange={e=>setHeadlinesPrompt(e.target.value)} />
                        <div className="text-[11px] text-slate-500 mt-1">Uses variables: {audience?'{audience} ':''}{benefits?'{benefits} ':''}{pains?'{pain_points} ':''}{title?'{title} ':''}</div>
                        <div className="text-[11px] text-slate-500 mt-1">Preview:</div>
                        <pre className="text-[11px] bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{expandPrompt(headlinesPrompt)}</pre>
                        <div className="mt-1"><Button size="sm" variant="outline" onClick={()=>{ try{ localStorage.setItem('ptos_ads_headlines_prompt', headlinesPrompt) }catch{} }}>Make default</Button></div>
                      </div>
                      <div><Button size="sm" variant="outline" onClick={generateHeadlines} disabled={running}>Generate headlines</Button></div>
                    </div>
                  )}
                  {(selectedNode.type==='copies' || selectedNode.type==='copies_out') && (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Ad copies prompt</div>
                        <Textarea rows={4} value={copiesPrompt} onChange={e=>setCopiesPrompt(e.target.value)} />
                        <div className="text-[11px] text-slate-500 mt-1">Uses variables: {audience?'{audience} ':''}{benefits?'{benefits} ':''}{pains?'{pain_points} ':''}{title?'{title} ':''}</div>
                        <div className="text-[11px] text-slate-500 mt-1">Preview:</div>
                        <pre className="text-[11px] bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{expandPrompt(copiesPrompt)}</pre>
                        <div className="mt-1"><Button size="sm" variant="outline" onClick={()=>{ try{ localStorage.setItem('ptos_ads_copies_prompt', copiesPrompt) }catch{} }}>Make default</Button></div>
                      </div>
                      <div><Button size="sm" variant="outline" onClick={generateCopies} disabled={running}>Generate copies</Button></div>
                    </div>
                  )}
                  {selectedNode.type==='headlines_out' && (
                    <div className="space-y-2 text-xs">
                      <div className="text-slate-500">Headlines</div>
                      <div className="grid grid-cols-1 gap-1">
                        {(Array.isArray(selectedNode.data?.headlines)? selectedNode.data.headlines : []).slice(0,12).map((h:string,i:number)=> (
                          <label key={i} className="text-sm flex items-center gap-2">
                            <input type="checkbox" checked={selectedHeadline===h} onChange={()=> setSelectedHeadline(h)} />
                            <span>{h}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedNode.type==='copies_out' && (
                    <div className="space-y-2 text-xs">
                      <div className="text-slate-500">Primary texts</div>
                      <div className="grid grid-cols-1 gap-1">
                        {(Array.isArray(selectedNode.data?.primaries)? selectedNode.data.primaries : []).slice(0,12).map((p:string,i:number)=> (
                          <label key={i} className="text-sm flex items-center gap-2">
                            <input type="checkbox" checked={selectedPrimary===p} onChange={()=> setSelectedPrimary(p)} />
                            <span>{p}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {(selectedNode.type==='gemini_images' || selectedNode.type==='images_out') && (
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 mb-1">Ad image prompt</div>
                      <Textarea rows={3} value={geminiAdPrompt} onChange={e=>setGeminiAdPrompt(e.target.value)} />
                      <div className="text-[11px] text-slate-500">Uses variables: {offers?'{offers} ':''}and selected image.</div>
                      <div className="text-[11px] text-slate-500 mt-1">Preview:</div>
                      <pre className="text-[11px] bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{expandPrompt(geminiAdPrompt)}</pre>
                      <div className="mt-1"><Button size="sm" variant="outline" onClick={()=>{ try{ localStorage.setItem('ptos_ads_gemini_prompt', geminiAdPrompt) }catch{} }}>Make default</Button></div>
                      <div><Button size="sm" variant="outline" onClick={runAdImages} disabled={running}>Generate images (4)</Button></div>
                      {adImages.length>0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {adImages.map((u,i)=> (
                            <button key={i} className={`border rounded overflow-hidden ${u===selectedImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`} onClick={()=> setSelectedImage(u)}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={u} alt={`ad-${i}`} className="w-full h-28 object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {selectedNode.type==='meta_ad' && (
                    <div className="space-y-3">
                      {/* Aggregate outputs upstream of this meta node */}
                      {(()=>{
                        const metaId = selectedNode.id
                        const incoming = edges.filter(e=> e.to===metaId).map(e=> nodes.find(n=> n.id===e.from)).filter(Boolean) as FlowNode[]
                        const heads = incoming.filter(n=> n.type==='headlines_out').flatMap(n=> Array.isArray(n.data?.headlines)? n.data.headlines : [])
                        const prims = incoming.filter(n=> n.type==='copies_out').flatMap(n=> Array.isArray(n.data?.primaries)? n.data.primaries : [])
                        const imgs = incoming.filter(n=> n.type==='images_out').flatMap(n=> Array.isArray(n.data?.images)? n.data.images : [])
                        return (
                          <div className="space-y-3 text-xs">
                            <div>
                              <div className="text-slate-500 mb-1">Select headline</div>
                              <div className="grid grid-cols-1 gap-1 max-h-36 overflow-auto">
                                {heads.slice(0,24).map((h:string,i:number)=> (
                                  <label key={i} className="text-sm flex items-center gap-2">
                                    <input type="checkbox" checked={selectedHeadline===h} onChange={()=> setSelectedHeadline(h)} />
                                    <span>{h}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-1">Select primary text</div>
                              <div className="grid grid-cols-1 gap-1 max-h-36 overflow-auto">
                                {prims.slice(0,24).map((p:string,i:number)=> (
                                  <label key={i} className="text-sm flex items-center gap-2">
                                    <input type="checkbox" checked={selectedPrimary===p} onChange={()=> setSelectedPrimary(p)} />
                                    <span>{p}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-1">Select image</div>
                              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-auto">
                                {imgs.slice(0,24).map((u:string,i:number)=> (
                                  <button key={i} className={`border rounded overflow-hidden ${u===selectedImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`} onClick={()=> setSelectedImage(u)}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={u} alt={`ad-${i}`} className="w-full h-20 object-cover" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                      <div className="space-y-2">
                        <div>
                          <div className="text-xs text-slate-500 mb-1">CTA</div>
                          <select value={cta} onChange={e=>setCta(e.target.value)} className="w-full rounded-xl border px-3 py-2">
                            {['SHOP_NOW','LEARN_MORE','SIGN_UP','SUBSCRIBE','GET_OFFER','BUY_NOW','CONTACT_US'].map(x=> (<option key={x} value={x}>{x.replaceAll('_',' ')}</option>))}
                          </select>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500 mb-1">Daily budget (USD)</div>
                          <Input type="number" min={1} value={String(budget)} onChange={e=> setBudget(e.target.value===''? 9 : Number(e.target.value))} />
                        </div>
                        <div>
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={advantagePlus} onChange={e=> setAdvantagePlus(e.target.checked)} />
                            <span>Advantage+ audience</span>
                          </label>
                        </div>
                        {!advantagePlus && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-xs text-slate-500 mb-1">Saved audience ID</div>
                              <Input value={savedAudienceId} onChange={e=> setSavedAudienceId(e.target.value)} placeholder="opt." />
                            </div>
                            <div>
                              <div className="text-xs text-slate-500 mb-1">Countries (comma-separated)</div>
                              <Input value={countries} onChange={e=> setCountries(e.target.value)} placeholder="US, MA" />
                            </div>
                          </div>
                        )}
                        <div className="flex justify-end"><Button onClick={approveAndDraft} disabled={running}>Approve & Create Draft</Button></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
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
  const from = nodes.find(n=> n.id===edge.from)
  const to = nodes.find(n=> n.id===edge.to)
  if(!from || !to) return null
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


