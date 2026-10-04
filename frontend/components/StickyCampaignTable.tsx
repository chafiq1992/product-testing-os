"use client"

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

// A floating copy lets the page scroll vertically while the actual table keeps
// its horizontal scrollbar. A sticky thead inside overflow-x:auto cannot do that.
export default function StickyCampaignTable({ header, children, pageHeader }: {
  header: ReactNode, children: ReactNode, pageHeader: RefObject<HTMLElement | null>,
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const floating = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ top: number, left: number, width: number, tableWidth: number, columns: number[] } | null>(null)

  useEffect(() => {
    const host = wrapper.current
    const source = table.current
    if(!host || !source) return
    let frame = 0
    const update = () => {
      frame = 0
      const rect = host.getBoundingClientRect()
      const top = Math.max(0, pageHeader.current?.getBoundingClientRect().bottom || 0)
      const head = source.tHead
      const visible = rect.width > 0 && !!head && rect.top < top && rect.bottom > top + head.offsetHeight
      if(visible){
        setLayout({ top, left: rect.left + host.clientLeft, width: host.clientWidth, tableWidth: source.getBoundingClientRect().width,
          columns: Array.from(head.rows[0]?.cells || []).map(cell => cell.getBoundingClientRect().width) })
      }else setLayout(null)
      if(floating.current) floating.current.scrollLeft = host.scrollLeft
    }
    const schedule = () => { if(!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    observer.observe(source)
    observer.observe(host)
    if(pageHeader.current) observer.observe(pageHeader.current)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    host.addEventListener('scroll', schedule, { passive: true })
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      host.removeEventListener('scroll', schedule)
    }
  }, [pageHeader])

  useEffect(() => { if(floating.current && wrapper.current) floating.current.scrollLeft = wrapper.current.scrollLeft }, [layout])

  return <>
    <div ref={wrapper} className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <table ref={table} className="min-w-full text-[13px] text-slate-800">{header}{children}</table>
    </div>
    {layout && <div ref={floating} data-sticky-campaign-header className="fixed z-40 overflow-hidden border-b border-slate-300 bg-slate-50 shadow-md"
      style={{ top: layout.top, left: layout.left, width: layout.width }}>
      <table className="text-[13px] text-slate-800" style={{ width: layout.tableWidth, tableLayout: 'fixed' }}>
        <colgroup>{layout.columns.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        {header}
      </table>
    </div>}
  </>
}
