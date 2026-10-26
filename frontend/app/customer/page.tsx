'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronRight, Eye, EyeOff, Globe2, Link2, Loader2, LogOut, MessageCircle, QrCode, ShieldCheck, ShoppingBag, ShoppingBasket, Store } from 'lucide-react'
import ChatInbox from '../../components/chat/ChatInbox'
import CustomerOrders from '../../components/customer/CustomerOrders'
import CustomerStorefront from '../../components/customer/CustomerStorefront'
import { CustomerPhoto, customerButton, customerField } from '../../components/customer/CustomerUi'
import { Customer, CustomerApiError, CustomerMerchant, customerApi, customerError } from '../../lib/customer'

type Lang = 'en' | 'ar'
type Tab = 'shops' | 'orders' | 'chat'

export default function CustomerPage() {
  const [lang, setLang] = useState<Lang>('en')
  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [merchants, setMerchants] = useState<CustomerMerchant[]>([])
  const [merchantsLoading, setMerchantsLoading] = useState(false)
  const [selected, setSelected] = useState<CustomerMerchant | null>(null)
  const [chatMerchant, setChatMerchant] = useState<CustomerMerchant | null>(null)
  const [tab, setTab] = useState<Tab>('shops')
  const [invite, setInvite] = useState('')
  const [inviteMerchant, setInviteMerchant] = useState<CustomerMerchant | null>(null)
  const [inviteError, setInviteError] = useState('')
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(false)
  const [ordersVersion, setOrdersVersion] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  const ar = lang === 'ar', t = (en: string, arabic: string) => ar ? arabic : en

  useEffect(() => {
    try { const saved = localStorage.getItem('customer-language'); if (saved === 'ar' || saved === 'en') setLang(saved) } catch {}
    const token = new URLSearchParams(window.location.search).get('invite') || ''
    setInvite(token)
    if (token) customerApi.invitation(token).then(result => setInviteMerchant('merchant' in result ? result.merchant : result)).catch(cause => setInviteError(customerError(cause, lang)))
    customerApi.me().then(setCustomer).catch(cause => {
      if (!(cause instanceof CustomerApiError && cause.status === 401)) setError(customerError(cause, lang))
    }).finally(() => setLoading(false))
  }, [])
  async function reloadMerchants() {
    setMerchantsLoading(true); setError('')
    try { setMerchants(await customerApi.merchants() || []) }
    catch (cause) { setError(customerError(cause, lang)) }
    finally { setMerchantsLoading(false) }
  }
  useEffect(() => { if (customer) void reloadMerchants() }, [customer?.id])
  function language(next: Lang) { setLang(next); try { localStorage.setItem('customer-language', next) } catch {} }
  function authenticated(value: Customer) {
    setCustomer(value); setError(''); setSelected(null); setChatMerchant(null); setTab('shops')
  }
  function chat(merchant: CustomerMerchant) { setChatMerchant(merchant); setTab('chat') }
  async function connectInvite() {
    if (!invite || !inviteMerchant || linking) return
    setLinking(true); setError('')
    try { await customerApi.link(invite); await reloadMerchants(); setInviteMerchant(null) }
    catch (cause) { setError(customerError(cause, lang)) }
    finally { setLinking(false) }
  }
  async function logout() {
    if (signingOut) return
    setSigningOut(true); setError('')
    try {
      await customerApi.logout(); setCustomer(null); setMerchants([]); setSelected(null); setChatMerchant(null); setTab('shops')
    } catch (cause) { setError(customerError(cause, lang)) }
    finally { setSigningOut(false) }
  }
  const linkedInvite = inviteMerchant && merchants.some(merchant => merchant.ref === inviteMerchant.ref)

  return <div dir={ar ? 'rtl' : 'ltr'} className="min-h-[100dvh] bg-[#f5f8f5] text-slate-900" style={{ fontFamily: ar ? "'Tajawal', 'Noto Sans Arabic', system-ui, sans-serif" : "'Inter', system-ui, sans-serif" }}>
    <header className="sticky top-0 z-30 border-b border-emerald-100/70 bg-white/95 backdrop-blur-lg"><div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-7"><button type="button" onClick={() => { setTab('shops'); setSelected(null) }} className="flex items-center gap-2.5 text-start"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-800 text-white"><ShoppingBasket size={23} /></span><span><strong className="block text-base font-black tracking-tight">{t('Your shops', 'متاجرك')}</strong><span className="block text-[10px] font-semibold tracking-wider text-slate-400">{t('GOOD THINGS, CLOSE TO HOME', 'كل ما تحتاجه من متاجرك')}</span></span></button><div className="flex items-center gap-2"><button type="button" onClick={() => language(ar ? 'en' : 'ar')} aria-label={t('Switch to Arabic', 'التغيير إلى الإنجليزية')} className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600"><Globe2 size={15} />{ar ? 'EN' : 'العربية'}</button>{customer && <button type="button" disabled={signingOut} onClick={() => void logout()} aria-label={t('Sign out', 'تسجيل الخروج')} className="rounded-xl p-2.5 text-slate-400 hover:bg-slate-100">{signingOut ? <Loader2 size={19} className="animate-spin" /> : <LogOut size={19} />}</button>}</div></div></header>
    {loading ? <div className="flex flex-col items-center gap-4 py-28"><Loader2 size={32} className="animate-spin text-emerald-600" /><p className="text-sm text-slate-500">{t('Getting your shops ready…', 'جاري تجهيز متاجرك…')}</p></div>
      : !customer ? <CustomerAuthentication lang={lang} invite={inviteMerchant ? invite : ''} merchant={inviteMerchant} inviteError={inviteError} initialError={error} onAuthenticated={authenticated} />
        : <>
          {tab !== 'chat' && <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-7 sm:pt-8">
            {error && <p role="alert" className="mb-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
            {inviteMerchant && !linkedInvite && <section className="mb-6 flex flex-col justify-between gap-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center"><div className="flex gap-3"><Link2 size={22} className="mt-1 shrink-0 text-emerald-700" /><div><p className="font-black">{t('Add ', 'إضافة ') + inviteMerchant.name}</p><p className="mt-1 text-sm text-emerald-800/70">{t('Keep this merchant with your shops and order directly.', 'احتفظ بهذا التاجر ضمن متاجرك واطلب مباشرة.')}</p></div></div><button type="button" disabled={linking} onClick={() => void connectInvite()} className={customerButton}>{linking ? <Loader2 size={17} className="animate-spin" /> : <PlusShop />}{t('Add this shop', 'أضف هذا المتجر')}</button></section>}
            {tab === 'orders' ? <CustomerOrders key={customer.id} lang={lang} merchants={merchants} refreshKey={ordersVersion} onShop={() => { setTab('shops'); setSelected(null) }} onChat={chat} />
              : selected ? <CustomerStorefront key={`${customer.id}:${selected.ref}`} customer={customer} merchant={selected} lang={lang} onBack={() => setSelected(null)} onChat={chat} onOrders={() => { setOrdersVersion(version => version + 1); setTab('orders') }} onOrderPlaced={() => setOrdersVersion(version => version + 1)} />
                : <>
                  <section className="mb-7 rounded-3xl bg-emerald-900 p-6 text-white sm:p-9"><span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100"><ShieldCheck size={14} />{t('Your own account. Your own orders.', 'حسابك الخاص وطلباتك فقط.')}</span><h1 className="mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl">{customer.name ? t(`Hello, ${customer.name}.`, `مرحباً، ${customer.name}.`) : t('A little closer to your shops.', 'أقرب إلى متاجرك.')}</h1><p className="mt-3 max-w-lg text-sm leading-relaxed text-emerald-100/75">{t('Browse your merchants, fill a basket, and keep every order and conversation in one place.', 'تصفح متاجرك وأضف المنتجات إلى السلة وتابع طلباتك ومحادثاتك في مكان واحد.')}</p></section>
                  <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-black">{t('My shops', 'متاجري')}</h2><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-500">{merchants.length}</span></div>
                  {merchantsLoading && !merchants.length ? <div className="flex justify-center py-14"><Loader2 size={28} className="animate-spin text-emerald-600" /></div>
                    : !merchants.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center"><QrCode size={46} className="mx-auto mb-4 text-emerald-400" /><h3 className="text-lg font-black">{t('Your shops will appear here', 'ستظهر متاجرك هنا')}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">{t('Ask your merchant for their QR code or invitation link. Open it to connect your account.', 'اطلب من التاجر رمز QR أو رابط الدعوة وافتحه لربط حسابك بالمتجر.')}</p></div>
                      : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{merchants.map(merchant => <article key={merchant.ref} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"><button type="button" onClick={() => setSelected(merchant)} className="w-full text-start"><div className="mb-4 flex items-center justify-between gap-3"><CustomerPhoto src={merchant.avatar} title={merchant.name} className="h-20 w-20 rounded-2xl" /><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700">{t('Connected', 'مرتبط')}</span></div><h3 className="text-xl font-black">{merchant.name}</h3><p className="mt-1 text-xs text-slate-400">{merchant.account_type === 'grocery' ? t('Groceries & everyday essentials', 'البقالة والاحتياجات اليومية') : t('Shop directly with your merchant', 'تسوق مباشرة لدى التاجر')}</p><span className="mt-5 flex items-center justify-between text-sm font-bold text-emerald-800">{t('Browse products', 'تصفح المنتجات')}<ChevronRight size={19} className={ar ? 'rotate-180' : ''} /></span></button><button type="button" onClick={() => chat(merchant)} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-100 text-xs font-bold text-slate-500"><MessageCircle size={16} />{t('Chat with merchant', 'دردشة مع التاجر')}</button></article>)}</div>}
                </>}
          </main>}
          {tab === 'chat' && <section className="mx-auto h-[calc(100dvh-152px)] max-w-7xl bg-white sm:h-[calc(100dvh-164px)]">
            <ChatInbox key={`${customer.chat_id}:${chatMerchant?.chat_id || 'all'}`} me={{ id: customer.chat_id, handle: customer.phone, name: customer.name || customer.phone, kind: 'customer' }} {...(chatMerchant ? { initialPeer: { id: chatMerchant.chat_id, handle: chatMerchant.name, name: chatMerchant.name, avatar: chatMerchant.avatar || '', kind: chatMerchant.kind } } : {})} hideProductTools className="h-full" heightClass="h-full" framed={false} />
          </section>}
          <nav aria-label={t('Customer navigation', 'قائمة العميل')} className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:shadow-lg"><div className="mx-auto flex h-[76px] max-w-lg gap-2 px-4 sm:h-16 sm:gap-4">{([{ id: 'shops', icon: Store, en: 'My shops', arabic: 'متاجري' }, { id: 'orders', icon: ShoppingBag, en: 'My orders', arabic: 'طلباتي' }, { id: 'chat', icon: MessageCircle, en: 'Messages', arabic: 'الرسائل' }] as const).map(item => <button key={item.id} type="button" onClick={() => { setTab(item.id); if (item.id === 'orders') setOrdersVersion(version => version + 1) }} aria-current={tab === item.id ? 'page' : undefined} className={`flex min-w-20 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-5 text-[10px] font-bold transition sm:min-w-24 ${tab === item.id ? 'text-emerald-800' : 'text-slate-400'}`}><item.icon size={22} strokeWidth={tab === item.id ? 2.5 : 1.8} />{t(item.en, item.arabic)}</button>)}</div></nav>
        </>}
  </div>
}

function PlusShop() { return <Store size={17} /> }

function CustomerAuthentication({ lang, invite, merchant, inviteError, initialError, onAuthenticated }: {
  lang: Lang; invite: string; merchant: CustomerMerchant | null; inviteError: string; initialError: string
  onAuthenticated: (customer: Customer) => void
}) {
  const ar = lang === 'ar', t = (en: string, arabic: string) => ar ? arabic : en
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (invite) setMode('register') }, [invite])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return
    setError('')
    if (!phone.trim() || !password) { setError(t('Enter your phone number and password.', 'أدخل رقم هاتفك وكلمة المرور.')); return }
    if (mode === 'register' && (password.length < 8 || password.length > 128)) { setError(t('Use a password with 8–128 characters.', 'استعمل كلمة مرور من 8 إلى 128 حرفاً.')); return }
    if (mode === 'register' && password !== confirm) { setError(t('The two passwords do not match.', 'كلمتا المرور غير متطابقتين.')); return }
    if (mode === 'register' && !invite) { setError(t('Open your merchant’s invitation to create an account.', 'افتح دعوة التاجر لإنشاء حساب.')); return }
    setBusy(true)
    try {
      const customer = mode === 'register'
        ? await customerApi.register({ phone: phone.trim(), password, password_confirm: confirm, name: name.trim(), invite })
        : await customerApi.login({ phone: phone.trim(), password, ...(invite ? { invite } : {}) })
      onAuthenticated(customer)
    } catch (cause) { setError(customerError(cause, lang)) }
    finally { setBusy(false) }
  }
  return <main className="mx-auto grid min-h-[calc(100dvh-76px)] max-w-6xl items-center gap-8 px-4 py-8 sm:px-7 lg:grid-cols-2 lg:gap-20 lg:py-14">
    <section className="hidden lg:block"><span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-xs font-bold text-emerald-800"><ShoppingBasket size={16} />{t('A simpler way to shop', 'طريقة أسهل للتسوق')}</span><h1 className="mt-6 max-w-md text-5xl font-black leading-[1.1] tracking-tight text-emerald-950">{t('Your favourite shops. All in one place.', 'متاجرك المفضلة. في مكان واحد.')}</h1><p className="mt-5 max-w-md text-base leading-relaxed text-slate-500">{t('Choose products, order from your merchant and stay in touch. Your account keeps your shops and your own order history together.', 'اختر المنتجات واطلب من التاجر وتواصل معه. يحتفظ حسابك بمتاجرك وسجل طلباتك الخاصة.')}</p><div className="mt-8 space-y-4">{[t('Real products from your linked merchants', 'منتجات حقيقية من تجارك المرتبطين'), t('Your orders, saved in your account', 'طلباتك محفوظة في حسابك'), t('A direct conversation with each shop', 'محادثة مباشرة مع كل متجر')].map(label => <p key={label} className="flex items-center gap-3 text-sm font-semibold text-emerald-900"><CheckCircle2 size={19} className="text-emerald-600" />{label}</p>)}</div></section>
    <section className="mx-auto w-full max-w-md rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
      {merchant ? <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex items-center gap-3"><CustomerPhoto src={merchant.avatar} title={merchant.name} className="h-12 w-12 shrink-0 rounded-xl" /><div><p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">{t('You’re invited to', 'دعوة من متجر')}</p><p className="mt-1 font-black text-emerald-950">{merchant.name}</p></div></div><p className="mt-3 text-xs leading-relaxed text-emerald-800/70">{t('Create your account or sign in to connect this merchant.', 'أنشئ حسابك أو سجل الدخول لربط هذا التاجر.')}</p></div> : <div className="mb-6"><span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Store size={25} /></span><h1 className="text-2xl font-black">{t('Welcome back', 'مرحباً بعودتك')}</h1><p className="mt-2 text-sm text-slate-500">{t('Sign in to your shops and orders.', 'سجل الدخول إلى متاجرك وطلباتك.')}</p></div>}
      {merchant && <div className="mb-6 flex rounded-2xl bg-slate-100 p-1">{(['register', 'login'] as const).map(value => <button key={value} type="button" onClick={() => { setMode(value); setError('') }} className={`min-h-11 flex-1 rounded-xl text-sm font-bold ${mode === value ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-400'}`}>{value === 'register' ? t('Create account', 'إنشاء حساب') : t('Sign in', 'تسجيل الدخول')}</button>)}</div>}
      {(inviteError || initialError) && <p role="alert" className="mb-5 rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">{inviteError || initialError}</p>}
      <form onSubmit={submit} className="space-y-4">
        {mode === 'register' && <label className="block text-xs font-bold text-slate-500">{t('Your name (optional)', 'اسمك (اختياري)')}<input value={name} onChange={event => setName(event.target.value)} maxLength={160} autoComplete="name" disabled={busy} className={`${customerField} mt-2`} /></label>}
        <label className="block text-xs font-bold text-slate-500">{t('Phone number', 'رقم الهاتف')}<input type="tel" dir="ltr" value={phone} onChange={event => setPhone(event.target.value)} required autoComplete="tel" inputMode="tel" placeholder="06 12 34 56 78" maxLength={40} disabled={busy} className={`${customerField} mt-2`} /></label>
        <label className="block text-xs font-bold text-slate-500">{t('Password', 'كلمة المرور')}<span className="relative mt-2 block"><input type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={mode === 'register' ? 8 : undefined} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} disabled={busy} className={`${customerField} pe-12`} /><button type="button" onClick={() => setShow(value => !value)} aria-label={show ? t('Hide password', 'إخفاء كلمة المرور') : t('Show password', 'إظهار كلمة المرور')} className="absolute end-3 top-3.5 text-slate-400">{show ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
        {mode === 'register' && <label className="block text-xs font-bold text-slate-500">{t('Repeat password', 'تأكيد كلمة المرور')}<input type={show ? 'text' : 'password'} value={confirm} onChange={event => setConfirm(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} className={`${customerField} mt-2`} /></label>}
        {error && <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
        <button disabled={busy} className={`${customerButton} !mt-6 w-full`}>{busy ? <Loader2 className="animate-spin" size={20} /> : mode === 'register' ? t('Create my account', 'إنشاء حسابي') : t('Sign in', 'تسجيل الدخول')}{!busy && <ArrowRight size={18} className={ar ? 'rotate-180' : ''} />}</button>
      </form>
      {!merchant && !inviteError && <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-slate-400"><QrCode size={18} className="mt-0.5 shrink-0" />{t('New here? Scan your merchant’s QR code or open their invitation link to create an account.', 'جديد هنا؟ امسح رمز QR الخاص بالتاجر أو افتح رابط دعوته لإنشاء حساب.')}</p>}
    </section>
  </main>
}
