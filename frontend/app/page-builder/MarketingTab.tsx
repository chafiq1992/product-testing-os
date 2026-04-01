'use client'

import { useState, useCallback } from 'react'
import {
  marketingStrategist,
  marketingCopywriter,
  marketingMediaBuyer,
} from '@/lib/api'

/* ─── Types ─── */
type Angle = {
  name: string; big_idea: string; confidence_score: number;
  target_audience: { description: string; demographics: string; interests: string[]; lookalike_suggestion: string };
  method: { primary: string; secondary: string; budget_split: string; funnel_stage: string };
  timing: { best_days: string[]; best_hours: string; seasonality_note: string; launch_tip: string };
  estimated_cpa_range: string;
}
type CopyResult = {
  angle_name?: string; headlines: string[]; sub_headlines: string[];
  ad_copy: { short: string; medium: string; long: string };
  cta_options: string[]; hooks: string[]; hashtags: string[];
}
type MediaResult = {
  image_prompts: { prompt: string; format: string; style: string; platform: string; headline_overlay: string }[];
  video_concepts: { title: string; duration: string; hook: string; body: string; cta: string; style: string; music_mood: string }[];
  format_recommendations: { format: string; why: string; platform: string }[];
  creative_notes: string;
}

/* ─── Icons ─── */
const BrainIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/><path d="M9 21v1M15 21v1M12 17v4"/></svg>
)
const PenIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
)
const CameraIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
)
const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
)
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
)

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0,1,2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i*150}ms` }}/>
      ))}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors px-1.5 py-0.5 rounded hover:bg-white/5"
      title="Copy"
    >
      {copied ? <><CheckIcon /> Copied</> : <><CopyIcon /> Copy</>}
    </button>
  )
}

/* ─── Step Indicator ─── */
function StepBar({ step }: { step: number }) {
  const steps = [
    { n: 1, label: 'Strategy', icon: <BrainIcon />, color: 'from-blue-500 to-purple-500' },
    { n: 2, label: 'Copy', icon: <PenIcon />, color: 'from-purple-500 to-pink-500' },
    { n: 3, label: 'Media', icon: <CameraIcon />, color: 'from-pink-500 to-orange-500' },
  ]
  return (
    <div className="flex items-center gap-1 px-4 py-3 border-b border-white/5">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-1 flex-1">
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            step >= s.n
              ? `bg-gradient-to-r ${s.color} text-white shadow-lg shadow-purple-500/10`
              : 'bg-white/5 text-white/30'
          }`}>
            {s.icon}
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < 2 && <div className={`flex-1 h-0.5 rounded-full mx-1 transition-all ${step > s.n ? 'bg-gradient-to-r ' + s.color : 'bg-white/5'}`}/>}
        </div>
      ))}
    </div>
  )
}

/* ─── Main Component ─── */
export default function MarketingTab({ currentPageUrl, selectedProduct }: {
  currentPageUrl: string | null;
  selectedProduct: { id?: string; title?: string; handle?: string; image?: string | null } | null;
}) {
  const [step, setStep] = useState(1)
  const [urlInput, setUrlInput] = useState(currentPageUrl || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1 results
  const [productSummary, setProductSummary] = useState('')
  const [angles, setAngles] = useState<Angle[]>([])
  const [selectedAngle, setSelectedAngle] = useState<Angle | null>(null)

  // Step 2 results
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null)
  const [copyTab, setCopyTab] = useState<'short' | 'medium' | 'long'>('medium')

  // Step 3 results
  const [mediaResult, setMediaResult] = useState<MediaResult | null>(null)

  // Update URL input when currentPageUrl changes
  const effectiveUrl = urlInput || currentPageUrl || ''

  const runStrategist = useCallback(async () => {
    if (!effectiveUrl && !selectedProduct) { setError('Enter a page URL or select a product first'); return }
    setLoading(true); setError(null); setAngles([]); setSelectedAngle(null); setCopyResult(null); setMediaResult(null); setStep(1)
    try {
      const productInfo = selectedProduct ? { title: selectedProduct.title, handle: selectedProduct.handle } : undefined
      const res = await marketingStrategist({ page_url: effectiveUrl || undefined, product_info: productInfo })
      if (res.error) { setError(res.error); return }
      setAngles(res.data?.angles || [])
      setProductSummary(res.data?.product_summary || '')
    } catch (e: any) { setError(e?.message || 'Failed to analyze') }
    finally { setLoading(false) }
  }, [effectiveUrl, selectedProduct])

  const runCopywriter = useCallback(async (angle: Angle) => {
    setSelectedAngle(angle); setStep(2); setLoading(true); setError(null); setCopyResult(null); setMediaResult(null)
    try {
      const productInfo = selectedProduct ? { title: selectedProduct.title, handle: selectedProduct.handle } : undefined
      const res = await marketingCopywriter({ angle, product_info: productInfo, page_url: effectiveUrl || undefined })
      if (res.error) { setError(res.error); return }
      setCopyResult(res.data || null)
    } catch (e: any) { setError(e?.message || 'Failed to generate copy') }
    finally { setLoading(false) }
  }, [effectiveUrl, selectedProduct])

  const runMediaBuyer = useCallback(async () => {
    if (!selectedAngle || !copyResult) return
    setStep(3); setLoading(true); setError(null); setMediaResult(null)
    try {
      const productInfo = selectedProduct ? { title: selectedProduct.title, handle: selectedProduct.handle } : undefined
      const res = await marketingMediaBuyer({ angle: selectedAngle, copy: copyResult, product_info: productInfo })
      if (res.error) { setError(res.error); return }
      setMediaResult(res.data || null)
    } catch (e: any) { setError(e?.message || 'Failed to generate media') }
    finally { setLoading(false) }
  }, [selectedAngle, copyResult, effectiveUrl, selectedProduct])

  const resetAll = () => {
    setStep(1); setAngles([]); setSelectedAngle(null); setCopyResult(null); setMediaResult(null); setError(null)
  }

  return (
    <div className="flex flex-col h-full">
      <StepBar step={step} />

      {/* URL Input */}
      <div className="px-4 py-3 border-b border-white/5">
        <label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Landing Page / Product URL</label>
        <div className="flex gap-2">
          <input
            type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)}
            placeholder={currentPageUrl || 'https://your-store.com/pages/...'}
            className="flex-1 bg-[#141422] border border-white/10 rounded-xl px-3 py-2 text-sm placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
          />
          <button onClick={runStrategist} disabled={loading}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-xs font-medium disabled:opacity-40 transition-all flex items-center gap-1.5 whitespace-nowrap"
          >
            <BrainIcon /> {loading && step === 1 ? <LoadingDots /> : 'Analyze'}
          </button>
        </div>
        {selectedProduct && (
          <div className="mt-1.5 text-[10px] text-purple-300/60">
            Product: {selectedProduct.title}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">{error}</div>
      )}

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">

        {/* Step 1: Angles */}
        {angles.length > 0 && (
          <div className="space-y-3">
            {productSummary && (
              <div className="text-xs text-white/50 bg-white/5 rounded-xl p-3 border border-white/5">{productSummary}</div>
            )}
            <div className="text-[10px] uppercase tracking-wider text-white/40">Marketing Angles — Pick One</div>
            {angles.map((a, i) => (
              <button key={i} onClick={() => runCopywriter(a)} disabled={loading}
                className={`w-full text-left rounded-2xl border p-4 transition-all hover:scale-[1.01] ${
                  selectedAngle?.name === a.name
                    ? 'border-purple-500/50 bg-purple-500/10 shadow-lg shadow-purple-500/5'
                    : 'border-white/5 bg-[#141422] hover:border-purple-500/30 hover:bg-purple-500/5'
                }`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="text-sm font-semibold text-white">{a.name}</div>
                  <div className="text-[10px] bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/20">
                    {a.confidence_score}/10
                  </div>
                </div>
                <div className="text-xs text-white/60 mb-3">{a.big_idea}</div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-white/5 rounded-lg p-2">
                    <div className="text-white/30 mb-0.5">🎯 Audience</div>
                    <div className="text-white/70">{a.target_audience.demographics}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2">
                    <div className="text-white/30 mb-0.5">📢 Method</div>
                    <div className="text-white/70">{a.method.primary}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2">
                    <div className="text-white/30 mb-0.5">🕐 Timing</div>
                    <div className="text-white/70">{a.timing.best_hours}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2">
                    <div className="text-white/30 mb-0.5">💰 Est. CPA</div>
                    <div className="text-white/70">{a.estimated_cpa_range}</div>
                  </div>
                </div>
                {a.target_audience.interests.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.target_audience.interests.map((int, j) => (
                      <span key={j} className="text-[10px] bg-purple-500/10 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/10">{int}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Copy */}
        {step >= 2 && copyResult && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-white/40">Ad Copy — {selectedAngle?.name}</div>
              <button onClick={runMediaBuyer} disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-pink-600 to-orange-600 hover:from-pink-500 hover:to-orange-500 text-white text-[11px] font-medium disabled:opacity-40 transition-all flex items-center gap-1.5"
              >
                <CameraIcon /> {loading && step === 3 ? <LoadingDots /> : 'Generate Media →'}
              </button>
            </div>

            {/* Headlines Grid */}
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">Headlines</div>
              <div className="grid grid-cols-1 gap-1.5">
                {copyResult.headlines.map((h, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#141422] border border-white/5 rounded-xl px-3 py-2 group">
                    <span className="text-sm text-white/80">{h}</span>
                    <CopyButton text={h} />
                  </div>
                ))}
              </div>
            </div>

            {/* Sub-headlines */}
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">Sub-Headlines</div>
              <div className="grid grid-cols-1 gap-1.5">
                {copyResult.sub_headlines.map((h, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#141422] border border-white/5 rounded-xl px-3 py-2 group">
                    <span className="text-xs text-white/60">{h}</span>
                    <CopyButton text={h} />
                  </div>
                ))}
              </div>
            </div>

            {/* Ad Copy Tabs */}
            <div>
              <div className="flex items-center gap-1 mb-2">
                <div className="text-[10px] text-white/30 mr-2">Ad Copy</div>
                {(['short','medium','long'] as const).map(t => (
                  <button key={t} onClick={() => setCopyTab(t)}
                    className={`text-[10px] px-2.5 py-1 rounded-lg transition-all ${copyTab === t ? 'bg-purple-600/30 text-purple-300' : 'text-white/30 hover:text-white/50 hover:bg-white/5'}`}
                  >{t}</button>
                ))}
              </div>
              <div className="bg-[#141422] border border-white/5 rounded-xl p-3 relative group">
                <pre className="text-xs text-white/70 whitespace-pre-wrap font-sans leading-relaxed">{copyResult.ad_copy[copyTab]}</pre>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyButton text={copyResult.ad_copy[copyTab]} />
                </div>
              </div>
            </div>

            {/* CTAs & Hooks */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-white/30 mb-1.5">CTAs</div>
                <div className="space-y-1">
                  {copyResult.cta_options.map((c, i) => (
                    <div key={i} className="flex items-center justify-between bg-[#141422] border border-white/5 rounded-lg px-2.5 py-1.5 text-[11px] text-white/70 group">
                      {c} <CopyButton text={c} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-white/30 mb-1.5">Video Hooks</div>
                <div className="space-y-1">
                  {copyResult.hooks.map((h, i) => (
                    <div key={i} className="flex items-center justify-between bg-[#141422] border border-white/5 rounded-lg px-2.5 py-1.5 text-[11px] text-white/70 group">
                      {h} <CopyButton text={h} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Hashtags */}
            {copyResult.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {copyResult.hashtags.map((h, i) => (
                  <span key={i} className="text-[10px] bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/10 cursor-pointer hover:bg-blue-500/20 transition-colors"
                    onClick={() => navigator.clipboard.writeText(h)}>{h}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Media */}
        {step >= 3 && mediaResult && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="text-[10px] uppercase tracking-wider text-white/40">Media & Creative Prompts</div>

            {mediaResult.creative_notes && (
              <div className="text-xs text-white/50 bg-gradient-to-r from-pink-500/5 to-orange-500/5 rounded-xl p-3 border border-pink-500/10 italic">
                💡 {mediaResult.creative_notes}
              </div>
            )}

            {/* Image Prompts */}
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">📸 Image Prompts</div>
              <div className="space-y-2">
                {mediaResult.image_prompts.map((p, i) => (
                  <div key={i} className="bg-[#141422] border border-white/5 rounded-xl p-3 group relative hover:border-pink-500/20 transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] bg-pink-500/15 text-pink-300 px-2 py-0.5 rounded-full">{p.style}</span>
                      <span className="text-[10px] bg-orange-500/15 text-orange-300 px-2 py-0.5 rounded-full">{p.format}</span>
                      <span className="text-[10px] text-white/25">{p.platform}</span>
                    </div>
                    <div className="text-xs text-white/70 leading-relaxed mb-1.5">{p.prompt}</div>
                    {p.headline_overlay && (
                      <div className="text-[10px] text-white/40">Overlay: &quot;{p.headline_overlay}&quot;</div>
                    )}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton text={p.prompt} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Video Concepts */}
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">🎬 Video Concepts</div>
              <div className="space-y-2">
                {mediaResult.video_concepts.map((v, i) => (
                  <div key={i} className="bg-[#141422] border border-white/5 rounded-xl p-3 group relative hover:border-orange-500/20 transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-white/80">{v.title}</span>
                      <span className="text-[10px] bg-white/10 text-white/50 px-2 py-0.5 rounded-full">{v.duration}</span>
                      <span className="text-[10px] text-white/25">{v.style}</span>
                    </div>
                    <div className="space-y-1.5 text-[11px]">
                      <div><span className="text-orange-300/70 font-medium">Hook:</span> <span className="text-white/60">{v.hook}</span></div>
                      <div><span className="text-purple-300/70 font-medium">Body:</span> <span className="text-white/60">{v.body}</span></div>
                      <div><span className="text-green-300/70 font-medium">CTA:</span> <span className="text-white/60">{v.cta}</span></div>
                      <div className="text-white/25">🎵 {v.music_mood}</div>
                    </div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton text={`Hook: ${v.hook}\nBody: ${v.body}\nCTA: ${v.cta}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Format Recommendations */}
            <div>
              <div className="text-[10px] text-white/30 mb-1.5">📐 Recommended Formats</div>
              <div className="grid grid-cols-1 gap-1.5">
                {mediaResult.format_recommendations.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#141422] border border-white/5 rounded-xl px-3 py-2">
                    <span className="text-xs font-medium text-white/80">{f.format}</span>
                    <span className="text-[10px] text-white/40 flex-1">{f.why}</span>
                    <span className="text-[10px] text-white/25">{f.platform}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600/20 to-pink-600/20 flex items-center justify-center mb-3 animate-pulse">
              {step === 1 ? <BrainIcon /> : step === 2 ? <PenIcon /> : <CameraIcon />}
            </div>
            <div className="text-sm text-white/50 mb-1">
              {step === 1 ? 'Analyzing & generating strategy' : step === 2 ? 'Writing ad copy' : 'Creating media prompts'}
            </div>
            <LoadingDots />
          </div>
        )}

        {/* Empty state */}
        {!loading && angles.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center opacity-40">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex items-center justify-center mb-4">
              <BrainIcon />
            </div>
            <h3 className="text-sm font-medium text-white/60 mb-1">AI Marketing Hub</h3>
            <p className="text-xs text-white/30 max-w-[260px]">
              Enter a landing page URL or select a product, then click Analyze to get marketing strategies, ad copy, and media prompts.
            </p>
          </div>
        )}
      </div>

      {/* Bottom: Reset */}
      {step > 1 && (
        <div className="px-4 py-3 border-t border-white/5 bg-[#0e0e18]/50">
          <button onClick={resetAll} className="w-full text-center text-[11px] text-white/30 hover:text-white/50 py-1.5 transition-colors">
            ← Start Over
          </button>
        </div>
      )}
    </div>
  )
}
