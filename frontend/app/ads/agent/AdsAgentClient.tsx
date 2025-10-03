"use client"
import { useCallback, useMemo, useState } from 'react'
import { agentAdsExecute } from '../../../lib/api'

type Message = { role: 'system'|'user'|'assistant'|'tool', content: any }

export default function AdsAgentClient(){
  const [url, setUrl] = useState<string>("")
  const [audience, setAudience] = useState<string>("")
  const [benefits, setBenefits] = useState<string>("")
  const [pains, setPains] = useState<string>("")
  const [budget, setBudget] = useState<string>("9")
  const [language, setLanguage] = useState<string>("")
  const [model, setModel] = useState<string>("")
  const [running, setRunning] = useState<boolean>(false)
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string>("")

  const system = useMemo<Message>(()=>({
    role:'system',
    content: 'You are the Ads Agent. Use tools to analyze the landing page and produce 2–3 ad angles. Avoid free-form text; return concise summaries.',
  }),[])

  const onRun = useCallback(async ()=>{
    setRunning(true); setResult(""); setError("")
    try{
      const product: any = {}
      if(audience.trim()) product.audience = audience.trim()
      if(benefits.trim()) product.benefits = benefits.split('\n').map(s=>s.trim()).filter(Boolean)
      if(pains.trim()) product.pain_points = pains.split('\n').map(s=>s.trim()).filter(Boolean)
      if(language.trim()) product.language = language.trim()
      const parts = [
        url? `URL: ${url.trim()}` : undefined,
        Object.keys(product).length? `PRODUCT: ${JSON.stringify(product)}` : undefined,
        budget? `BUDGET: ${budget}` : undefined,
      ].filter(Boolean)
      const messages: Message[] = [system, { role:'user', content: parts.join('\n') }]
      const res = await agentAdsExecute({ messages, model: model || undefined })
      if(res?.error){ setError(res.error) }
      else{ setResult(res?.text || JSON.stringify(res, null, 2)) }
    }catch(e:any){ setError(String(e?.message||e)) }
    finally{ setRunning(false) }
  },[system, url, audience, benefits, pains, budget, model, language])

  return (
    <div className="flex gap-4 p-4">
      <div className="w-[320px] shrink-0 border rounded p-3 bg-white">
        <div className="text-sm font-medium mb-2">Create Ads (Agent)</div>
        <div className="flex flex-col gap-2 text-sm">
          <input className="border rounded px-2 py-1" placeholder="Landing page URL" value={url} onChange={e=>setUrl(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[56px]" placeholder="Audience" value={audience} onChange={e=>setAudience(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[80px]" placeholder="Benefits (one per line)" value={benefits} onChange={e=>setBenefits(e.target.value)} />
          <textarea className="border rounded px-2 py-1 min-h-[80px]" placeholder="Pain points (one per line)" value={pains} onChange={e=>setPains(e.target.value)} />
          <div className="flex gap-2">
            <input className="border rounded px-2 py-1 w-1/2" placeholder="Budget (MAD)" value={budget} onChange={e=>setBudget(e.target.value)} />
            <input className="border rounded px-2 py-1 w-1/2" placeholder="Language (e.g., ar, fr, en)" value={language} onChange={e=>setLanguage(e.target.value)} />
          </div>
          <input className="border rounded px-2 py-1" placeholder="Model (optional)" value={model} onChange={e=>setModel(e.target.value)} />
          <button className="bg-black text-white px-3 py-1 rounded disabled:opacity-50" disabled={running} onClick={onRun}>{running? 'Running…':'Generate Angles'}</button>
        </div>
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium mb-2">Result</div>
        {error? <div className="text-xs text-red-600 whitespace-pre-wrap">{error}</div> : null}
        {result? <pre className="text-xs whitespace-pre-wrap bg-white border rounded p-3 min-h-[200px]">{result}</pre> : <div className="text-xs text-slate-500">No result yet</div>}
      </div>
    </div>
  )
}


