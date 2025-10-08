"use client"
import { useCallback, useMemo, useState } from 'react'
import { agentAdsExecute, geminiSuggestPrompts, geminiGenerateAdImages, translateTexts, llmAnalyzeLandingPage, llmGenerateAngles } from '../../../lib/api'

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
  const [model, setModel] = useState<string>("")
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
  const [analyzePrompt, setAnalyzePrompt] = useState<string>("")
  const [anglesPrompt, setAnglesPrompt] = useState<string>("")
  const [variation, setVariation] = useState<string>("")
  // Translate settings
  const [translateLocale, setTranslateLocale] = useState<string>('MA')
  const [autoTranslate, setAutoTranslate] = useState<boolean>(true)

  const system = useMemo<Message>(()=>({
    role:'system',
    content: 'You are the Ads Agent specialized in digital ads. Always output in English. Only generate ad headlines, primary texts, and ad image prompts. Do not produce product titles, descriptions, or landing copy.',
  }),[])

  const onRun = useCallback(async ()=>{
    setRunning(true); setResult(""); setError("")
    setMessages(null); setAngles(null); setSelectedIdx(0)
    setHeadlines([]); setCopies([]); setArHeadlines([]); setFrHeadlines([]); setArCopies([]); setFrCopies([])
    try{
      // Auto-fill benefits & pain points from landing analysis when available
      if(runAnalyze && (url || imageUrl)){
        try{
          const a = await llmAnalyzeLandingPage({ url: url || imageUrl, model: model || undefined, prompt: analyzePrompt || undefined })
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
        (analyzePrompt||anglesPrompt||variation)? `PROMPT_OVERRIDES: ${JSON.stringify({ analyze: analyzePrompt||undefined, angles: anglesPrompt||undefined, variation: variation||undefined })}` : undefined,
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
            const direct = await llmGenerateAngles({ product, num_angles: Math.max(1, Math.min(5, Number(numAngles)||3)), model: model || undefined, prompt: anglesPrompt || undefined })
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
              const baseImg = imageUrl || (url||'')
              if(baseImg){
                const gen = await geminiGenerateAdImages({ image_url: baseImg, prompt: bannerPrompt, num_images: 2, neutral_background: false })
                const imgs = (gen as any)?.images || []
                if(Array.isArray(imgs)) setAdImages(imgs)
              }
            }catch{}
        }
      }
    }catch(e:any){ setError(String(e?.message||e)) }
    finally{ setRunning(false) }
  },[system, url, imageUrl, audience, benefits, pains, budget, model, analyzePrompt, anglesPrompt, numAngles, runAnalyze, translateLocale, autoTranslate])

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
      const res = await geminiGenerateAdImages({ image_url: imageUrl || (url||''), prompt: adImagePrompt, num_images: Math.max(1, Math.min(6, Number(adImageCount)||2)) })
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

  return (
    <div className="flex gap-6 p-6 text-slate-800">
      {/* Left: Agent cards */}
      <div className="w-[380px] shrink-0 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="text-base font-semibold mb-3">Ads Agent Settings</div>
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
            <textarea className="border rounded-lg px-3 py-2 min-h-[56px] bg-white border-slate-200" placeholder="Angles prompt override (optional)" value={anglesPrompt} onChange={e=>setAnglesPrompt(e.target.value)} />
            <textarea className="border rounded-lg px-3 py-2 min-h-[56px] bg-white border-slate-200" placeholder="Analyze prompt override (optional)" value={analyzePrompt} onChange={e=>setAnalyzePrompt(e.target.value)} />
            <input className="border rounded-lg px-3 py-2 bg-white border-slate-200" placeholder="Variation (type to vary results)" value={variation} onChange={e=>setVariation(e.target.value)} />
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
      </div>

      {/* Right: Outputs */}
      <div className="flex-1 space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="text-lg font-semibold mb-4">English Outputs</div>
          {angles && angles.length? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              {angles.map((a, i)=> (
                <div key={i} className={`border border-slate-200 rounded-lg p-3 bg-white ${i===selectedIdx? 'ring-2 ring-blue-600':''}`}>
                  <div className="text-base font-medium">{a.name||'Angle'}</div>
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
                  <div className="text-base font-medium mb-2">Ad Headlines</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {headlines.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">{t}</div>))}
                  </div>
                </div>
              ) : null}
              {copies.length? (
                <div>
                  <div className="text-base font-medium mb-2">Primary Texts</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {copies.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-3 text-sm whitespace-pre-wrap">{t}</div>))}
                  </div>
                </div>
              ) : null}

              {/* Ad Image Prompt */}
              <div>
                <div className="text-base font-medium mb-2">Ad Image Prompt (English)</div>
                <div className="flex gap-2 mb-2">
                  <button className="text-sm px-3 py-2 border border-slate-200 rounded-lg" onClick={proposeAdImagePrompt}>Suggest Different Style</button>
                  <button className="text-sm px-3 py-2 border border-slate-200 rounded-lg" onClick={generateAdImages}>Re-Generate (2)</button>
                </div>
                <textarea className="border border-slate-200 rounded-lg px-3 py-2 min-h-[96px] w-full bg-white" placeholder="Ad image prompt" value={adImagePrompt} onChange={e=>setAdImagePrompt(e.target.value)} />
              </div>
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
                  <img src={src} alt="ad" className="w-full h-40 object-cover" />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}


