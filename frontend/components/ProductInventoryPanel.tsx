"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

type Inventory = { sizes: string[], colors: string[], matrix: Record<string, Record<string, number>>, total_available: number }

export default function ProductInventoryPanel({ productId, data, loading, anchor, onClose }: {
  productId: string, data?: Inventory, loading: boolean, anchor: HTMLElement, onClose: () => void,
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number, left: number, maxHeight: number } | null>(null)
  useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      if(!anchor.isConnected){ onClose(); return }
      const rect = anchor.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = document.documentElement.clientHeight
      if(rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth){ onClose(); return }
      const gap = 8
      const margin = 12
      const width = Math.min(640, viewportWidth - margin * 2)
      const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - margin))
      const below = viewportHeight - rect.bottom - gap - margin
      const above = rect.top - gap - margin
      // Prefer the hovered inventory's lower edge. If it is near the bottom of
      // the screen, use the space above so the table can still be scrolled.
      const showAbove = below < 180 && above > below
      const maxHeight = Math.max(0, showAbove ? above : below)
      const height = Math.min(panel.current?.getBoundingClientRect().height || maxHeight, maxHeight)
      const top = showAbove ? rect.top - gap - height : rect.bottom + gap
      setPosition({ top: Math.max(margin, top), left, maxHeight })
    }
    const schedule = () => { if(!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    observer.observe(anchor)
    observer.observe(document.body)
    if(panel.current) observer.observe(panel.current)
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [anchor, onClose, data, loading])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if(event.key === 'Escape') onClose() }
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if(!panel.current?.contains(target) && !target.closest('[data-inventory-trigger]')) onClose()
    }
    window.addEventListener('keydown', close)
    document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', close); document.removeEventListener('pointerdown', outside) }
  }, [onClose])
  const alerts = data?.colors.reduce((count, color) => count + data.sizes.filter(size => Object.hasOwn(data.matrix[color] || {}, size) && data.matrix[color][size] <= 0).length, 0) || 0
  return <div ref={panel} role="region" aria-label={`Inventory for product ${productId}`} data-inventory-panel
    className="fixed z-[999] flex w-[640px] max-w-[calc(100vw-24px)] flex-col rounded-xl border border-slate-200 bg-white text-xs text-slate-800 shadow-2xl"
    style={position ? { top: position.top, left: position.left, maxHeight: position.maxHeight } : { visibility: 'hidden' }}>
    <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
      <div><h2 className="font-bold">Product inventory · #{productId}</h2><p className="mt-1 text-slate-500">Scroll to see every size and color.</p></div>
      <button onClick={onClose} className="rounded p-1 hover:bg-slate-100" aria-label="Close inventory"><X className="h-4 w-4" /></button>
    </div>
    {loading ? <p className="p-4 text-slate-500">Loading variants…</p> : !data ? <p className="p-4 text-slate-500">Inventory unavailable. Click the inventory number to retry.</p> : !data.sizes.length ? <p className="p-4 text-slate-500">No variants.</p> : <>
      {alerts > 0 && <p className="shrink-0 bg-rose-50 px-4 py-2 font-semibold text-rose-700">{alerts} variants need attention (0 or negative)</p>}
      <div className="min-h-0 overflow-auto overscroll-contain" tabIndex={0} aria-label="Sizes and colors inventory table">
        <table className="w-full border-separate border-spacing-0">
          <thead><tr><th className="sticky left-0 top-0 z-30 border-b bg-slate-50 px-3 py-2 text-left">Color</th>
            {data.sizes.map(size => <th key={size} className="sticky top-0 z-20 min-w-12 border-b bg-slate-50 px-3 py-2 text-center whitespace-nowrap">{size}</th>)}
          </tr></thead>
          <tbody>{data.colors.map(color => <tr key={color}>
            <th className="sticky left-0 z-10 border-b bg-white px-3 py-2 text-left font-medium whitespace-nowrap">{color}</th>
            {data.sizes.map(size => {
              const exists = Object.hasOwn(data.matrix[color] || {}, size)
              const quantity = exists ? data.matrix[color][size] : null
              return <td key={size} className="border-b px-3 py-2 text-center"><span className={`inline-block min-w-7 rounded px-1.5 py-1 font-bold ${exists && Number(quantity) <= 0 ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{quantity ?? '—'}</span></td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </div>
}
