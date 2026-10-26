'use client'

import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Package, X } from 'lucide-react'

export const customerField = 'w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100'
export const customerButton = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45'

export function CustomerPhoto({ src, title, className = '' }: { src?: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return src && !failed ? <img src={src} alt={title} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`bg-slate-100 object-cover ${className}`} />
    : <span aria-label={title} className={`flex items-center justify-center bg-emerald-50 text-emerald-300 ${className}`}><Package size={38} strokeWidth={1.5} /></span>
}

export function CustomerDialog({ title, onClose, closeLabel, locked = false, children }: { title: string; onClose: () => void; closeLabel: string; locked?: boolean; children: ReactNode }) {
  const id = useId(), container = useRef<HTMLDivElement>(null), callback = useRef(onClose)
  callback.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])
    focusable()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) callback.current()
      if (event.key !== 'Tab') return
      const elements = focusable(), first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus() }
  }, [locked])
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-5" onClick={event => { if (event.target === event.currentTarget && !locked) onClose() }}>
    <div ref={container} role="dialog" aria-modal="true" aria-labelledby={id} className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 text-slate-900 shadow-2xl sm:rounded-3xl sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-3"><h2 id={id} className="text-xl font-black">{title}</h2><button type="button" disabled={locked} onClick={onClose} aria-label={closeLabel} className="rounded-full bg-slate-100 p-3 text-slate-500 disabled:opacity-30"><X size={18} /></button></div>
      {children}
    </div>
  </div>
}
