 'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Rocket, FileText, Image as ImageIcon, Megaphone, Trash } from 'lucide-react'
import { llmGenerateAngles, geminiGenerateAdImages, metaDraftImageCampaign, getFlow, updateDraft, llmAnalyzeLandingPage, fetchSavedAudiences, saveDraft, launchAdsAutomation } from '@/lib/api'

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
  // Track where each input came from (manual vs analyze_landing)
  const [inputSources,setInputSources]=useState<Record<string,'manual'|'analyze_landing'>>({
    audience:'manual',
    benefits:'manual',
    pains:'manual',
    offers:'manual',
    emotions:'manual',
    title:'manual',
    sourceImage:'manual',
  })

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || ''
  function toDisplayUrl(u: string){
    try{
      if(!u) return u
      if(u.startsWith('/')) return u
      if(!/^https?:\/\//i.test(u)) return u
      const host = new URL(u).host
      let ownHost = ''
      try{ ownHost = apiBase? new URL(apiBase).host : (typeof window!=='undefined'? window.location.host : '') }catch{}
      const allowed = ['cdn.shopify.com','images.openai.com','oaidalleapiprodscus.blob.core.windows.net']
      const ok = allowed.some(d=> host===d || host.endsWith('.'+d)) || (!!ownHost && host===ownHost)
      return ok? u : `${apiBase}/proxy/image?url=${encodeURIComponent(u)}`
    }catch{ return u }
  }

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
  const [model,setModel]=useState<string>('gpt-4o-mini')
  const [countries,setCountries]=useState<string>('')
  const [savedAudienceId,setSavedAudienceId]=useState<string>('')
  const [savedAudiences,setSavedAudiences]=useState<Array<{id:string,name:string,description?:string}>>([])
  const [running,setRunning]=useState<boolean>(false)
  const [autoRun,setAutoRun]=useState<boolean>(false)
  const [internalFlowId,setInternalFlowId]=useState<string>(flowId||'')
  const automationLaunchedRef = useRef<Record<string, boolean>>({})
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
      // Restore flow canvas and UI state if present
      try{
        const ui = (f as any)?.ui||{}
        if(typeof ui.zoom==='number') setZoom(ui.zoom)
        if(ui.pan && typeof ui.pan.x==='number' && typeof ui.pan.y==='number') setPan({x:ui.pan.x,y:ui.pan.y})
        if(typeof ui.selected_node==='string') setSelectedNodeId(ui.selected_node)
        if(typeof ui.active_left_tab==='string' && (ui.active_left_tab==='inputs' || ui.active_left_tab==='prompts')) setActiveLeftTab(ui.active_left_tab)
        const mdl = (f as any)?.settings?.model
        if(typeof mdl==='string') setModel(mdl)
      }catch{}
      try{
        const flow = (f as any)?.flow||{}
        const nodesSaved = Array.isArray(flow?.nodes)? flow.nodes : []
        const edgesSaved = Array.isArray(flow?.edges)? flow.edges : []
        if(nodesSaved.length>0){
          setNodes(nodesSaved)
          setEdges(edgesSaved)
          // Bump id sequence to avoid ID collisions with restored nodes
          try{
            const nums = nodesSaved.map((n:any)=> Number(String(n?.id||'').replace(/[^0-9]/g,''))).filter((x:number)=> Number.isFinite(x))
            const maxId = nums.length>0? Math.max(...nums) : 0
            idSeqRef.current = Math.max(idSeqRef.current, maxId+1)
          }catch{}
        }
      }catch{}

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

  // Load saved audiences for Meta targeting dropdown
  useEffect(()=>{ (async()=>{
    try{
      const out = await fetchSavedAudiences()
      const items = Array.isArray((out as any)?.data)? (out as any).data : []
      setSavedAudiences(items)
    }catch{ setSavedAudiences([]) }
  })() },[])

  // Load auto-run preference
  useEffect(()=>{
    try{ const v = localStorage.getItem('ptos_ads_auto_run'); if(v!=null) setAutoRun(v==='1') }catch{}
  },[])
  useEffect(()=>{ try{ localStorage.setItem('ptos_ads_auto_run', autoRun? '1':'0') }catch{} },[autoRun])

  // Ensure we have a draft flow id to persist automation state
  async function ensureFlowId(): Promise<string>{
    if(internalFlowId) return internalFlowId
    const product = {
      audience,
      benefits: benefits.split('\n').map(s=>s.trim()).filter(Boolean),
      pain_points: pains.split('\n').map(s=>s.trim()).filter(Boolean),
      title: title||undefined,
    }
    const settings:any = { flow_type:'ads', adset_budget: budget, advantage_plus: advantagePlus, model }
    if(countries) settings.countries = countries.split(',').map(c=>c.trim()).filter(Boolean)
    if(savedAudienceId) settings.saved_audience_id = savedAudienceId
    const prompts:any = { analyze_landing_prompt: analyzePrompt, headlines_prompt: headlinesPrompt, copies_prompt: copiesPrompt, gemini_ad_prompt: geminiAdPrompt }
    const ui = { zoom, pan, selected_node: selectedNodeId, active_left_tab: activeLeftTab }
    const flow = { nodes, edges }
    const res = await saveDraft({ product: product as any, image_urls: candidateImages, settings, prompts, ui, flow })
    setInternalFlowId(res.id)
    try{
      const url = new URL(window.location.href)
      url.searchParams.set('id', res.id)
      window.history.replaceState({}, '', url.toString())
    }catch{}
    return res.id
  }

  function buildAdsSnapshotFromNodes(){
    const angleNodes = nodes.filter(n=> n.type==='angle_variant')
    const per_angle = angleNodes.map(n=>{
      const angleId = n.id
      const heads = nodes.filter(x=> x.type==='headlines_out' && x.data?.angleId===angleId).flatMap(x=> Array.isArray(x.data?.headlines)? x.data.headlines : [])
      const prims = nodes.filter(x=> x.type==='copies_out' && x.data?.angleId===angleId).flatMap(x=> Array.isArray(x.data?.primaries)? x.data.primaries : [])
      const imgs = nodes.filter(x=> x.type==='images_out' && x.data?.angleId===angleId).flatMap(x=> Array.isArray(x.data?.images)? x.data.images : [])
      return { angle: n.data?.angle||{}, headlines: heads.slice(0,12), primaries: prims.slice(0,12), images: imgs.slice(0,12) }
    })
    return { landing_url: landingUrl, source_image: sourceImage||candidateImages[1]||candidateImages[0]||'', angles, per_angle }
  }

  async function saveStepToDraft(extraAds?: any){
    if(!internalFlowId) return
    try{
      const ads:any = {
        selectedHeadline, selectedPrimary, selectedImage, cta, budget, advantagePlus,
        countries, savedAudienceId, candidateImages, adImages,
        ...buildAdsSnapshotFromNodes(),
        ...(extraAds||{}),
      }
      const product = { audience, benefits: benefits.split('\n').filter(Boolean), pain_points: pains.split('\n').filter(Boolean), title: title||undefined }
      const prompts:any = { analyze_landing_prompt: analyzePrompt, headlines_prompt: headlinesPrompt, copies_prompt: copiesPrompt, gemini_ad_prompt: geminiAdPrompt }
      const ui = { zoom, pan, selected_node: selectedNodeId, active_left_tab: activeLeftTab }
      const flow = { nodes, edges }
      await updateDraft(internalFlowId, { product: product as any, ads, prompts, settings: { flow_type:'ads', adset_budget: budget, advantage_plus: advantagePlus, model } as any, ui, flow })
    }catch{}
  }

  async function startAutoRun(){
    const fid = await ensureFlowId()
    try{
      // Launch background automation so it keeps running if user leaves
      if(!automationLaunchedRef.current[fid]){
        const resp = await launchAdsAutomation({ flow_id: fid, landing_url: landingUrl||undefined, source_image: (sourceImage||candidateImages[1]||candidateImages[0]||undefined), num_angles: 3, prompts: { analyze_landing_prompt: analyzePrompt, angles_prompt: anglesPrompt, headlines_prompt: headlinesPrompt, copies_prompt: copiesPrompt, gemini_ad_prompt: geminiAdPrompt }, model })
        if(resp && !(resp as any).error){ automationLaunchedRef.current[fid] = true }
      }
    }catch{}
    // Local click-through automation
    ;(async()=>{
      // Wait until landing URL is set and a proper source image is chosen (prefer 2nd image)
      while(autoRun && (!landingUrl || !sourceImage)){
        if(!sourceImage && candidateImages.length>1){ setSourceImage(candidateImages[1]) }
        await new Promise(r=> setTimeout(r, 400))
      }
      if(!autoRun) return
      // Ensure images are parsed at least once from the landing page
      if(landingUrl && (!candidateImages || candidateImages.length===0)){
        await analyzeLanding()
      }
      await saveStepToDraft()
      if(!autoRun) return
      addAnglesCardOnly()
      setActiveStep({ step:'generate_angles' })
      const createdAngles = await autoGenerateAnglesFromInputs()
      await saveStepToDraft()
      if(!autoRun) return
      // Expand each angle and generate outputs
      const list = (createdAngles && createdAngles.length>0)? createdAngles : nodesRef.current.filter(n=> n.type==='angle_variant').slice(0,3)
      for(let i=0;i<list.length;i++){
        const v = list[i]
        if(!autoRun) break
        await expandAngle(v.id)
        await new Promise(r=> setTimeout(r, 250))
        const genH = nodesRef.current.find(n=> n.type==='headlines' && n.data?.angleId===v.id)
        const genC = nodesRef.current.find(n=> n.type==='copies' && n.data?.angleId===v.id)
        const genI = nodesRef.current.find(n=> n.type==='gemini_images' && n.data?.angleId===v.id)
        setActiveStep({ step:'generate_headlines', angle_index: i })
        if(genH) await generateHeadlinesForNode(genH.id)
        setActiveStep({ step:'generate_copies', angle_index: i })
        if(genC) await generateCopiesForNode(genC.id)
        setActiveStep({ step:'generate_images', angle_index: i })
        if(genI) await runAdImagesForNode(genI.id)
        await saveStepToDraft()
      }
      setActiveStep(null)
    })()
  }

  // Direct angles generation from current inputs and deterministic node creation
  async function autoGenerateAnglesFromInputs(){
    try{
      setRunning(true)
      const product = {
        audience,
        benefits: benefits.split('\n').map(s=>s.trim()).filter(Boolean),
        pain_points: pains.split('\n').map(s=>s.trim()).filter(Boolean),
        title: title||undefined,
      }
      const out = await llmGenerateAngles({ product: product as any, num_angles: 3, prompt: anglesPrompt||undefined, model })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      setAngles(arr)
      const landing = nodesRef.current.find(n=> n.type==='landing') || nodesRef.current[0]
      let gen = nodesRef.current.find(n=> n.type==='angles')
      if(!gen && landing){ gen = addNodeUnique('angles', landing, { }, { x: landing.x+300, y: landing.y }); connectUnique(landing, gen) }
      const created: FlowNode[] = []
      const count = Math.min(3, Math.max(0, arr.length||3))
      for(let i=0;i<count;i++){
        const a = arr[i] || { name:`Angle ${i+1}` }
        const av = createChildNode('angle_variant', gen!, { angle: a, angleIndex: i }, i, count)
        created.push(av)
      }
      return created
    }catch(e:any){
      alert('Angles generation failed: '+ String(e?.message||e))
      return []
    }finally{
      setRunning(false)
    }
  }

  // Background progress poller: refresh minimal data while automation runs or when a flow id is loaded
  useEffect(()=>{
    if(!internalFlowId) return
    let stop = false
    const tick = async()=>{
      try{
        const f = await getFlow(internalFlowId)
        const ads:any = (f as any)?.ads||{}
        // Merge candidate images from analysis
        try{
          const imgs = Array.isArray(ads?.analyze?.images)? ads.analyze.images : []
          const filtered = (imgs||[]).filter((u:string)=> typeof u==='string' && u)
          const skipped = filtered.slice(1)
          const final = skipped.length>0? skipped : filtered
          if(final.length>0 && candidateImages.length===0){ setCandidateImages(final.slice(0,10)); if(!sourceImage) setSourceImage(final[0]) }
        }catch{}
        // Merge ad images from per_angle
        try{
          const allImgs:string[] = []
          for(const it of (ads?.per_angle||[])){
            for(const u of (it?.images||[])){ if(typeof u==='string' && u) allImgs.push(u) }
          }
          if(allImgs.length>0){ setAdImages(prev=>{ const set = new Set([...(prev||[]), ...allImgs]); return Array.from(set) }) }
        }catch{}
        // Merge angles if empty
        try{
          if(angles.length===0 && Array.isArray(ads?.angles) && ads.angles.length>0){ setAngles(ads.angles) }
        }catch{}

        // Hydrate canvas nodes/edges from backend ads state
        try{
          hydrateCanvasFromBackend(ads)
        }catch{}

        // Track active step to animate edges
        try{
          const steps = Array.isArray(ads?.steps)? ads.steps : []
          const running = steps.filter((s:any)=> (s?.status==='running'))
          const last = running.length>0? running[running.length-1] : (steps.length>0? steps[steps.length-1] : null)
          setActiveStep(last||null)
        }catch{}
      }catch{}
      if(!stop) setTimeout(tick, 8000)
    }
    const t = setTimeout(tick, 3000)
    return ()=>{ stop = true; clearTimeout(t) }
  },[internalFlowId])

  const [anglesPrompt,setAnglesPrompt]=useState<string>('You are a marketing strategist, professional performance marketer, and market researcher. Using PRODUCT_INFO, generate exactly 3 distinct, high-converting angles for paid ads. Each angle must include: name (concise), big_idea (1 sentence), promise (benefit-focused), 6-10 headlines (≤12 words, specific, no emojis/ALL CAPS), and primaries with 2 variants: short (≤60 chars) and medium (≤120 chars). Avoid fluff; be concrete and conversion-oriented.\n\nReturn ONE valid json object ONLY with fields: angles[3] each with { name, big_idea, promise, headlines[6..10], primaries { short, medium } }.')
  const recommendedHeadlinesPrompt = 'You are a senior direct‑response copywriter and conversion strategist. Using PRODUCT_INFO and ANGLE, write 8 unique, high‑converting ad headlines for Meta in English, and also provide faithful French and Arabic translations. Rules: ≤12 words each, concrete, specific, benefit‑led, no emojis, minimal punctuation, avoid spammy claims, no ALL CAPS.\n\nReturn ONE valid JSON object ONLY:\n{ "angles": [ { "headlines_en": ["..."], "headlines_fr": ["..."], "headlines_ar": ["..."] } ] }'
  const recommendedCopiesPrompt = 'You are a senior direct‑response copywriter. Using PRODUCT_INFO and ANGLE, write 2 persuasive Meta primary texts that are multi‑line, include tasteful and relevant emojis, and maximize conversion with clear value, social proof (if implied), and a strong CTA. Each copy can be 2–4 short lines with line breaks. Provide English versions and faithful French and Arabic translations.\n\nReturn ONE valid JSON object ONLY:\n{ "angles": [ { "primaries_en": ["...multi\nline\nA...", "...multi\nline\nB..."], "primaries_fr": ["...A FR...", "...B FR..."], "primaries_ar": ["...A AR...", "...B AR..."] } ] }'
  const [headlinesPrompt,setHeadlinesPrompt]=useState<string>(recommendedHeadlinesPrompt)
  const [copiesPrompt,setCopiesPrompt]=useState<string>(recommendedCopiesPrompt)
  const [geminiAdPrompt,setGeminiAdPrompt]=useState<string>('Create a high‑quality ad image from this product photo. No text, premium look.')
  const [analyzePrompt,setAnalyzePrompt]=useState<string>('You are a senior direct-response marketer. Analyze the landing page HTML to extract: title, benefits, pain_points, offers, emotions, and propose 3-5 marketing angles with headlines and primary texts. Respond only as compact JSON. Avoid prose.')
  const [lastAnalyzePromptUsed,setLastAnalyzePromptUsed]=useState<string>('')
  // Prompt version histories per tool
  type PromptVersion = { version:number, text:string, savedAt:number }
  const [anglesPromptVersions,setAnglesPromptVersions]=useState<PromptVersion[]>([])
  const [headlinesPromptVersions,setHeadlinesPromptVersions]=useState<PromptVersion[]>([])
  const [copiesPromptVersions,setCopiesPromptVersions]=useState<PromptVersion[]>([])
  const [geminiPromptVersions,setGeminiPromptVersions]=useState<PromptVersion[]>([])
  function loadPromptVersions(){
    try{ const v = localStorage.getItem('ptos_versions_angles'); if(v) setAnglesPromptVersions(JSON.parse(v)) }catch{}
    try{ const v = localStorage.getItem('ptos_versions_headlines'); if(v) setHeadlinesPromptVersions(JSON.parse(v)) }catch{}
    try{ const v = localStorage.getItem('ptos_versions_copies'); if(v) setCopiesPromptVersions(JSON.parse(v)) }catch{}
    try{ const v = localStorage.getItem('ptos_versions_gemini'); if(v) setGeminiPromptVersions(JSON.parse(v)) }catch{}
  }
  useEffect(()=>{ loadPromptVersions() },[])
  useEffect(()=>{ try{ localStorage.setItem('ptos_versions_angles', JSON.stringify(anglesPromptVersions||[])) }catch{} },[anglesPromptVersions])
  useEffect(()=>{ try{ localStorage.setItem('ptos_versions_headlines', JSON.stringify(headlinesPromptVersions||[])) }catch{} },[headlinesPromptVersions])
  useEffect(()=>{ try{ localStorage.setItem('ptos_versions_copies', JSON.stringify(copiesPromptVersions||[])) }catch{} },[copiesPromptVersions])
  useEffect(()=>{ try{ localStorage.setItem('ptos_versions_gemini', JSON.stringify(geminiPromptVersions||[])) }catch{} },[geminiPromptVersions])
  function savePromptVersion(kind:'angles'|'headlines'|'copies'|'gemini'){
    const now = Date.now()
    if(kind==='angles') setAnglesPromptVersions(prev=>[{version:(prev[0]?.version||0)+1, text:anglesPrompt, savedAt:now}, ...prev])
    if(kind==='headlines') setHeadlinesPromptVersions(prev=>[{version:(prev[0]?.version||0)+1, text:headlinesPrompt, savedAt:now}, ...prev])
    if(kind==='copies') setCopiesPromptVersions(prev=>[{version:(prev[0]?.version||0)+1, text:copiesPrompt, savedAt:now}, ...prev])
    if(kind==='gemini') setGeminiPromptVersions(prev=>[{version:(prev[0]?.version||0)+1, text:geminiAdPrompt, savedAt:now}, ...prev])
  }
  function restorePromptVersion(kind:'angles'|'headlines'|'copies'|'gemini', v:number){
    if(kind==='angles'){ const it=anglesPromptVersions.find(x=>x.version===v); if(it) setAnglesPrompt(it.text) }
    if(kind==='headlines'){ const it=headlinesPromptVersions.find(x=>x.version===v); if(it) setHeadlinesPrompt(it.text) }
    if(kind==='copies'){ const it=copiesPromptVersions.find(x=>x.version===v); if(it) setCopiesPrompt(it.text) }
    if(kind==='gemini'){ const it=geminiPromptVersions.find(x=>x.version===v); if(it) setGeminiAdPrompt(it.text) }
  }

  const [activeLeftTab,setActiveLeftTab]=useState<'inputs'|'prompts'>('inputs')

  const [zoom,setZoom]=useState<number>(1)
  const [pan,setPan]=useState<{x:number,y:number}>({x:0,y:0})
  const canvasRef = useRef<HTMLDivElement|null>(null)
  const [selectedNodeId,setSelectedNodeId]=useState<string|null>(null)
  const dragRef = useRef<{ id:string, startX:number, startY:number, nodeStartX:number, nodeStartY:number }|null>(null)
  const panningRef = useRef<{ startX:number, startY:number, panStartX:number, panStartY:number }|null>(null)
  const [activeStep,setActiveStep]=useState<any>(null)

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
        if(typeof p?.settings?.model==='string') setModel(p.settings.model)
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
          if(!sourceImage && (imgs[1]||imgs[0])) setSourceImage(imgs[1]||imgs[0])
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
      const out = await llmAnalyzeLandingPage({ url: landingUrl, prompt: analyzePrompt, model })
      if((out as any)?.error){ throw new Error((out as any).error) }
      if(typeof (out as any)?.prompt_used==='string') setLastAnalyzePromptUsed((out as any).prompt_used)
      if(typeof (out as any)?.title==='string' && !(title&&title.trim())){ setTitle((out as any).title); setInputSources(s=>({...s, title:'analyze_landing'})) }
      const arr = Array.isArray((out as any)?.benefits)? (out as any).benefits : []
      if(arr.length>0){ setBenefits(arr.join('\n')); setInputSources(s=>({...s, benefits:'analyze_landing'})) }
      const painsArr = Array.isArray((out as any)?.pain_points)? (out as any).pain_points : []
      if(painsArr.length>0){ setPains(painsArr.join('\n')); setInputSources(s=>({...s, pains:'analyze_landing'})) }
      const offersArr = Array.isArray((out as any)?.offers)? (out as any).offers : []
      if(offersArr.length>0){ setOffers(offersArr.join('\n')); setInputSources(s=>({...s, offers:'analyze_landing'})) }
      const emosArr = Array.isArray((out as any)?.emotions)? (out as any).emotions : []
      if(emosArr.length>0 && !selectedPrimary) setSelectedPrimary(emosArr[0])
      const imgs = Array.isArray((out as any)?.images)? (out as any).images : []
      const filtered = (imgs||[]).filter((u:string)=> typeof u==='string' && u)
      const cands = filtered.slice(1)
      const final = cands.length>0? cands : filtered
      if(final.length>0){ setCandidateImages(final.slice(0,10)); if(!sourceImage){ setSourceImage(final[0]); setInputSources(s=>({...s, sourceImage:'analyze_landing'})) } }
      const angs = Array.isArray((out as any)?.angles)? (out as any).angles : []
      if(angs.length>0){ setAngles(angs); setSelectedAngleIdx(0) }
      alert('Analyzed landing page with AI. Prefilled inputs.')
    }catch(e:any){ alert('Analyze failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  // removed legacy runAngles

  const idSeqRef = useRef(1)
  const nextId = ()=> `a${idSeqRef.current++}`
  const [nodes,setNodes]=useState<FlowNode[]>(()=>{
    const base = { id: nextId(), type:'landing' as const, x:120, y:160, data:{ url: prefillLanding||'', image: (prefillImages||[])[0]||'', title: prefillTitle||'' } }
    return [base]
  })
  const [edges,setEdges]=useState<FlowEdge[]>([])
  const nodesRef = useRef<FlowNode[]>([])
  useEffect(()=>{ nodesRef.current = nodes },[nodes])
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
    connectUnique(landing, gen)
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
    connectUnique(parent, child)
    return child
  }

  function ensureGenerator(type:Extract<NodeType,'headlines'|'copies'|'gemini_images'>, parent:FlowNode, index:number, total:number){
    const existing = nodes.find(n=> n.type===type)
    if(existing) return existing
    return createChildNode(type, parent, {}, index, total)
  }

  // Hydrate canvas from backend ads state (angles, per-angle outputs)
  function hydrateCanvasFromBackend(ads:any){
    if(!ads || typeof ads!=='object') return
    // Ensure angles/angle_variant nodes
    const backAngles:any[] = Array.isArray(ads.angles)? ads.angles : []
    if(backAngles.length>0){
      const currentNodes = nodesRef.current
      const landing = currentNodes.find(n=> n.type==='landing') || currentNodes[0]
      let gen = currentNodes.find(n=> n.type==='angles')
      if(!gen){ gen = addNodeUnique('angles', landing, {}, { x: landing.x+300, y: landing.y }); connectUnique(landing, gen) }
      const existingVariants = currentNodes.filter(n=> n.type==='angle_variant')
      if(existingVariants.length===0){
        const count = Math.min(3, backAngles.length)
        for(let i=0;i<count;i++){
          const a = backAngles[i]
          const av = createChildNode('angle_variant', gen!, { angle: a, angleIndex: i }, i, count)
          // Prepare generator nodes for animation
          createChildNode('headlines', av, { angle: a, angleId: av.id, angleIndex: i }, 0, 3)
          createChildNode('copies', av, { angle: a, angleId: av.id, angleIndex: i }, 1, 3)
          createChildNode('gemini_images', av, { from: sourceImage||candidateImages[1]||candidateImages[0]||'', angle: a, angleId: av.id, angleIndex: i }, 2, 3)
        }
      }
    }
    // Ensure outputs from per_angle
    const per:any[] = Array.isArray(ads.per_angle)? ads.per_angle : []
    if(per.length>0){
      per.forEach((it:any, idx:number)=>{
        // Find angle node by index
        const angleNode = nodesRef.current.find(n=> n.type==='angle_variant' && Number((n.data||{}).angleIndex)===idx)
        if(!angleNode) return
        // Headlines out
        if(Array.isArray(it.headlines) && it.headlines.length>0){
          const exists = nodesRef.current.find(n=> n.type==='headlines_out' && (n.data||{}).angleId===angleNode.id)
          if(!exists){
            const out = createChildNode('headlines_out', angleNode, { headlines: it.headlines.slice(0,8), angleId: angleNode.id }, 0, 1)
            const meta = nodesRef.current.find(n=> n.type==='meta_ad' && (n.data||{}).angleId===angleNode.id) || addNodeUnique('meta_ad', out, { angleId: angleNode.id }, { x: out.x+300, y: out.y+300 })
            connectUnique(out, meta)
          }
        }
        // Copies out
        if(Array.isArray(it.primaries) && it.primaries.length>0){
          const exists = nodesRef.current.find(n=> n.type==='copies_out' && (n.data||{}).angleId===angleNode.id)
          if(!exists){
            const out = createChildNode('copies_out', angleNode, { primaries: it.primaries.slice(0,2), angleId: angleNode.id }, 0, 1)
            const meta = nodesRef.current.find(n=> n.type==='meta_ad' && (n.data||{}).angleId===angleNode.id) || addNodeUnique('meta_ad', out, { angleId: angleNode.id }, { x: out.x+300, y: out.y+300 })
            connectUnique(out, meta)
          }
        }
        // Images out
        if(Array.isArray(it.images) && it.images.length>0){
          const exists = nodesRef.current.find(n=> n.type==='images_out' && (n.data||{}).angleId===angleNode.id)
          if(!exists){
            const out = createChildNode('images_out', angleNode, { images: it.images.slice(0,4), angleId: angleNode.id }, 0, 1)
            const meta = nodesRef.current.find(n=> n.type==='meta_ad' && (n.data||{}).angleId===angleNode.id) || addNodeUnique('meta_ad', out, { angleId: angleNode.id }, { x: out.x+300, y: out.y+300 })
            connectUnique(out, meta)
          }
        }
      })
    }
  }

  // Determine which edges should show active animation based on backend step
  function isEdgeActive(edge:FlowEdge){
    if(!activeStep) return false
    const step = String(activeStep.step||'')
    if(step==='generate_angles'){
      const from = nodes.find(n=> n.id===edge.from)
      const to = nodes.find(n=> n.id===edge.to)
      return !!(from && to && from.type==='landing' && to.type==='angles')
    }
    const idx = Number(activeStep.angle_index)
    if(Number.isNaN(idx)) return false
    const from = nodes.find(n=> n.id===edge.from)
    const to = nodes.find(n=> n.id===edge.to)
    if(!from || !to) return false
    if(from.type!=='angle_variant') return false
    const aidx = Number((from.data||{}).angleIndex)
    if(aidx!==idx) return false
    if(step==='generate_headlines' && to.type==='headlines') return true
    if(step==='generate_copies' && to.type==='copies') return true
    if(step==='generate_images' && to.type==='gemini_images') return true
    return false
  }

  function aggregateFromAngles(arr:any[]){
    const headlines:string[] = []
    const primaries:string[] = []
    for(const a of (arr||[])){
      const hs = Array.isArray(a?.headlines)? a.headlines : []
      let ps:string[] = []
      if(Array.isArray(a?.primaries)) ps = a.primaries
      else if(a?.primaries && typeof a.primaries==='object'){
        const cand = [a.primaries.short, a.primaries.medium, a.primaries.long]
        ps = cand.filter((x:any)=> typeof x==='string' && x)
      }
      for(const h of hs){ if(typeof h==='string' && h && headlines.length<12) headlines.push(h) }
      for(const p of ps){ if(typeof p==='string' && p && primaries.length<12) primaries.push(p) }
    }
    return { headlines, primaries }
  }

  function getOrCreateReviewForAngle(angleId:string, near:FlowNode){
    const existing = nodes.find(n=> n.type==='meta_ad' && n.data?.angleId===angleId)
    if(existing) return existing
    // Create Review node but DO NOT connect from generator/angle; outputs will connect to it
    const meta = addNodeUnique('meta_ad', near, { angleId }, { x: near.x+300, y: near.y+300 })
    return meta
  }

  async function generateHeadlinesForNode(nodeId:string){
    try{
      const genNode = nodes.find(n=> n.id===nodeId && n.type==='headlines')
      if(!genNode) return
      setNodes(ns=> ns.map(n=> n.id===nodeId? ({...n, data:{...n.data, status:'running'}}): n))
      setRunning(true)
      const startedAt = Date.now()
      const benefitsArr = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      const painsArr = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      const a = genNode.data?.angle
      const formatted = a? `${headlinesPrompt}\n\nPRODUCT_INFO: ${JSON.stringify({audience, benefits:benefitsArr, pain_points:painsArr, title})}\nANGLE: ${JSON.stringify(a)}` : headlinesPrompt
      const out = await llmGenerateAngles({ product:{ audience, benefits:benefitsArr, pain_points:painsArr, title: title||undefined } as any, num_angles: 1, prompt: formatted||undefined, model })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      const a0 = arr[0] || {}
      const h_en = Array.isArray((a0 as any).headlines_en)? (a0 as any).headlines_en : (Array.isArray((a0 as any).headlines)? (a0 as any).headlines : [])
      const h_fr = Array.isArray((a0 as any).headlines_fr)? (a0 as any).headlines_fr : []
      const h_ar = Array.isArray((a0 as any).headlines_ar)? (a0 as any).headlines_ar : []
      const outNode = createChildNode('headlines_out', genNode, { headlines_en: (h_en||[]).slice(0,8), headlines_fr: (h_fr||[]).slice(0,8), headlines_ar: (h_ar||[]).slice(0,8), headlines: (h_en||[]).slice(0,8), angleId: genNode.data?.angleId||genNode.id }, 0, 1)
      // If a Review node already exists for this angle, connect this output to it
      const angleId = String(genNode.data?.angleId||genNode.id)
      const metaExisting = nodes.find(n=> n.type==='meta_ad' && n.data?.angleId===angleId)
      if(metaExisting){ connectUnique(outNode, metaExisting) }
      const finishedAt = Date.now()
      setNodes(ns=> ns.map(n=> n.id===nodeId? ({...n, data:{...n.data, status:'done', meta:{ ...(n.data?.meta||{}), lastRun:{
        nodeType:'headlines', startedAt, finishedAt, durationMs: finishedAt-startedAt,
        model: 'default (server)', promptUsed: formatted,
        inputSnapshot: { audience, benefits:benefitsArr, pain_points:painsArr, title, angle:a },
        inputSources: inputSources,
        outputSnapshot: { headlines_en: (h_en||[]).slice(0,8), headlines_fr:(h_fr||[]).slice(0,8), headlines_ar:(h_ar||[]).slice(0,8) },
        logs: [] }}}}): n))
    }catch(e:any){ alert('Generate failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function generateCopiesForNode(nodeId:string){
    try{
      const genNode = nodes.find(n=> n.id===nodeId && n.type==='copies')
      if(!genNode) return
      setNodes(ns=> ns.map(n=> n.id===nodeId? ({...n, data:{...n.data, status:'running'}}): n))
      setRunning(true)
      const startedAt = Date.now()
      const benefitsArr = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      const painsArr = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      const a = genNode.data?.angle
      const formatted = a? `${copiesPrompt}\n\nPRODUCT_INFO: ${JSON.stringify({audience, benefits:benefitsArr, pain_points:painsArr, title})}\nANGLE: ${JSON.stringify(a)}` : copiesPrompt
      const out = await llmGenerateAngles({ product:{ audience, benefits:benefitsArr, pain_points:painsArr, title: title||undefined } as any, num_angles: 1, prompt: formatted||undefined, model })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      const a0 = arr[0] || {}
      // Backward-compatible extraction of EN if only primaries exist
      let basePrimaries: string[] = []
      try{
        const prim = (a0 as any).primaries
        if(Array.isArray(prim)) basePrimaries = prim
        else if(prim && typeof prim==='object') basePrimaries = [prim.short, prim.medium, prim.long].filter((x:any)=> typeof x==='string' && x)
      }catch{}
      const p_en = Array.isArray((a0 as any).primaries_en)? (a0 as any).primaries_en : basePrimaries
      const p_fr = Array.isArray((a0 as any).primaries_fr)? (a0 as any).primaries_fr : []
      const p_ar = Array.isArray((a0 as any).primaries_ar)? (a0 as any).primaries_ar : []
      const outNode = createChildNode('copies_out', genNode, { primaries_en: (p_en||[]).slice(0,2), primaries_fr: (p_fr||[]).slice(0,2), primaries_ar: (p_ar||[]).slice(0,2), primaries: (p_en||[]).slice(0,2), angleId: genNode.data?.angleId||genNode.id }, 0, 1)
      // Create Review node now and connect all existing outputs
      const meta = getOrCreateReviewForAngle(String(genNode.data?.angleId||genNode.id), genNode)
      connectUnique(outNode, meta)
      const angleId = String(genNode.data?.angleId||genNode.id)
      const outputs = nodes.filter(n=> (n.type==='headlines_out' || n.type==='images_out') && n.data?.angleId===angleId)
      for(const o of outputs){ connectUnique(o, meta) }
      const finishedAt = Date.now()
      setNodes(ns=> ns.map(n=> n.id===nodeId? ({...n, data:{...n.data, status:'done', meta:{ ...(n.data?.meta||{}), lastRun:{
        nodeType:'copies', startedAt, finishedAt, durationMs: finishedAt-startedAt,
        model: 'default (server)', promptUsed: formatted,
        inputSnapshot: { audience, benefits:benefitsArr, pain_points:painsArr, title, angle:a },
        inputSources: inputSources,
        outputSnapshot: { primaries_en:(p_en||[]).slice(0,2), primaries_fr:(p_fr||[]).slice(0,2), primaries_ar:(p_ar||[]).slice(0,2) },
        logs: [] }}}}): n))
    }catch(e:any){ alert('Generate failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function runAdImagesForNode(nodeId:string){
    try{
      const genNode = nodes.find(n=> n.id===nodeId && n.type==='gemini_images')
      if(!genNode) return
      setNodes(ns=> ns.map(n=> n.id===nodeId? ({...n, data:{...n.data, status:'running'}}): n))
      const src = genNode.data?.from || sourceImage || candidateImages[1] || candidateImages[0]
      if(!src){ alert('Missing source image URL'); return }
      setRunning(true)
      const startedAt = Date.now()
      const offerText = (offers||'').trim()
      const a = genNode.data?.angle
      const angleSuffix = a && a.name? ` Angle: ${String(a.name)}` : ''
      const prompt = `${geminiAdPrompt || 'Create a high‑quality ad image from this product photo. No text, premium look.'}${offerText? ` Emphasize the offer/promotion: ${offerText}.`: ''}${angleSuffix}`
      const resp = await geminiGenerateAdImages({ image_url: src, prompt, num_images: 4, neutral_background: true })
      const imgs = Array.isArray((resp as any)?.images)? (resp as any).images : []
      setAdImages(imgs)
      const outNode = createChildNode('images_out', genNode, { images: imgs.slice(0,4), angleId: genNode.data?.angleId||genNode.id }, 0, 1)
      // If a Review node already exists for this angle, connect this output to it
      const angleId = String(genNode.data?.angleId||genNode.id)
      const metaExisting = nodes.find(n=> n.type==='meta_ad' && n.data?.angleId===angleId)
      if(metaExisting){ connectUnique(outNode, metaExisting) }
      const finishedAt = Date.now()
      setNodes(ns=> ns.map(n=> n.id===nodeId? ({...n, data:{...n.data, status:'done', meta:{ ...(n.data?.meta||{}), lastRun:{
        nodeType:'gemini_images', startedAt, finishedAt, durationMs: finishedAt-startedAt,
        model: 'Gemini (server default)', promptUsed: prompt,
        inputSnapshot: { image_url: src, offers: offerText, angle:a },
        inputSources: inputSources,
        outputSnapshot: { images: imgs.slice(0,4) },
        logs: [] }}}}): n))
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
      const out = await llmGenerateAngles({ product: product as any, num_angles: numAngles, prompt: headlinesPrompt||undefined, model })
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
      const startedAt = Date.now()
      const product = {
        audience,
        benefits: benefits.split('\n').map(s=>s.trim()).filter(Boolean),
        pain_points: pains.split('\n').map(s=>s.trim()).filter(Boolean),
        title: title||undefined,
      }
      const out = await llmGenerateAngles({ product: product as any, num_angles: 3, prompt: anglesPrompt||undefined, model })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      setAngles(arr)
      const landing = nodes.find(n=> n.type==='landing') || nodes[0]
      const existing = nodes.find(n=> n.type==='angles')
      const gen = existing || addNodeUnique('angles', landing, { }, { x: landing.x+300, y: landing.y })
      connectUnique(landing, gen)
      const count = Math.min(3, Math.max(0, arr.length||3))
      for(let i=0;i<count;i++){
        const a = arr[i] || { name:`Angle ${i+1}` }
        createChildNode('angle_variant', gen, { angle: a, angleIndex: i }, i, count)
      }
      const finishedAt = Date.now()
      setNodes(ns=> ns.map(n=> n.id===gen.id? ({...n, data:{...n.data, meta:{ ...(n.data?.meta||{}), lastRun:{
        nodeType:'angles', startedAt, finishedAt, durationMs: finishedAt-startedAt,
        model: 'default (server)', promptUsed: anglesPrompt,
        inputSnapshot: product,
        inputSources: inputSources,
        outputSnapshot: { angles: arr.slice(0,3) },
        logs: [] }}}}): n))
    }catch(e:any){ alert('Angles generation failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function expandAngle(nodeId:string){
    const n = nodes.find(x=> x.id===nodeId)
    if(!n) return
    const a = (n.data||{}).angle||{}
    const angleId = n.id
    // Only add generator cards (no API calls here)
    createChildNode('headlines', n, { angle: a, angleId, angleIndex: (n.data||{}).angleIndex }, 0, 3)
    createChildNode('copies', n, { angle: a, angleId, angleIndex: (n.data||{}).angleIndex }, 1, 3)
    createChildNode('gemini_images', n, { from: sourceImage||candidateImages[0]||'', angle: a, angleId, angleIndex: (n.data||{}).angleIndex }, 2, 3)
    // Defer Review node until we have at least one output
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
      const out = await llmGenerateAngles({ product: product as any, num_angles: numAngles, prompt: copiesPrompt||undefined, model })
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
      // Basic URL validations to avoid Meta fetch errors
      try{
        const u = new URL(landingUrl)
        if(!(u.protocol==='http:' || u.protocol==='https:')) throw new Error('Invalid scheme')
      }catch{ alert('Landing URL must be a valid http(s) URL.'); return }
      try{
        const iu = new URL(selectedImage)
        if(!(iu.protocol==='http:' || iu.protocol==='https:')) throw new Error('Invalid scheme')
      }catch{ alert('Image URL must be a valid public http(s) URL.'); return }
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

  // Autosave Ads inputs and canvas/UI to linked flow when id present (debounced, silent)
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
          const ui = { zoom, pan, selected_node: selectedNodeId, active_left_tab: activeLeftTab }
          const flow = { nodes, edges }
          await updateDraft(flowId, { product: product as any, ads, prompts, ui, flow })
          try{ localStorage.setItem('ptos_analyze_prompt_default', analyzePrompt) }catch{}
        }catch{}
      }, 800)
    }
    schedule()
    return ()=>{ if(timer) clearTimeout(timer) }
  },[flowId, selectedHeadline, selectedPrimary, selectedImage, cta, budget, advantagePlus, countries, savedAudienceId, candidateImages, adImages, audience, benefits, pains, title, analyzePrompt, headlinesPrompt, copiesPrompt, geminiAdPrompt, nodes, edges, zoom, pan, selectedNodeId, activeLeftTab, model])

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
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoRun} onChange={async (e)=>{
              const v = e.target.checked
              setAutoRun(v)
              if(v){
                await startAutoRun()
              }
            }} />
            <span>Auto-run</span>
          </label>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-3 p-3 h-[calc(100vh-4rem)]">
        <aside className="col-span-12 md:col-span-3 space-y-3 overflow-y-auto pb-24">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">LLM model</CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                <select value={model} onChange={e=>setModel(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm">
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4.1">gpt-4.1</option>
                  <option value="gpt-4a">chatgpt-4a</option>
                  <option value="gpt-5">gpt-5</option>
                </select>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <button className={`text-sm px-3 py-1.5 rounded ${activeLeftTab==='inputs'?'bg-blue-600 text-white':'border'}`} onClick={()=>setActiveLeftTab('inputs')}>Inputs</button>
                <button className={`text-sm px-3 py-1.5 rounded ${activeLeftTab==='prompts'?'bg-blue-600 text-white':'border'}`} onClick={()=>setActiveLeftTab('prompts')}>Prompts</button>
              </div>
            </CardHeader>
          </Card>

          {selectedNode && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Selected Card Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {selectedNode.type==='angle_variant' && (
                <div className="space-y-2">
                  <div className="text-slate-500">Angle</div>
                  <div className="font-medium">{String(selectedNode.data?.angle?.name||'')}</div>
                  <div>Big idea: {String(selectedNode.data?.angle?.big_idea||'')}</div>
                  <div>Promise: {String(selectedNode.data?.angle?.promise||'')}</div>
                  {Array.isArray(selectedNode.data?.angle?.headlines) && selectedNode.data.angle.headlines.length>0 && (
                    <div>
                      <div className="text-slate-500">Headlines</div>
                      <ul className="list-disc pl-4">{selectedNode.data.angle.headlines.slice(0,8).map((h:string,i:number)=> (<li key={i}>{h}</li>))}</ul>
                    </div>
                  )}
                  {(()=>{ const anglesNode = nodes.find(n=> n.type==='angles'); const run:any = (anglesNode?.data?.meta||{}).lastRun; return run? (
                    <div className="space-y-1">
                      <div className="text-slate-500">Generated by</div>
                      <div>Model: {run.model||'default'}</div>
                      <div>Duration: {run.durationMs} ms</div>
                      <div>Prompt used:</div>
                      <pre className="bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-24 overflow-auto">{run.promptUsed||''}</pre>
                    </div>
                  ) : null })()}
                </div>
              )}

              {selectedNode.type==='headlines' && (()=>{ const run:any=(selectedNode.data?.meta||{}).lastRun; return (
                <div className="space-y-1">
                  <div className="text-slate-500">Prompt</div>
                  <pre className="bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-24 overflow-auto">{headlinesPrompt}</pre>
                  {run && (
                    <>
                      <div className="text-slate-500">Last output</div>
                      <ul className="list-disc pl-4">{(run.outputSnapshot?.headlines_en||[]).map((h:string,i:number)=> (<li key={i}>{h}</li>))}</ul>
                    </>
                  )}
                </div>
              )})()}

              {selectedNode.type==='headlines_out' && (
                <div className="space-y-1">
                  <div className="text-slate-500">Headlines</div>
                  <ul className="list-disc pl-4">{(Array.isArray(selectedNode.data?.headlines_en)? selectedNode.data.headlines_en : (selectedNode.data?.headlines||[])).slice(0,12).map((h:string,i:number)=> (<li key={i}>{h}</li>))}</ul>
                </div>
              )}

              {selectedNode.type==='copies' && (()=>{ const run:any=(selectedNode.data?.meta||{}).lastRun; return (
                <div className="space-y-1">
                  <div className="text-slate-500">Prompt</div>
                  <pre className="bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-24 overflow-auto">{copiesPrompt}</pre>
                  {run && (
                    <>
                      <div className="text-slate-500">Last output</div>
                      <ul className="list-disc pl-4">{(run.outputSnapshot?.primaries_en||[]).map((p:string,i:number)=> (<li key={i}><span className="whitespace-pre-line">{p}</span></li>))}</ul>
                    </>
                  )}
                </div>
              )})()}

              {selectedNode.type==='copies_out' && (
                <div className="space-y-1">
                  <div className="text-slate-500">Primary texts</div>
                  <ul className="list-disc pl-4">{(Array.isArray(selectedNode.data?.primaries_en)? selectedNode.data.primaries_en : (selectedNode.data?.primaries||[])).slice(0,12).map((p:string,i:number)=> (<li key={i}><span className="whitespace-pre-line">{p}</span></li>))}</ul>
                </div>
              )}

              {selectedNode.type==='gemini_images' && (()=>{ const run:any=(selectedNode.data?.meta||{}).lastRun; return (
                <div className="space-y-1">
                  <div className="text-slate-500">Prompt</div>
                  <pre className="bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-24 overflow-auto">{geminiAdPrompt}</pre>
                  {run && (
                    <>
                      <div>Source image: {String(run.inputSnapshot?.image_url||'')}</div>
                      <div className="text-slate-500">Last images</div>
                      <div className="grid grid-cols-2 gap-2">{(run.outputSnapshot?.images||[]).map((u:string,i:number)=> (
                        <img key={i} src={toDisplayUrl(u)} alt={`img-${i}`} className="w-full h-20 object-cover rounded border" />
                      ))}</div>
                    </>
                  )}
                </div>
              )})()}

              {selectedNode.type==='images_out' && (
                <div className="space-y-1">
                  <div className="text-slate-500">Images</div>
                  <div className="grid grid-cols-2 gap-2">{(selectedNode.data?.images||[]).slice(0,8).map((u:string,i:number)=> (
                    <img key={i} src={toDisplayUrl(u)} alt={`img-${i}`} className="w-full h-20 object-cover rounded border" />
                  ))}</div>
                </div>
              )}
            </CardContent>
          </Card>
          )}

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
                <Input value={audience} onChange={e=>{ setAudience(e.target.value); setInputSources(s=>({...s, audience:'manual'})) }} placeholder="Shoppers likely to buy this product" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Product title</div>
                <Input value={title} onChange={e=>{ setTitle(e.target.value); setInputSources(s=>({...s, title:'manual'})) }} placeholder="Product title" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Key benefits (one per line)</div>
                <Textarea rows={3} value={benefits} onChange={e=>{ setBenefits(e.target.value); setInputSources(s=>({...s, benefits:'manual'})) }} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Pain points (one per line)</div>
                <Textarea rows={3} value={pains} onChange={e=>{ setPains(e.target.value); setInputSources(s=>({...s, pains:'manual'})) }} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Offers / Promotions</div>
                <Textarea rows={2} value={offers} onChange={e=>{ setOffers(e.target.value); setInputSources(s=>({...s, offers:'manual'})) }} placeholder="E.g., -20%, Free shipping, Bundle" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Emotional triggers</div>
                <Textarea rows={2} value={emotions} onChange={e=>{ setEmotions(e.target.value); setInputSources(s=>({...s, emotions:'manual'})) }} placeholder="Trust, novelty, safety, time-saving" />
              </div>
              <Separator/>
              <div>
                <div className="text-xs text-slate-500 mb-1">Source image for ad</div>
                <Input value={sourceImage} onChange={e=>{ setSourceImage(e.target.value); setInputSources(s=>({...s, sourceImage:'manual'})) }} placeholder="https://cdn.shopify.com/...jpg" />
                {candidateImages.length>0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {candidateImages.slice(0,9).map((u,i)=> (
                      <div key={i} className={`relative border rounded overflow-hidden ${u===sourceImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`}>
                        <button className="absolute top-1 right-1 z-10 bg-white/90 hover:bg-white text-slate-700 rounded px-1 text-xs" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); setCandidateImages(arr=> arr.filter((x,idx)=> idx!==i)); if(sourceImage===u) setSourceImage('') }}>
                          Delete
                        </button>
                        <button className="block w-full" onClick={()=> { setSourceImage(u); setInputSources(s=>({...s, sourceImage:'manual'})) }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={toDisplayUrl(u)} alt={`img-${i}`} className="w-full h-20 object-cover" />
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
            className="relative h-[calc(100%-3rem)] bg-white rounded-2xl shadow-inner overflow-auto border"
            onWheel={(e)=>{ if((e as any).ctrlKey){ e.preventDefault() } }}
            onMouseDown={(e)=>{
              // Pan when clicking background (not on node cards)
              const t = e.target as HTMLElement
              const onNode = !!t.closest('.node-card')
              if(!onNode){
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
                  <Edge key={e.id} edge={e} nodes={nodes} active={isEdgeActive(e)} />
                ))}
              </div>
              <div className="relative z-10">
                {nodes.map(n=> (
                  <div
                    key={n.id}
                    className={`node-card absolute select-none ${selectedNodeId===n.id? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'} rounded-2xl bg-white border shadow w-[220px]`}
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
                          : n.type==='angles'? 'Generate Angles'
                          : n.type==='angle_variant'? `Angle: ${String(n.data?.angle?.name||'Variant')}`
                          : n.type==='headlines'? 'Generate Headlines'
                          : n.type==='copies'? 'Generate Ad Copies'
                          : n.type==='gemini_images'? 'Generate Ad Images'
                          : n.type==='headlines_out'? 'Headlines Output'
                          : n.type==='copies_out'? 'Ad Copies Output'
                          : n.type==='images_out'? 'Images Output'
                          : 'Review & Approve'}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${'bg-slate-100 text-slate-600'}`}>idle</span>
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
                        <img src={toDisplayUrl(candidateImages[0])} alt="cover" className="mt-2 w-[180px] h-24 object-cover rounded" />
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
                        <Input value={title} onChange={e=>{ setTitle(e.target.value); setInputSources(s=>({...s, title:'manual'})) }} placeholder="Product title" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Images</div>
                        {candidateImages.length>0? (
                          <div className="grid grid-cols-3 gap-2">
                            {candidateImages.slice(0,9).map((u,i)=> (
                              <div key={i} className={`relative border rounded overflow-hidden ${u===sourceImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`}>
                                <button className="absolute top-1 right-1 z-10 bg-white/90 hover:bg-white text-slate-700 rounded px-1 text-xs" onClick={(e)=>{ e.preventDefault(); setCandidateImages(arr=> arr.filter((x,idx)=> idx!==i)); if(sourceImage===u) setSourceImage('') }}>Delete</button>
                                <button className="block w-full" onClick={()=> { setSourceImage(u); setInputSources(s=>({...s, sourceImage:'manual'})) }}>
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
                  {selectedNode.type==='angles' && (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Angles prompt</div>
                        <Textarea rows={4} value={anglesPrompt} onChange={e=>setAnglesPrompt(e.target.value)} />
                        <div className="mt-1 flex items-center gap-2">
                          <select className="text-xs border rounded px-2 py-1"
                            onChange={e=>{ const v=Number(e.target.value); if(!Number.isNaN(v)) restorePromptVersion('angles', v) }}
                            defaultValue="">
                            <option value="">Versions…</option>
                            {anglesPromptVersions.map(v=> (
                              <option key={v.version} value={v.version}>{`v${v.version} – ${new Date(v.savedAt).toLocaleString()}`}</option>
                            ))}
                          </select>
                          <Button size="sm" variant="outline" onClick={()=> savePromptVersion('angles')}>Save version</Button>
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">Preview:</div>
                      <pre className="text-[11px] bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{anglesPrompt}</pre>
                      <div className="text-[11px] text-slate-500">Inputs:</div>
                      <ul className="list-disc pl-4 text-xs">
                        <li>audience ({inputSources.audience}): {audience}</li>
                        <li>benefits ({inputSources.benefits}): {benefits.split('\n').filter(Boolean).slice(0,4).join(', ')}</li>
                        <li>pain_points ({inputSources.pains}): {pains.split('\n').filter(Boolean).slice(0,4).join(', ')}</li>
                        <li>title ({inputSources.title}): {title}</li>
                      </ul>
                      {(()=>{ const run:any = (selectedNode.data?.meta||{}).lastRun; return run? (
                        <div className="text-xs space-y-1">
                          <div className="text-slate-500">Last run</div>
                          <div>Model: {run.model||'default'}</div>
                          <div>Duration: {run.durationMs} ms</div>
                          <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
                          <div className="text-slate-500">Output angles:</div>
                          <ul className="list-disc pl-4">
                            {(run.outputSnapshot?.angles||[]).map((a:any,i:number)=> (<li key={i}>{String(a?.name||'Angle')}</li>))}
                          </ul>
                        </div>
                      ) : null })()}
                      <div><Button size="sm" variant="outline" onClick={generateAngles} disabled={running}>Generate angles</Button></div>
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
                        <div className="mt-1 flex items-center gap-2">
                          <select className="text-xs border rounded px-2 py-1"
                            onChange={e=>{ const v=Number(e.target.value); if(!Number.isNaN(v)) restorePromptVersion('headlines', v) }} defaultValue="">
                            <option value="">Versions…</option>
                            {headlinesPromptVersions.map(v=> (<option key={v.version} value={v.version}>{`v${v.version} – ${new Date(v.savedAt).toLocaleString()}`}</option>))}
                          </select>
                          <Button size="sm" variant="outline" onClick={()=> savePromptVersion('headlines')}>Save version</Button>
                          <Button size="sm" variant="outline" onClick={()=>{ try{ localStorage.setItem('ptos_ads_headlines_prompt', headlinesPrompt) }catch{} }}>Make default</Button>
                        </div>
                      </div>
                      {(()=>{ const run:any = (selectedNode.data?.meta||{}).lastRun; return run? (
                        <div className="text-xs space-y-1">
                          <div className="text-slate-500">Last run</div>
                          <div>Model: {run.model||'default'}</div>
                          <div>Duration: {run.durationMs} ms</div>
                          <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
                          <div className="text-slate-500">Inputs:</div>
                          <ul className="list-disc pl-4">
                            <li>audience ({inputSources.audience}): {audience}</li>
                            <li>benefits ({inputSources.benefits}): {(run.inputSnapshot?.benefits||[]).join(', ')}</li>
                            <li>pain_points ({inputSources.pains}): {(run.inputSnapshot?.pain_points||[]).join(', ')}</li>
                            <li>title ({inputSources.title}): {run.inputSnapshot?.title||''}</li>
                          </ul>
                        </div>
                      ) : null })()}
                      <div><Button size="sm" variant="outline" onClick={()=> generateHeadlinesForNode(selectedNode.id)} disabled={running}>Generate headlines</Button></div>
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
                        <div className="mt-1 flex items-center gap-2">
                          <select className="text-xs border rounded px-2 py-1"
                            onChange={e=>{ const v=Number(e.target.value); if(!Number.isNaN(v)) restorePromptVersion('copies', v) }} defaultValue="">
                            <option value="">Versions…</option>
                            {copiesPromptVersions.map(v=> (<option key={v.version} value={v.version}>{`v${v.version} – ${new Date(v.savedAt).toLocaleString()}`}</option>))}
                          </select>
                          <Button size="sm" variant="outline" onClick={()=> savePromptVersion('copies')}>Save version</Button>
                          <Button size="sm" variant="outline" onClick={()=>{ try{ localStorage.setItem('ptos_ads_copies_prompt', copiesPrompt) }catch{} }}>Make default</Button>
                        </div>
                      </div>
                      {(()=>{ const run:any = (selectedNode.data?.meta||{}).lastRun; return run? (
                        <div className="text-xs space-y-1">
                          <div className="text-slate-500">Last run</div>
                          <div>Model: {run.model||'default'}</div>
                          <div>Duration: {run.durationMs} ms</div>
                          <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
                        </div>
                      ) : null })()}
                      <div><Button size="sm" variant="outline" onClick={()=> generateCopiesForNode(selectedNode.id)} disabled={running}>Generate copies</Button></div>
                    </div>
                  )}
                  {selectedNode.type==='headlines_out' && (
                    <div className="space-y-2 text-xs">
                      <div className="text-slate-500">Headlines (EN)</div>
                      <div className="grid grid-cols-1 gap-1">
                        {(
                          Array.isArray(selectedNode.data?.headlines_en)? selectedNode.data.headlines_en
                          : (Array.isArray(selectedNode.data?.headlines)? selectedNode.data.headlines : [])
                        ).slice(0,12).map((h:string,i:number)=> (
                          <label key={i} className="text-sm flex items-center gap-2">
                            <input type="checkbox" checked={selectedHeadline===h} onChange={()=> setSelectedHeadline(h)} />
                            <span>{h}</span>
                          </label>
                        ))}
                      </div>
                      {Array.isArray(selectedNode.data?.headlines_fr) && selectedNode.data.headlines_fr.length>0 && (
                        <>
                          <div className="text-slate-500 mt-2">Titres (FR)</div>
                          <div className="grid grid-cols-1 gap-1">
                            {selectedNode.data.headlines_fr.slice(0,12).map((h:string,i:number)=> (
                              <label key={i} className="text-sm flex items-center gap-2">
                                <input type="checkbox" checked={selectedHeadline===h} onChange={()=> setSelectedHeadline(h)} />
                                <span>{h}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                      {Array.isArray(selectedNode.data?.headlines_ar) && selectedNode.data.headlines_ar.length>0 && (
                        <>
                          <div className="text-slate-500 mt-2">العناوين (AR)</div>
                          <div className="grid grid-cols-1 gap-1">
                            {selectedNode.data.headlines_ar.slice(0,12).map((h:string,i:number)=> (
                              <label key={i} className="text-sm flex items-center gap-2">
                                <input type="checkbox" checked={selectedHeadline===h} onChange={()=> setSelectedHeadline(h)} />
                                <span>{h}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {selectedNode.type==='copies_out' && (
                    <div className="space-y-2 text-xs">
                      <div className="text-slate-500">Primary texts (EN)</div>
                      <div className="grid grid-cols-1 gap-1">
                        {(
                          Array.isArray(selectedNode.data?.primaries_en)? selectedNode.data.primaries_en
                          : (Array.isArray(selectedNode.data?.primaries)? selectedNode.data.primaries : [])
                        ).slice(0,12).map((p:string,i:number)=> (
                          <label key={i} className="text-sm flex items-center gap-2">
                            <input type="checkbox" checked={selectedPrimary===p} onChange={()=> setSelectedPrimary(p)} />
                            <span className="whitespace-pre-line">{p}</span>
                          </label>
                        ))}
                      </div>
                      {Array.isArray(selectedNode.data?.primaries_fr) && selectedNode.data.primaries_fr.length>0 && (
                        <>
                          <div className="text-slate-500 mt-2">Textes (FR)</div>
                          <div className="grid grid-cols-1 gap-1">
                            {selectedNode.data.primaries_fr.slice(0,12).map((p:string,i:number)=> (
                              <label key={i} className="text-sm flex items-center gap-2">
                                <input type="checkbox" checked={selectedPrimary===p} onChange={()=> setSelectedPrimary(p)} />
                                <span className="whitespace-pre-line">{p}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                      {Array.isArray(selectedNode.data?.primaries_ar) && selectedNode.data.primaries_ar.length>0 && (
                        <>
                          <div className="text-slate-500 mt-2">النصوص (AR)</div>
                          <div className="grid grid-cols-1 gap-1">
                            {selectedNode.data.primaries_ar.slice(0,12).map((p:string,i:number)=> (
                              <label key={i} className="text-sm flex items-center gap-2">
                                <input type="checkbox" checked={selectedPrimary===p} onChange={()=> setSelectedPrimary(p)} />
                                <span className="whitespace-pre-line">{p}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                      {(selectedNode.type==='gemini_images' || selectedNode.type==='images_out') && (
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 mb-1">Ad image prompt</div>
                      <Textarea rows={3} value={geminiAdPrompt} onChange={e=>setGeminiAdPrompt(e.target.value)} />
                      <div className="text-[11px] text-slate-500">Uses variables: {offers?'{offers} ':''}and selected image.</div>
                      <div className="text-[11px] text-slate-500 mt-1">Preview:</div>
                      <pre className="text-[11px] bg-slate-50 border rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{expandPrompt(geminiAdPrompt)}</pre>
                      <div className="mt-1 flex items-center gap-2">
                        <select className="text-xs border rounded px-2 py-1"
                          onChange={e=>{ const v=Number(e.target.value); if(!Number.isNaN(v)) restorePromptVersion('gemini', v) }} defaultValue="">
                          <option value="">Versions…</option>
                          {geminiPromptVersions.map(v=> (<option key={v.version} value={v.version}>{`v${v.version} – ${new Date(v.savedAt).toLocaleString()}`}</option>))}
                        </select>
                        <Button size="sm" variant="outline" onClick={()=> savePromptVersion('gemini')}>Save version</Button>
                        <Button size="sm" variant="outline" onClick={()=>{ try{ localStorage.setItem('ptos_ads_gemini_prompt', geminiAdPrompt) }catch{} }}>Make default</Button>
                      </div>
                      {(()=>{ const run:any = (selectedNode.data?.meta||{}).lastRun; return run? (
                        <div className="text-xs space-y-1 mt-2">
                          <div className="text-slate-500">Last run</div>
                          <div>Model: {run.model||'default'}</div>
                          <div>Duration: {run.durationMs} ms</div>
                          <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
                          <div>Source image ({inputSources.sourceImage}): {String(run.inputSnapshot?.image_url||'')}</div>
                        </div>
                      ) : null })()}
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={()=> selectedNode.type==='gemini_images'? runAdImagesForNode(selectedNode.id): runAdImages()} disabled={running}>Generate images (4)</Button>
                            {selectedNode.type==='images_out' && Array.isArray(selectedNode.data?.images) && selectedNode.data.images.length>0 && (
                              <>
                                <Button size="sm" variant="outline" onClick={()=>{
                                  try{
                                    for(const u of (selectedNode.data?.images||[])){
                                      const a=document.createElement('a'); a.href=u; a.download='ad-image.jpg'; document.body.appendChild(a); a.click(); a.remove()
                                    }
                                  }catch{}
                                }}>Download all</Button>
                              </>
                            )}
                          </div>
                      {adImages.length>0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {adImages.map((u,i)=> (
                              <button key={i} className={`group border rounded overflow-hidden ${u===selectedImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`} onClick={()=> setSelectedImage(u)}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={toDisplayUrl(u)} alt={`ad-${i}`} className="w-full h-28 object-cover" />
                                <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition">
                                  <button className="text-[10px] px-1 py-0.5 rounded bg-white/90 border" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); try{ const a=document.createElement('a'); a.href=toDisplayUrl(u); a.download='ad-image.jpg'; document.body.appendChild(a); a.click(); a.remove() }catch{} }}>Download</button>
                                </div>
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
                        const heads = incoming.filter(n=> n.type==='headlines_out').flatMap(n=> {
                          const d:any = n.data||{}
                          const en = Array.isArray(d.headlines_en)? d.headlines_en : (Array.isArray(d.headlines)? d.headlines : [])
                          const fr = Array.isArray(d.headlines_fr)? d.headlines_fr : []
                          const ar = Array.isArray(d.headlines_ar)? d.headlines_ar : []
                          return [...en, ...fr, ...ar]
                        })
                        const prims = incoming.filter(n=> n.type==='copies_out').flatMap(n=> {
                          const d:any = n.data||{}
                          const en = Array.isArray(d.primaries_en)? d.primaries_en : (Array.isArray(d.primaries)? d.primaries : [])
                          const fr = Array.isArray(d.primaries_fr)? d.primaries_fr : []
                          const ar = Array.isArray(d.primaries_ar)? d.primaries_ar : []
                          return [...en, ...fr, ...ar]
                        })
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
                                    <span className="whitespace-pre-line">{p}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-1">Select image</div>
                              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-auto">
                                {Array.from(new Set([...
                                  imgs.slice(0,24),
                                  ...candidateImages.slice(0,24)
                                ])).map((u:string,i:number)=> (
                                  <button key={i} className={`border rounded overflow-hidden ${u===selectedImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`} onClick={()=> setSelectedImage(u)}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={toDisplayUrl(u)} alt={`ad-${i}`} className="w-full h-20 object-cover" />
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
                              <div className="text-xs text-slate-500 mb-1">Saved audience</div>
                              <select value={savedAudienceId} onChange={e=> setSavedAudienceId(e.target.value)} className="w-full rounded-xl border px-3 py-2">
                                <option value="">None</option>
                                {savedAudiences.map(a=> (<option key={a.id} value={a.id}>{a.name||a.id}</option>))}
                              </select>
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
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,_#eef2ff_1px,transparent_1px),linear-gradient(to_bottom,_#eef2ff_1px,transparent_1px)] bg-[size:24px_24px]"/>
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.06),transparent_30%),radial-gradient(circle_at_80%_60%,rgba(14,165,233,0.06),transparent_35%)]"/>
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


