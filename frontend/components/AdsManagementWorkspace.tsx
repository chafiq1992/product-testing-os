"use client"
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

// These operator tabs depend on browser preferences. Load each on its first
// visit, then keep it mounted so reports, filters and unsaved settings survive.
const Campaigns = dynamic(() => import('./AdsManagementCampaigns'), { ssr: false, loading: () => <p role="status" className="p-6">Loading campaigns…</p> })
const Settings = dynamic(() => import('./AdsAgentSettingsTab'), { ssr: false, loading: () => <p role="status" className="p-6">Loading agent settings…</p> })

export default function AdsManagementWorkspace() {
  const pathname = usePathname()
  const settingsActive = pathname?.replace(/\/$/, '') === '/ads-management/settings'
  const [campaignsVisited, setCampaignsVisited] = useState(!settingsActive)
  const [settingsVisited, setSettingsVisited] = useState(settingsActive)
  useEffect(() => {
    if(settingsActive) setSettingsVisited(true)
    else setCampaignsVisited(true)
  }, [settingsActive])
  return <>
    <div hidden={settingsActive} data-ads-tab="campaigns">{(campaignsVisited || !settingsActive) && <Campaigns />}</div>
    <div hidden={!settingsActive} data-ads-tab="settings">{(settingsVisited || settingsActive) && <Settings />}</div>
  </>
}
