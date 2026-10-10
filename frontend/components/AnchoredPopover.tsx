"use client"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Position = { left: number, top?: number, bottom?: number, maxHeight: number }

/**
 * Click-opened panel pinned to a table cell. It follows the cell while the page
 * scrolls, closes on outside click / Escape, and closes once the cell leaves the
 * viewport so nothing opens or lingers on its own while scrolling.
 */
export default function AnchoredPopover({ anchor, onClose, children, width = 420, label }: {
  anchor: HTMLElement | null,
  onClose: () => void,
  children: ReactNode,
  width?: number,
  label: string,
}){
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [pos, setPos] = useState<Position | null>(null)

  useLayoutEffect(() => {
    if(!anchor) return
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      if(rect.bottom < 0 || rect.top > vh){ closeRef.current(); return }
      const w = Math.min(width, vw - 16)
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), vw - w - 8)
      const below = vh - rect.bottom - 12
      const above = rect.top - 12
      if(below >= 260 || below >= above) setPos({ left, top: rect.bottom + 4, maxHeight: Math.max(160, Math.min(560, below)) })
      else setPos({ left, bottom: vh - rect.top + 4, maxHeight: Math.max(160, Math.min(560, above)) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor, width])

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if(ref.current?.contains(target) || anchor?.contains(target)) return
      closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => { if(e.key === 'Escape') closeRef.current() }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor])

  // Rendered at the page root (outside the scrolling table), so fixed positioning is viewport-relative.
  if(!anchor || !pos) return null
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fixed z-[999] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-xl"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxHeight }}
    >
      {children}
    </div>
  )
}
