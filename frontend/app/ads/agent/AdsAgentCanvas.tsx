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
    const titleDesc = getLatestToolContent(messages||[], 'gen_title_desc_tool')
    const landingCopy = getLatestToolContent(messages||[], 'gen_landing_copy_tool')
    const pfi = getLatestToolContent(messages||[], 'product_from_image_tool')
    const steps = [
      { key:'user', title:'User Input', done: !!(messages&&messages.length), summary: '' },
      { key:'pfi', title:'Product From Image', done: !!pfi, summary: summarizePfi(pfi) },
      { key:'analyze', title:'Analyze Landing', done: !!analyze, summary: summarizeAnalyze(analyze) },
      { key:'angles', title:'Generate Angles', done: !!(angles && (Array.isArray(angles.angles)? angles.angles.length: (angles.raw?.angles||[]).length)), summary: summarizeAngles(angles) },
      { key:'td', title:'Title & Description', done: !!(titleDesc && (titleDesc.title||titleDesc.description)), summary: summarizeTitleDesc(titleDesc) },
      { key:'lc', title:'Landing Copy', done: !!(landingCopy && (landingCopy.headline||landingCopy.sections||landingCopy.html)), summary: summarizeLandingCopy(landingCopy) },
    ]
    const activeIndex = steps.findIndex(s=>!s.done)
    return { steps, activeIndex }
  },[messages])

  // Layout
  const nodeW = 260
  const nodeH = 72
  const gap = 40
  const padding = 16
  const totalH = padding*2 + data.steps.length*nodeH + (data.steps.length-1)*gap
  const totalW = nodeW + padding*2

  return (
    <div className="border rounded p-3 bg-white mb-3">
      <div className="text-sm font-semibold mb-2">Agent Orchestration</div>
      <svg width={totalW} height={totalH} className="block">
        <defs>
          <style>{`
            .fadeIn { opacity:0; animation: fadein 0.6s forwards; }
            @keyframes fadein { to { opacity:1 } }
            .dash { stroke-dasharray: 6 6; animation: dash 2s linear infinite; }
            @keyframes dash { to { stroke-dashoffset: -12 } }
          `}</style>
        </defs>
        {data.steps.map((s, i)=>{
          const x = padding
          const y = padding + i*(nodeH+gap)
          const nextY = padding + (i+1)*(nodeH+gap)
          const isActive = (i===data.activeIndex) || (data.activeIndex===-1 && i===data.steps.length-1)
          const color = s.done? '#0f172a' : (isActive? '#2563EB' : '#94A3B8')
          const fill = s.done? '#F8FAFC' : (isActive? '#DBEAFE' : '#FFFFFF')
          const badge = s.done? '#16A34A' : (isActive? '#F59E0B' : '#94A3B8')
          return (
            <g key={s.key} className="fadeIn" style={{ animationDelay: `${i*120}ms` }}>
              {/* connector */}
              {i < data.steps.length-1 ? (
                <line x1={padding+nodeW/2} y1={y+nodeH} x2={padding+nodeW/2} y2={nextY} stroke={isActive? '#2563EB' : '#94A3B8'} strokeWidth={2} className="dash" />
              ) : null}
              {/* node */}
              <rect x={x} y={y} rx={10} ry={10} width={nodeW} height={nodeH} fill={fill} stroke={color} strokeWidth={2} />
              <circle cx={x+16} cy={y+20} r={6} fill={badge} />
              {/* title */}
              <text x={x+32} y={y+24} fill={color} fontSize={12} fontWeight={600}>{s.title}</text>
              {/* summary */}
              <text x={x+16} y={y+48} fill="#334155" fontSize={11}>
                {s.summary || (s.done? 'completed' : 'pending')}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}


