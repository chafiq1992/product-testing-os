import { Suspense } from 'react'
import AdsManagementWorkspace from '@/components/AdsManagementWorkspace'

export default function AdsManagementLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-6">Loading ads manager…</p>}>
    <AdsManagementWorkspace />
    {children}
  </Suspense>
}
