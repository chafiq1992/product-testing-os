"use client"
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ChevronDown, ExternalLink, PackageCheck, PackageX, RefreshCw, Truck, X } from 'lucide-react'
import { fetchProductDeliveryIssues, type ProductDeliveryIssue, type ProductDeliveryReport } from '@/lib/api'

type Props = {
  productId: string
  productName: string
  stores: string[]
  start: string
  end: string
}

const issueSections: { kind: ProductDeliveryIssue['kind'], title: string }[] = [
  { kind: 'product', title: 'Product complaints' },
  { kind: 'delivery', title: 'Delivery issues' },
  { kind: 'queue', title: 'Dispatch queue' },
  { kind: 'unattributed', title: 'Mixed orders · item unclear' },
  { kind: 'unmatched', title: 'Unmatched orders' },
]

function orderCount(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? 'order' : 'orders'}`
}

function MoroccoTime({ value }: { value: string }) {
  // The API supplies Morocco's offset for this instant. Preserve its wall time
  // even on devices with an older copy of the country's time-zone rules.
  return <time dateTime={value}>{value.slice(0, 10)} {value.slice(11, 19)} Morocco time</time>
}

function OrderIssue({ records, shopDomain, reason }: { records: ProductDeliveryIssue[], shopDomain: string, reason: string }) {
  const issue = records[0]
  const shop = /^([a-z\d-]+)\.myshopify\.com$/i.exec(shopDomain)?.[1]
  const order = issue.order_name || `#${issue.order_id}`
  const variants = [...new Set(records.flatMap(record => record.variants))]
  const notes = [...new Set(records.flatMap(record => record.notes))]
  const events = new Map(records.map(record => {
    const cancellation = reason === 'Cancelled after fulfillment' && record.cancelled_after_fulfillment_at
    const time = cancellation || record.occurred_at
    const label = cancellation ? 'Cancelled' : record.kind === 'queue' ? 'Queued since' : record.kind === 'product' ? 'Product complaint recorded' : 'Recorded'
    return [JSON.stringify([label, record.status, time]), { label, status: record.status, time, queue: record.kind === 'queue' }]
  }))
  return (
    <li className="min-w-0 space-y-1.5 py-3 first:pt-1 last:pb-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {shop && /^\d+$/.test(issue.order_id)
          ? <a className="inline-flex items-center gap-1 font-semibold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:decoration-blue-700" href={`https://admin.shopify.com/store/${shop}/orders/${issue.order_id}`} target="_blank" rel="noreferrer">{order}<ExternalLink className="h-3 w-3" aria-hidden="true"/></a>
          : <strong>{order}</strong>}
        {variants.length > 0 && <span className="break-words text-xs text-slate-600" dir="auto">{variants.join(' · ')}</span>}
      </div>
      {[...events].map(([key, event]) => <div key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-slate-600">
        {event.status && <span className="font-medium" dir="auto">{event.status}</span>}
        {event.time
          ? <span>{event.label} <MoroccoTime value={event.time}/></span>
          : event.queue && <span>Queue time unavailable</span>}
      </div>)}
      {notes.map(note => <p key={note} className="whitespace-pre-wrap break-words border-s-2 border-slate-300 ps-2.5 text-sm leading-snug text-slate-700" dir="auto">{note}</p>)}
    </li>
  )
}

function RateCard({ cancelled, numerator, fulfilled, available, unverified }: {
  cancelled?: boolean, numerator?: number | null, fulfilled?: number | null, available: boolean, unverified?: number | null
}) {
  const title = cancelled ? 'Cancellation rate' : 'Delivery rate'
  const Icon = cancelled ? PackageX : PackageCheck
  const ready = available && fulfilled != null && fulfilled > 0 && numerator != null && numerator >= 0 && numerator <= fulfilled
  const uncertain = ready && cancelled && unverified != null ? unverified : 0
  const rate = ready ? numerator / fulfilled : null
  const smallShare = rate != null && rate > 0 && rate < 0.001
  const percent = ready && uncertain ? Math.floor(numerator * 1000 / fulfilled) / 1000 : rate
  const caption = ready
    ? `${numerator.toLocaleString()} of ${fulfilled.toLocaleString()} fully fulfilled ${fulfilled === 1 ? 'order' : 'orders'}`
    : fulfilled === 0 ? 'No fully fulfilled orders' : !available ? 'Delivery data unavailable' : 'Outcome data unavailable'
  return (
    <section aria-label={title} className={`min-w-0 rounded-xl border px-3 py-3 sm:px-4 ${cancelled ? 'border-rose-200 bg-rose-50 text-rose-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true"/><h3 className="text-xs font-semibold sm:text-sm">{title}</h3>
      </div>
      <p className="mt-2 text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-4xl">{percent == null
        ? <><span aria-hidden="true">—</span><span className="sr-only">Rate unavailable</span></>
        : smallShare ? (uncertain ? '>0%' : '<0.1%')
        : <>{uncertain > 0 && <><span aria-hidden="true">≥</span><span className="sr-only">At least </span></>}{percent.toLocaleString('en', { style: 'percent', maximumFractionDigits: 1 })}</>}</p>
      <p className="mt-1.5 text-xs leading-snug">{caption}</p>
      {uncertain > 0 && <p className="mt-2 text-xs leading-snug">Cancellation timing unverified for {orderCount(uncertain)}.</p>}
    </section>
  )
}

function OrderFunnel({ report }: { report: ProductDeliveryReport }) {
  const s = report.summary
  const shopify: [string, number][] = [['Orders received', s.received], ['Fully fulfilled', s.fulfilled], ['Partially fulfilled', s.partially_fulfilled], ['Unfulfilled', s.unfulfilled], ['Cancelled in Shopify', s.cancelled]]
  const sendo: [string, number | null][] = [['Tracked parcels', s.tracked], ['Delivered', s.delivered], ['In progress', s.in_progress], ['Adverse delivery outcomes', s.adverse], ['In dispatch queue', s.queued], ['Queue errors', s.queue_errors], ['No parcel or queue match', s.unmatched], ['Product complaints', s.product_complaints]]
  return <details className="group rounded-lg border border-slate-200">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2.5 text-sm font-semibold hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 -rotate-90 text-slate-500 group-open:rotate-0"/>
      Order funnel <span className="text-xs font-normal text-slate-600">{orderCount(s.received)} received</span>
    </summary>
    <div className="grid gap-4 border-t border-slate-200 px-3 py-3 sm:grid-cols-2 sm:gap-x-6">
      {[{ label: 'Shopify', counts: shopify, available: true }, { label: 'Sendo', counts: sendo, available: report.delivery_available }].map(source =>
        <div key={source.label}><h4 className="mb-1 text-xs font-semibold text-slate-900">{source.label}</h4>
          <dl className="text-xs">{source.counts.map(([label, value]) => <div key={label} className="flex justify-between gap-2 py-0.5">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium tabular-nums">{source.available && value != null ? value.toLocaleString() : 'Unavailable'}</dd>
          </div>)}</dl>
        </div>)}
    </div>
  </details>
}

function groupByReason(issues: ProductDeliveryIssue[]) {
  const sections = issueSections.map(section => ({
    ...section, orderIds: new Set<string>(), reasons: new Map<string, Map<string, ProductDeliveryIssue[]>>(),
  }))
  const allOrders = new Set<string>()
  let memberships = 0
  for (const issue of issues) {
    const reasonsByKind = issue.reason_groups ?? { [issue.kind]: issue.reasons.length ? issue.reasons : [issue.status || 'Reason unavailable'] }
    for (const section of sections) {
      const labels = new Set(reasonsByKind[section.kind]?.map(reason => reason.trim()).filter(Boolean))
      for (const label of labels) {
        let orders = section.reasons.get(label)
        if (!orders) { orders = new Map(); section.reasons.set(label, orders) }
        const records = orders.get(issue.order_id)
        if (records) records.push(issue)
        else { orders.set(issue.order_id, [issue]); memberships++ }
        section.orderIds.add(issue.order_id)
        allOrders.add(issue.order_id)
      }
    }
  }
  return {
    orderTotal: allOrders.size, overlap: memberships > allOrders.size,
    sections: sections.filter(s => s.reasons.size).map(s => ({
      ...s, reasons: [...s.reasons].sort(([a, aOrders], [b, bOrders]) => bOrders.size - aOrders.size || a.localeCompare(b)),
    })),
  }
}

function IssueReasons({ report }: { report: ProductDeliveryReport }) {
  const [selected, setSelected] = useState<string | null>(null)
  const id = useId()
  const { orderTotal, overlap, sections } = useMemo(() => groupByReason(report.issues), [report.issues])
  return <section aria-label="Issues by reason" className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-base font-semibold text-slate-900">Issues by reason</h3>
      {orderTotal > 0 && <span className="text-xs text-slate-600">{orderCount(orderTotal)}</span>}
    </div>
    {overlap && <p className="text-xs text-slate-600">An order can appear under more than one reason. Each reason counts it once.</p>}
    {sections.map(section => <section key={section.kind} aria-label={section.title} className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-baseline justify-between gap-2 bg-slate-50 px-3 py-2">
        <h4 className="text-sm font-semibold text-slate-800">{section.title}</h4>
        <span className="shrink-0 text-xs text-slate-600">{orderCount(section.orderIds.size)}</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {section.reasons.map(([label, orders], index) => {
          const panelId = `${id}-${section.kind}-${index}`
          const open = selected === panelId
          return <li key={label}>
            <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setSelected(open ? null : panelId)}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm hover:bg-slate-50 ${open ? 'font-semibold text-blue-800' : 'font-medium text-slate-800'}`}>
              <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-slate-500 ${open ? '' : '-rotate-90'}`}/>
              <span className="min-w-0 flex-1 break-words" dir="auto">{label}</span>
              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-700">{orderCount(orders.size)}</span>
            </button>
            <div id={panelId} hidden={!open}>
              {open && <ul className="divide-y divide-slate-200 bg-slate-50/70 px-4 py-2.5 sm:ps-8">
                {[...orders].map(([orderId, records]) => <OrderIssue key={orderId} records={records} shopDomain={report.shop_domain} reason={label}/>)}
              </ul>}
            </div>
          </li>
        })}
      </ul>
    </section>)}
    {!orderTotal && <p role="status" className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">{!report.summary.received ? 'No Shopify orders contained this product in the selected dates.' : !report.delivery_available ? 'Delivery issue details are unavailable.' : 'No issues were recorded for these orders.'}</p>}
  </section>
}

function Report({ report }: { report: ProductDeliveryReport }) {
  const { summary, delivery_available: available } = report
  return <div className="space-y-4">
    {report.warning && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{report.warning}</p>}
    <div>
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:gap-3">
        <RateCard numerator={summary.fulfilled_delivered} fulfilled={summary.fulfilled} available={available}/>
        <RateCard cancelled numerator={summary.fulfilled_cancelled} fulfilled={summary.fulfilled} available={available} unverified={summary.fulfilled_cancellation_unverified}/>
      </div>
      {report.cancellation_definition && <p className="mt-2 text-xs leading-relaxed text-slate-600">{report.cancellation_definition}</p>}
      {!!summary.fulfillment_history_unverified && <p className="mt-1 text-xs leading-relaxed text-slate-600">Both rates exclude {orderCount(summary.fulfillment_history_unverified)} with unverified fulfillment history.</p>}
    </div>
    <OrderFunnel report={report}/>
    <IssueReasons report={report}/>
  </div>
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
        className="m-auto max-h-[90dvh] w-[min(44rem,calc(100%-1.5rem))] overflow-auto rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <span className="hidden shrink-0 rounded-lg bg-blue-50 p-2 text-blue-700 sm:block"><Truck className="h-5 w-5" aria-hidden="true"/></span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold leading-tight">Product delivery issues</h2>
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
          {(error || report) && selected && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
            {report && <p className="text-xs text-slate-500">Checked <MoroccoTime value={report.as_of}/></p>}
            <button type="button" onClick={() => void load(selected)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true"/>{error ? 'Retry' : 'Refresh report'}
            </button>
          </div>}
        </div>
      </dialog>, document.body,
    )}
  </>
}
