"use client"

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, PlusCircle, Package, Camera, Settings, Trash2, Plus, Loader2,
  TrendingUp, Box, DollarSign, Tag as TagIcon, RefreshCw, Image as ImageIcon,
  Filter, ChevronDown, Calendar, Clock, Layers, X, LogOut, User, Eye, EyeOff,
  ShoppingCart, CheckCircle, Minus, Search, Phone, MapPin
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
const SEGMENTS = ['Men', 'Women', 'Kids']
const SEASONS = ['Winter', 'Summer', 'Spring', 'Fall']

// ─── API helpers ─────────────────────────────────────────
async function apiPost(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  return res.json()
}
async function apiGet(path: string) {
  const res = await fetch(`${API}${path}`)
  return res.json()
}

// ─── Session helpers ─────────────────────────────────────
function getSession() {
  try {
    const raw = localStorage.getItem('wholesale_session')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function setSession(data: any) {
  localStorage.setItem('wholesale_session', JSON.stringify(data))
}
function clearSession() {
  localStorage.removeItem('wholesale_session')
}

// ════════════════════════════════════════════════════
//  MAIN PAGE COMPONENT
// ════════════════════════════════════════════════════
export default function WholesalePage() {
  const [vendor, setVendor] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const s = getSession()
    if (s?.id) setVendor(s)
    setLoading(false)
  }, [])

  function onLogin(v: any) { setSession(v); setVendor(v) }
  function onLogout() { clearSession(); setVendor(null) }

  if (loading) return <LoadingScreen />
  if (!vendor) return <LoginScreen onLogin={onLogin} />
  return <Dashboard vendor={vendor} onLogout={onLogout} />
}

// ─── Loading ─────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 gap-4">
      <Loader2 className="animate-spin text-blue-600" size={40} />
      <p className="text-slate-500 animate-pulse font-medium">Loading portal...</p>
    </div>
  )
}

// ─── Login Screen ────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (v: any) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await apiPost('/api/wholesale/login', { username, password })
      if (res?.error) { setError('Invalid credentials'); return }
      if (res?.data) { onLogin(res.data); return }
      setError('Unexpected response')
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl shadow-blue-500/25 mb-4">
            <Package className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">WholesaleHub</h1>
          <p className="text-blue-300/70 text-sm mt-1 uppercase tracking-widest font-semibold">MMD Vendor Portal</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-3xl p-8 space-y-5 shadow-2xl">
          <div>
            <label className="text-[10px] font-bold text-blue-200/80 uppercase tracking-widest block mb-2">Username</label>
            <input
              value={username} onChange={e => setUsername(e.target.value)}
              className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-medium placeholder-white/30 outline-none focus:ring-2 focus:ring-blue-500/50 transition"
              placeholder="Enter your username"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-blue-200/80 uppercase tracking-widest block mb-2">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-medium placeholder-white/30 outline-none focus:ring-2 focus:ring-blue-500/50 transition pr-12"
                placeholder="Enter your password"
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition">
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs font-bold bg-red-500/10 px-3 py-2 rounded-xl">{error}</p>}
          <button
            disabled={busy}
            className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-60 text-sm uppercase tracking-wider"
          >
            {busy ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Sign In'}
          </button>
        </form>
        <p className="text-center text-white/20 text-xs mt-6">Contact admin to get your vendor credentials</p>
      </div>
    </div>
  )
}

// ─── Dashboard Shell ─────────────────────────────────────
function Dashboard({ vendor, onLogout }: { vendor: any; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [products, setProducts] = useState<any[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [orderStats, setOrderStats] = useState<any>(null)

  async function refreshProducts() {
    setLoadingProducts(true)
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/products`)
      setProducts(res?.data || [])
    } catch { setProducts([]) }
    finally { setLoadingProducts(false) }
  }

  async function refreshOrders() {
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/orders`)
      setOrderStats(res?.data || null)
    } catch { /* ignore */ }
  }

  useEffect(() => { refreshProducts(); refreshOrders() }, [vendor.id])

  const renderContent = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab products={products} loading={loadingProducts} orderStats={orderStats} />
      case 'inventory': return <InventoryTab products={products} loading={loadingProducts} />
      case 'create-order': return <CreateOrderTab vendor={vendor} products={products} onDone={() => { refreshOrders(); setActiveTab('overview') }} />
      case 'add-new': return <AddNewTab vendor={vendor} onDone={() => { refreshProducts(); setActiveTab('inventory') }} />
      case 'settings': return <SettingsTab vendor={vendor} onLogout={onLogout} />
      default: return <OverviewTab products={products} loading={loadingProducts} orderStats={orderStats} />
    }
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 text-slate-900 overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Desktop Sidebar */}
      <nav className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2">
            <Package className="text-blue-600" size={22} />
            WholesaleHub
          </h1>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">MMD Vendor Portal</p>
        </div>
        <div className="flex-1 p-4 space-y-2">
          <NavItem active={activeTab==='overview'} onClick={()=>setActiveTab('overview')} icon={<LayoutDashboard size={20}/>} label="Overview" />
          <NavItem active={activeTab==='inventory'} onClick={()=>setActiveTab('inventory')} icon={<Package size={20}/>} label="Inventory" />
          <button onClick={()=>setActiveTab('create-order')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab==='create-order' ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'}`}>
            <ShoppingCart size={20}/>
            <span className="font-bold text-sm">Create Order</span>
          </button>
          <NavItem active={activeTab==='add-new'} onClick={()=>setActiveTab('add-new')} icon={<PlusCircle size={20}/>} label="Add Product" />
        </div>
        <div className="p-4 border-t border-slate-100">
          <NavItem active={activeTab==='settings'} onClick={()=>setActiveTab('settings')} icon={<Settings size={20}/>} label="Profile" />
          <div className="mt-4 p-3 bg-blue-50 rounded-xl">
            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-tight">Vendor</p>
            <p className="text-sm font-mono font-bold text-blue-900">{vendor.name}</p>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8 p-4 md:p-8">{renderContent()}</main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex justify-between items-center z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <MobileNavItem active={activeTab==='overview'} onClick={()=>setActiveTab('overview')} icon={<LayoutDashboard size={22}/>} label="Home" />
        <MobileNavItem active={activeTab==='inventory'} onClick={()=>setActiveTab('inventory')} icon={<Package size={22}/>} label="Stock" />
        <div className="relative -top-6">
          <button onClick={()=>setActiveTab('create-order')} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 ${activeTab==='create-order'?'bg-emerald-600 text-white shadow-emerald-300':'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-300'}`}>
            <ShoppingCart size={28} />
          </button>
        </div>
        <MobileNavItem active={activeTab==='add-new'} onClick={()=>setActiveTab('add-new')} icon={<PlusCircle size={22}/>} label="Add" />
        <MobileNavItem active={activeTab==='settings'} onClick={()=>setActiveTab('settings')} icon={<Settings size={22}/>} label="More" />
      </nav>
    </div>
  )
}

// ─── Nav Items ───────────────────────────────────────────
function NavItem({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </button>
  )
}
function MobileNavItem({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 transition-colors ${active ? 'text-blue-600' : 'text-slate-400'}`}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  )
}

// ─── Stats Card ──────────────────────────────────────────
function StatsCard({ label, value, sub, icon }: any) {
  return (
    <div className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100 flex items-start gap-4">
      <div className="p-3 bg-slate-50 rounded-xl">{icon}</div>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider leading-none mb-1">{label}</p>
        <p className="text-xl md:text-2xl font-bold">{value}</p>
        <p className="text-[10px] md:text-xs text-slate-400 mt-1">{sub}</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ products, loading, orderStats }: { products: any[]; loading: boolean; orderStats: any }) {
  const totalStock = useMemo(() => products.reduce((a, p) => {
    const vars = p.variants || []
    return a + vars.reduce((s: number, v: any) => s + (parseInt(v.inventory_quantity) || 0), 0)
  }, 0), [products])

  const totalValue = useMemo(() => products.reduce((a, p) => {
    const vars = p.variants || []
    return a + vars.reduce((s: number, v: any) => s + (parseFloat(v.price) || 0) * (parseInt(v.inventory_quantity) || 0), 0)
  }, 0), [products])

  const segmentData = useMemo(() => {
    const counts: Record<string, number> = {}
    products.forEach(p => {
      const tags = typeof p.tags === 'string' ? p.tags.split(',').map((t: string) => t.trim()) : []
      const seg = tags.find((t: string) => t.startsWith('segment:'))
      const name = seg ? seg.replace('segment:', '') : 'Other'
      counts[name] = (counts[name] || 0) + 1
    })
    return Object.entries(counts).map(([name, count]) => ({ name, count }))
  }, [products])

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">Dashboard Overview</h2>
          <p className="text-slate-500 text-sm">Performance metrics for your products on MMD store.</p>
        </div>
        <div className="bg-white border p-3 rounded-2xl shadow-sm flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Package size={18}/></div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block leading-none">Total Products</span>
            <p className="text-lg font-bold">{loading ? '...' : products.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatsCard label="Inventory Level" value={loading ? '...' : totalStock.toLocaleString()} sub="Total units in stock" icon={<Box size={20} className="text-blue-600" />} />
        <StatsCard label="Inventory Value" value={loading ? '...' : `$${totalValue.toLocaleString()}`} sub="Current market value" icon={<DollarSign size={20} className="text-green-600" />} />
        <StatsCard label="Orders" value={orderStats ? orderStats.total_orders : '...'} sub={orderStats ? `$${orderStats.total_revenue} revenue` : 'Loading...'} icon={<ShoppingCart size={20} className="text-emerald-600" />} />
        <StatsCard label="Units Sold" value={orderStats ? orderStats.total_units_sold : '...'} sub="Total items ordered" icon={<TrendingUp size={20} className="text-orange-600" />} />
      </div>

      {/* Segment breakdown */}
      {segmentData.length > 0 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold mb-4">Products by Segment</h3>
          <div className="space-y-3">
            {segmentData.map(s => (
              <div key={s.name} className="flex items-center gap-4">
                <div className="w-24 text-sm font-semibold text-slate-600">{s.name}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(10, (s.count / Math.max(products.length, 1)) * 100)}%` }}
                  >
                    <span className="text-[10px] text-white font-bold">{s.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent products */}
      {products.length > 0 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold mb-4">Recent Products</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.slice(0, 6).map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {p.images?.[0]?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].src} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={20} className="text-slate-300" />
                  )}
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-bold truncate">{p.title}</p>
                  <p className="text-[10px] text-slate-500">${p.variants?.[0]?.price || '0.00'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  INVENTORY TAB
// ═══════════════════════════════════════════════════
function InventoryTab({ products, loading }: { products: any[]; loading: boolean }) {
  const [search, setSearch] = useState('')
  const [segFilter, setSegFilter] = useState('All')

  const filtered = useMemo(() => {
    return products.filter(p => {
      const matchSearch = !search || (p.title || '').toLowerCase().includes(search.toLowerCase())
      if (segFilter === 'All') return matchSearch
      const tags = typeof p.tags === 'string' ? p.tags : ''
      return matchSearch && tags.includes(`segment:${segFilter}`)
    })
  }, [products, search, segFilter])

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10 animate-in">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Live Inventory</h2>
          <p className="text-slate-500 text-sm">Products on the MMD Shopify store assigned to you.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search products..."
          className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/30 w-64"
        />
        <select value={segFilter} onChange={e => setSegFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none"
        >
          <option value="All">All Segments</option>
          {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-left min-w-[700px]">
          <thead className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
            <tr>
              <th className="px-6 py-4">Product Detail</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-center">Stock</th>
              <th className="px-6 py-4 text-right">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={4} className="px-6 py-16 text-center">
                <Loader2 className="animate-spin text-blue-500 mx-auto mb-2" size={24} />
                <p className="text-slate-400 text-sm">Loading products...</p>
              </td></tr>
            )}
            {!loading && filtered.map((p: any) => {
              const qty = (p.variants || []).reduce((s: number, v: any) => s + (parseInt(v.inventory_quantity) || 0), 0)
              const price = p.variants?.[0]?.price || '0.00'
              return (
                <tr key={p.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 flex-shrink-0 flex items-center justify-center">
                        {p.images?.[0]?.src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.images[0].src} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={20} className="text-slate-300" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{p.title || 'Untitled'}</p>
                        <p className="text-[10px] text-slate-400 font-mono">ID: {p.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${p.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center font-bold text-sm">{qty}</td>
                  <td className="px-6 py-4 text-right font-bold">${price}</td>
                </tr>
              )
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-16 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center"><Package size={32}/></div>
                  <p className="text-slate-400 font-medium">No products found.</p>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  ADD NEW PRODUCT TAB
// ═══════════════════════════════════════════════════
function AddNewTab({ vendor, onDone }: { vendor: any; onDone: () => void }) {
  const [saving, setSaving] = useState(false)
  const [colorInput, setColorInput] = useState('')
  const [form, setForm] = useState({
    title: '', description: '', cogPrice: '', salePrice: '',
    colors: [] as string[], segment: 'Men', season: 'Summer',
    sizeGroups: [{ from: 20, to: 25, qty: 10 }],
    variantGroupId: ''
  })
  // Image capture state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const netProfit = useMemo(() => {
    const sale = parseFloat(form.salePrice) || 0
    const cog = parseFloat(form.cogPrice) || 0
    return (sale - cog).toFixed(2)
  }, [form.salePrice, form.cogPrice])

  function addColor() {
    const c = colorInput.trim()
    if (!c || form.colors.includes(c)) return
    setForm(f => ({ ...f, colors: [...f.colors, c] }))
    setColorInput('')
  }
  function removeColor(c: string) {
    setForm(f => ({ ...f, colors: f.colors.filter(x => x !== c) }))
  }

  function addSizeGroup() {
    setForm(f => ({ ...f, sizeGroups: [...f.sizeGroups, { from: 20, to: 25, qty: 10 }] }))
  }
  function removeSizeGroup(idx: number) {
    setForm(f => ({ ...f, sizeGroups: f.sizeGroups.filter((_, i) => i !== idx) }))
  }

  // Handle image selection (camera or file)
  async function handleImageCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    // Show local preview
    const reader = new FileReader()
    reader.onload = (ev) => setImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    // Upload to server
    setUploading(true)
    setAiStatus('Uploading image...')
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch(`${API}/api/wholesale/upload-image`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data?.data?.url) {
        setImageUrl(data.data.url)
        setAiStatus('Image uploaded! Tap "Analyze with AI" to auto-fill product details.')
      } else {
        setAiStatus('Upload failed. Please try again.')
      }
    } catch {
      setAiStatus('Upload error. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // Send image to ChatGPT for analysis
  async function handleAnalyzeImage() {
    if (!imageUrl) return
    setAnalyzing(true)
    setAiStatus('🤖 Analyzing product with AI... This may take a few seconds.')
    try {
      const res = await apiPost('/api/wholesale/analyze-image', { image_url: imageUrl })
      if (res?.data) {
        const ai = res.data
        setForm(f => ({
          ...f,
          title: ai.title || f.title,
          description: (ai.benefits || []).join('. ') || f.description,
          colors: (ai.colors && ai.colors.length > 0) ? ai.colors : f.colors,
        }))
        setAiStatus('✅ AI analysis complete! Title and description updated.')
      } else {
        setAiStatus('AI analysis returned no data. Please fill manually.')
      }
    } catch {
      setAiStatus('AI analysis failed. Please fill manually.')
    } finally {
      setAnalyzing(false)
    }
  }

  function removeImage() {
    setImageFile(null)
    setImagePreview(null)
    setImageUrl(null)
    setAiStatus(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit() {
    if (!form.title.trim()) { alert('Please enter a product title.'); return }
    setSaving(true)
    try {
      const res = await apiPost(`/api/wholesale/vendors/${vendor.id}/products`, {
        title: form.title,
        description: form.description,
        cog_price: parseFloat(form.cogPrice) || undefined,
        sale_price: parseFloat(form.salePrice) || undefined,
        segment: form.segment,
        season: form.season,
        colors: form.colors.length > 0 ? form.colors : undefined,
        size_groups: form.sizeGroups,
        image_url: imageUrl || undefined,
        variant_group_id: form.variantGroupId.trim() || undefined,
      })
      if (res?.error) { alert('Error: ' + res.error); return }
      onDone()
    } catch (e: any) {
      alert('Error saving product: ' + (e?.message || e))
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24 animate-in">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">Add Product</h2>
        <p className="text-slate-500 text-sm">Create a new product on the MMD Shopify store.</p>
      </div>

      {/* ── CAMERA / IMAGE CAPTURE SECTION ── */}
      <section className="bg-gradient-to-br from-blue-50 via-indigo-50 to-violet-50 p-5 rounded-3xl border border-blue-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-blue-600 mb-4 flex items-center gap-2 tracking-widest">
          <Camera size={14} /> Product Photo
        </h3>
        {!imagePreview ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-20 h-20 bg-white/80 rounded-3xl flex items-center justify-center shadow-inner border-2 border-dashed border-blue-300">
              <Camera size={36} className="text-blue-400" />
            </div>
            <p className="text-sm text-blue-600 font-medium text-center">Take a photo or upload an image of your product</p>
            <p className="text-[10px] text-blue-400 text-center">AI will analyze the image to auto‑fill title & description</p>
            <div className="flex gap-3">
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2 text-sm">
                <Camera size={18} />
                Take Photo
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageCapture}
                  className="hidden"
                />
              </label>
              <label className="cursor-pointer bg-white hover:bg-slate-50 text-blue-600 px-6 py-3 rounded-2xl font-bold shadow-md border border-blue-200 transition-all active:scale-95 flex items-center gap-2 text-sm">
                <ImageIcon size={18} />
                Upload
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageCapture}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden border-2 border-blue-200 shadow-md bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Product preview" className="w-full max-h-80 object-contain bg-white" />
              <button
                onClick={removeImage}
                className="absolute top-3 right-3 bg-red-500 hover:bg-red-600 text-white p-2 rounded-full shadow-lg transition-all"
              >
                <X size={16} />
              </button>
            </div>
            {/* AI Analyze Button */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleAnalyzeImage}
                disabled={analyzing || !imageUrl}
                className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-6 py-3.5 rounded-2xl font-bold shadow-lg shadow-violet-200 transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
              >
                {analyzing ? <Loader2 className="animate-spin" size={18} /> : <span className="text-lg">🤖</span>}
                {analyzing ? 'Analyzing...' : 'Analyze with AI'}
              </button>
              <label className="cursor-pointer bg-white hover:bg-slate-50 text-blue-600 px-5 py-3.5 rounded-2xl font-bold shadow-md border border-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2 text-sm">
                <RefreshCw size={16} />
                Retake
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageCapture}
                  className="hidden"
                />
              </label>
            </div>
            {/* Status */}
            {aiStatus && (
              <div className={`px-4 py-3 rounded-xl text-xs font-bold ${aiStatus.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : aiStatus.startsWith('🤖') ? 'bg-violet-50 text-violet-700 border border-violet-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                {aiStatus}
              </div>
            )}
          </div>
        )}
        {uploading && (
          <div className="flex items-center gap-2 mt-3 text-blue-600">
            <Loader2 className="animate-spin" size={16} />
            <span className="text-xs font-bold">Uploading image...</span>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Catalog Data */}
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <TagIcon size={14} /> Catalog Data
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Product Title</label>
                <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="Enter product title" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none resize-none h-24" placeholder="Product description..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Segment</label>
                  <select value={form.segment} onChange={e => setForm({...form, segment: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none">
                    {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Season</label>
                  <select value={form.season} onChange={e => setForm({...form, season: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none">
                    {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              {/* Colors */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Colors</label>
                <div className="flex gap-2 mb-3">
                  <input type="text" value={colorInput} onChange={e => setColorInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addColor())}
                    placeholder="Enter color name..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium outline-none" />
                  <button onClick={addColor} className="bg-blue-600 text-white px-4 rounded-xl font-bold text-xs">Add</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.colors.map(c => (
                    <span key={c} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full text-xs font-bold border border-blue-100">
                      {c} <button onClick={() => removeColor(c)}><X size={14} /></button>
                    </span>
                  ))}
                  {form.colors.length === 0 && <p className="text-[10px] text-slate-400 italic">No colors added yet.</p>}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Pricing */}
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <DollarSign size={14} /> Financials
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">COG Price</label>
                  <input type="number" value={form.cogPrice} onChange={e => setForm({...form, cogPrice: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Sale Price</label>
                  <input type="number" value={form.salePrice} onChange={e => setForm({...form, salePrice: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="0.00" />
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-2xl border border-green-100 font-bold text-green-700">
                <span className="text-xs uppercase">Est. Net Profit</span>
                <span className="text-xl">${netProfit}</span>
              </div>
            </div>
          </section>

          {/* Size Groups / Quantities */}
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                <Layers size={14} /> Stock Variants
              </h3>
              <button onClick={addSizeGroup} className="text-blue-600 text-[10px] font-black flex items-center gap-1"><Plus size={12} /> Add Range</button>
            </div>
            <div className="space-y-3">
              {form.sizeGroups.map((group, idx) => (
                <div key={idx} className="flex flex-col md:flex-row md:items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 relative">
                  <div className="grid grid-cols-3 gap-3 flex-1">
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">From</span>
                      <input type="number" value={group.from}
                        onChange={e => { const gs = [...form.sizeGroups]; gs[idx] = {...gs[idx], from: parseInt(e.target.value)||0}; setForm({...form, sizeGroups: gs}) }}
                        className="font-bold text-sm outline-none w-full" />
                    </div>
                    <div className="bg-white p-2 rounded-xl border border-slate-200 flex flex-col">
                      <span className="text-[9px] text-slate-400 font-bold uppercase mb-1">To</span>
                      <input type="number" value={group.to}
                        onChange={e => { const gs = [...form.sizeGroups]; gs[idx] = {...gs[idx], to: parseInt(e.target.value)||0}; setForm({...form, sizeGroups: gs}) }}
                        className="font-bold text-sm outline-none w-full" />
                    </div>
                    <div className="bg-blue-600 p-2 rounded-xl flex flex-col border border-blue-700">
                      <span className="text-[9px] text-blue-100 font-bold uppercase mb-1">Qty</span>
                      <input type="number" value={group.qty}
                        onChange={e => { const gs = [...form.sizeGroups]; gs[idx] = {...gs[idx], qty: parseInt(e.target.value)||0}; setForm({...form, sizeGroups: gs}) }}
                        className="font-bold text-sm outline-none w-full text-white bg-transparent" />
                    </div>
                  </div>
                  {form.sizeGroups.length > 1 && (
                    <button onClick={() => removeSizeGroup(idx)} className="absolute -top-2 -right-2 md:relative md:top-0 md:right-0 bg-red-500 text-white md:bg-transparent md:text-slate-300 md:hover:text-red-500 p-1 rounded-full shadow-md md:shadow-none">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Variant Group ID */}
          <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 flex items-center gap-2 tracking-widest">
              <TagIcon size={14} /> Variant Group ID (SKU)
            </h3>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Group ID</label>
              <input type="text" value={form.variantGroupId} onChange={e => setForm({...form, variantGroupId: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none" placeholder="e.g. SKU-0828-2" />
              <p className="text-[10px] text-slate-400 mt-2">This ID will be set as the SKU on all variants in Shopify</p>
            </div>
          </section>

          {/* Vendor Tag Info */}
          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-tight mb-1">Products will be tagged as</p>
            <p className="text-sm font-mono font-bold text-blue-900">Vendor: {vendor.name}</p>
            <p className="text-[10px] text-blue-500 mt-1">This name will appear as the vendor field on Shopify</p>
          </div>
        </div>
      </div>

      {/* ── SAVE BUTTON AT BOTTOM ── */}
      <div className="pt-4">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-4 rounded-2xl font-bold shadow-xl shadow-blue-200 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-3 text-base uppercase tracking-wider"
        >
          {saving && <Loader2 className="animate-spin" size={20} />}
          Save & Send to Store
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  CREATE ORDER TAB
// ═══════════════════════════════════════════════════
function CreateOrderTab({ vendor, products, onDone }: { vendor: any; products: any[]; onDone: () => void }) {
  const [search, setSearch] = useState('')
  const [lineItems, setLineItems] = useState<{ variant_id: number; quantity: number; title: string; sku: string; price: string }[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState({ address1: 'NA', city: 'Casablanca', province: 'Casablanca-Settat', zip: '20000', country: 'MA' })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<any>(null)
  const [showProducts, setShowProducts] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // Flatten variants for search
  const allVariants = useMemo(() => {
    const arr: any[] = []
    products.forEach(p => {
      (p.variants || []).forEach((v: any) => {
        arr.push({
          variant_id: v.id,
          title: p.title,
          variant_title: v.title,
          sku: v.sku || '',
          price: v.price || '0.00',
          inventory: v.inventory_quantity || 0,
          image: p.images?.[0]?.src || null,
        })
      })
    })
    return arr
  }, [products])

  const filtered = useMemo(() => {
    if (!search) return allVariants.slice(0, 20)
    const q = search.toLowerCase()
    return allVariants.filter(v =>
      v.title.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q) || v.variant_title.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [allVariants, search])

  function addItem(v: any) {
    const existing = lineItems.find(li => li.variant_id === v.variant_id)
    if (existing) {
      setLineItems(lineItems.map(li => li.variant_id === v.variant_id ? { ...li, quantity: li.quantity + 1 } : li))
    } else {
      setLineItems([...lineItems, { variant_id: v.variant_id, quantity: 1, title: `${v.title} - ${v.variant_title}`, sku: v.sku, price: v.price }])
    }
    setSearch('')
    setShowProducts(false)
  }

  function updateQty(variantId: number, delta: number) {
    setLineItems(lineItems.map(li => {
      if (li.variant_id === variantId) {
        const newQty = Math.max(1, li.quantity + delta)
        return { ...li, quantity: newQty }
      }
      return li
    }))
  }

  function removeItem(variantId: number) {
    setLineItems(lineItems.filter(li => li.variant_id !== variantId))
  }

  const orderTotal = useMemo(() => {
    return lineItems.reduce((sum, li) => sum + (parseFloat(li.price) || 0) * li.quantity, 0).toFixed(2)
  }, [lineItems])

  async function handleSubmit() {
    if (!customerName.trim() || !customerPhone.trim()) { alert('Customer name and phone are required'); return }
    if (lineItems.length === 0) { alert('Add at least one product'); return }
    setSaving(true)
    try {
      const body = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_address1: address.address1,
        customer_city: address.city,
        customer_province: address.province,
        customer_zip: address.zip,
        customer_country: address.country,
        line_items: lineItems.map(li => ({ variant_id: li.variant_id, quantity: li.quantity })),
      }
      const res = await apiPost(`/api/wholesale/vendors/${vendor.id}/orders`, body)
      if (res?.error) { alert('Error: ' + res.error); setSaving(false); return }
      setSuccess(res?.data)
    } catch (e: any) { alert('Failed: ' + e.message) }
    finally { setSaving(false) }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowProducts(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (success) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center animate-in">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={40} className="text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Order Created!</h2>
        <p className="text-slate-500 mb-6">Order <span className="font-bold text-emerald-600">{success.name || `#${success.order_number}`}</span> has been sent to Shopify.</p>
        <p className="text-lg font-bold text-slate-900 mb-8">Total: ${success.total_price}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setSuccess(null); setLineItems([]); setCustomerName(''); setCustomerPhone('') }} className="px-6 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50">New Order</button>
          <button onClick={onDone} className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700">Back to Overview</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-28 animate-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-xl"><ShoppingCart size={22} className="text-emerald-600" /></div>
          Create Order
        </h2>
        <p className="text-slate-500 text-sm mt-1">Select products by SKU and enter customer details.</p>
      </div>

      {/* Product Search & Selection */}
      <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest">Add Products</h3>
        <div ref={searchRef} className="relative">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <Search size={16} className="text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowProducts(true) }}
              onFocus={() => setShowProducts(true)}
              placeholder="Search by product name or SKU..."
              className="bg-transparent flex-1 text-sm font-medium outline-none"
            />
          </div>
          {showProducts && (
            <div className="absolute z-40 left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-64 overflow-y-auto">
              {filtered.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">No products found</p>}
              {filtered.map(v => (
                <button key={v.variant_id} onClick={() => addItem(v)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {v.image ? <img src={v.image} alt="" className="w-full h-full object-cover" /> : <Package size={16} className="text-slate-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{v.title}</p>
                    <p className="text-[10px] text-slate-400">{v.variant_title} {v.sku && `· SKU: ${v.sku}`}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-emerald-600">${v.price}</p>
                    <p className="text-[10px] text-slate-400">{v.inventory} in stock</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Line Items */}
        {lineItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {lineItems.map(li => (
              <div key={li.variant_id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{li.title}</p>
                  <p className="text-[10px] text-slate-400">{li.sku && `SKU: ${li.sku} · `}${li.price} each</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => updateQty(li.variant_id, -1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Minus size={14}/></button>
                  <span className="w-8 text-center text-sm font-bold">{li.quantity}</span>
                  <button onClick={() => updateQty(li.variant_id, 1)} className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100"><Plus size={14}/></button>
                </div>
                <button onClick={() => removeItem(li.variant_id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16}/></button>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
              <span className="text-sm font-bold text-slate-500">Order Total</span>
              <span className="text-lg font-black text-emerald-600">${orderTotal}</span>
            </div>
          </div>
        )}
      </section>

      {/* Customer Info */}
      <section className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-4 tracking-widest flex items-center gap-2"><User size={14}/> Customer Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Full Name *</label>
            <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="Ahmed Bennani" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">Phone *</label>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <Phone size={14} className="text-slate-400" />
              <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="bg-transparent flex-1 text-sm font-bold outline-none" placeholder="+212 600 000000" />
            </div>
          </div>
        </div>
        {/* Collapsible Address (pre-filled) */}
        <details className="mt-4">
          <summary className="text-[10px] font-bold text-slate-400 uppercase cursor-pointer hover:text-slate-600 flex items-center gap-1"><MapPin size={12}/> Address (auto-filled — click to edit)</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Address</label>
              <input type="text" value={address.address1} onChange={e => setAddress({...address, address1: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">City</label>
              <input type="text" value={address.city} onChange={e => setAddress({...address, city: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Province</label>
              <input type="text" value={address.province} onChange={e => setAddress({...address, province: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">ZIP</label>
              <input type="text" value={address.zip} onChange={e => setAddress({...address, zip: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
            </div>
          </div>
        </details>
      </section>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={saving || lineItems.length === 0}
        className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-4 rounded-2xl font-bold shadow-xl shadow-emerald-200 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-3 text-base uppercase tracking-wider"
      >
        {saving && <Loader2 className="animate-spin" size={20} />}
        <ShoppingCart size={20} />
        Place Order ({lineItems.length} {lineItems.length === 1 ? 'item' : 'items'} · ${orderTotal})
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════
//  SETTINGS TAB
// ═══════════════════════════════════════════════════
function SettingsTab({ vendor, onLogout }: { vendor: any; onLogout: () => void }) {
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-24 animate-in">
      <h2 className="text-2xl font-bold">Profile Settings</h2>
      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl flex items-center justify-center text-white text-3xl font-black shadow-lg shadow-blue-100">
            {(vendor.name || 'V').charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="text-xl font-bold">{vendor.name}</h3>
            <p className="text-slate-500 text-sm">Wholesale Vendor Partner</p>
          </div>
        </div>
        <div className="space-y-6">
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Username</label>
            <code className="block bg-white border border-slate-200 rounded-xl px-4 py-3 text-blue-600 font-bold font-mono text-sm tracking-widest">{vendor.username}</code>
          </div>
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Vendor ID</label>
            <code className="block bg-white border border-slate-200 rounded-xl px-4 py-3 text-indigo-600 font-bold font-mono text-sm tracking-widest">{vendor.id}</code>
          </div>
          <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100">
            <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-2">Connected Store</label>
            <p className="text-sm font-bold text-blue-900">MMD Shopify Store</p>
            <p className="text-[10px] text-blue-500 mt-1">Products you create are pushed directly to this store</p>
          </div>
        </div>
        <button onClick={onLogout} className="w-full py-4 bg-red-50 text-red-600 font-black rounded-2xl hover:bg-red-100 transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2">
          <LogOut size={18} /> Logout
        </button>
      </div>
    </div>
  )
}
