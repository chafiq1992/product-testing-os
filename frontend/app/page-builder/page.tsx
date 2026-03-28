'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  pageBuilderSearchProducts,
  pageBuilderGenerate,
  pageBuilderToggleLayout,
  pageBuilderWidgetInstall,
  pageBuilderWidgetUninstall,
} from '@/lib/api'

/* ───────── Types ───────── */
type Product = { id:string; title:string; handle:string; image?:string|null; price?:string|null; status?:string }
type ChatMsg = { role:'user'|'assistant'|'system'; content:string; pageUrl?:string; slug?:string }

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

  // Preview
  const [iframeKey, setIframeKey] = useState(0)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const searchTimeoutRef = useRef<any>(null)

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, generating])

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

          {/* Layout Controls */}
          {currentSlug && (
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-4">
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
                    'Create a luxury landing page with hero, features, and FAQ',
                    'Build a product page with testimonials and urgency section',
                    'Design a minimalist page with image gallery and CTA',
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
        </div>

        {/* Right: Preview Panel */}
        <div className="flex-1 flex flex-col bg-[#080810] min-h-[400px]">
          {currentPageUrl ? (
            <>
              <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3 bg-[#0e0e18]/50">
                <span className="text-xs text-white/40 flex-1 truncate">{currentPageUrl}</span>
                <button onClick={() => setIframeKey(k => k + 1)}
                  className="text-white/40 hover:text-white/60 transition-colors p-1.5 hover:bg-white/5 rounded-lg" title="Refresh">
                  <RefreshIcon />
                </button>
                <a href={currentPageUrl} target="_blank" rel="noopener noreferrer"
                  className="text-white/40 hover:text-white/60 transition-colors p-1.5 hover:bg-white/5 rounded-lg" title="Open in new tab">
                  <ExternalLinkIcon />
                </a>
              </div>
              <div className="flex-1 relative">
                <iframe
                  key={iframeKey}
                  src={currentPageUrl}
                  className="absolute inset-0 w-full h-full border-0"
                  title="Page Preview"
                />
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
