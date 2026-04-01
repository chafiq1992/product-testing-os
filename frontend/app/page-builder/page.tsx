'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  pageBuilderSearchProducts,
  pageBuilderGenerate,
  pageBuilderToggleLayout,
  pageBuilderWidgetInstall,
  pageBuilderWidgetUninstall,
  pageBuilderListPages,
  pageBuilderTranslate,
} from '@/lib/api'
import MarketingTab from './MarketingTab'

/* ───────── Types ───────── */
type Product = { id:string; title:string; handle:string; image?:string|null; price?:string|null; status?:string }
type ChatMsg = { role:'user'|'assistant'|'system'; content:string; pageUrl?:string; slug?:string }
type AiPage = { id:string; title:string; handle:string; template_suffix:string; slug:string; url:string; created_at?:string; updated_at?:string }

/* ───────── Icons (inline SVGs) ───────── */
const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
)
const SparklesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/></svg>
)
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
)
const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
)
const LayoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
)
const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
)

/* ───────── Animated dots ───────── */
function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0,1,2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i*150}ms` }}/>
      ))}
    </span>
  )
}

/* ───────── Main Page ───────── */
export default function PageBuilderPage() {
  // Product picker state
  const [productQuery, setProductQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product|null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)

  // Chat state
  const [prompt, setPrompt] = useState('')
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [generating, setGenerating] = useState(false)
  const [messages, setMessages] = useState<any[]>([])
  const [currentSlug, setCurrentSlug] = useState<string|null>(null)
  const [currentPageUrl, setCurrentPageUrl] = useState<string|null>(null)

  // Layout toggles
  const [showHeader, setShowHeader] = useState(true)
  const [showFooter, setShowFooter] = useState(true)

  // Widget install
  const [widgetInstalled, setWidgetInstalled] = useState(false)
  const [widgetLoading, setWidgetLoading] = useState(false)

  // Translation
  const [translating, setTranslating] = useState(false)

  // Preview
  const [iframeKey, setIframeKey] = useState(0)
  const [previewDevice, setPreviewDevice] = useState<'desktop'|'tablet'|'mobile'>('desktop')
  const [iframeError, setIframeError] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState<'builder'|'marketing'>('builder')

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const searchTimeoutRef = useRef<any>(null)

  // Existing AI pages
  const [aiPages, setAiPages] = useState<AiPage[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, generating])

  // Load existing AI pages on mount
  const loadAiPages = useCallback(async () => {
    setPagesLoading(true)
    try {
      const res = await pageBuilderListPages()
      setAiPages(res.data || [])
    } catch { setAiPages([]) }
    setPagesLoading(false)
  }, [])

  useEffect(() => { loadAiPages() }, [loadAiPages])

  // Product search with debounce
  const searchProducts = useCallback(async (q: string) => {
    if (!q.trim()) { setProducts([]); return }
    setSearchLoading(true)
    try {
      const res = await pageBuilderSearchProducts(q)
      setProducts(res.data || [])
    } catch { setProducts([]) }
    setSearchLoading(false)
  }, [])

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (productQuery.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => searchProducts(productQuery), 400)
    } else {
      setProducts([])
    }
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current) }
  }, [productQuery, searchProducts])

  // Send prompt to AI agent
  // Send a quick-action prompt directly
  const sendQuickAction = (text: string) => {
    if (generating) return
    setChat(prev => [...prev, { role: 'user', content: text }])
    setPrompt('')
    setGenerating(true)
    pageBuilderGenerate({
      prompt: text,
      product_handle: selectedProduct?.handle || undefined,
      product_id: selectedProduct?.id || undefined,
      product_title: selectedProduct?.title || undefined,
      hide_header: !showHeader,
      hide_footer: !showFooter,
      messages: messages.length ? messages : undefined,
      slug: currentSlug || undefined,
    }).then(res => {
      if (res.error) {
        setChat(prev => [...prev, { role: 'assistant', content: `❌ Error: ${res.error}` }])
      } else {
        const msg: ChatMsg = { role: 'assistant', content: res.text || 'Done!', pageUrl: res.page_url || undefined, slug: res.slug || undefined }
        setChat(prev => [...prev, msg])
        if (res.messages) setMessages(res.messages)
        if (res.slug) setCurrentSlug(res.slug)
        if (res.page_url) { setCurrentPageUrl(res.page_url); setIframeKey(k => k + 1); setIframeError(false); loadAiPages() }
      }
    }).catch((e: any) => {
      setChat(prev => [...prev, { role: 'assistant', content: `❌ ${e?.message || 'Unknown error'}` }])
    }).finally(() => {
      setGenerating(false)
      inputRef.current?.focus()
    })
  }

  const handleSend = async () => {
    const text = prompt.trim()
    if (!text || generating) return

    setChat(prev => [...prev, { role: 'user', content: text }])
    setPrompt('')
    setGenerating(true)

    try {
      const res = await pageBuilderGenerate({
        prompt: text,
        product_handle: selectedProduct?.handle || undefined,
        product_id: selectedProduct?.id || undefined,
        product_title: selectedProduct?.title || undefined,
        hide_header: !showHeader,
        hide_footer: !showFooter,
        messages: messages.length ? messages : undefined,
        slug: currentSlug || undefined,
      })

      if (res.error) {
        setChat(prev => [...prev, { role: 'assistant', content: `❌ Error: ${res.error}` }])
      } else {
        const msg: ChatMsg = {
          role: 'assistant',
          content: res.text || 'Page generated successfully!',
          pageUrl: res.page_url || undefined,
          slug: res.slug || undefined,
        }
        setChat(prev => [...prev, msg])

        if (res.messages) setMessages(res.messages)
        if (res.slug) setCurrentSlug(res.slug)
        if (res.page_url) {
          setCurrentPageUrl(res.page_url)
          setIframeKey(k => k + 1)
          setIframeError(false)
          loadAiPages() // Refresh pages dropdown
        }
      }
    } catch (e: any) {
      setChat(prev => [...prev, { role: 'assistant', content: `❌ ${e?.message || 'Unknown error'}` }])
    }
    setGenerating(false)
    inputRef.current?.focus()
  }

  // Toggle layout
  const handleLayoutToggle = async (header: boolean, footer: boolean) => {
    if (!currentSlug) return
    setShowHeader(header)
    setShowFooter(footer)
    try {
      await pageBuilderToggleLayout({ slug: currentSlug, show_header: header, show_footer: footer })
      setIframeKey(k => k + 1)
      setChat(prev => [...prev, {
        role: 'system',
        content: `Layout updated: header ${header ? 'shown' : 'hidden'}, footer ${footer ? 'shown' : 'hidden'}.`
      }])
    } catch {}
  }

  // Install/uninstall widget into theme
  const handleWidgetToggle = async () => {
    setWidgetLoading(true)
    try {
      if (widgetInstalled) {
        await pageBuilderWidgetUninstall()
        setWidgetInstalled(false)
        setChat(prev => [...prev, { role: 'system', content: '✓ Widget removed from theme.' }])
      } else {
        const res = await pageBuilderWidgetInstall()
        if (res.error) {
          setChat(prev => [...prev, { role: 'system', content: `❌ Install failed: ${res.error}` }])
        } else {
          setWidgetInstalled(true)
          setChat(prev => [...prev, { role: 'system', content: '✓ AI widget installed! Open the Shopify Theme Editor — you\'ll see a ✨ button in the preview pane.' }])
        }
      }
    } catch (e: any) {
      setChat(prev => [...prev, { role: 'system', content: `❌ ${e?.message || 'Error'}` }])
    }
    setWidgetLoading(false)
  }

  // Enter to send (shift+enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0e0e18]/80 backdrop-blur-xl px-6 py-4 flex items-center gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-2 text-purple-400">
          <SparklesIcon />
          <h1 className="text-lg font-semibold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            AI Page Builder
          </h1>
        </div>
        <span className="text-xs text-white/30">Shopify Theme Editor Integration</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={handleWidgetToggle}
            disabled={widgetLoading}
            className={`flex items-center gap-1.5 text-xs border rounded-lg px-3 py-1.5 transition-colors ${
              widgetInstalled
                ? 'text-green-300 border-green-500/30 hover:bg-green-500/10'
                : 'text-purple-300 border-purple-500/30 hover:bg-purple-500/10'
            } disabled:opacity-50`}
          >
            <SparklesIcon />
            {widgetLoading ? 'Working...' : widgetInstalled ? 'Widget Installed ✓' : 'Install in Theme Editor'}
          </button>
          {currentPageUrl && (
            <a href={currentPageUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 border border-purple-500/30 rounded-lg px-3 py-1.5 hover:bg-purple-500/10 transition-colors">
              <ExternalLinkIcon /> View Page
            </a>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* Left: Chat Panel */}
        <div className="lg:w-[480px] w-full flex flex-col border-r border-white/5 bg-[#0c0c14]">

          {/* Tab Switcher */}
          <div className="flex border-b border-white/5">
            <button onClick={() => setActiveTab('builder')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium transition-all ${
                activeTab === 'builder'
                  ? 'text-purple-300 border-b-2 border-purple-500 bg-purple-500/5'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              Page Builder
            </button>
            <button onClick={() => setActiveTab('marketing')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium transition-all ${
                activeTab === 'marketing'
                  ? 'text-pink-300 border-b-2 border-pink-500 bg-pink-500/5'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Marketing
            </button>
          </div>

          {activeTab === 'marketing' ? (
            <MarketingTab currentPageUrl={currentPageUrl} selectedProduct={selectedProduct} />
          ) : (
          <>
          {/* Product Picker */}
          <div className="p-4 border-b border-white/5">
            <label className="text-xs font-medium text-white/50 mb-2 block">SELECT PRODUCT</label>
            <div className="relative">
              {selectedProduct ? (
                <div className="flex items-center gap-3 bg-[#141422] border border-purple-500/30 rounded-xl p-3">
                  {selectedProduct.image && (
                    <img src={selectedProduct.image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{selectedProduct.title}</div>
                    <div className="text-xs text-white/40">{selectedProduct.handle}</div>
                  </div>
                  <button onClick={() => { setSelectedProduct(null); setProductQuery('') }}
                    className="text-white/30 hover:text-white/60 text-lg px-2">×</button>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"><SearchIcon /></div>
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={productQuery}
                    onChange={e => { setProductQuery(e.target.value); setShowDropdown(true) }}
                    onFocus={() => setShowDropdown(true)}
                    className="w-full bg-[#141422] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                  {showDropdown && products.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl max-h-60 overflow-auto z-50">
                      {products.map(p => (
                        <button key={p.id}
                          onClick={() => { setSelectedProduct(p); setShowDropdown(false); setProductQuery('') }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left">
                          {p.image ? (
                            <img src={p.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/20 text-xs">?</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{p.title}</div>
                            <div className="text-xs text-white/40">{p.handle}</div>
                          </div>
                          {p.price && <span className="text-xs text-white/40">${p.price}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {showDropdown && searchLoading && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-[#1a1a2e] border border-white/10 rounded-xl p-4 text-center text-white/40 text-sm z-50">
                      Searching...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Existing Pages Dropdown */}
          <div className="px-4 py-3 border-b border-white/5">
            <label className="text-xs font-medium text-white/50 mb-2 block">EXISTING AI PAGES</label>
            <select
              value={currentSlug || ''}
              onChange={e => {
                const slug = e.target.value
                if (!slug) {
                  setCurrentSlug(null)
                  setCurrentPageUrl(null)
                  setChat([])
                  setMessages([])
                  setIframeKey(k => k + 1)
                  return
                }
                const page = aiPages.find(p => p.slug === slug)
                if (page) {
                  setCurrentSlug(page.slug)
                  setCurrentPageUrl(page.url)
                  setIframeKey(k => k + 1)
                  setIframeError(false)
                  setChat(prev => [...prev, { role: 'system', content: `📄 Loaded page: ${page.title}` }])
                }
              }}
              className="w-full bg-[#141422] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white/80 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all appearance-none cursor-pointer"
            >
              <option value="">— New Page —</option>
              {pagesLoading && <option disabled>Loading...</option>}
              {aiPages.map(p => (
                <option key={p.id} value={p.slug}>
                  {p.title} {p.updated_at ? `(${new Date(p.updated_at).toLocaleDateString()})` : ''}
                </option>
              ))}
            </select>
            {aiPages.length > 0 && (
              <div className="text-[10px] text-white/25 mt-1">{aiPages.length} page{aiPages.length !== 1 ? 's' : ''} • most recent first</div>
            )}
          </div>

          {/* Layout Controls + Translate */}
          {currentSlug && (
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5 text-white/40 text-xs"><LayoutIcon /> Layout</div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={showHeader}
                  onChange={e => handleLayoutToggle(e.target.checked, showFooter)}
                  className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/30 accent-purple-500" />
                <span className="text-white/60">Header</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={showFooter}
                  onChange={e => handleLayoutToggle(showHeader, e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/30 accent-purple-500" />
                <span className="text-white/60">Footer</span>
              </label>
              <div className="ml-auto">
                <button
                  onClick={async () => {
                    if (!currentSlug || translating) return
                    setTranslating(true)
                    setChat(prev => [...prev, { role: 'system', content: '🌐 Translating page to Arabic and French...' }])
                    try {
                      const res = await pageBuilderTranslate({ slug: currentSlug })
                      if (res.error) {
                        setChat(prev => [...prev, { role: 'system', content: `❌ Translation failed: ${res.error}` }])
                      } else {
                        setChat(prev => [...prev, { role: 'system', content: `✅ Translated ${res.translated_sections} sections to Arabic and French!` }])
                        setIframeKey(k => k + 1)
                      }
                    } catch (e: any) {
                      setChat(prev => [...prev, { role: 'system', content: `❌ ${e?.message || 'Translation error'}` }])
                    }
                    setTranslating(false)
                  }}
                  disabled={translating}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30 rounded-lg px-3 py-1.5 hover:bg-emerald-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {translating ? '⏳ Translating...' : '🌐 Translate AR/FR'}
                </button>
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {chat.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
                <div className="text-purple-400 mb-3"><SparklesIcon /></div>
                <h3 className="text-sm font-medium text-white/60 mb-1">AI Page Builder</h3>
                <p className="text-xs text-white/30 max-w-[280px]">
                  Select a product, then describe the page you want.
                  The AI will create a native Shopify page using your theme&apos;s sections.
                </p>
                <div className="mt-4 space-y-1.5 w-full max-w-[280px]">
                  {[
                    'Create a landing page with hero, benefits, testimonials, FAQ, and CTA',
                    'Build a product page with features, countdown timer, and guarantee section',
                    'Design a high-converting page with comparison, benefits, and urgency',
                  ].map((ex, i) => (
                    <button key={i} onClick={() => setPrompt(ex)}
                      className="w-full text-left text-xs text-white/40 hover:text-white/60 bg-white/5 hover:bg-white/8 rounded-lg px-3 py-2 transition-colors">
                      &ldquo;{ex}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chat.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-purple-600/20 border border-purple-500/30 text-white'
                    : msg.role === 'system'
                      ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-200'
                      : 'bg-[#141422] border border-white/5 text-white/80'
                }`}>
                  {msg.content}
                  {msg.pageUrl && (
                    <div className="mt-2 pt-2 border-t border-white/10 flex gap-2">
                      <a href={msg.pageUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200 transition-colors">
                        <ExternalLinkIcon /> View Page
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {generating && (
              <div className="flex justify-start">
                <div className="bg-[#141422] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white/60 flex items-center gap-2">
                  <SparklesIcon /> Generating page <LoadingDots />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Quick-Action Section Buttons */}
          {currentSlug && (
            <div className="px-4 py-3 border-t border-white/5 bg-[#0e0e18]/30">
              <div className="text-[10px] uppercase tracking-wider text-white/25 mb-2">Quick Add Section</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: '✨ Features', prompt: 'Add a features section with icons' },
                  { label: '✅ Benefits', prompt: 'Add a benefits section' },
                  { label: '⭐ Testimonials', prompt: 'Add a testimonials section' },
                  { label: '❓ FAQ', prompt: 'Add an FAQ section' },
                  { label: '🔥 Countdown', prompt: 'Add a countdown/urgency section' },
                  { label: '🛡️ Guarantee', prompt: 'Add a guarantee section' },
                  { label: '⚡ CTA', prompt: 'Add a call-to-action section' },
                  { label: '📊 Comparison', prompt: 'Add a comparison section' },
                  { label: '🏪 Why Us', prompt: 'Add a why choose us section' },
                  { label: '🎉 Promo', prompt: 'Add a promotional banner section' },
                  { label: '📝 Description', prompt: 'Add a description section' },
                  { label: '🎬 Video', prompt: 'Add a video section' },
                ].map((action, i) => (
                  <button key={i}
                    onClick={() => sendQuickAction(action.prompt)}
                    disabled={generating}
                    className="text-[11px] text-white/50 hover:text-white/80 bg-white/5 hover:bg-purple-500/15 border border-white/5 hover:border-purple-500/30 rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-30"
                  >{action.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="p-4 border-t border-white/5 bg-[#0e0e18]/50">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={currentSlug ? 'Describe changes...' : 'Describe your page...'}
                rows={1}
                className="flex-1 bg-[#141422] border border-white/10 rounded-xl px-4 py-3 text-sm resize-none placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all max-h-32"
                style={{ minHeight: '44px' }}
              />
              <button
                onClick={handleSend}
                disabled={generating || !prompt.trim()}
                className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:hover:bg-purple-600 transition-all text-white"
              >
                <SendIcon />
              </button>
            </div>
            <div className="mt-2 text-[10px] text-white/20 text-center">
              Press Enter to send · Shift+Enter for new line
            </div>
          </div>
          </>
          )}
        </div>

        {/* Right: Preview Panel */}
        <div className="flex-1 flex flex-col bg-[#080810] min-h-[400px]">
          {currentPageUrl ? (
            <>
              <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3 bg-[#0e0e18]/50">
                {/* Device viewport toggle */}
                <div className="flex items-center bg-white/5 rounded-lg p-0.5">
                  {([
                    { mode: 'desktop' as const, label: 'Desktop', icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                    )},
                    { mode: 'tablet' as const, label: 'Tablet', icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
                    )},
                    { mode: 'mobile' as const, label: 'Mobile', icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
                    )},
                  ]).map(d => (
                    <button key={d.mode}
                      onClick={() => setPreviewDevice(d.mode)}
                      title={d.label}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all ${
                        previewDevice === d.mode
                          ? 'bg-purple-600/30 text-purple-300 shadow-sm'
                          : 'text-white/40 hover:text-white/60 hover:bg-white/5'
                      }`}
                    >
                      {d.icon}
                      <span className="hidden sm:inline">{d.label}</span>
                    </button>
                  ))}
                </div>

                <span className="text-xs text-white/30 flex-1 truncate ml-2">{currentPageUrl}</span>
                <button onClick={() => setIframeKey(k => k + 1)}
                  className="text-white/40 hover:text-white/60 transition-colors p-1.5 hover:bg-white/5 rounded-lg" title="Refresh">
                  <RefreshIcon />
                </button>
                <a href={currentPageUrl} target="_blank" rel="noopener noreferrer"
                  className="text-white/40 hover:text-white/60 transition-colors p-1.5 hover:bg-white/5 rounded-lg" title="Open in new tab">
                  <ExternalLinkIcon />
                </a>
              </div>
              <div className="flex-1 relative overflow-auto flex justify-center bg-[#060610]"
                   style={{ background: previewDevice !== 'desktop' ? 'radial-gradient(circle at 50% 20%, #0e0e1f, #060610)' : undefined }}>
                <div
                  className="transition-all duration-300 ease-in-out h-full"
                  style={{
                    width: previewDevice === 'desktop' ? '100%'
                         : previewDevice === 'tablet' ? '768px'
                         : '375px',
                    maxWidth: '100%',
                    ...(previewDevice !== 'desktop' ? {
                      margin: '16px auto',
                      border: '2px solid rgba(255,255,255,0.08)',
                      borderRadius: '16px',
                      overflow: 'hidden',
                      boxShadow: '0 0 40px rgba(0,0,0,0.5)',
                      height: 'calc(100% - 32px)',
                    } : {}),
                  }}
                >
                  {iframeError ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                        <ExternalLinkIcon />
                      </div>
                      <p className="text-sm text-white/50">Preview blocked by store settings</p>
                      <a href={currentPageUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200 bg-purple-600/20 border border-purple-500/30 rounded-xl px-5 py-2.5 hover:bg-purple-600/30 transition-all">
                        <ExternalLinkIcon /> Open page in new tab
                      </a>
                    </div>
                  ) : (
                    <iframe
                      key={iframeKey}
                      src={`/api/page-builder/preview-proxy?url=${encodeURIComponent(currentPageUrl)}`}
                      className="w-full h-full border-0"
                      title="Page Preview"
                      onError={() => setIframeError(true)}
                      onLoad={(e) => {
                        try {
                          const f = e.currentTarget;
                          if (f.contentDocument === null && f.contentWindow === null) {
                            setIframeError(true);
                          }
                        } catch { /* cross-origin is expected, iframe is rendering */ }
                      }}
                    />
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center opacity-30">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                  <LayoutIcon />
                </div>
                <p className="text-sm text-white/40">Page preview will appear here</p>
                <p className="text-xs text-white/20 mt-1">Generate a page to see it live</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
