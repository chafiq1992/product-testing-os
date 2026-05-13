"use client"
import * as React from "react"

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }

export function Textarea({ className = "", ...props }: TextareaProps) {
  const base = "w-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 min-h-[100px]"
  return <textarea {...props} className={[base, "rounded-lg", className].join(" ")} />
}

export default Textarea

