"use client"
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ExternalLink, RefreshCw, Truck, X } from 'lucide-react'
import { fetchProductDeliveryIssues, type ProductDeliveryIssue, type ProductDeliveryReport } from '@/lib/api'

type Props = {
  productId: string
  productName: string
  stores: string[]
  start: string
  end: string
}

const issueLabels: Record<ProductDeliveryIssue['kind'], string> = {
  product: 'Product complaint',
  delivery: 'Delivery issue',
  queue: 'Dispatch queue',
  unattributed: 'Mixed order · item unclear',
  unmatched: 'No delivery match',
}

function MoroccoTime({ value }: { value: string }) {
  // The API supplies Morocco's offset for this instant. Preserve its wall time
  // even on devices with an older copy of the country's time-zone rules.
  return <time dateTime={value}>{value.slice(0, 10)} {value.slice(11, 19)} Morocco time</time>
}

function OrderIssue({ issue, shopDomain }: { issue: ProductDeliveryIssue, shopDomain: string }) {
  const shop = /^([a-z\d-]+)\.myshopify\.com$/i.exec(shopDomain)?.[1]
  const order = issue.order_name || `#${issue.order_id}`
  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {shop && /^\d+$/.test(issue.order_id)
          ? <a className="inline-flex items-center gap-1 font-semibold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:decoration-blue-700" href={`https://admin.shopify.com/store/${shop}/orders/${issue.order_id}`} target="_blank" rel="noreferrer">{order}<ExternalLink className="h-3 w-3" aria-hidden="true"/></a>
          : <strong>{order}</strong>}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">{issueLabels[issue.kind]}</span>
        {issue.status && <span className="text-xs text-slate-600" dir="auto">{issue.status}</span>}
      </div>
      {issue.variants.length > 0 && <p className="mt-1 text-xs text-slate-600" dir="auto">{issue.variants.join(' · ')}</p>}
      {issue.reasons.map((reason, index) => <p key={index} className="mt-1 font-medium" dir="auto">{reason}</p>)}
      {issue.notes.map((note, index) => <p key={index} className="mt-1 whitespace-pre-wrap break-words text-slate-700" dir="auto">{note}</p>)}
      {issue.occurred_at
        ? <p className="mt-1 text-xs text-slate-600">{issue.kind === 'queue' ? 'Queued since' : 'Recorded'} <MoroccoTime value={issue.occurred_at}/></p>
        : issue.kind === 'queue' && <p className="mt-1 text-xs text-slate-600">Queue time unavailable</p>}
    </li>
  )
}

function Report({ report }: { report: ProductDeliveryReport }) {
  const [filter, setFilter] = useState<ProductDeliveryIssue['kind'] | ''>('')
  const { summary, delivery_available: available, issues } = report
  const deliveryCount = (n: number | null) => available ? n : null
  const deliveredShare = available && summary.delivered != null && summary.tracked
    ? `${Math.round(summary.delivered / summary.tracked * 100)}% of ${summary.tracked} tracked`
    : ''
  const headline = [
    { label: 'Orders received', value: summary.received },
    { label: 'Fulfilled', value: summary.fulfilled, share: summary.received ? `${Math.round(summary.fulfilled / summary.received * 100)}% of ${summary.received} received` : '' },
    { label: 'Delivered', value: deliveryCount(summary.delivered), share: deliveredShare },
    { label: 'Product complaints', value: deliveryCount(summary.product_complaints) },
  ]
  const details: [string, number | null][] = [
    ['Cancelled', summary.cancelled], ['Unfulfilled', summary.unfulfilled], ['Partially fulfilled', summary.partially_fulfilled],
    ['Tracked in Sendo', deliveryCount(summary.tracked)], ['In progress', deliveryCount(summary.in_progress)], ['Adverse delivery outcomes', deliveryCount(summary.adverse)],
    ['In dispatch queue', deliveryCount(summary.queued)], ['Queue errors', deliveryCount(summary.queue_errors)], ['No parcel or queue match', deliveryCount(summary.unmatched)],
  ]
  const matchingIssues = filter ? issues.filter(issue => issue.kind === filter) : issues
  return (
    <div className="space-y-4">
      {report.warning && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{report.warning}</p>}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {headline.map(({ label, value, share }) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <dt className="text-xs font-medium text-slate-600">{label}</dt>
            <dd className={value == null ? 'mt-1 text-sm text-slate-500' : 'mt-1 text-xl font-semibold tabular-nums'}>{value == null ? 'Unavailable' : value.toLocaleString()}</dd>
            {share && <dd className="text-xs text-slate-600">{share}</dd>}
          </div>
        ))}
      </dl>
      <dl className="grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium tabular-nums">{value == null ? 'Unavailable' : value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Order issues and dispatch queue</h3>
        {issues.length > 0 && <label className="flex items-center gap-2 text-xs text-slate-600">Show
          <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-800" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
            <option value="">All issues ({issues.length})</option>
            {Object.entries(issueLabels).map(([kind, label]) => {
              const count = issues.filter(issue => issue.kind === kind).length
              return count > 0 && <option key={kind} value={kind}>{label} ({count})</option>
            })}
          </select>
        </label>}
      </div>
      {matchingIssues.length > 0
        ? <ul className="space-y-2 text-sm">{matchingIssues.map((issue, index) => <OrderIssue key={`${issue.order_id}-${issue.kind}-${index}`} issue={issue} shopDomain={report.shop_domain}/>)}</ul>
        : <p role="status" className="text-sm text-slate-600">{!summary.received ? 'No Shopify orders contained this product in the selected dates.' : !available ? 'Delivery issue details are unavailable.' : 'No issues were recorded for these orders.'}</p>}
      <p className="text-xs text-slate-500">Checked <MoroccoTime value={report.as_of}/></p>
    </div>
  )
}

export default function ProductDeliveryIssues({ productId, productName, stores, start, end }: Props) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const active = useRef<{ store: string, controller: AbortController } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [report, setReport] = useState<ProductDeliveryReport | null>(null)
  const [error, setError] = useState('')
  const isOpen = selected !== null
  useEffect(() => {
    if (isOpen) dialog.current?.showModal()
  }, [isOpen])
  useEffect(() => () => active.current?.controller.abort(), [])

  async function load(store: string) {
    if (active.current?.store === store) return
    active.current?.controller.abort()
    const controller = new AbortController()
    active.current = { store, controller }
    setSelected(store)
    setReport(null)
    setError('')
    try {
      const result = await fetchProductDeliveryIssues({ store, product_id: productId, start, end }, controller.signal)
      if (!controller.signal.aborted) setReport(result)
    } catch (err) {
      if (controller.signal.aborted) return
      const detail = axios.isAxiosError(err) ? err.response?.data?.error || err.response?.data?.detail : undefined
      setError(typeof detail === 'string' ? detail : err instanceof Error ? err.message : 'Could not load the delivery report.')
    } finally {
      if (active.current?.controller === controller) active.current = null
    }
  }

  function close() {
    active.current?.controller.abort()
    active.current = null
    dialog.current?.close()
    setSelected(null)
    setError('')
    setReport(null)
    trigger.current?.focus()
  }

  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-label={`Delivery issues for product ${productId}`}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 hover:underline"
      onClick={() => stores.length === 1 ? void load(stores[0]) : setSelected('')}>
      <Truck className="h-3.5 w-3.5" aria-hidden="true"/> Delivery issues
    </button>
    {isOpen && createPortal(
      <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close() }}
        className="m-auto max-h-[88vh] w-[min(42rem,calc(100%-2rem))] overflow-auto rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">Product delivery issues</h2>
            <p className="mt-0.5 break-words text-sm text-slate-700">{productName} · #{productId}</p>
          </div>
          <button type="button" aria-label="Close delivery report" onClick={close} className="rounded-md p-2 text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" aria-hidden="true"/></button>
        </div>
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <p>Orders placed {start} to {end} (Morocco time)</p>
            {stores.length > 1
              ? <label className="flex items-center gap-2">Store
                  <select value={selected || ''} onChange={event => void load(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800">
                    <option value="" disabled>Choose a store</option>
                    {stores.map(store => <option key={store} value={store}>{store}</option>)}
                  </select>
                </label>
              : <p>Store <strong>{selected}</strong></p>}
          </div>
          {selected && !report && !error && <p role="status" className="flex items-center gap-2 py-4 text-sm text-slate-600"><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true"/>Checking Shopify and Sendo…</p>}
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
          {report && <Report report={report}/>}
          {(error || report) && selected && <button type="button" onClick={() => void load(selected)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true"/>{error ? 'Retry' : 'Refresh report'}
          </button>}
        </div>
      </dialog>, document.body,
    )}
  </>
}
