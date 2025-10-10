"use client"
import * as React from "react"

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { className?: string }

export function Input({ className = "", ...props }: InputProps) {
  const base = "h-10 w-full border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
  return <input {...props} className={[base, "rounded-lg", className].join(" ")} />
}

export default Input

