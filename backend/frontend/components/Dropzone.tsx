'use client'
import { useRef } from 'react'

type Props={ files:File[]; onFiles:(fs:File[])=>void }
export default function Dropzone({files,onFiles}:Props){
  const ref=useRef<HTMLInputElement>(null)
  return (
    <div className="p-6 border-2 border-dashed border-slate-700 rounded-xl text-center hover:border-slate-500 transition" onClick={()=>ref.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault(); onFiles([...files,...Array.from(e.dataTransfer.files)])}}>
      <p className="text-slate-300">Drop images here or click to upload</p>
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={e=> onFiles([...files, ...Array.from(e.target.files||[])]) } />
      <div className="mt-3 flex flex-wrap gap-2 justify-center">
        {files.map((f,i)=> (<span key={i} className="text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">{f.name}</span>))}
      </div>
    </div>
  )
}
