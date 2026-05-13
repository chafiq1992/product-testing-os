"use client"
import * as React from "react"

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost"
  size?: "sm" | "md"
  className?: string
}

export function Button({ variant = "default", size = "md", className = "", ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center font-medium transition focus:outline-none"
  const variants = {
    default: "bg-slate-900 text-white hover:bg-slate-800",
    outline: "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
    ghost: "text-slate-700 hover:bg-slate-100",
  } as const
  const sizes = { sm: "h-8 px-2 rounded-md text-sm", md: "h-10 px-4 rounded-lg" } as const
  return <button {...props} className={[base, variants[variant], sizes[size], className].join(" ")} />
}

export default Button

