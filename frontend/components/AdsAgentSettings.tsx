"use client"
import { useEffect, useState } from 'react'
import { adsAgentModels, adsAgentSettings, adsAgentSettingsSave, type AdsAnalyzerSettings, type AdsModelCatalog } from '@/lib/api'

export default function AdsAgentSettings({ store }: { store: string }) {
  const [settings, setSettings] = useState<AdsAnalyzerSettings | null>(null)
  const [catalog, setCatalog] = useState<AdsModelCatalog | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let active = true
    setSettings(null); setError(''); setSaved(false)
    Promise.all([adsAgentSettings(store), adsAgentModels()]).then(([config, models]) => {
      if(active) { setSettings(config); setCatalog(models) }
    }).catch(e => { if(active) setError(e.message || 'Could not load settings') })
    return () => { active = false }
  }, [store])
  const update = (key: keyof AdsAnalyzerSettings, value: any) => { setSettings(s => s ? { ...s, [key]: value } : s); setSaved(false) }
  const fieldClass = 'mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm'
  const modelSelect = (key: 'model' | 'reviewer_model') => {
    const ids = Array.from(new Set([settings?.[key] || '', ...(catalog?.models || []).map(m => m.id)])).filter(Boolean)
    return <select className={fieldClass} value={settings?.[key]} onChange={e => update(key, e.target.value)}>{ids.map(id => <option key={id} value={id}>{id}{catalog?.source !== 'openai' ? ' (availability unverified)' : ''}</option>)}</select>
  }
  return <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
    <div><h1 className="text-2xl font-semibold">AI agent settings</h1><p className="mt-2 text-sm text-slate-600">Ads specialist and funnel analyzer for {store}. These controls apply to new individual and bulk analyses.</p></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
    {!settings ? <p role="status">{error ? 'Settings could not be loaded. Reload to retry.' : 'Loading agent settings…'}</p> : <form onSubmit={async e => {
      e.preventDefault(); setSaving(true); setError(''); setSaved(false)
      try { await adsAgentSettingsSave(settings, store); setSaved(true) } catch(e: any) { setError(e?.response?.data?.detail?.[0]?.msg || e.message || 'Could not save settings') } finally { setSaving(false) }
    }} className="space-y-6">
      <section className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Agent and models</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled} onChange={e => update('enabled', e.target.checked)} />Analyzer enabled</label></div>
        <p className="mt-2 text-sm text-slate-500">Models are fetched from your server’s OpenAI account. Credentials stay in the server Secret Manager configuration.</p>
        {catalog?.error && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{catalog.error}</p>}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-medium">Analysis model{modelSelect('model')}</label>
          <label className="text-sm font-medium">Reasoning depth<select className={fieldClass} value={settings.reasoning_effort} onChange={e => update('reasoning_effort', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label className="text-sm font-medium">Output token limit<input className={fieldClass} type="number" min={3000} max={16000} step={500} required value={settings.max_output_tokens} onChange={e => update('max_output_tokens', Number(e.target.value))} /></label>
        </div>
        <button type="button" className="mt-4 text-sm font-medium text-violet-700 underline" onClick={async () => { try { setCatalog(await adsAgentModels(true)) } catch { setError('Could not refresh model catalog') } }}>Refresh available models</button>
      </section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Specialists and evidence tools</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{([
          ['profiler_enabled', 'Customer profiler', 'Uses the analysis model to add a product and buyer brief.'],
          ['reviewer_enabled', 'Independent reviewer', 'Makes an extra model call to challenge unsupported conclusions.'],
          ['clarity_enabled', 'Clarity behavior insights', 'Uses recent available behavior exports; coverage is shown in the report.'],
          ['screenshots_enabled', 'Landing-page screenshots', 'Captures the mobile first screen and buying section for visual review.'],
          ['compare_previous_period', 'Previous-period comparison', 'Compares with the preceding period of equal length.'],
        ] as const).map(([key, label, description]) => <label key={key} className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={settings[key]} onChange={e => update(key, e.target.checked)} /><span><span className="font-medium">{label}</span><span className="mt-1 block text-slate-500">{description}</span></span></label>)}</div>
        {settings.reviewer_enabled && <label className="mt-5 block max-w-md text-sm font-medium">Reviewer model{modelSelect('reviewer_model')}</label>}
      </section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Decision thresholds</h2><p className="mt-2 text-sm text-slate-500">Spend and CPA use the Meta ad account currency. Sample thresholds limit winner, kill and scaling verdicts. Targets do not establish profitability without margins and delivery costs.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="text-sm">Minimum purchases<input className={fieldClass} type="number" min={3} max={500} required value={settings.min_purchases} onChange={e => update('min_purchases', Number(e.target.value))} /></label>
          <label className="text-sm">Minimum spend<input className={fieldClass} type="number" min={0} max={100000} step="any" required value={settings.min_spend} onChange={e => update('min_spend', Number(e.target.value))} /></label>
          <label className="text-sm">Target CPA (optional)<input className={fieldClass} type="number" min={0.01} max={100000} step="any" value={settings.target_cpa ?? ''} onChange={e => update('target_cpa', e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="text-sm">Target ROAS (optional)<input className={fieldClass} type="number" min={0.01} max={1000} step="any" value={settings.target_roas ?? ''} onChange={e => update('target_roas', e.target.value ? Number(e.target.value) : null)} /></label>
        </div>
      </section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Report preferences</h2><label className="mt-4 block max-w-sm text-sm">Language<select className={fieldClass} value={settings.language} onChange={e => update('language', e.target.value)}>{['auto', 'English', 'Arabic', 'French'].map(lang => <option key={lang} value={lang}>{lang === 'auto' ? 'Match ad language' : lang}</option>)}</select></label><label className="mt-4 block text-sm">Business context and instructions<textarea className={`${fieldClass} min-h-32`} maxLength={6000} placeholder="Margins, COD delivery constraints, customer objections, or experiments to consider…" value={settings.instructions} onChange={e => update('instructions', e.target.value)} /></label></section>
      <div className="flex items-center gap-4"><button disabled={saving} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save agent settings'}</button>{saved && <span role="status" className="text-sm text-emerald-700">Settings saved for {store}.</span>}</div>
    </form>}
  </div>
}
