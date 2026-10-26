'use client'

import { useRef, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Loader2, MessageCircle, QrCode, Users } from 'lucide-react'
import ChatInbox from './chat/ChatInbox'
import { Me } from './chat/chatApi'
import { CustomerDialog } from './customer/CustomerUi'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
export type CustomerMerchantSelection = { kind: 'vendor' | 'seller'; account_id: string; locator?: string }
type Invite = { invite: string; token?: string; registration_path?: string; expires_at?: string; merchant: { name: string } }

export async function merchantCustomerRequest<T>(path: string, body?: object, role: 'vendor' | 'seller' | 'admin' = 'vendor'): Promise<T> {
  const token = role === 'vendor' ? '' : localStorage.getItem(role === 'seller' ? 'ptos_affiliate_token' : 'ptos_system_admin_token') || ''
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(API + '/api/customers' + path, {
      method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    if (!response.ok || result.error || result.detail) {
      const detail = result.detail || result
      const message = typeof detail === 'string' ? detail : detail.message || detail.error || result.error || `Request failed (${response.status})`
      throw new Error(message)
    }
    return result.data as T
  } finally { clearTimeout(timer) }
}

export default function CustomerMerchantTools({ kind, lang = 'en', merchantName = '', selection, showChat = false }: {
  kind: 'vendor' | 'seller'; lang?: 'en' | 'ar'; merchantName?: string
  selection?: CustomerMerchantSelection; showChat?: boolean
}) {
  const ar = lang === 'ar', t = (en: string, arabic: string) => ar ? arabic : en
  const [invitation, setInvitation] = useState<Invite | null>(null)
  const [link, setLink] = useState(''), [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false), [chatBusy, setChatBusy] = useState(false)
  const [error, setError] = useState(''), [copied, setCopied] = useState(false), [manualCopy, setManualCopy] = useState(false)
  const [chatIdentity, setChatIdentity] = useState<Me | null>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  const requestRole = selection ? 'admin' : kind

  async function generate() {
    if (busy) return
    setBusy(true); setError(''); setCopied(false); setManualCopy(false)
    try {
      const result = await merchantCustomerRequest<Invite>('/merchant/invites', selection || {}, requestRole)
      const token = result.invite || result.token
      if (!token) throw new Error(t('The invitation could not be created.', 'تعذر إنشاء الدعوة.'))
      const url = new URL('/customer/', window.location.origin)
      url.searchParams.set('invite', token)
      const QRCode = await import('qrcode')
      const image = await QRCode.toDataURL(url.toString(), { width: 768, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#052e16', light: '#ffffff' } })
      setInvitation(result); setLink(url.toString()); setQr(image)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setError(/account_setup_required/.test(message)
        ? t('Sign out and sign back in once to prepare your customer invitation.', 'سجل الخروج ثم الدخول مرة واحدة لتجهيز دعوة العملاء.')
        : /sign_in|required|unauthorized/.test(message) ? t('Please sign in again to create an invitation.', 'يرجى تسجيل الدخول مجدداً لإنشاء دعوة.')
          : ar ? 'تعذر تجهيز الدعوة. حاول مجدداً.' : message || 'The invitation could not be prepared. Please try again.')
    } finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setManualCopy(false) }
    catch { linkInput.current?.focus(); linkInput.current?.select(); setManualCopy(true) }
  }
  async function openChat() {
    if (chatBusy) return
    setChatBusy(true); setError('')
    try {
      const identity = await merchantCustomerRequest<Me & { chat_id?: string }>('/merchant/chat-session', {}, requestRole)
      setChatIdentity({ ...identity, id: identity.chat_id || identity.id })
    } catch { setError(t('Customer messages could not open. Please sign in again.', 'تعذر فتح رسائل العملاء. يرجى تسجيل الدخول مجدداً.')) }
    finally { setChatBusy(false) }
  }
  return <section dir={ar ? 'rtl' : 'ltr'} className="mb-5 rounded-3xl border border-emerald-100 bg-white p-5 text-slate-900 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Users size={22} /></span><div><h2 className="font-black">{t('Invite your customers', 'دعوة عملائك')}</h2><p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">{t('Customers scan your QR code, create a phone account, then shop and chat directly with you.', 'يمسح العملاء رمز QR لإنشاء حساب برقم الهاتف ثم يتسوقون ويتواصلون معك مباشرة.')}</p></div></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void generate()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-bold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={17} />}{invitation ? t('Show invitation', 'عرض الدعوة') : t('Get my QR code', 'رمز QR الخاص بي')}</button>{showChat && <button type="button" disabled={chatBusy} onClick={() => void openChat()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 px-4 py-3 text-xs font-bold text-emerald-800 disabled:opacity-50">{chatBusy ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={17} />}{t('Customer messages', 'رسائل العملاء')}</button>}</div></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    {invitation && qr && <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 sm:grid-cols-[200px_1fr]"><div><img src={qr} alt={t('Customer registration QR code for ', 'رمز تسجيل العملاء لدى ') + (invitation.merchant?.name || merchantName)} className="mx-auto aspect-square w-52 rounded-2xl border border-slate-100 bg-white p-1" /><a href={qr} download="customer-invitation.png" className="mt-3 flex min-h-10 items-center justify-center gap-2 text-xs font-bold text-emerald-700"><Download size={15} />{t('Save QR image', 'حفظ صورة QR')}</a></div><div className="min-w-0 self-center"><p className="text-lg font-black">{invitation.merchant?.name || merchantName}</p><p className="mt-2 text-sm leading-relaxed text-slate-500">{t('Show this code at your shop, or copy the invitation link to share with a customer.', 'اعرض هذا الرمز في متجرك أو انسخ رابط الدعوة لمشاركته مع العميل.')}</p><label className="mt-4 block text-xs font-bold text-slate-500">{t('Customer invitation link', 'رابط دعوة العملاء')}<input ref={linkInput} value={link} readOnly dir="ltr" onFocus={event => event.target.select()} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600 outline-none focus:border-emerald-500" /></label><div className="mt-3 flex gap-2"><button type="button" onClick={() => void copy()} className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? t('Copied', 'تم النسخ') : t('Copy link', 'نسخ الرابط')}</button><a href={link} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600"><ExternalLink size={14} />{t('Open', 'فتح')}</a></div>{manualCopy && <p role="status" className="mt-2 text-xs text-amber-700">{t('Copy the selected link using your browser.', 'انسخ الرابط المحدد باستعمال المتصفح.')}</p>}{invitation.expires_at && <p className="mt-3 text-[11px] text-slate-400">{t('Valid until ', 'صالح إلى ')}{new Date(invitation.expires_at).toLocaleDateString(ar ? 'ar-MA' : 'en-GB', { timeZone: 'Africa/Casablanca', day: 'numeric', month: 'short', year: 'numeric' })}</p>}</div></div>}
    {chatIdentity && <CustomerDialog title={t('Customer messages', 'رسائل العملاء')} closeLabel={t('Close', 'إغلاق')} onClose={() => setChatIdentity(null)}><div className="h-[65dvh] min-h-80"><ChatInbox key={chatIdentity.id} me={chatIdentity} hideProductTools framed={false} heightClass="h-full" className="h-full" /></div></CustomerDialog>}
  </section>
}
