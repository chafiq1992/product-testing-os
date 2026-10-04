"use client"

import { useState } from 'react'

export default function CampaignLifeDays({ start, totalDays, activity, onOpen }: {
  start: Date, totalDays: number,
  activity: (date: string) => { actions: number, notes: number }, onOpen: (date: string) => void,
}) {
  const [expanded, setExpanded] = useState(false)
  function dayButton(index: number) {
    const dayNumber = totalDays - index
    const date = new Date(start)
    date.setDate(start.getDate() + dayNumber - 1)
    const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
    const { actions, notes } = activity(day)
    return <button key={day} type="button" onClick={() => onOpen(day)}
      className={`relative h-6 min-w-6 shrink-0 rounded-full px-1 text-center text-[10px] font-bold leading-6 text-white focus:outline-none focus:ring-2 focus:ring-violet-400 ${actions ? 'bg-orange-500' : 'bg-emerald-500'} ${notes ? 'ring-2 ring-blue-500 ring-offset-1' : ''} ${index === 0 ? 'outline outline-2 outline-violet-600 outline-offset-1' : ''}`}
      title={`Day ${dayNumber} · ${day} · ${actions} actions · ${notes} notes`}
      aria-label={`Open day ${dayNumber}, ${actions} actions and ${notes} notes`}>{dayNumber}</button>
  }
  return <div className="inline-flex flex-col items-start" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}
    onFocus={() => setExpanded(true)} onBlur={event => { if(!event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}>
    <div className="flex items-center gap-2"><span className="shrink-0 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-bold text-violet-700">Day {totalDays}</span>
    <div className="flex gap-1 py-1" aria-label="Last five lifetime days">{Array.from({ length: Math.min(5, totalDays) }, (_, index) => dayButton(index))}</div></div>
    {expanded && totalDays > 5 && <div className="mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold text-slate-600">All {totalDays} days · scroll for earlier days</p>
      <div className="grid max-h-52 grid-cols-5 gap-2 overflow-y-auto overscroll-contain p-1" tabIndex={0} aria-label="All lifetime days">
        {Array.from({ length: totalDays }, (_, index) => dayButton(index))}
      </div>
    </div>}
  </div>
}
