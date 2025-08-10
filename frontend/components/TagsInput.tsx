'use client'
import { useState, KeyboardEvent } from 'react'

type Props={ value:string[]; onChange:(v:string[])=>void; placeholder?:string }
export default function TagsInput({value,onChange,placeholder}:Props){
  const [input,setInput]=useState('')
  function add(tag:string){ const t=tag.trim(); if(!t) return; if(!value.includes(t)){ onChange([...value,t]) } setInput('') }
  function onKeyDown(e:KeyboardEvent<HTMLInputElement>){ if(e.key==='Enter'||e.key===','){ e.preventDefault(); add(input) } }
  return (
    <div>
      <div className="flex flex-wrap gap-2 p-2 rounded-lg border border-slate-700 bg-[#0c122a]">
        {value.map(t=> (
          <span key={t} className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-sm">{t}
            <button className="ml-2 text-slate-400" onClick={()=>onChange(value.filter(x=>x!==t))}>×</button>
          </span>
        ))}
        <input className="flex-1 bg-transparent outline-none text-sm" value={input} placeholder={placeholder||'Add & press Enter'} onChange={e=>setInput(e.target.value)} onKeyDown={onKeyDown}/>
      </div>
    </div>
  )
}
