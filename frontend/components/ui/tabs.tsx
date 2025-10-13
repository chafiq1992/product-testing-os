"use client"
import * as React from "react"

type TabsContextValue = {
  value: string
  setValue: (v: string) => void
}

const TabsCtx = React.createContext<TabsContextValue | null>(null)

export function Tabs({ value, onValueChange, className = "", children }: { value: string, onValueChange: (v: string)=>void, className?: string, children: React.ReactNode }){
  const [internal, setInternal] = React.useState<string>(value)
  React.useEffect(()=>{ setInternal(value) }, [value])
  const setValue = React.useCallback((v: string)=>{ setInternal(v); onValueChange(v) }, [onValueChange])
  return (
    <div className={className}>
      <TabsCtx.Provider value={{ value: internal, setValue }}>
        {children}
      </TabsCtx.Provider>
    </div>
  )
}

export function TabsList({ className = "", children }: { className?: string, children: React.ReactNode }){
  return <div className={["inline-flex gap-2 bg-slate-100 p-1", className].join(" ")}>{children}</div>
}

export function TabsTrigger({ value, className = "", children }: { value: string, className?: string, children: React.ReactNode }){
  const ctx = React.useContext(TabsCtx)
  const active = ctx?.value === value
  return (
    <button onClick={()=>ctx?.setValue(value)} className={[
      "px-3 py-1.5 text-sm rounded-md transition",
      active? "bg-white shadow border border-slate-200" : "hover:bg-white/60",
      className
    ].join(" ")}>{children}</button>
  )
}

export function TabsContent({ value, className = "", children }: { value: string, className?: string, children: React.ReactNode }){
  const ctx = React.useContext(TabsCtx)
  if(ctx?.value !== value) return null
  return <div className={className}>{children}</div>
}

export default Tabs


