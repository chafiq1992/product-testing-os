"use client"
import { useCallback, useMemo, useState } from 'react'
import { agentExecute } from '../../lib/api'

type Message = { role: 'system'|'user'|'assistant'|'tool', content: any }

export default function AgentPanel(){
  const [url, setUrl] = useState<string>("")
  const [productJson, setProductJson] = useState<string>("")
  const [running, setRunning] = useState<boolean>(false)
  const [output, setOutput] = useState<string>("")
  const [error, setError] = useState<string>("")

  const system = useMemo<Message>(()=>({ role:'system', content: 'You are a promotion assistant. If a landing URL is provided, analyze it. Then generate 2–3 angles for promotion. Keep responses concise.' }),[])

  const onRun = useCallback(async ()=>{
    setRunning(true); setOutput(""); setError("")
    try{
      const userParts: any[] = []
      if(url && url.trim()){
        userParts.push(`Landing URL: ${url.trim()}`)
      }
      if(productJson && productJson.trim()){
        userParts.push(`PRODUCT JSON: ${productJson.trim()}`)
      }
      if(userParts.length===0){ userParts.push('Promotion mode: generate 2 angles for a generic ecommerce product in Morocco.') }
      const messages = [system, { role:'user', content: userParts.join('\n') }]
      const res = await agentExecute({ messages })
      if(res?.error){ setError(res.error||'Agent error') }
      else{ setOutput(res?.text || JSON.stringify(res, null, 2)) }
    }catch(e:any){ setError(String(e?.message||e)) }
    finally{ setRunning(false) }
  },[system, url, productJson])

  return (
    <div className="border rounded-md p-3 bg-white shadow-sm">
      <div className="text-sm font-medium mb-2">Agent (experimental, promotion-only)</div>
      <div className="flex flex-col gap-2">
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Landing page URL (optional)"
          value={url}
          onChange={e=>setUrl(e.target.value)}
        />
        <textarea
          className="border rounded px-2 py-1 text-sm min-h-[90px]"
          placeholder='Product JSON (optional) e.g. {"audience":"Parents in MA","benefits":["..."],"pain_points":["..."]}'
          value={productJson}
          onChange={e=>setProductJson(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="bg-black text-white text-sm px-3 py-1 rounded disabled:opacity-50"
            disabled={running}
            onClick={onRun}
          >{running? 'Running…':'Run Agent'}</button>
        </div>
        {error? <div className="text-red-600 text-xs whitespace-pre-wrap">{error}</div> : null}
        {output? <pre className="text-xs whitespace-pre-wrap bg-slate-50 border rounded p-2 max-h-80 overflow-auto">{output}</pre> : null}
      </div>
    </div>
  )
}


