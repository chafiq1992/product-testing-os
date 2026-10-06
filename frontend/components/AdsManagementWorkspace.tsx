"use client"
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import SendoEmbed from '@/components/SendoEmbed'
import { isEmbedded } from '@/lib/sendoEmbed'

// These operator tabs depend on browser preferences. Load each on its first
// visit, then keep it mounted so reports, filters and unsaved settings survive.
const Campaigns = dynamic(() => import('./AdsManagementCampaigns'), { ssr: false, loading: () => <p role="status" className="p-6">Loading campaigns…</p> })
const Settings = dynamic(() => import('./AdsAgentSettingsTab'), { ssr: false, loading: () => <p role="status" className="p-6">Loading agent settings…</p> })

export default function AdsManagementWorkspace() {
  const pathname = usePathname()
  const settingsActive = pathname?.replace(/\/$/, '') === '/ads-management/settings'
  const [campaignsVisited, setCampaignsVisited] = useState(!settingsActive)
  const [settingsVisited, setSettingsVisited] = useState(settingsActive)
  // Embedded for a Sendo merchant (lib/sendoEmbed.ts): campaigns only, inside
  // the workspace session. The AI agent settings tab stays operator-only.
  const [mode, setMode] = useState<'detect' | 'embed' | 'operator'>('detect')
  useEffect(() => { setMode(isEmbedded() ? 'embed' : 'operator') }, [])
  useEffect(() => {
    if(settingsActive) setSettingsVisited(true)
    else setCampaignsVisited(true)
  }, [settingsActive])
  if(mode === 'detect') return null
  if(mode === 'embed') return <SendoEmbed title="True Manager"><Campaigns embedded /></SendoEmbed>
  return <>
    <div hidden={settingsActive} data-ads-tab="campaigns">{(campaignsVisited || !settingsActive) && <Campaigns />}</div>
    <div hidden={!settingsActive} data-ads-tab="settings">{(settingsVisited || settingsActive) && <Settings />}</div>
  </>
}
