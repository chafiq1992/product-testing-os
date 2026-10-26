'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, Flashlight, Keyboard, Loader2, RefreshCw, ScanLine, X } from 'lucide-react'
import { normalizeBarcode, ScanStabilityGate, validateBarcode } from './scanner'

type Props = { onScan: (barcode: string) => void; lang: 'en' | 'ar'; disabled?: boolean }
type NativeDetection = { rawValue: string; format: string }
type Detector = { detect: (source: HTMLVideoElement) => Promise<NativeDetection[]> }
type DetectorConstructor = {
  new (options: { formats: string[] }): Detector
  getSupportedFormats: () => Promise<string[]>
}

const formats = ['ean_13', 'ean_8', 'upc_a', 'code_128']

export default function BarcodeScanner({ onScan, lang, disabled = false }: Props) {
  const ar = lang === 'ar'
  const [requested, setRequested] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [last, setLast] = useState('')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torch, setTorch] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const callbackRef = useRef(onScan)
  const disabledRef = useRef(disabled)
  const gateRef = useRef(new ScanStabilityGate())
  const audioRef = useRef<AudioContext | null>(null)
  callbackRef.current = onScan
  disabledRef.current = disabled

  const copyRef = useRef(ar)
  copyRef.current = ar

  useEffect(() => {
    if (!disabled && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [disabled])

  function feedback(code: string) {
    if (disabledRef.current) return
    setLast(code)
    setError('')
    try { navigator.vibrate?.(35) } catch { /* Optional feedback. */ }
    const audio = audioRef.current
    if (audio?.state === 'running') {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.frequency.value = 1050
      gain.gain.setValueAtTime(0.035, audio.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.07)
      oscillator.start()
      oscillator.stop(audio.currentTime + 0.07)
    }
    callbackRef.current(code)
  }

  // Feedback reads current props without forcing a camera restart on each cart change.
  const feedbackRef = useRef(feedback)
  feedbackRef.current = feedback

  function unlockAudio() {
    try {
      if (!audioRef.current) audioRef.current = new AudioContext()
      void audioRef.current.resume().catch(() => {})
    } catch { /* Sound is optional. */ }
  }

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    const onVisibility = () => { if (document.hidden) setRequested(false) }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void audioRef.current?.close().catch(() => {})
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!requested || disabled) return
    let cancelled = false
    let stream: MediaStream | null = null
    let controls: { stop: () => void } | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const video = videoRef.current
    const gate = gateRef.current
    gate.reset()
    setStarting(true)
    setCameraReady(false)
    setError('')

    const read = (raw: string | null, format?: string) => {
      if (cancelled || disabledRef.current) return
      const result = gate.observe(raw, format, performance.now())
      if (result) feedbackRef.current(result)
    }

    async function fallback() {
      const { BrowserMultiFormatOneDReader, BarcodeFormat } = await import('@zxing/browser')
      if (cancelled || !stream || !video) return
      const reader = new BrowserMultiFormatOneDReader(undefined, {
        delayBetweenScanAttempts: 100,
        delayBetweenScanSuccess: 110,
        tryPlayVideoTimeout: 8000,
      })
      const started = await reader.decodeFromStream(stream, video, (result, _error, callbackControls) => {
        if (cancelled) { callbackControls.stop(); return }
        if (result) read(result.getText(), BarcodeFormat[result.getBarcodeFormat()].toLowerCase())
        else read(null)
      })
      if (cancelled) { started.stop(); return }
      controls = started
    }

    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('camera_unavailable')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled || !video) { stream.getTracks().forEach(track => track.stop()); return }
        const track = stream.getVideoTracks()[0]
        trackRef.current = track || null
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
        setTorchAvailable(Boolean(capabilities?.torch))
        video.srcObject = stream
        await video.play()
        if (cancelled) return

        let detector: Detector | null = null
        try {
          const Constructor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
          if (Constructor) {
            const supported = await Constructor.getSupportedFormats()
            // A partial native decoder would silently miss common grocery labels.
            if (formats.every(format => supported.includes(format))) detector = new Constructor({ formats })
          }
        } catch { /* Probe/construction failure uses the bundled decoder. */ }
        if (cancelled) return
        if (detector) {
          const native = detector
          let failures = 0
          const tick = async () => {
            if (cancelled) return
            try {
              if (video.readyState >= 2) {
                const results = await native.detect(video)
                if (cancelled) return
                failures = 0
                // Require one visible label; never choose an arbitrary product from a shelf.
                const unique = [...new Map(results.map(result => [normalizeBarcode(result.rawValue), result])).values()]
                if (unique.length === 1) read(unique[0].rawValue, unique[0].format)
                else read(null)
              }
            } catch {
              if (cancelled) return
              if (++failures >= 3) {
                try { await fallback() } catch (cause) { fail(cause) }
                return
              }
            }
            if (!cancelled) timer = setTimeout(tick, 100)
          }
          void tick()
        } else await fallback()
        if (!cancelled) { setStarting(false); setCameraReady(true) }
      } catch (cause) { fail(cause) }
    }

    function fail(cause: unknown) {
      if (cancelled) return
      const name = (cause as { name?: string })?.name
      const arabic = copyRef.current
      setError(name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? (arabic ? 'السماح باستعمال الكاميرا مطلوب. يمكنك إدخال الباركود أدناه.' : 'Allow camera access in your browser. You can also enter the barcode below.')
        : name === 'NotFoundError'
          ? (arabic ? 'لم يتم العثور على كاميرا. استعمل قارئ الباركود أو الإدخال اليدوي.' : 'No camera found. Use a handheld scanner or enter the barcode.')
          : (arabic ? 'تعذر تشغيل الكاميرا. تحقق من صلاحية الوصول ثم حاول مجدداً، أو أدخل الباركود.' : 'Camera could not start. Check access and retry, or enter the barcode.'))
      setStarting(false)
      setRequested(false)
      stream?.getTracks().forEach(track => track.stop())
    }

    void start()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      controls?.stop()
      stream?.getTracks().forEach(track => track.stop())
      if (video?.srcObject === stream) video.srcObject = null
      trackRef.current = null
      setCameraReady(false)
      setTorchAvailable(false)
      setTorch(false)
    }
  }, [requested, disabled])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (disabled) return
    if (!validateBarcode(input)) {
      setError(ar ? 'تحقق من أرقام الباركود ثم حاول مجدداً.' : 'Check the barcode digits and try again.')
      return
    }
    unlockAudio()
    feedback(normalizeBarcode(input))
    setInput('')
    inputRef.current?.focus()
  }

  async function toggleTorch() {
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
      setTorch(value => !value)
    } catch { setTorchAvailable(false) }
  }

  return (
    <section aria-label={ar ? 'قارئ الباركود' : 'Barcode scanner'} className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold text-slate-900"><ScanLine size={21} className="text-emerald-600" />{ar ? 'امسح الباركود' : 'Scan a barcode'}</div>
        {!requested ? (
          <button type="button" disabled={disabled} onClick={() => { unlockAudio(); setRequested(true) }} className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Camera size={18} />{ar ? 'تشغيل الكاميرا' : 'Open camera'}</button>
        ) : (
          <button type="button" onClick={() => setRequested(false)} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"><X size={18} />{ar ? 'إغلاق' : 'Close camera'}</button>
        )}
      </div>
      {requested && (
        <div className="relative mb-4 aspect-[4/3] max-h-80 overflow-hidden rounded-2xl bg-slate-950">
          <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" aria-label={ar ? 'معاينة الكاميرا' : 'Camera preview'} />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-28 w-[82%] rounded-xl border-2 border-emerald-400 shadow-[0_0_0_999px_rgba(0,0,0,0.22)]" /></div>
          {(starting || disabled) && <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-950/65 px-5 text-center text-sm font-bold text-white">{starting && <Loader2 size={20} className="animate-spin" />}{disabled ? (ar ? 'المسح متوقف مؤقتاً' : 'Scanning paused') : (ar ? 'جاري تشغيل الكاميرا…' : 'Starting camera…')}</div>}
          {cameraReady && !disabled && <div className="absolute inset-x-3 bottom-3 rounded-xl bg-slate-950/70 px-3 py-2 text-center text-xs font-medium text-white">{ar ? 'قرّب باركوداً واحداً داخل الإطار وثبّت الهاتف' : 'Hold one barcode steady inside the frame'}</div>}
          {torchAvailable && !disabled && <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch} aria-label={ar ? 'إضاءة الكاميرا' : 'Camera light'} className={`absolute right-3 top-3 rounded-xl p-3 ${torch ? 'bg-amber-300 text-slate-950' : 'bg-slate-950/70 text-white'}`}><Flashlight size={19} /></button>}
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Keyboard size={18} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
          <input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} disabled={disabled} dir="ltr" aria-label={ar ? 'الباركود أو رمز المنتج' : 'Barcode or product code'} placeholder={ar ? 'قارئ الباركود أو إدخال يدوي' : 'Handheld scanner or type barcode'} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={64} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:opacity-50" />
        </div>
        <button type="submit" disabled={disabled || !input.trim()} className="min-h-12 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-40">{ar ? 'إدخال' : 'Enter'}</button>
      </form>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{ar ? 'قارئ USB أو Bluetooth: امسح الرمز مع تفعيل خانة الإدخال. الباركود يحدد المنتج؛ راجع اسمه والسعر.' : 'USB / Bluetooth scanner: focus the field and scan with Enter. Check the product name and price.'}</p>
      {last && <div role="status" aria-live="polite" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"><span className="flex items-center gap-2"><CheckCircle2 size={16} /><span dir="ltr">{last}</span></span>{requested && <button type="button" disabled={disabled} onClick={() => { gateRef.current.reset(); setLast('') }} className="flex min-h-9 items-center gap-1 rounded-lg border border-emerald-200 px-2 disabled:opacity-50"><RefreshCw size={13} />{ar ? 'مسح نفس المنتج مجدداً' : 'Scan same item again'}</button>}</div>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-3 text-sm font-medium text-rose-700">{error}</p>}
    </section>
  )
}
