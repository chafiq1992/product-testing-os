'use client'
import { useEffect, useState } from 'react'

// Where Meta's consent popup lands for a Sendo merchant (meta_connection.py
// _return_url). Tells the embedded page the result, then closes.
export default function SendoConnectedPage() {
  const [result, setResult] = useState('')

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('result') || ''
    setResult(value)
    try {
      window.opener?.postMessage({ type: 'sendo-meta-connect', result: value }, window.location.origin)
    } catch {}
    const timer = setTimeout(() => { try { window.close() } catch {} }, 600)
    return () => clearTimeout(timer)
  }, [])

  const ok = result === 'meta_connected'
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f7f2] p-6 text-center text-[#183d32]">
      <div>
        <h1 className="text-lg font-semibold">{ok ? 'Meta Ads connected' : result ? 'Meta Ads was not connected' : 'Finishing…'}</h1>
        <p className="mt-2 text-sm text-[#67776e]">You can close this window.</p>
      </div>
    </div>
  )
}
