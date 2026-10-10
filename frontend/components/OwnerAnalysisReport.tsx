"use client"
import { useEffect } from 'react'
import { AlertTriangle, Eye, TrendingUp, X } from 'lucide-react'
import { analysisEvidenceUrl, type OwnerProductReport, type OwnerReportAction } from '@/lib/api'

const SIGNAL_STYLE: Record<OwnerProductReport['signal'], { label: string, pill: string, icon: string }> = {
  scale: { label: 'Scale', pill: 'bg-emerald-600 text-white', icon: 'bg-emerald-500 text-white ring-emerald-200 hover:bg-emerald-600' },
  fix: { label: 'Fix', pill: 'bg-rose-600 text-white', icon: 'bg-rose-500 text-white ring-rose-200 hover:bg-rose-600' },
  watch: { label: 'Watch', pill: 'bg-amber-500 text-white', icon: 'bg-amber-400 text-white ring-amber-100 hover:bg-amber-500' },
}

const ADSET_ACTION_STYLE: Record<string, string> = {
  scale: 'bg-emerald-100 text-emerald-800', duplicate: 'bg-emerald-50 text-emerald-700', keep: 'bg-slate-100 text-slate-700',
  watch: 'bg-amber-100 text-amber-800', reduce: 'bg-orange-100 text-orange-800', pause: 'bg-rose-100 text-rose-800',
}

function mad(value: unknown, digits = 0){
  if(value == null || value === '' || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })} MAD`
}

function num(value: unknown, suffix = ''){
  if(value == null || value === '' || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`
}

export function OwnerSignalIcon({ report, onClick }: { report: OwnerProductReport, onClick: () => void }){
  const style = SIGNAL_STYLE[report.signal] || SIGNAL_STYLE.watch
  const Icon = report.signal === 'scale' ? TrendingUp : report.signal === 'fix' ? AlertTriangle : Eye
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${style.label}: ${report.headline}`}
      aria-label={`Open ${style.label.toLowerCase()} recommendation for ${report.product_name || report.product_id}`}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full shadow-sm ring-2 transition-transform hover:scale-110 ${style.icon}`}
    >
      <Icon className="h-3 w-3" />
    </button>
  )
}

function ActionList({ title, items }: { title: string, items: OwnerReportAction[] }){
  if(!items?.length) return null
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold text-slate-800">{title}</h3>
      <ol className="space-y-1.5">
        {items.slice().sort((a, b) => a.priority - b.priority).map((item, index) => (
          <li key={index} className="rounded-lg border border-slate-200 p-2.5" dir="auto">
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${item.priority === 1 ? 'bg-rose-100 text-rose-700' : item.priority === 2 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>P{item.priority}</span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-800">{item.title}</p>
                <p className="mt-0.5 whitespace-pre-line text-slate-600">{item.detail}</p>
                {item.expected_effect && <p className="mt-1 text-xs text-slate-500">Expected: {item.expected_effect}</p>}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function OwnerAnalysisReport({ report, onClose }: { report: OwnerProductReport, onClose: () => void }){
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if(e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const style = SIGNAL_STYLE[report.signal] || SIGNAL_STYLE.watch
  const econ = report.economics
  const totals = econ?.totals || {}
  const unit = econ?.unit_economics || {}
  const cover = econ?.inventory_cover || {}
  const adsetInputs = new Map((report.adsets_input || []).map(a => [String(a.adset_id), a]))
  const screenshots = (report.visual_evidence || []).filter(e => e.status === 'captured' && e.url && analysisEvidenceUrl(e.url))
  const kpis: Array<[string, string, string?]> = [
    ['Ad spend (5d)', mad(totals.spend_mad)],
    ['Real orders', num(totals.real_orders)],
    ['True CPP', mad(totals.true_cpp_mad), `Break-even ${mad(unit.break_even_cpp_mad)}`],
    ['Est. profit (5d)', mad(unit.estimated_profit_5d_mad), 'Before COD returns'],
    ['Link CTR', num(totals.link_ctr, '%')],
    ['ATC → order', num(totals.atc_to_order_rate, '%'), `${num(totals.add_to_cart)} add to carts`],
    ['Stock cover', cover.days_of_cover != null ? `${num(cover.days_of_cover)} days` : '—', `${num(cover.available_units)} units`],
    ['Unit margin', mad(unit.margin_before_ads_mad), `Price ${mad(unit.selling_price_mad)} · cost ${mad(unit.product_cost_mad)}${unit.product_cost_source === 'default' ? ' (default)' : ''} · service ${mad(unit.service_cost_mad)}`],
  ]
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-slate-900/40 p-3 md:p-8" onMouseDown={e => { if(e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={`Ads analyst report for ${report.product_name || report.product_id}`} className="max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl bg-white text-sm shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start gap-3 rounded-t-2xl border-b bg-white/95 px-4 py-3 backdrop-blur">
          <span className={`mt-0.5 rounded-full px-3 py-1 text-xs font-bold ${style.pill}`}>{style.label}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-900">{report.product_name || `Product ${report.product_id}`}</h2>
            <p className="text-xs text-slate-500">
              {report.date_range ? `${report.date_range.start} → ${report.date_range.end}` : 'Last 5 days'} · {report.confidence} confidence
              {report.owner ? ` · ${report.owner}` : ''}{report.agent?.model ? ` · ${report.agent.model}` : ''}
              {report.analyzed_at ? ` · ${new Date(report.analyzed_at).toLocaleString()}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close report"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-5 p-4">
          <section className={`rounded-xl p-3 ${report.signal === 'scale' ? 'bg-emerald-50' : report.signal === 'fix' ? 'bg-rose-50' : 'bg-amber-50'}`}>
            <p className="font-semibold text-slate-900" dir="auto">{report.headline}</p>
            <p className="mt-1 leading-relaxed text-slate-700" dir="auto">{report.summary}</p>
            {!!report.guardrail_notes?.length && (
              <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
                {report.guardrail_notes.map((note, i) => <li key={i}>Safety rule: {note}</li>)}
              </ul>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {kpis.map(([label, value, hint]) => (
              <div key={label} className="rounded-lg border border-slate-200 px-2.5 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-0.5 font-bold text-slate-900">{value}</div>
                {hint && <div className="mt-0.5 text-[10px] text-slate-500">{hint}</div>}
              </div>
            ))}
          </section>

          {!!econ?.daily?.length && (
            <section className="overflow-x-auto">
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Last 5 days</h3>
              <table className="w-full min-w-[520px] text-right text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr><th className="py-1 text-left">Day</th><th>Spend</th><th>Link CTR</th><th>ATC</th><th>Meta purch.</th><th>Real orders</th><th>True CPP</th></tr>
                </thead>
                <tbody>
                  {econ.daily.map(day => (
                    <tr key={day.date} className="border-t border-slate-100">
                      <td className="py-1 text-left font-medium">{day.date}</td>
                      <td>{mad(day.spend_mad)}</td><td>{num(day.link_ctr, '%')}</td><td>{num(day.add_to_cart)}</td>
                      <td>{num(day.meta_purchases)}</td><td className="font-semibold">{day.real_orders}</td><td>{mad(day.true_cpp_mad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {econ.fx_note && <p className="mt-1 text-[10px] text-slate-400">{econ.fx_note}</p>}
            </section>
          )}

          {!!report.key_findings?.length && (
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Key findings</h3>
              <ul className="list-inside list-disc space-y-0.5 text-slate-700">{report.key_findings.map((f, i) => <li key={i} dir="auto">{f}</li>)}</ul>
            </section>
          )}

          {!!report.adsets?.length && (
            <section className="overflow-x-auto">
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Ad sets</h3>
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr><th className="py-1">Ad set</th><th>Days</th><th className="text-right">5d spend</th><th className="text-right">CTR</th><th className="text-right">ATC</th><th className="text-right">Purch.</th><th className="pl-2">Action</th><th>Why</th></tr>
                </thead>
                <tbody>
                  {report.adsets.map(adset => {
                    const input = adsetInputs.get(String(adset.adset_id))
                    return (
                      <tr key={adset.adset_id} className="border-t border-slate-100 align-top">
                        <td className="max-w-[180px] py-1.5 pr-2"><div className="truncate font-medium" title={adset.adset_name}>{adset.adset_name}</div><div className="text-[10px] text-slate-400">{input?.status || ''}</div></td>
                        <td>{input?.days_active ?? '—'}</td>
                        <td className="text-right">{mad(input?.spend_5d_mad)}</td>
                        <td className="text-right">{num(input?.link_ctr, '%')}</td>
                        <td className="text-right">{num(input?.add_to_cart)}</td>
                        <td className="text-right">{num(input?.meta_purchases)}</td>
                        <td className="pl-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${ADSET_ACTION_STYLE[adset.action] || 'bg-slate-100'}`}>{adset.action}</span></td>
                        <td className="min-w-[200px] text-slate-600" dir="auto">{adset.reason}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <ActionList title="Ads & creative" items={report.ads_creative} />
            <ActionList title="Landing page (Arabic)" items={report.landing_page} />
            <ActionList title="Offer & pricing" items={report.offer_and_pricing} />
            <ActionList title="Inventory" items={report.inventory} />
          </div>

          {report.scaling_plan && (
            <section className="rounded-xl border border-slate-200 p-3">
              <h3 className="text-sm font-semibold text-slate-800">{report.signal === 'scale' ? 'Scaling plan' : 'Recovery plan'} · {report.scaling_plan.method}</h3>
              {report.scaling_plan.budget_change && <p className="mt-1 font-medium text-slate-700" dir="auto">Budget: {report.scaling_plan.budget_change}</p>}
              <ol className="mt-2 list-inside list-decimal space-y-0.5 text-slate-700">{report.scaling_plan.steps.map((s, i) => <li key={i} dir="auto">{s}</li>)}</ol>
              {!!report.scaling_plan.guardrails?.length && (
                <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                  <div className="font-semibold">Guardrails</div>
                  <ul className="list-inside list-disc">{report.scaling_plan.guardrails.map((g, i) => <li key={i} dir="auto">{g}</li>)}</ul>
                </div>
              )}
            </section>
          )}

          {!!report.other_platforms?.length && (
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Other ad platforms</h3>
              <div className="grid gap-2 md:grid-cols-2">
                {report.other_platforms.map((p, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-2.5" dir="auto">
                    <p className="font-semibold">{p.platform}</p>
                    <p className="mt-0.5 text-slate-600">{p.why}</p>
                    <p className="mt-1 text-xs text-slate-500">How: {p.how}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {screenshots.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Landing page reviewed</h3>
              {report.landing_page_input?.url && <a href={report.landing_page_input.url} target="_blank" rel="noreferrer" className="break-all text-xs text-blue-600 hover:underline">{report.landing_page_input.url}</a>}
              <div className="mt-2 flex gap-3">
                {screenshots.map(shot => (
                  <a key={shot.id} href={analysisEvidenceUrl(shot.url!)} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={analysisEvidenceUrl(shot.url!)} alt={shot.title || 'Landing page screenshot'} className="h-56 rounded-lg border object-contain" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {(!!report.data_gaps?.length || report.next_check) && (
            <section className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              {report.next_check && <p dir="auto"><span className="font-semibold text-slate-800">Next check: </span>{report.next_check}</p>}
              {!!report.data_gaps?.length && <ul className="mt-1 list-inside list-disc">{report.data_gaps.map((gap, i) => <li key={i} dir="auto">{gap}</li>)}</ul>}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
