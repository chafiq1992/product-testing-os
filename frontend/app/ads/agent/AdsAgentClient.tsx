"use client"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentAdsExecute, geminiSuggestPrompts, geminiGenerateAdImages, translateTexts, llmAnalyzeLandingPage, llmGenerateAngles } from '../../../lib/api'
import AdsAgentCanvas from './AdsAgentCanvas'
import { Settings } from 'lucide-react'

type Message = { role: 'system'|'user'|'assistant'|'tool', content: any }

type ToolPayload = any

function getLatestToolContent(messages: any[]|undefined, toolName: string): ToolPayload | undefined{
  try{
    const arr = Array.isArray(messages)? messages : []
    for(let i=arr.length-1;i>=0;i--){
      const m = arr[i]
      if(m && m.role==='tool' && m.name===toolName){
        const c = typeof m.content==='string'? m.content : (m.content? JSON.stringify(m.content) : '{}')
        return JSON.parse(c)
      }
    }
  }catch{}
  return undefined
}

export default function AdsAgentClient(){
  const [url, setUrl] = useState<string>("")
  const [imageUrl, setImageUrl] = useState<string>("")
  const [audience, setAudience] = useState<string>("")
  const [benefits, setBenefits] = useState<string>("")
  const [pains, setPains] = useState<string>("")
  const [budget, setBudget] = useState<string>("9")
  const [model, setModel] = useState<string>("gpt-5")
  const [running, setRunning] = useState<boolean>(false)
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [messages, setMessages] = useState<any[]|null>(null)
  const [angles, setAngles] = useState<any[]|null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(0)
  const [headlines, setHeadlines] = useState<string[]>([])
  const [copies, setCopies] = useState<string[]>([])
  // Translations
  const [arHeadlines, setArHeadlines] = useState<string[]>([])
  const [frHeadlines, setFrHeadlines] = useState<string[]>([])
  const [arCopies, setArCopies] = useState<string[]>([])
  const [frCopies, setFrCopies] = useState<string[]>([])
  // Image generation
  const [adImagePrompt, setAdImagePrompt] = useState<string>("")
  const [adImageCount, setAdImageCount] = useState<number>(2)
  const [adImages, setAdImages] = useState<string[]>([])
  const [appendImages, setAppendImages] = useState<boolean>(true)
  const [numAngles, setNumAngles] = useState<number>(3)
  const [runAnalyze, setRunAnalyze] = useState<boolean>(true)
  // Translate settings
  const [translateLocale, setTranslateLocale] = useState<string>('MA')
  const [autoTranslate, setAutoTranslate] = useState<boolean>(true)
  // Agent instruction (editable)
  const defaultInstruction = 'You are the Ads Agent specialized in digital ads. Always prefer tools when available. Typical flow: (1) If a URL is provided, call analyze_landing_page_tool. (2) Use gen_angles_tool (num_angles=2 or 3). (3) Optionally refine with gen_title_desc_tool. (4) Optionally prepare gen_landing_copy_tool. (5) If an image_url is provided without product info, call product_from_image_tool first. Output in English. By default, only generate ad angles, headlines, primary texts, and ad image prompts. Keep outputs concise and structured.'
  const [systemInstruction, setSystemInstruction] = useState<string>(defaultInstruction)
  const [showSettings, setShowSettings] = useState<boolean>(false)

  useEffect(()=>{
    try{
      const savedInstr = localStorage.getItem('ads_agent_instruction')
      if(savedInstr && typeof savedInstr==='string' && savedInstr.trim()){
        setSystemInstruction(savedInstr)
      }
    }catch{}
  },[])

  // Helpers for image source & display (mirror Studio page behavior)
  const __API_BASE = (typeof process!=='undefined'? (process.env as any).NEXT_PUBLIC_API_BASE_URL : '') || ''
  function toDisplayUrl(u: string){
    try{
      if(!u) return u
      if(u.startsWith('data:')) return u
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
  function isProbablyImageUrl(u:string){
    try{
      if(!u) return false
      if(u.startsWith('data:image/')) return true
      const low = u.toLowerCase()
      if(low.endsWith('.jpg')||low.endsWith('.jpeg')||low.endsWith('.png')||low.endsWith('.webp')||low.endsWith('.gif')) return true
      if(low.includes('cdn.shopify.com')) return true
      return false
    }catch{ return false }
  }
  function resolveSourceImage(): string | ''{
    // 1) Prefer user-provided imageUrl if it looks like an image
    if(isProbablyImageUrl(imageUrl)) return imageUrl
    // 2) Try to pull from latest analyze_landing_page_tool images
    try{
      const a = getLatestToolContent(messages||[], 'analyze_landing_page_tool') as any
      if(a && Array.isArray(a.images) && a.images[0] && isProbablyImageUrl(a.images[0])){
        return a.images[0]
      }
    }catch{}
    // 3) Try product_from_image_tool output
    try{
      const pfi = getLatestToolContent(messages||[], 'product_from_image_tool') as any
      if(pfi && typeof pfi.image_url==='string' && isProbablyImageUrl(pfi.image_url)){
        return pfi.image_url
      }
    }catch{}
    return ''
  }

  const system = useMemo<Message>(()=>({
    role:'system',
    content: systemInstruction,
  }),[systemInstruction])

  const onRun = useCallback(async ()=>{
    setRunning(true); setResult(""); setError("")
    setMessages(null); setAngles(null); setSelectedIdx(0)
    setHeadlines([]); setCopies([]); setArHeadlines([]); setFrHeadlines([]); setArCopies([]); setFrCopies([])
    try{
      // Auto-fill benefits & pain points from landing analysis when available
      if(runAnalyze && (url || imageUrl)){
        try{
          const a = await llmAnalyzeLandingPage({ url: url || imageUrl, model: model || undefined })
          if(Array.isArray((a as any)?.benefits) && !benefits){ setBenefits((a as any).benefits.join('\n')) }
          if(Array.isArray((a as any)?.pain_points) && !pains){ setPains((a as any).pain_points.join('\n')) }
        }catch{}
      }
      const product: any = {}
      if(audience.trim()) product.audience = audience.trim()
      if(benefits.trim()) product.benefits = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      if(pains.trim()) product.pain_points = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      const parts = [
        url? `URL: ${url.trim()}` : undefined,
        imageUrl? `IMAGE_URL: ${imageUrl.trim()}` : undefined,
        Object.keys(product).length? `PRODUCT: ${JSON.stringify(product)}` : undefined,
        budget? `BUDGET: ${budget}` : undefined,
        `SETTINGS: num_angles=${Math.max(1, Math.min(5, Number(numAngles)||3))}; run_analyze=${runAnalyze}`,
      ].filter(Boolean)
      const thread: Message[] = [system, { role:'user', content: `GOAL: angles_headlines_copies_only\n` + parts.join('\n') }]
      const res = await agentAdsExecute({ messages: thread, model: model || undefined })
      if(res?.error){ setError(res.error) }
      else{
        setMessages(res?.messages||null)
        setResult(res?.text || JSON.stringify(res, null, 2))
        const toolAngles = getLatestToolContent(res?.messages, 'gen_angles_tool')
        const analyzeAngles = getLatestToolContent(res?.messages, 'analyze_landing_page_tool')
        let arr = (toolAngles?.angles && Array.isArray(toolAngles.angles))? toolAngles.angles : (toolAngles?.raw?.angles||[])
        if((!arr || !arr.length) && Array.isArray(analyzeAngles?.angles)){
          arr = analyzeAngles.angles
        }
        // Fallback: call direct angles endpoint if agent returned nothing
        if((!arr || !arr.length)){
          try{
            const direct = await llmGenerateAngles({ product, num_angles: Math.max(1, Math.min(5, Number(numAngles)||3)), model: model || undefined })
            arr = (direct as any)?.angles || []
          }catch{}
        }
        if(arr && arr.length){
          setAngles(arr); setSelectedIdx(0)
          // Collect headlines/copies
            const hs: string[] = []
            const ps: string[] = []
            for(const it of arr){
              if(Array.isArray(it.headlines)){
                for(const h of it.headlines){ if(typeof h==='string' && h.trim()) hs.push(h.trim()) }
              }
              const prim = it.primaries
              if(Array.isArray(prim)){
                for(const p of prim){ if(typeof p==='string' && p.trim()) ps.push(p.trim()) }
              } else if(prim && typeof prim==='object'){
                if(typeof prim.short==='string' && prim.short.trim()) ps.push(prim.short.trim())
                if(typeof prim.medium==='string' && prim.medium.trim()) ps.push(prim.medium.trim())
                if(typeof prim.long==='string' && prim.long.trim()) ps.push(prim.long.trim())
              }
            }
            const topHeadlines = hs.slice(0,8)
            const topCopies = ps.slice(0,3)
            setHeadlines(topHeadlines)
            setCopies(topCopies)
            // Run translations (AR/FR) in parallel
            if(autoTranslate){
              try{
                const [arH, frH] = await Promise.all([
                  translateTexts({ texts: topHeadlines, target: 'ar', locale: translateLocale, domain: 'ads' }),
                  translateTexts({ texts: topHeadlines, target: 'fr', locale: translateLocale, domain: 'ads' }),
                ])
                setArHeadlines(Array.isArray((arH as any)?.translations)? (arH as any).translations : [])
                setFrHeadlines(Array.isArray((frH as any)?.translations)? (frH as any).translations : [])
              }catch{}
              try{
                const [arC, frC] = await Promise.all([
                  translateTexts({ texts: topCopies, target: 'ar', locale: translateLocale, domain: 'ads' }),
                  translateTexts({ texts: topCopies, target: 'fr', locale: translateLocale, domain: 'ads' }),
                ])
                setArCopies(Array.isArray((arC as any)?.translations)? (arC as any).translations : [])
                setFrCopies(Array.isArray((frC as any)?.translations)? (frC as any).translations : [])
              }catch{}
            }
            // Build image prompt with banners based on first pairs
            const h1 = topHeadlines[0] || ''
            const c1 = topCopies[0] || ''
            const h2 = topHeadlines[1] || h1
            const c2 = topCopies[1] || c1
            const bannerPrompt = [
              'Create two high‑impact ecommerce ad images from the provided product photo.',
              'Design both with bold, clean banners and overlay text for social-feed legibility (4:5 crop).',
              'Rules: keep product identity exact (colors/materials/shape/branding). Premium lighting. Crisp edges. High contrast.',
              'Each image must include one headline and one short supporting line as vector text (sharp, no artifacts).',
              `Image A banner text: Headline: "${h1}" | Subtext: "${c1}"`,
              `Image B banner text: Headline: "${h2}" | Subtext: "${c2}"`,
              'Use tasteful brand-neutral colors, ensure strong readability, and avoid covering key product details.',
            ].join('\n')
            setAdImagePrompt(bannerPrompt)
            // Generate exactly 2 images at the end if imageUrl/url is present
            try{
              const baseImg = resolveSourceImage()
              if(baseImg && isProbablyImageUrl(baseImg)){
                const gen = await geminiGenerateAdImages({ image_url: baseImg, prompt: bannerPrompt, num_images: 2, neutral_background: false })
                const imgs = (gen as any)?.images || []
                if(Array.isArray(imgs)) setAdImages(imgs)
              }
            }catch{}
        }
      }
    }catch(e:any){ setError(String(e?.message||e)) }
    finally{ setRunning(false) }
  },[system, url, imageUrl, audience, benefits, pains, budget, model, numAngles, runAnalyze, translateLocale, autoTranslate])

  const onSelectAngle = useCallback(async (idx: number)=>{
    setSelectedIdx(idx)
  },[])

  // Image prompt suggest and generation (Gemini)
  const proposeAdImagePrompt = useCallback(async ()=>{
    try{
      const product: any = {}
      if(audience.trim()) product.audience = audience.trim()
      if(benefits.trim()) product.benefits = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      if(pains.trim()) product.pain_points = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      const res = await geminiSuggestPrompts({ product, image_url: imageUrl || (url||'') })
      const p = (res as any)?.ad_prompt || ''
      if(p) setAdImagePrompt(p)
    }catch{}
  },[audience, benefits, pains, imageUrl, url])

  const generateAdImages = useCallback(async ()=>{
    if(!adImagePrompt) return
    try{
      const src = resolveSourceImage()
      if(!src || !isProbablyImageUrl(src)) return
      const res = await geminiGenerateAdImages({ image_url: src, prompt: adImagePrompt, num_images: Math.max(1, Math.min(6, Number(adImageCount)||2)) })
      const imgs = (res as any)?.images || []
      if(Array.isArray(imgs)){
        setAdImages(prev=> appendImages? [...prev, ...imgs] : imgs)
      }
    }catch{}
  },[adImagePrompt, imageUrl, url, adImageCount, appendImages])

  const retranslate = useCallback(async ()=>{
    try{
      const [arH, frH] = await Promise.all([
        translateTexts({ texts: headlines, target: 'ar', locale: translateLocale, domain: 'ads' }),
        translateTexts({ texts: headlines, target: 'fr', locale: translateLocale, domain: 'ads' }),
      ])
      setArHeadlines(Array.isArray((arH as any)?.translations)? (arH as any).translations : [])
      setFrHeadlines(Array.isArray((frH as any)?.translations)? (frH as any).translations : [])
    }catch{}
    try{
      const [arC, frC] = await Promise.all([
        translateTexts({ texts: copies, target: 'ar', locale: translateLocale, domain: 'ads' }),
        translateTexts({ texts: copies, target: 'fr', locale: translateLocale, domain: 'ads' }),
      ])
      setArCopies(Array.isArray((arC as any)?.translations)? (arC as any).translations : [])
      setFrCopies(Array.isArray((frC as any)?.translations)? (frC as any).translations : [])
    }catch{}
  },[copies, headlines, translateLocale])

  // Reasoning/events extracted from messages (tool usage and assistant turns)
  const reasoning = useMemo(()=>{
    const items: { type: 'tool'|'assistant', label: string, detail?: string }[] = []
    const arr = Array.isArray(messages)? messages : []
    for(const m of arr){
      try{
        if(m && Array.isArray(m.tool_calls) && m.tool_calls.length){
          for(const tc of m.tool_calls){
            const nm = tc?.function?.name || 'tool'
            items.push({ type:'tool', label: `Calling ${nm}`, detail: (tc?.function?.arguments||'').slice(0,160) })
          }
        }
        if(m && m.role==='tool' && typeof m.name==='string'){
          items.push({ type:'tool', label: `Completed ${m.name}`, detail: String(m.content||'').slice(0,180) })
        }
        if(m && m.role==='assistant' && m.content && !m.tool_calls){
          items.push({ type:'assistant', label: 'Assistant', detail: String(m.content||'').slice(0,180) })
        }
      }catch{}
    }
    return items.slice(-12)
  },[messages])

  return (
    <div className="flex gap-6 p-6 text-slate-800">
      {/* Left: Agent cards */}
      <div className="w-[380px] shrink-0 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-semibold">Ads Agent Settings</div>
            <button className="p-2 rounded-lg hover:bg-slate-100" title="Agent settings" onClick={()=>setShowSettings(true)}><Settings className="w-5 h-5 text-slate-600"/></button>
          </div>
          <div className="flex flex-col gap-3 text-base">
            <input className="border rounded-lg px-3 py-2 bg-white border-slate-200" placeholder="Landing page URL" value={url} onChange={e=>setUrl(e.target.value)} />
            <input className="border rounded-lg px-3 py-2 bg-white border-slate-200" placeholder="Image URL (optional)" value={imageUrl} onChange={e=>setImageUrl(e.target.value)} />
            <textarea className="border rounded-lg px-3 py-2 min-h-[64px] bg-white border-slate-200" placeholder="Audience" value={audience} onChange={e=>setAudience(e.target.value)} />
            <textarea className="border rounded-lg px-3 py-2 min-h-[96px] bg-white border-slate-200" placeholder="Benefits (one per line)" value={benefits} onChange={e=>setBenefits(e.target.value)} />
            <textarea className="border rounded-lg px-3 py-2 min-h-[96px] bg-white border-slate-200" placeholder="Pain points (one per line)" value={pains} onChange={e=>setPains(e.target.value)} />
            <div className="flex gap-3">
              <input className="border rounded-lg px-3 py-2 w-1/2 bg-white border-slate-200" placeholder="Budget (MAD)" value={budget} onChange={e=>setBudget(e.target.value)} />
              <input className="border rounded-lg px-3 py-2 w-1/2 bg-white border-slate-200" placeholder="Model (optional)" value={model} onChange={e=>setModel(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-slate-600">Num angles</label>
              <input type="number" min={1} max={5} className="border rounded-lg px-3 py-2 w-24 bg-white border-slate-200" value={numAngles} onChange={e=>setNumAngles(parseInt(e.target.value||'3')||3)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={runAnalyze} onChange={e=>setRunAnalyze(e.target.checked)} />Auto analyze landing</label>
            
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50" disabled={running} onClick={onRun}>{running? 'Running…':'Generate Ads'}</button>
            {error? <div className="text-sm text-red-600 whitespace-pre-wrap">{error}</div> : null}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="text-base font-semibold mb-3">Translate Agent Settings</div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm text-slate-600">Locale</label>
            <select className="border rounded-lg px-3 py-2 bg-white border-slate-200" value={translateLocale} onChange={e=>setTranslateLocale(e.target.value)}>
              <option value="MA">MA</option>
              <option value="FR">FR</option>
              <option value="SA">SA</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 mb-3"><input type="checkbox" checked={autoTranslate} onChange={e=>setAutoTranslate(e.target.checked)} />Auto-translate outputs</label>
          <button className="text-sm px-3 py-2 border border-slate-200 rounded-lg" onClick={retranslate}>Translate Now</button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="text-base font-semibold mb-3">Gemini Ad Image Generator</div>
          <div className="flex gap-2 mb-2">
            <button className="text-sm px-3 py-2 border border-slate-200 rounded-lg" onClick={proposeAdImagePrompt}>Suggest Different Style</button>
            <button className="text-sm px-3 py-2 border border-slate-200 rounded-lg" onClick={generateAdImages}>Generate (2)</button>
          </div>
          <textarea className="border border-slate-200 rounded-lg px-3 py-2 min-h-[96px] w-full bg-white" placeholder="Ad image prompt" value={adImagePrompt} onChange={e=>setAdImagePrompt(e.target.value)} />
        </div>
      </div>

      {/* Middle: Canvas + Outputs */}
      <div className="flex-1 space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <AdsAgentCanvas messages={messages||[]}/>
          <div className="text-lg font-semibold mb-1">Outputs</div>
          <div className="text-sm text-slate-600 mb-3">Sections: Angles, Ad Headlines (EN), Primary Texts (EN)</div>
          {angles && angles.length? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              {angles.map((a, i)=> (
                <div key={i} className={`border border-slate-200 rounded-lg p-3 bg-white ${i===selectedIdx? 'ring-2 ring-blue-600':''}`}>
                  <div className="text-base font-medium">Angle: {a.name||'Untitled Angle'}</div>
                  {Array.isArray(a.headlines)? <ul className="list-disc ml-5 text-sm mt-1 text-slate-700">
                    {a.headlines.slice(0,4).map((h:string, idx:number)=>(<li key={idx}>{h}</li>))}
                  </ul> : null}
                  <div className="mt-2">
                    <button className="text-sm px-2 py-1 border rounded-lg" onClick={()=>onSelectAngle(i)}>Select</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {(headlines.length || copies.length)? (
            <div className="space-y-5">
              {headlines.length? (
                <div>
                  <div className="text-base font-medium mb-2">Ad Headlines (EN)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {headlines.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">{t}</div>))}
                  </div>
                </div>
              ) : null}
              {copies.length? (
                <div>
                  <div className="text-base font-medium mb-2">Primary Texts (EN)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {copies.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-3 text-sm whitespace-pre-wrap">{t}</div>))}
                  </div>
                </div>
              ) : null}

              {/* Image prompt moved to left panel */}
            </div>
          ) : null}
        </div>

        {/* Translation Panel */}
        {(headlines.length || copies.length)? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="text-lg font-semibold mb-4">Translate Agent</div>
            {headlines.length? (
              <div className="mb-5">
                <div className="text-base font-medium mb-2">Headlines (EN / AR / FR)</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="text-sm space-y-2">{headlines.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2">{t}</div>))}</div>
                  <div className="text-sm space-y-2">{(arHeadlines.length? arHeadlines: new Array(headlines.length).fill('…')).map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2">{t}</div>))}</div>
                  <div className="text-sm space-y-2">{(frHeadlines.length? frHeadlines: new Array(headlines.length).fill('…')).map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2">{t}</div>))}</div>
                </div>
              </div>
            ) : null}
            {copies.length? (
              <div>
                <div className="text-base font-medium mb-2">Primary Texts (EN / AR / FR)</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="text-sm space-y-2">{copies.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-3 whitespace-pre-wrap">{t}</div>))}</div>
                  <div className="text-sm space-y-2">{(arCopies.length? arCopies: new Array(copies.length).fill('…')).map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-3 whitespace-pre-wrap">{t}</div>))}</div>
                  <div className="text-sm space-y-2">{(frCopies.length? frCopies: new Array(copies.length).fill('…')).map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-3 whitespace-pre-wrap">{t}</div>))}</div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Ad Images (Gemini) */}
        {adImages.length? (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="text-lg font-semibold mb-4">Gemini Ad Images</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {adImages.map((src, idx)=>(
                <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <img src={toDisplayUrl(src)} alt="ad" className="w-full h-40 object-cover" />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Right: Chat-style transcript */}
      <div className="w-[340px] shrink-0 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sticky top-20 max-h-[80vh] overflow-auto">
          <div className="text-base font-semibold mb-3">Agent Transcript</div>
          <div className="space-y-3">
            {Array.isArray(messages) && messages.length? messages.map((m:any, idx:number)=>{
              const role = m?.role || 'assistant'
              const hasTools = Array.isArray(m?.tool_calls) && m.tool_calls.length>0
              const isTool = role==='tool'
              const bubbleColor = isTool? 'bg-slate-50' : (role==='user'? 'bg-blue-50' : (role==='system'? 'bg-violet-50' : 'bg-white'))
              const title = isTool? (m?.name? `Tool: ${m.name}`:'Tool') : (role.charAt(0).toUpperCase()+role.slice(1))
              let body: string = ''
              try{
                if(isTool){
                  body = typeof m.content==='string'? m.content : JSON.stringify(m.content, null, 2)
                } else if(hasTools){
                  const calls = m.tool_calls.map((tc:any)=>{
                    const nm = tc?.function?.name || 'tool'
                    const args = tc?.function?.arguments || ''
                    return `${nm}(${args})`
                  }).join('\n')
                  body = calls
                } else {
                  body = typeof m.content==='string'? m.content : JSON.stringify(m.content||'', null, 2)
                }
              }catch{ body = String(m?.content||'') }
              return (
                <div key={idx} className={`border border-slate-200 rounded-lg p-3 ${bubbleColor}`}>
                  <div className="text-xs font-semibold text-slate-700 mb-1">{title}</div>
                  <pre className="text-xs text-slate-700 whitespace-pre-wrap">{body}</pre>
                </div>
              )
            }) : <div className="text-sm text-slate-500">No transcript yet</div>}
          </div>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings? (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={()=>setShowSettings(false)}>
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl p-5" onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-semibold mb-2">Agent Instruction</div>
            <div className="text-sm text-slate-600 mb-3">Edit the single system instruction for the Ads Agent.</div>
            <textarea className="w-full min-h-[180px] border border-slate-200 rounded-lg px-3 py-2" value={systemInstruction} onChange={e=>setSystemInstruction(e.target.value)} />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button className="px-3 py-2 text-sm border border-slate-200 rounded-lg" onClick={()=>{ setSystemInstruction(defaultInstruction); try{ localStorage.setItem('ads_agent_instruction', defaultInstruction) }catch{} }}>Reset</button>
              <button className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg" onClick={()=>{ try{ localStorage.setItem('ads_agent_instruction', systemInstruction||defaultInstruction) }catch{}; setShowSettings(false) }}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}


