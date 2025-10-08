"use client"
import { useMemo } from 'react'

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

function summarizeAnalyze(p: any){
  if(!p) return ""
  const parts: string[] = []
  if(p.title) parts.push(String(p.title))
  if(Array.isArray(p.images)) parts.push(`${p.images.length} image(s)`) 
  if(Array.isArray(p.angles)) parts.push(`${p.angles.length} angle(s) found`)
  return parts.join(" • ")
}

function summarizeAngles(p: any){
  const arr = (p?.angles && Array.isArray(p.angles))? p.angles : (p?.raw?.angles||[])
  if(!Array.isArray(arr)) return ""
  const names = arr.map((a:any)=>a?.name).filter(Boolean).slice(0,3)
  return `${arr.length||0} angle(s)` + (names.length? ` • ${names.join(', ')}` : '')
}

function summarizeTitleDesc(p: any){
  if(!p) return ""
  return [p.title, p.description? `${Math.min(p.description.length,120)} chars` : null].filter(Boolean).join(" • ")
}

function summarizeLandingCopy(p: any){
  if(!p) return ""
  const secs = Array.isArray(p.sections)? p.sections.length : 0
  return [p.headline||null, secs? `${secs} section(s)` : null].filter(Boolean).join(" • ")
}

function summarizePfi(p:any){
  if(!p) return ""
  const fields = [
    p.title? 'title' : null,
    (p.benefits && p.benefits.length)? 'benefits' : null,
    (p.pain_points && p.pain_points.length)? 'pain_points' : null,
    (p.colors && p.colors.length)? 'colors' : null,
    (p.sizes && p.sizes.length)? 'sizes' : null,
  ].filter(Boolean)
  return fields.length? `fields: ${fields.join(', ')}` : ''
}

export default function AdsAgentCanvas({ messages }: { messages: any[]|null }){
  const data = useMemo(()=>{
    const analyze = getLatestToolContent(messages||[], 'analyze_landing_page_tool')
    const angles = getLatestToolContent(messages||[], 'gen_angles_tool')
    const pfi = getLatestToolContent(messages||[], 'product_from_image_tool')
    const steps = [
      { key:'user', title:'User Input', done: !!(messages&&messages.length), summary: '' },
      { key:'pfi', title:'Product From Image', done: !!pfi, summary: summarizePfi(pfi) },
      { key:'analyze', title:'Analyze Landing', done: !!analyze, summary: summarizeAnalyze(analyze) },
      { key:'angles', title:'Generate Angles', done: !!(angles && (Array.isArray(angles.angles)? angles.angles.length: (angles.raw?.angles||[]).length)), summary: summarizeAngles(angles) },
    ]
    const activeIndex = steps.findIndex(s=>!s.done)
    return { steps, activeIndex }
  },[messages])

  // Layout – horizontal flow
  const nodeW = 260
  const nodeH = 84
  const gapX = 56
  const padding = 16
  const totalW = padding*2 + data.steps.length*nodeW + (data.steps.length-1)*gapX
  const totalH = padding*2 + nodeH

  return (
    <div className="border rounded-xl p-4 bg-white shadow-sm">
      <div className="text-sm font-semibold mb-2">Agent Orchestration</div>
      <svg width={totalW} height={totalH} className="block">
        <defs>
          <style>{`
            .fadeIn { opacity:0; animation: fadein 0.6s ease forwards; }
            @keyframes fadein { to { opacity:1 } }
            .dash { stroke-dasharray: 10 6; animation: dash 2.2s linear infinite; }
            @keyframes dash { to { stroke-dashoffset: -16 } }
            .pulseGlow { filter: drop-shadow(0 0 8px rgba(37, 99, 235, .45)); }
            .activeRing { stroke: rgba(37, 99, 235, .35); stroke-width: 10; fill: none; animation: ring 1.2s ease-in-out infinite; }
            @keyframes ring { 0% { opacity: .2; r: 18 } 50% { opacity: .45; r: 28 } 100% { opacity: .2; r: 18 } }
            .particle { animation: particle 1.6s linear infinite; }
            @keyframes particle { 0% { opacity: 0; transform: translateX(0) } 10% { opacity: .9 } 90% { opacity: .9 } 100% { opacity: 0; transform: translateX(56px) } }
          `}</style>
        </defs>
        {data.steps.map((s, i)=>{
          const x = padding + i*(nodeW+gapX)
          const y = padding
          const nextX = padding + (i+1)*(nodeW+gapX)
          const isActive = (i===data.activeIndex) || (data.activeIndex===-1 && i===data.steps.length-1)
          const color = s.done? '#0f172a' : (isActive? '#2563EB' : '#94A3B8')
          const fill = s.done? '#F8FAFC' : (isActive? '#DBEAFE' : '#FFFFFF')
          const badge = s.done? '#16A34A' : (isActive? '#F59E0B' : '#94A3B8')
          return (
            <g key={s.key} className="fadeIn" style={{ animationDelay: `${i*120}ms` }}>
              {/* connector */}
              {i < data.steps.length-1 ? (
                <g>
                  <line x1={x+nodeW} y1={y+nodeH/2} x2={nextX} y2={y+nodeH/2} stroke={isActive? '#2563EB' : '#94A3B8'} strokeWidth={2} className="dash" />
                  {/* particles to show flow */}
                  {isActive? new Array(4).fill(0).map((_,k)=> (
                    <circle key={k} cx={x+nodeW-48+(k*14)} cy={y+nodeH/2} r={2.5} fill="#2563EB" className="particle" style={{ animationDelay: `${k*160}ms`}} />
                  )): null}
                </g>
              ) : null}
              {/* node */}
              <rect x={x} y={y} rx={12} ry={12} width={nodeW} height={nodeH} fill={fill} stroke={color} strokeWidth={2} className={isActive? 'pulseGlow':''} />
              {/* active ring */}
              {isActive? <circle cx={x+20} cy={y+22} r={22} className="activeRing" /> : null}
              <circle cx={x+20} cy={y+22} r={7} fill={badge} />
              {/* title */}
              <text x={x+40} y={y+26} fill={color} fontSize={12} fontWeight={600}>{s.title}</text>
              {/* summary */}
              <text x={x+20} y={y+52} fill="#334155" fontSize={11}>
                {s.summary || (s.done? 'completed' : 'pending')}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}


