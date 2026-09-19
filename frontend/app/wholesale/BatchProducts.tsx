"use client"

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Image as ImageIcon, Layers, Loader2, RefreshCw, X } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
export type BatchImage = { id: string; file: File; preview: string; url?: string; error?: string; status: 'queued' | 'uploading' | 'ready' | 'failed' }
type BatchJob = { id: string; status: string; total: number; completed: number; failed: number; items: { name: string; image_url: string; status: string; error?: string }[] }

export function BatchImagePicker({ images, onChange, disabled, arabic }: {
  images: BatchImage[]; onChange: React.Dispatch<React.SetStateAction<BatchImage[]>>; disabled: boolean; arabic: boolean
}) {
  const busy = useRef(false)
  const [uploadRevision, setUploadRevision] = useState(0)
  const activeUpload = useRef<AbortController | null>(null)
  const previews = useRef(new Set<string>())
  const [error, setError] = useState('')
  useEffect(() => () => { activeUpload.current?.abort(); previews.current.forEach(url => URL.revokeObjectURL(url)) }, [])
  useEffect(() => {
    const current = new Set(images.map(image => image.preview))
    previews.current.forEach(url => {
      if (!current.has(url)) { URL.revokeObjectURL(url); previews.current.delete(url) }
    })
  }, [images])

  useEffect(() => {
    const image = images.find(i => i.status === 'queued')
    if (!image || busy.current) return
    busy.current = true
    onChange(current => current.map(i => i.id === image.id ? { ...i, status: 'uploading', error: undefined } : i))
    const upload = async () => {
      let url: string | undefined
      let message = ''
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const controller = new AbortController()
          activeUpload.current = controller
          const timer = setTimeout(() => controller.abort(), 60000)
          try {
            const body = new FormData()
            body.append('image', image.file)
            // The stable ID makes network retries reuse an upload instead of saving duplicates.
            body.append('upload_id', image.id)
            const response = await fetch(`${API}/api/wholesale/upload-image`, { method: 'POST', body, signal: controller.signal })
            const data = await response.json()
            if (!response.ok || !data?.data?.url) throw new Error(String(data?.error || data?.detail || `Upload failed (${response.status})`))
            url = String(data.data.url)
            break
          } catch (error) {
            message = error instanceof Error && error.name !== 'AbortError' ? error.message : (arabic ? 'انتهت مهلة رفع الصورة.' : 'Image upload timed out.')
          } finally { clearTimeout(timer); activeUpload.current = null }
        }
      } finally {
        // Release the lock before rendering the result. Always schedule another
        // effect even if React rendered the parent before this promise settled.
        busy.current = false
        onChange(current => current.map(i => i.id === image.id ? { ...i, status: url ? 'ready' : 'failed', url, error: url ? undefined : message } : i))
        setUploadRevision(value => value + 1)
      }
    }
    void upload()
  }, [images, onChange, uploadRevision])

  function select(files: FileList | null) {
    if (!files) return
    const added: BatchImage[] = []
    const rejected: string[] = []
    for (const file of Array.from(files)) {
      // Mobile file pickers can report a blank or generic MIME type for photos.
      const photo = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(file.name)
      if (!photo || file.size > 20 * 1024 * 1024) { rejected.push(file.name); continue }
      if (images.length + added.length >= 50) { rejected.push(file.name); continue }
      const preview = URL.createObjectURL(file)
      previews.current.add(preview)
      added.push({ id: crypto.randomUUID(), file, preview, status: 'queued' })
    }
    setError(rejected.length ? `${arabic ? 'لم تتم إضافة' : 'Not added'}: ${rejected.join(', ')}. ${arabic ? 'اختر حتى 50 صورة، أقل من 20 ميغابايت لكل صورة.' : 'Choose up to 50 photos, under 20 MB each.'}` : '')
    onChange(current => [...current, ...added])
  }

  return <section className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
    <h3 className="flex items-center gap-2 font-bold text-blue-900"><Layers size={18} />{arabic ? 'صور المنتجات' : 'Product photos'} <span className="text-sm">{images.length}/50</span></h3>
    <p className="my-3 text-sm text-slate-600">{arabic ? 'كل صورة تصبح منتجاً مستقلاً. المقاسات والأسعار والكميات أدناه تطبق على كل منتج.' : 'Each photo becomes a separate product. Sizes, prices, SKUs and quantities below apply to every product.'}</p>
    <label className={`flex min-h-28 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-300 bg-white p-5 font-bold text-blue-700 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-blue-50'}`}>
      <ImageIcon size={24} />{arabic ? 'اختيار عدة صور' : 'Choose multiple photos'}
      <input aria-label={arabic ? 'اختيار عدة صور' : 'Choose multiple photos'} type="file" accept="image/*" multiple disabled={disabled || images.length >= 50} className="sr-only" onChange={event => { select(event.target.files); event.target.value = '' }} />
    </label>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {images.length > 0 && <p role="status" className="mt-3 text-sm font-bold text-blue-800">{arabic ? `تم رفع ${images.filter(i => i.status === 'ready').length} من ${images.length} صور` : `${images.filter(i => i.status === 'ready').length} of ${images.length} photos uploaded`}</p>}
    {images.some(i => i.status === 'queued' || i.status === 'uploading') && <p className="mt-1 text-xs text-slate-600">{arabic ? 'أبقِ هذه الصفحة مفتوحة حتى ينتهي الرفع، ثم اضغط إنشاء المنتجات.' : 'Keep this page open until uploads finish, then click Create products.'}</p>}
    {images.some(i => i.status === 'failed') && <button type="button" disabled={disabled} onClick={() => onChange(current => current.map(i => i.status === 'failed' ? { ...i, status: 'queued', error: undefined } : i))} className="mt-3 text-sm font-bold text-red-600">{arabic ? 'إعادة رفع الصور الفاشلة' : 'Retry all failed uploads'}</button>}
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {images.map((image, index) => <div key={image.id} className="relative rounded-2xl border border-slate-200 bg-white p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.preview} alt={image.file.name} className="h-28 w-full rounded-xl object-contain" />
        <button type="button" disabled={disabled} aria-label={`${arabic ? 'حذف' : 'Remove'} ${image.file.name}`} className="absolute right-1 top-1 rounded-full bg-white p-1 text-slate-600 shadow disabled:hidden" onClick={() => { onChange(current => current.filter(i => i.id !== image.id)); URL.revokeObjectURL(image.preview); previews.current.delete(image.preview) }}><X size={16} /></button>
        <p className="mt-2 truncate text-xs text-slate-500">{index + 1}. {image.file.name}</p>
        <div className="mt-1 flex items-center gap-1 text-xs font-bold" role="status">
          {image.status === 'ready' ? <><CheckCircle size={13} className="text-emerald-600" />{arabic ? 'جاهزة' : 'Ready'}</> : image.status === 'failed' ? <button type="button" disabled={disabled} onClick={() => onChange(current => current.map(i => i.id === image.id ? { ...i, status: 'queued' } : i))} className="text-red-600">{arabic ? 'إعادة الرفع' : 'Retry upload'}</button> : image.status === 'queued' ? <span className="text-slate-500">{arabic ? 'في الانتظار' : 'Waiting'}</span> : <><Loader2 size={13} className="animate-spin text-blue-600" />{arabic ? 'جاري الرفع' : 'Uploading'}</>}
        </div>
        {image.error && <p className="mt-1 break-words text-xs text-red-600">{image.error}</p>}
      </div>)}
    </div>
  </section>
}

export function BatchProgress({ vendorId, refreshKey, arabic }: { vendorId: string; refreshKey: number; arabic: boolean }) {
  const [jobs, setJobs] = useState<BatchJob[]>([])
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      let delay = 5000
      try {
        const response = await fetch(`${API}/api/wholesale/vendors/${encodeURIComponent(vendorId)}/product-batches`)
        const result = await response.json()
        if (!response.ok || !Array.isArray(result.data)) throw new Error('Status unavailable')
        if (!result.data.some((job: BatchJob) => ['queued', 'running'].includes(job.status))) delay = 30000
        if (!stopped) { setJobs(result.data); setError('') }
      } catch { if (!stopped) setError(arabic ? 'تعذر تحديث التقدم. سنحاول مجدداً.' : 'Could not refresh progress. Reconnecting…') }
      if (!stopped) timer = setTimeout(load, delay)
    }
    void load()
    return () => { stopped = true; clearTimeout(timer) }
  }, [vendorId, refreshKey, refresh, arabic])

  async function retry(id: string) {
    setRetrying(id)
    try {
      const response = await fetch(`${API}/api/wholesale/vendors/${encodeURIComponent(vendorId)}/product-batches/${id}/retry`, { method: 'POST' })
      if (!response.ok) throw new Error('Retry failed')
      setRefresh(value => value + 1)
    } catch { setError(arabic ? 'تعذرت إعادة المحاولة.' : 'Could not retry. Please try again.') }
    finally { setRetrying(null) }
  }
  if (!jobs.length && !error) return null
  const labels: Record<string, string> = arabic
    ? { queued: 'في الانتظار', analyzing: 'جاري التحضير', creating: 'جاري الإنشاء', processing: 'جاري الإكمال', completed: 'مكتمل', failed: 'تعذر التحضير', needs_review: 'تحقق من المنتج' }
    : { queued: 'Queued', analyzing: 'Preparing', creating: 'Creating', processing: 'Finishing', completed: 'Created', failed: 'Failed', needs_review: 'Check product' }
  return <section className="space-y-3" aria-label={arabic ? 'تقدم الدفعات' : 'Batch progress'}>
    {error && <p role="status" className="text-sm text-amber-700">{error}</p>}
    {jobs.filter((job, index) => ['queued', 'running'].includes(job.status) || index < 3).map(job => {
      const active = ['queued', 'running'].includes(job.status)
      return <details key={job.id} className="rounded-2xl border border-slate-200 bg-white p-4" open={active || undefined}>
        <summary className="cursor-pointer text-sm font-bold text-slate-800">
          {active ? <Loader2 size={16} className="mr-2 inline animate-spin text-blue-600" /> : job.failed ? <AlertCircle size={16} className="mr-2 inline text-amber-600" /> : <CheckCircle size={16} className="mr-2 inline text-emerald-600" />}
          {arabic ? `${job.completed} من ${job.total} منتجات مكتملة` : `${job.completed} of ${job.total} products created`}
          {job.failed > 0 && <span className="ml-2 text-amber-700">{arabic ? `${job.failed} تحتاج مراجعة` : `${job.failed} need attention`}</span>}
        </summary>
        {active && <p className="mt-2 text-xs text-slate-500">{arabic ? 'تتم معالجة الصور واحدة تلو الأخرى. يمكنك مغادرة الصفحة.' : 'Processing photos one by one. You can leave this page.'}</p>}
        <progress aria-label={arabic ? 'تقدم الدفعة' : 'Batch progress'} value={job.completed + job.failed} max={job.total} className="mt-3 h-2 w-full accent-blue-600" />
        <ul className="mt-3 max-h-56 space-y-2 overflow-auto">
          {job.items.map((item, index) => <li key={index} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate">{index + 1}. {item.name || (arabic ? 'صورة' : 'Photo')}</span>
            <span className={`shrink-0 font-bold ${item.status === 'completed' ? 'text-emerald-600' : item.error ? 'text-amber-700' : 'text-slate-500'}`} title={item.error}>{labels[item.status] || item.status}</span>
          </li>)}
        </ul>
        {job.items.some(i => i.status === 'needs_review') && <p className="mt-3 text-xs text-amber-700">{arabic ? 'تحقق من المنتجات في الكتالوج قبل إضافتها مجدداً.' : 'Check these products in your catalog before adding them again; setup may be incomplete.'}</p>}
        {!active && job.items.some(i => i.status === 'failed') && <button type="button" disabled={retrying === job.id} onClick={() => retry(job.id)} className="mt-3 flex items-center gap-2 text-sm font-bold text-blue-600 disabled:opacity-50"><RefreshCw size={14} />{arabic ? 'إعادة محاولة الصور الفاشلة' : 'Retry failed photos'}</button>}
      </details>
    })}
  </section>
}
