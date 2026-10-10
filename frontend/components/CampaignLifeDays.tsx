"use client"

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import AnchoredPopover from '@/components/AnchoredPopover'

// The table cell shows only the last three days (no day count) so it keeps a
// fixed size; the full timeline with the total day count opens on click only.
export default function CampaignLifeDays({ start, totalDays, activity, onOpen }: {
  start: Date, totalDays: number,
  activity: (date: string) => { actions: number, notes: number }, onOpen: (date: string) => void,
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  function dayButton(index: number, compact: boolean) {
    const dayNumber = totalDays - index
    const date = new Date(start)
    date.setDate(start.getDate() + dayNumber - 1)
    const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
    const { actions, notes } = activity(day)
    return <button key={day} type="button" onClick={() => onOpen(day)}
      className={`relative h-6 min-w-6 shrink-0 rounded-full px-1 text-center text-[10px] font-bold leading-6 text-white focus:outline-none focus:ring-2 focus:ring-violet-400 ${actions ? 'bg-orange-500' : 'bg-emerald-500'} ${notes ? 'ring-2 ring-blue-500 ring-offset-1' : ''} ${index === 0 ? 'outline outline-2 outline-violet-600 outline-offset-1' : ''}`}
      title={`Day ${dayNumber} · ${day} · ${actions} actions · ${notes} notes`}
      aria-label={`Open day ${dayNumber}, ${actions} actions and ${notes} notes`}>{compact ? '' : dayNumber}</button>
  }
  const open = !!anchor
  return <div className="flex items-center gap-1.5">
    <div className="flex gap-1 py-1" aria-label="Last three lifetime days">{Array.from({ length: Math.min(3, totalDays) }, (_, index) => dayButton(index, true))}</div>
    <button type="button" onClick={event => { const target = event.currentTarget; setAnchor(open ? null : target) }}
      aria-expanded={open} title="Show all campaign days"
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-violet-700 transition-colors ${open ? 'border-violet-400 bg-violet-100' : 'border-violet-200 bg-white hover:bg-violet-50'}`}>
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {anchor && <AnchoredPopover anchor={anchor} onClose={() => setAnchor(null)} width={320} label="All lifetime days">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-violet-800">Day {totalDays}</p>
          <p className="text-[11px] text-slate-500">Started {start.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</p>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />No change</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" />Changes made</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full ring-2 ring-blue-500" />Has notes</span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 p-1" aria-label="All lifetime days">
        {Array.from({ length: totalDays }, (_, index) => dayButton(index, false))}
      </div>
    </AnchoredPopover>}
  </div>
}
