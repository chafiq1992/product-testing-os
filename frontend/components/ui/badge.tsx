"use client"
import * as React from "react"

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "secondary" | "outline"
  className?: string
}

export function Badge({ variant = "default", className = "", ...props }: BadgeProps) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
  const variants = {
    default: "bg-slate-900 text-white",
    secondary: "bg-slate-100 text-slate-900",
    outline: "border border-slate-200 text-slate-700",
  } as const
  return <span {...props} className={[base, variants[variant], className].join(" ")} />
}

export default Badge

