"use client"

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, PlusCircle, Package, Camera, Settings, Trash2, Plus, Loader2,
  TrendingUp, Box, DollarSign, Tag as TagIcon, RefreshCw, Image as ImageIcon,
  Filter, ChevronDown, Calendar, Clock, Layers, X, LogOut, User, Eye, EyeOff,
  ShoppingCart, CheckCircle, Minus, Search, Phone, MapPin, ClipboardList, FileText,
  CreditCard, AlertCircle, ChevronRight, Edit3
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
async function apiPatch(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
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
      case 'orders': return <OrdersTab vendor={vendor} />
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
          <NavItem active={activeTab==='orders'} onClick={()=>setActiveTab('orders')} icon={<ClipboardList size={20}/>} label="Orders" />
          <button onClick={()=>setActiveTab('create-order')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab==='create-order' ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-200' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'}`}>
            <ShoppingCart size={20}/>
            <span className="font-bold text-sm">Create Order</span>
          </button>
          <NavItem active={activeTab==='add-new'} onClick={()=>setActiveTab('add-new')} icon={<PlusCircle size={20}/>} label="Add Product" />
        </div>
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center text-white text-sm font-black flex-shrink-0">
              {(vendor.name || 'V').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-blue-900 truncate">{vendor.name}</p>
              <p className="text-[10px] text-blue-500">Vendor</p>
            </div>
            <button onClick={onLogout} className="text-red-400 hover:text-red-600 transition-colors" title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8 p-4 md:p-8">{renderContent()}</main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2 flex justify-around items-center z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <MobileNavItem active={activeTab==='overview'} onClick={()=>setActiveTab('overview')} icon={<LayoutDashboard size={20}/>} label="Home" />
        <MobileNavItem active={activeTab==='inventory'} onClick={()=>setActiveTab('inventory')} icon={<Package size={20}/>} label="Stock" />
        <div className="relative -top-5">
          <button onClick={()=>setActiveTab('create-order')} className={`w-13 h-13 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 p-3 ${activeTab==='create-order'?'bg-emerald-600 text-white shadow-emerald-300':'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-300'}`}>
            <ShoppingCart size={24} />
          </button>
        </div>
        <MobileNavItem active={activeTab==='orders'} onClick={()=>setActiveTab('orders')} icon={<ClipboardList size={20}/>} label="Orders" />
        <MobileNavItem active={activeTab==='add-new'} onClick={()=>setActiveTab('add-new')} icon={<PlusCircle size={20}/>} label="Add" />
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
  const [lineItems, setLineItems] = useState<{ variant_id: number; quantity: number; title: string; sku: string; price: string; image: string | null; variantTitle: string }[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState({ address1: 'NA', city: 'Casablanca', province: 'Casablanca-Settat', zip: '20000', country: 'MA' })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<any>(null)
  const [showProducts, setShowProducts] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const invoiceRef = useRef<HTMLDivElement>(null)

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
      setLineItems([...lineItems, { variant_id: v.variant_id, quantity: 1, title: v.title, sku: v.sku, price: v.price, image: v.image, variantTitle: v.variant_title }])
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

  // Download invoice as image
  async function downloadInvoice() {
    if (!invoiceRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      const link = document.createElement('a')
      link.download = `invoice-${success?.name || success?.order_number || 'order'}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.error('Failed to generate invoice image:', err)
      alert('Failed to generate invoice image. Please try again.')
    }
  }

  // Share invoice as image (mobile share API or fallback to download)
  async function shareInvoice() {
    if (!invoiceRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) { downloadInvoice(); return }
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], `invoice-${success?.name || 'order'}.png`, { type: 'image/png' })
        const shareData = { files: [file], title: `Invoice ${success?.name || ''}`, text: `Invoice from ${vendor.name}` }
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData)
          return
        }
      }
      // Fallback: download
      downloadInvoice()
    } catch (err) {
      console.error('Share failed:', err)
      downloadInvoice()
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowProducts(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const invoiceDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const invoiceTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const totalItems = lineItems.reduce((s, li) => s + li.quantity, 0)

  if (success) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-28 animate-in">
        {/* Action buttons above the invoice */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={downloadInvoice} className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-[0.98] text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download Invoice
          </button>
          <button onClick={shareInvoice} className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-emerald-200 transition-all active:scale-[0.98] text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share Invoice
          </button>
        </div>

        {/* ═══ PROFESSIONAL INVOICE ═══ */}
        <div ref={invoiceRef} style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif", background: '#fff', padding: '32px', borderRadius: '0px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', paddingBottom: '20px', borderBottom: '3px solid #1e40af' }}>
            <div>
              <div style={{ fontSize: '28px', fontWeight: 900, color: '#1e3a5f', letterSpacing: '-0.5px', lineHeight: 1 }}>INVOICE</div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px', fontWeight: 600, letterSpacing: '0.5px' }}>
                {success.name || `#${success.order_number}`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#1e40af', letterSpacing: '-0.3px' }}>{vendor.name}</div>
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Wholesale Vendor</div>
            </div>
          </div>

          {/* Info Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
            <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '14px 16px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px' }}>Customer</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{customerName}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{customerPhone}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{address.city}, {address.country}</div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '14px 16px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '6px' }}>Invoice Details</div>
              <div style={{ fontSize: '12px', color: '#334155' }}><span style={{ fontWeight: 700 }}>Date: </span>{invoiceDate}</div>
              <div style={{ fontSize: '12px', color: '#334155', marginTop: '2px' }}><span style={{ fontWeight: 700 }}>Time: </span>{invoiceTime}</div>
              <div style={{ fontSize: '12px', color: '#334155', marginTop: '2px' }}><span style={{ fontWeight: 700 }}>Status: </span><span style={{ color: '#16a34a', fontWeight: 700 }}>Confirmed</span></div>
            </div>
          </div>

          {/* Items Table */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0', background: '#1e40af', borderRadius: '10px 10px 0 0', padding: '10px 16px' }}>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '1.2px' }}>Item</div>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '1.2px', textAlign: 'center' }}>Qty</div>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '1.2px', textAlign: 'center' }}>Price</div>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '1.2px', textAlign: 'right' }}>Total</div>
            </div>
            {lineItems.map((li, idx) => (
              <div key={li.variant_id} style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0',
                padding: '12px 16px', alignItems: 'center',
                background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0',
                borderBottom: '1px solid #e2e8f0',
                ...(idx === lineItems.length - 1 ? { borderRadius: '0 0 10px 10px' } : {}),
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {li.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={li.image} alt="" style={{ width: '36px', height: '36px', borderRadius: '8px', objectFit: 'cover', border: '1px solid #e2e8f0', flexShrink: 0 }} crossOrigin="anonymous" />
                  ) : (
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#f1f5f9', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Package size={14} color="#94a3b8" />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{li.title}</div>
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>
                      {li.variantTitle !== 'Default Title' && li.variantTitle}{li.sku && ` · SKU: ${li.sku}`}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', textAlign: 'center' }}>{li.quantity}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748b', textAlign: 'center' }}>${li.price}</div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', textAlign: 'right' }}>${(parseFloat(li.price) * li.quantity).toFixed(2)}</div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
            <div style={{ width: '220px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', color: '#64748b' }}>
                <span>Subtotal ({totalItems} items)</span>
                <span style={{ fontWeight: 700 }}>${orderTotal}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', color: '#64748b' }}>
                <span>Shipping</span>
                <span style={{ fontWeight: 700 }}>Free</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', marginTop: '6px', borderTop: '2px solid #1e40af', fontSize: '16px', fontWeight: 900, color: '#1e3a5f' }}>
                <span>TOTAL</span>
                <span>${success.total_price || orderTotal}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>Thank you for your business!</div>
            <div style={{ fontSize: '9px', color: '#cbd5e1', marginTop: '4px' }}>{vendor.name} · MMD Wholesale · {invoiceDate}</div>
          </div>
        </div>

        {/* Bottom actions */}
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
                  <p className="text-sm font-bold truncate">{li.title} - {li.variantTitle}</p>
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
// ─── Orders Tab ──────────────────────────────────────────
function OrdersTab({ vendor }: { vendor: any }) {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'unpaid'|'newest'|'oldest'>('unpaid')
  const [customerFilter, setCustomerFilter] = useState('')
  const [expandedOrder, setExpandedOrder] = useState<string|null>(null)
  const [paymentModal, setPaymentModal] = useState<any>(null)
  const [payStatus, setPayStatus] = useState('unpaid')
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function fetchOrders() {
    setLoading(true)
    try {
      const res = await apiGet(`/api/wholesale/vendors/${vendor.id}/orders`)
      setOrders(res?.data?.all_orders || [])
    } catch { setOrders([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { fetchOrders() }, [vendor.id])

  // Unique customer names for filter
  const customers = useMemo(() => {
    const names = new Set(orders.map((o: any) => o.customer_name).filter(Boolean))
    return Array.from(names).sort()
  }, [orders])

  // Filtered + sorted
  const filtered = useMemo(() => {
    let list = [...orders]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((o: any) =>
        (o.name || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.line_items || []).some((li: any) => (li.title || '').toLowerCase().includes(q))
      )
    }
    if (customerFilter) {
      list = list.filter((o: any) => o.customer_name === customerFilter)
    }
    if (sortBy === 'unpaid') {
      const priority: Record<string, number> = { unpaid: 0, partially_paid: 1, paid: 2 }
      list.sort((a: any, b: any) => {
        const pa = priority[a.payment_status] ?? 0
        const pb = priority[b.payment_status] ?? 0
        if (pa !== pb) return pa - pb
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    } else if (sortBy === 'newest') {
      list.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } else {
      list.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    return list
  }, [orders, search, customerFilter, sortBy])

  function openPaymentModal(order: any) {
    setPaymentModal(order)
    setPayStatus(order.payment_status || 'unpaid')
    setPayAmount(String(order.amount_paid || 0))
    setPayNote(order.payment_note || '')
  }

  async function savePayment() {
    if (!paymentModal) return
    setSaving(true)
    try {
      await apiPatch(`/api/wholesale/vendors/${vendor.id}/orders/${paymentModal.id}/payment`, {
        payment_status: payStatus,
        amount_paid: parseFloat(payAmount) || 0,
        payment_note: payNote,
      })
      // Update local state
      setOrders(prev => prev.map(o =>
        o.id === paymentModal.id ? { ...o, payment_status: payStatus, amount_paid: parseFloat(payAmount) || 0, payment_note: payNote } : o
      ))
      setPaymentModal(null)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const statusBadge = (status: string) => {
    if (status === 'paid') return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-full">✓ Paid</span>
    if (status === 'partially_paid') return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">◐ Partial</span>
    return <span className="px-2.5 py-1 bg-red-100 text-red-600 text-[11px] font-bold rounded-full">● Unpaid</span>
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-blue-600" size={32} />
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-24 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Orders</h2>
          <p className="text-sm text-slate-500">{orders.length} total orders</p>
        </div>
        <button onClick={fetchOrders} className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
          <RefreshCw size={18} className="text-slate-500" />
        </button>
      </div>

      {/* Search + Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search orders, customers, products..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Customers</option>
            {customers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex bg-slate-100 rounded-xl p-0.5">
            {(['unpaid', 'newest', 'oldest'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${sortBy === s ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {s === 'unpaid' ? 'Unpaid First' : s === 'newest' ? 'Newest' : 'Oldest'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Orders List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <ClipboardList size={48} className="mx-auto mb-4 opacity-40" />
          <p className="font-semibold">No orders found</p>
          <p className="text-sm mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order: any) => {
            const isExpanded = expandedOrder === String(order.id)
            const total = parseFloat(order.total_price || '0')
            const remaining = total - (order.amount_paid || 0)
            return (
              <div key={order.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                {/* Order Header */}
                <button onClick={() => setExpandedOrder(isExpanded ? null : String(order.id))}
                  className="w-full p-4 flex items-center gap-3 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-blue-600">{order.name}</span>
                      {statusBadge(order.payment_status)}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {order.customer_name} · {order.units} items · {new Date(order.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-sm">{total.toFixed(2)} MAD</p>
                    {order.payment_status === 'partially_paid' && (
                      <p className="text-[10px] text-amber-600 font-medium">Remaining: {remaining.toFixed(2)}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    {/* Line Items */}
                    <div className="space-y-2">
                      {(order.line_items || []).map((li: any, i: number) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded-xl p-3 border border-slate-100">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{li.title}</p>
                            <p className="text-[11px] text-slate-500">
                              {li.variant_title && <span>{li.variant_title} · </span>}
                              {li.sku && <span>SKU: {li.sku} · </span>}
                              Qty: {li.quantity}
                            </p>
                          </div>
                          <p className="text-sm font-bold text-slate-700 ml-3">{(parseFloat(li.price) * li.quantity).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>

                    {/* Payment Note */}
                    {order.payment_note && (
                      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                        <p className="text-[10px] font-bold text-amber-600 uppercase">Payment Note</p>
                        <p className="text-sm text-amber-800 mt-0.5">{order.payment_note}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button onClick={() => openPaymentModal(order)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors">
                        <CreditCard size={16} /> Update Payment
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Payment Modal */}
      {paymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setPaymentModal(null)}>
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Update Payment</h3>
                <button onClick={() => setPaymentModal(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                  <X size={18} />
                </button>
              </div>
              <p className="text-sm text-slate-500 mt-1">{paymentModal.name} · {paymentModal.customer_name}</p>
              <p className="text-lg font-bold mt-2">Total: {parseFloat(paymentModal.total_price || '0').toFixed(2)} MAD</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Payment Status</label>
                <div className="flex gap-2">
                  {[{v:'unpaid',l:'Unpaid',c:'red'},{v:'partially_paid',l:'Partial',c:'amber'},{v:'paid',l:'Paid',c:'emerald'}].map(s => (
                    <button key={s.v} onClick={() => {
                      setPayStatus(s.v)
                      if (s.v === 'paid') setPayAmount(String(parseFloat(paymentModal.total_price || '0')))
                      if (s.v === 'unpaid') setPayAmount('0')
                    }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border-2 ${
                        payStatus === s.v
                          ? s.c === 'red' ? 'border-red-500 bg-red-50 text-red-600'
                          : s.c === 'amber' ? 'border-amber-500 bg-amber-50 text-amber-600'
                          : 'border-emerald-500 bg-emerald-50 text-emerald-600'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}>
                      {s.l}
                    </button>
                  ))}
                </div>
              </div>
              {payStatus !== 'unpaid' && (
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Amount Paid (MAD)</label>
                  <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00" step="0.01" />
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-2">Note (optional)</label>
                <textarea value={payNote} onChange={e => setPayNote(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2} placeholder="Any payment notes..." />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button onClick={() => setPaymentModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm">
                Cancel
              </button>
              <button onClick={savePayment} disabled={saving}
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
