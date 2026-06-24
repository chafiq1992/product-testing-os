import { useCallback, useEffect, useRef, useState } from 'react'

export type AudioRecording = { blob: Blob; url: string; duration: number; mime: string }

// Minimal MediaRecorder-based voice-note recorder.
export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const resolveRef = useRef<((r: AudioRecording | null) => void) | null>(null)

  const cleanup = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  const pickMime = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    for (const m of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m
    }
    return ''
  }

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
        const out: AudioRecording = { blob, url: URL.createObjectURL(blob), duration, mime: blob.type }
        cleanup()
        setRecording(false)
        setElapsed(0)
        resolveRef.current?.(out)
        resolveRef.current = null
      }
      recorderRef.current = rec
      startedAtRef.current = Date.now()
      rec.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000))
      }, 250)
    } catch (e: any) {
      setError(e?.message || 'mic_unavailable')
      cleanup()
      setRecording(false)
    }
  }, [cleanup])

  // Stop and resolve with the recording.
  const stop = useCallback((): Promise<AudioRecording | null> => {
    return new Promise((resolve) => {
      if (!recorderRef.current || recorderRef.current.state === 'inactive') { resolve(null); return }
      resolveRef.current = resolve
      try { recorderRef.current.stop() } catch { resolve(null) }
    })
  }, [])

  const cancel = useCallback(() => {
    resolveRef.current = null
    try { recorderRef.current?.stop() } catch {}
    cleanup()
    setRecording(false)
    setElapsed(0)
  }, [cleanup])

  return { recording, elapsed, error, start, stop, cancel }
}
