"use client"
import { useEffect, useRef, useState } from 'react'
import { adsAgentReports, analysisEvidenceUrl, campaignAnalyze, type CampaignAnalysisResult } from '@/lib/api'

type Props = { open: boolean, onClose: () => void, panelId: string, campaignKey: string, campaignIds: string[], productId?: string, name: string, store: string, adAccount?: string, range: { start: string, end: string }, initialSignal?: Pick<CampaignAnalysisResult, 'product_signal' | 'confidence_level' | 'date_range' | 'analyzed_at'> }
const label = (value?: string) => (value || 'unknown').replace(/_/g, ' ')
const tone = (value?: string) => value === 'potential_winner' || value === 'healthy' ? 'bg-emerald-50 text-emerald-800' : value === 'at_risk' || value === 'issue' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'

export default function ProductAdAnalysis(props: Props) {
  const loadedKey = useRef('')
  const [busy, setBusy] = useState(false)
  const [reports, setReports] = useState<CampaignAnalysisResult[]>([])
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    const reportKey = `${props.store}:${props.campaignKey}`
    if(!props.open || loadedKey.current === reportKey) return
    let active = true
    setLoading(true)
    adsAgentReports(props.campaignKey, props.store).then(rows => { if(active) { setReports(rows); setSelected(0); loadedKey.current = reportKey } }).catch(e => { if(active) setError(e.message || 'Saved reports could not load') }).finally(() => { if(active) setLoading(false) })
    return () => { active = false }
  }, [props.open, props.campaignKey, props.store])
  const result = reports[selected]
  const metrics = result?.meta_inputs || {}
  const run = async () => {
    setBusy(true); setError('')
    const controller = new AbortController(); abort.current = controller
    try {
      const response = await campaignAnalyze({ campaign_ids: props.campaignIds, campaign_key: props.campaignKey, product_id: props.productId,
        campaign_name: props.name, store: props.store, ad_account: props.adAccount, date_range: props.range }, { signal: controller.signal })
      if(response.error) throw new Error(response.error)
      if(response.data) { setReports(previous => [response.data!, ...previous].slice(0, 5)); setSelected(0) }
    } catch(e: any) { if(!controller.signal.aborted) setError(e.message || 'Analysis failed') }
    finally { setBusy(false); abort.current = null }
  }
  if(!props.open) return null
  return <section id={props.panelId} aria-label={`Ad analysis for ${props.name}`} className="max-w-[calc(100vw-3rem)] rounded-lg border border-violet-100 bg-white text-sm md:max-w-none">
    <div className="space-y-5 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-violet-700">Ad analysis</h2><button type="button" aria-label="Close ad analysis" onClick={props.onClose} className="rounded-lg border px-3 py-1 text-xs hover:bg-slate-50">Close</button></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{props.name}</p><p className="mt-1 text-xs text-slate-500">Selected period: {props.range.start} → {props.range.end} · {props.campaignIds.length} campaign(s)</p></div><div className="flex gap-2"><button type="button" disabled={busy || loading || !props.campaignIds.length} onClick={run} className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Analyzing funnel…' : 'Analyze ads'}</button>{busy && <button type="button" className="rounded-lg border px-3 py-2" onClick={() => { abort.current?.abort(); loadedKey.current = ''; setBusy(false); setError('Stopped waiting. The server may finish the report; reopen this panel to retrieve it.') }}>Stop waiting</button>}</div></div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}
      {loading && <p role="status" className="text-slate-500">Loading saved reports…</p>}
      {busy && <p role="status" className="text-slate-500">Reading period KPIs, comparing campaigns, and reviewing funnel evidence. You can collapse this panel while it runs.</p>}
      {!result && !loading && !busy && <p className="text-slate-500">Run an analysis to see product signals, funnel issues, suggested tests and screenshot explanations here.</p>}
      {result && <>
        <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1 font-semibold capitalize ${tone(result.product_signal)}`}>{label(result.product_signal)}</span><span className="capitalize">{label(result.overall_verdict)} · {label(result.confidence_level)} confidence</span><label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs text-slate-500 sm:ml-auto">Saved reports<select aria-label="Choose saved analysis report" className="w-full min-w-0 max-w-full rounded-lg border p-2 sm:w-auto" value={selected} onChange={e => setSelected(Number(e.target.value))}>{reports.map((r, i) => <option key={i} value={i}>{r.date_range?.start} → {r.date_range?.end} · {r.analyzed_at ? new Date(r.analyzed_at).toLocaleString() : `Report ${i + 1}`}</option>)}</select></label></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="leading-relaxed" dir="auto">{result.summary}</p><p className="mt-3 text-xs text-slate-500">Report period: {result.date_range?.start} → {result.date_range?.end} · Model: {result.agent?.model || 'Legacy analyzer'}{result.agent?.reviewer_model && ` · Reviewer: ${result.agent.reviewer_model}`}</p>{(result.date_range?.start !== props.range.start || result.date_range?.end !== props.range.end) && <p className="mt-2 text-xs font-medium text-amber-700">This saved report uses a different period from the current dashboard selection.</p>}</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">{[['Spend', metrics.spend], ['Purchases', metrics.purchases], ['CPA', metrics.cpp], ['Link CTR %', metrics.link_ctr], ['ROAS', metrics.roas], ['Landing views', metrics.landing_page_views]].map(([title, value]) => <div key={String(title)} className="rounded-lg border p-3"><p className="text-xs text-slate-500">{title}</p><p className="mt-1 font-semibold">{value == null ? 'Unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{['Spend', 'CPA'].includes(String(title)) && value != null ? ` ${metrics.currency || ''}` : ''}</p></div>)}</div>
        {!!result.warnings?.length && <div className="space-y-2">{result.warnings.map((warning, i) => <div key={i} className={`rounded-lg p-3 ${warning.severity === 'critical' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}><p className="font-semibold" dir="auto">{warning.title}</p><p className="mt-1" dir="auto">{warning.explanation}</p></div>)}</div>}
        <section><h3 className="font-semibold">Funnel diagnosis</h3><div className="mt-3 grid gap-3 md:grid-cols-3">{result.funnel_stages?.map(stage => <div key={stage.stage} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-2"><h4 className="font-semibold capitalize">{label(stage.stage)}</h4><span className={`rounded-full px-2 py-0.5 text-xs ${tone(stage.status)}`}>{stage.status}</span></div><ul className="mt-3 space-y-1 text-xs text-slate-600">{stage.evidence.map((item, i) => <li key={i} dir="auto">{item}</li>)}</ul><p className="mt-3" dir="auto"><span className="font-medium">Hypothesis: </span>{stage.hypothesis}</p><p className="mt-2" dir="auto"><span className="font-medium">Test: </span>{stage.suggested_test}</p></div>)}</div></section>
        <section><h3 className="font-semibold">Recommended actions</h3><ol className="mt-3 space-y-3">{result.recommendations.map((rec, i) => <li key={i} className="rounded-xl border p-4" dir="auto"><p className="font-semibold">P{rec.priority} · {label(rec.category)} · {rec.recommendation}</p><p className="mt-2 text-slate-600">{rec.finding}</p><p className="mt-2 text-xs text-slate-500">Validation / expected effect: {rec.expected_impact}</p></li>)}</ol></section>
        {!!result.visual_evidence?.length && <section><h3 className="font-semibold">Screenshot evidence</h3><div className="mt-3 grid gap-4 md:grid-cols-2">{result.visual_evidence.map((evidence, i) => <div key={`${evidence.id}-${i}`} className="rounded-xl border p-4"><h4 className="font-medium">{evidence.title || 'Landing page capture unavailable'}</h4>{evidence.url && analysisEvidenceUrl(evidence.url) && <a href={analysisEvidenceUrl(evidence.url)} target="_blank" rel="noreferrer"><img className="mx-auto mt-3 max-h-96 max-w-full rounded-lg border object-contain" src={analysisEvidenceUrl(evidence.url)} alt={evidence.title || 'Mobile landing page screenshot'} /></a>}<p className="mt-2 text-xs text-slate-500">{evidence.note}</p>{evidence.status === 'captured' && result.visual_findings?.filter(f => f.evidence_id === evidence.id).map((finding, j) => <div key={j} className="mt-3 border-t pt-3" dir="auto"><p className="font-semibold">{finding.area}</p><p className="mt-1">{finding.observation}</p><p className="mt-2 text-slate-600">Why: {finding.why_it_matters}</p><p className="mt-2 font-medium">Change: {finding.suggested_change}</p></div>)}</div>)}</div></section>}
        {!!result.creative_analysis?.new_creative_examples?.length && <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Suggested hooks and creative tests</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{result.creative_analysis.new_creative_examples.map((concept, i) => <div key={i} className="rounded-lg bg-slate-50 p-3" dir="auto"><p className="font-semibold">{concept.concept_name} · {concept.format}</p><p className="mt-2">Hook: {concept.hook}</p><p className="mt-2">{concept.visual_direction}</p><p className="mt-2">{concept.primary_text}</p><p className="mt-2 font-medium">{concept.headline}</p><p className="mt-2 text-xs text-slate-500">{concept.why_it_should_work}</p></div>)}</div></details>}
        {!!result.data_gaps?.length && <section className="rounded-xl bg-amber-50 p-4"><h3 className="font-semibold">Evidence still needed</h3><ul className="mt-2 list-inside list-disc space-y-1">{result.data_gaps.map((gap, i) => <li key={i} dir="auto">{gap}</li>)}</ul></section>}
        {result.review && <section className="rounded-xl border p-4"><h3 className="font-semibold">Independent review</h3><p className="mt-2" dir="auto">{result.review.summary}</p><ul className="mt-2 list-inside list-disc">{result.review.concerns.map((concern, i) => <li key={i} dir="auto">{concern}</li>)}</ul></section>}
      </>}
    </div>
  </section>
}
