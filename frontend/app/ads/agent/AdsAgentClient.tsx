"use client"
import { useCallback, useMemo, useState } from 'react'
import { agentAdsExecute } from '../../../lib/api'
import AdsAgentCanvas from './AdsAgentCanvas'

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
  const [language, setLanguage] = useState<string>("")
  const [model, setModel] = useState<string>("")
  const [running, setRunning] = useState<boolean>(false)
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [messages, setMessages] = useState<any[]|null>(null)
  const [angles, setAngles] = useState<any[]|null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(0)
  const [titleDesc, setTitleDesc] = useState<{title?:string, description?:string}|null>(null)
  const [landingCopy, setLandingCopy] = useState<any|null>(null)
  const [goal, setGoal] = useState<'angles'|'headlines'|'copies'|'title_desc'|'landing_copy'|'full'>('full')
  const [headlines, setHeadlines] = useState<string[]>([])
  const [copies, setCopies] = useState<string[]>([])
  const [numAngles, setNumAngles] = useState<number>(3)
  const [runAnalyze, setRunAnalyze] = useState<boolean>(true)
  const [runTD, setRunTD] = useState<boolean>(true)
  const [runLC, setRunLC] = useState<boolean>(true)
  const [analyzePrompt, setAnalyzePrompt] = useState<string>("")
  const [anglesPrompt, setAnglesPrompt] = useState<string>("")
  const [titleDescPrompt, setTitleDescPrompt] = useState<string>("")
  const [landingCopyPrompt, setLandingCopyPrompt] = useState<string>("")
  const [variation, setVariation] = useState<string>("")
  const [showHtmlPreview, setShowHtmlPreview] = useState<boolean>(true)

  const system = useMemo<Message>(()=>({
    role:'system',
    content: 'You are the Ads Agent. Use tools to analyze the landing page and produce 2–3 ad angles. Avoid free-form text; return concise summaries.',
  }),[])

  const onRun = useCallback(async ()=>{
    setRunning(true); setResult(""); setError("")
    setMessages(null); setAngles(null); setSelectedIdx(0); setTitleDesc(null); setLandingCopy(null)
    try{
      const product: any = {}
      if(audience.trim()) product.audience = audience.trim()
      if(benefits.trim()) product.benefits = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      if(pains.trim()) product.pain_points = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      if(language.trim()) product.language = language.trim()
      const parts = [
        url? `URL: ${url.trim()}` : undefined,
        imageUrl? `IMAGE_URL: ${imageUrl.trim()}` : undefined,
        Object.keys(product).length? `PRODUCT: ${JSON.stringify(product)}` : undefined,
        budget? `BUDGET: ${budget}` : undefined,
        `SETTINGS: num_angles=${Math.max(1, Math.min(5, Number(numAngles)||3))}; run_analyze=${runAnalyze}; run_title_desc=${runTD}; run_landing_copy=${runLC}`,
        (analyzePrompt||anglesPrompt||titleDescPrompt||landingCopyPrompt||variation)? `PROMPT_OVERRIDES: ${JSON.stringify({ analyze: analyzePrompt||undefined, angles: anglesPrompt||undefined, title_desc: titleDescPrompt||undefined, landing_copy: landingCopyPrompt||undefined, variation: variation||undefined })}` : undefined,
      ].filter(Boolean)
      const thread: Message[] = [system, { role:'user', content: `GOAL: ${goal}\n` + parts.join('\n') }]
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
        if(arr && arr.length){
          setAngles(arr); setSelectedIdx(0)
          // Collect headlines/copies if goal is headlines/copies
          if(goal==='headlines' || goal==='copies' || goal==='full'){
            const hs: string[] = []
            const ps: string[] = []
            for(const it of arr){
              if(Array.isArray(it.headlines)) hs.push(...it.headlines.slice(0,8))
              const prim = it.primaries
              if(Array.isArray(prim)) ps.push(...prim.slice(0,4))
              else if(prim && typeof prim==='object'){
                if(typeof prim.short==='string') ps.push(prim.short)
                if(typeof prim.medium==='string') ps.push(prim.medium)
                if(typeof prim.long==='string') ps.push(prim.long)
              }
            }
            setHeadlines(hs)
            setCopies(ps)
          }
        }
        if(arr && arr.length && runTD && (goal==='title_desc' || goal==='full')){ await runTitleDesc(arr[0], res?.messages||thread, product) }
      }
    }catch(e:any){ setError(String(e?.message||e)) }
    finally{ setRunning(false) }
  },[system, url, imageUrl, audience, benefits, pains, budget, model, language])

  const runTitleDesc = useCallback(async (angle: any, baseMessages: any[], product: any)=>{
    try{
      const prompt = `Using this ANGLE, generate product title and short description. Use gen_title_desc_tool. ${titleDescPrompt? `OVERRIDE: ${titleDescPrompt}`:''}\nANGLE:\n${JSON.stringify(angle)}`
      const next = [...baseMessages, { role:'user', content: prompt }]
      const res = await agentAdsExecute({ messages: next, model: model || undefined })
      setMessages(res?.messages||next)
      const td = getLatestToolContent(res?.messages, 'gen_title_desc_tool')
      if(td && (td.title || td.description)) setTitleDesc({ title: td.title, description: td.description })
      if(runLC){ await runLandingCopy(angle, res?.messages||next, product, td) }
    }catch(e:any){ /* ignore */ }
  },[model, titleDescPrompt, runLC])

  const runLandingCopy = useCallback(async (angle: any, baseMessages: any[], product: any, td?: any)=>{
    try{
      const withTD = { ...product }
      if(td?.title) withTD.title = td.title
      if(td?.description) withTD.description = td.description
      const images: string[] = imageUrl? [imageUrl] : []
      const prompt = `Generate landing copy using gen_landing_copy_tool. Include image_urls when helpful. ${landingCopyPrompt? `OVERRIDE: ${landingCopyPrompt}`:''}`
      const ctx = { product: withTD, angles: [angle], image_urls: images }
      const next = [...baseMessages, { role:'user', content: `${prompt}\nCONTEXT:\n${JSON.stringify(ctx)}` }]
      const res = await agentAdsExecute({ messages: next, model: model || undefined })
      setMessages(res?.messages||next)
      const lc = getLatestToolContent(res?.messages, 'gen_landing_copy_tool')
      if(lc && (lc.headline || lc.html || lc.sections)) setLandingCopy(lc)
    }catch(e:any){ /* ignore */ }
  },[imageUrl, model, landingCopyPrompt])

  const onSelectAngle = useCallback(async (idx: number)=>{
    setSelectedIdx(idx)
    setTitleDesc(null)
    setLandingCopy(null)
    if(angles && angles[idx] && messages){
      const product: any = {}
      if(audience.trim()) product.audience = audience.trim()
      if(benefits.trim()) product.benefits = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      if(pains.trim()) product.pain_points = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      if(language.trim()) product.language = language.trim()
      await runTitleDesc(angles[idx], messages, product)
    }
  },[angles, messages, runTitleDesc, audience, benefits, pains, language])

  return (
    <div className="flex gap-4 p-4">
      <div className="w-[360px] shrink-0 border rounded p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700">
        <div className="text-sm font-medium mb-2">Create Ads (Agent)</div>
        <div className="flex flex-col gap-2 text-sm">
          <input className="border rounded px-2 py-1 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Landing page URL" value={url} onChange={e=>setUrl(e.target.value)} />
          <input className="border rounded px-2 py-1 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Image URL (optional)" value={imageUrl} onChange={e=>setImageUrl(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[56px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Audience" value={audience} onChange={e=>setAudience(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[80px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Benefits (one per line)" value={benefits} onChange={e=>setBenefits(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[80px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Pain points (one per line)" value={pains} onChange={e=>setPains(e.target.value)} />
          <div className="flex gap-2">
            <input className="border rounded px-2 py-1 w-1/2 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Budget (MAD)" value={budget} onChange={e=>setBudget(e.target.value)} />
            <input className="border rounded px-2 py-1 w-1/2 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Language (e.g., ar, fr, en)" value={language} onChange={e=>setLanguage(e.target.value)} />
          </div>
          <input className="border rounded px-2 py-1 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Model (optional)" value={model} onChange={e=>setModel(e.target.value)} />
          <div className="border-t border-slate-200 dark:border-slate-700 my-2"/>
          <div className="font-medium">Goal</div>
          <select className="border rounded px-2 py-1 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" value={goal} onChange={e=>setGoal(e.target.value as any)}>
            <option value="angles">Angles only</option>
            <option value="headlines">Angles + Headlines</option>
            <option value="copies">Angles + Ad Copies</option>
            <option value="title_desc">Title & Description</option>
            <option value="landing_copy">Landing Copy</option>
            <option value="full">Full Flow</option>
          </select>
          <div className="font-medium">Advanced</div>
          <div className="flex items-center gap-2">
            <label className="text-xs">Num angles</label>
            <input type="number" min={1} max={5} className="border rounded px-2 py-1 w-20 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" value={numAngles} onChange={e=>setNumAngles(parseInt(e.target.value||'3')||3)} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={runAnalyze} onChange={e=>setRunAnalyze(e.target.checked)} />Run Analyze</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={runTD} onChange={e=>setRunTD(e.target.checked)} />Run Title/Desc</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={runLC} onChange={e=>setRunLC(e.target.checked)} />Run Landing Copy</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showHtmlPreview} onChange={e=>setShowHtmlPreview(e.target.checked)} />HTML Preview</label>
          </div>
          <textarea className="border rounded px-2 py-1 min-h-[52px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Angles prompt override (optional)" value={anglesPrompt} onChange={e=>setAnglesPrompt(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[52px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Title/Desc prompt override (optional)" value={titleDescPrompt} onChange={e=>setTitleDescPrompt(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[52px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Landing copy prompt override (optional)" value={landingCopyPrompt} onChange={e=>setLandingCopyPrompt(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[52px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Analyze prompt override (optional)" value={analyzePrompt} onChange={e=>setAnalyzePrompt(e.target.value)} />
          <input className="border rounded px-2 py-1 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" placeholder="Variation (type to vary results)" value={variation} onChange={e=>setVariation(e.target.value)} />
          <button className="bg-black text-white px-3 py-1 rounded disabled:opacity-50" disabled={running} onClick={onRun}>{running? 'Running…':'Run Agent'}</button>
        </div>
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium mb-2">Result</div>
        {error? <div className="text-xs text-red-600 whitespace-pre-wrap">{error}</div> : null}
        <AdsAgentCanvas messages={messages||[]}/>
        {angles && angles.length? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {angles.map((a, i)=> (
              <div key={i} className={`border rounded p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700 ${i===selectedIdx? 'ring-2 ring-black':''}`}>
                <div className="text-sm font-semibold">{a.name||'Angle'}</div>
                {Array.isArray(a.headlines)? <ul className="list-disc ml-5 text-xs mt-1">
                  {a.headlines.slice(0,4).map((h:string, idx:number)=>(<li key={idx}>{h}</li>))}
                </ul> : null}
                <div className="mt-2">
                  <button className="text-xs px-2 py-1 border rounded" onClick={()=>onSelectAngle(i)}>Select</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {(goal==='headlines' || goal==='full') && headlines.length? (
          <div className="border rounded p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700 mb-3">
            <div className="text-sm font-semibold mb-2">Headlines</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {headlines.map((h, idx)=>(
                <input key={idx} className="border rounded px-2 py-1 text-xs bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" value={h} onChange={e=>{
                  const copy = headlines.slice(); copy[idx]=e.target.value; setHeadlines(copy)
                }}/>
              ))}
            </div>
          </div>
        ) : null}
        {(goal==='copies' || goal==='full') && copies.length? (
          <div className="border rounded p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700 mb-3">
            <div className="text-sm font-semibold mb-2">Primary Texts</div>
            <div className="grid grid-cols-1 gap-2">
              {copies.map((c, idx)=>(
                <textarea key={idx} className="border rounded px-2 py-1 text-xs min-h-[64px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700" value={c} onChange={e=>{
                  const copy = copies.slice(); copy[idx]=e.target.value; setCopies(copy)
                }}/>
              ))}
            </div>
          </div>
        ) : null}
        {titleDesc? (
          <div className="border rounded p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700 mb-3">
            <div className="text-sm font-semibold">Title & Description</div>
            <div className="text-sm mt-1">{titleDesc.title}</div>
            <div className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{titleDesc.description}</div>
          </div>
        ) : null}
        {landingCopy? (
          <div className="border rounded p-3 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700 mb-3">
            <div className="text-sm font-semibold">Landing Copy</div>
            {landingCopy.headline? <div className="text-sm mt-1">{landingCopy.headline}</div> : null}
            {landingCopy.html && showHtmlPreview? (
              <iframe className="w-full min-h-[360px] mt-2 border rounded bg-white" sandbox="allow-same-origin" srcDoc={landingCopy.html} />
            ) : landingCopy.html? (
              <div className="text-xs mt-2 border rounded p-2 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 overflow-auto" dangerouslySetInnerHTML={{__html: landingCopy.html}}/>
            ) : (
              <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(landingCopy, null, 2)}</pre>
            )}
          </div>
        ) : null}
        {result? <pre className="text-xs whitespace-pre-wrap bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border rounded p-3 min-h-[120px]">{result}</pre> : <div className="text-xs text-slate-500">No result yet</div>}
      </div>
    </div>
  )
}


