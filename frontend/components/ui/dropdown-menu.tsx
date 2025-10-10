"use client"
import * as React from "react"

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  return <div className="relative inline-block text-left">{children}</div>
}

export function DropdownMenuTrigger({ asChild, children }: { asChild?: boolean, children: React.ReactNode }) {
  return <>{children}</>
}

export function DropdownMenuContent({ align = "start", children }: { align?: "start" | "end", children: React.ReactNode }) {
  return (
    <div className={`absolute z-50 mt-2 min-w-[12rem] rounded-lg border border-slate-200 bg-white p-1 shadow-lg ${align==="end"? "right-0" : "left-0"}`}>
      {children}
    </div>
  )
}

export function DropdownMenuItem({ onClick, children }: { onClick?: () => void, children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
      {children}
    </button>
  )
}

export default DropdownMenu

