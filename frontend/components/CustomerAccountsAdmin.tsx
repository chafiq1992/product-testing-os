'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Eye, EyeOff, Loader2, RefreshCw, Search, UserPlus, Users } from 'lucide-react'
import { Customer } from '../lib/customer'
import CustomerMerchantTools, { CustomerMerchantSelection, merchantCustomerRequest } from './CustomerMerchantTools'
import { customerButton, customerField } from './customer/CustomerUi'

type AdminMerchant = { ref: string; name: string; kind: 'vendor' | 'seller'; account_id?: string; locator?: string }

export default function CustomerAccountsAdmin() {
  const [accounts, setAccounts] = useState<Customer[]>([]), [merchants, setMerchants] = useState<AdminMerchant[]>([])
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([]), [inviteRef, setInviteRef] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', password: '', password_confirm: '' })
  async function load() {
    setLoading(true); setError('')
    const results = await Promise.allSettled([
      merchantCustomerRequest<Customer[]>('/admin/accounts', undefined, 'admin'),
      merchantCustomerRequest<AdminMerchant[]>('/admin/merchants', undefined, 'admin'),
    ])
    if (results[0].status === 'fulfilled') setAccounts(results[0].value || [])
    if (results[1].status === 'fulfilled') setMerchants(results[1].value || [])
    if (results.some(result => result.status === 'rejected')) setError('Customer accounts could not load. Sign in as an operator, then refresh this section.')
    setLoading(false)
  }
  useEffect(() => { void load() }, [])
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (busy) return
    setError(''); setNotice('')
    if (form.password !== form.password_confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    try {
      const account = await merchantCustomerRequest<Customer>('/admin/accounts', { ...form, name: form.name.trim(), phone: form.phone.trim(), merchant_refs: selected }, 'admin')
      setAccounts(previous => [account, ...previous]); setForm({ name: '', phone: '', password: '', password_confirm: '' }); setSelected([])
      setNotice(`Customer account created for ${account.phone}. They can sign in at the Customer portal.`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setError(/phone_already_registered/.test(message) ? 'This phone already has a customer account. Creating another account would reuse its identity.' : message || 'The customer account could not be created.')
    } finally { setBusy(false) }
  }
  const inviteMerchant = merchants.find(merchant => merchant.ref === inviteRef)
  const selection: CustomerMerchantSelection | undefined = inviteMerchant?.account_id ? { kind: inviteMerchant.kind, account_id: inviteMerchant.account_id, locator: inviteMerchant.locator } : undefined
  const filtered = accounts.filter(account => `${account.name || ''} ${account.phone}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="rounded-3xl border border-emerald-100 bg-white p-6 text-slate-900 shadow-sm md:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-3 text-lg font-black"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><Users size={20} /></span>Customer accounts</h2><p className="mt-2 text-xs text-slate-500">Create a phone login, connect merchants and prepare their registration QR codes.</p></div><div className="flex gap-2"><Link href="/customer/" className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600">Customer portal</Link><button type="button" disabled={loading} onClick={() => void load()} aria-label="Refresh customer accounts" className="rounded-xl border border-slate-200 p-3 text-slate-500"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div></div>
    {error && <p role="alert" className="mb-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="mb-5 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 size={18} />{notice}</p>}
    <form onSubmit={create} className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 sm:p-5"><h3 className="flex items-center gap-2 text-sm font-black"><UserPlus size={17} />Create customer login</h3><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-500">Name (optional)<input value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} maxLength={160} disabled={busy} autoComplete="off" className={`${customerField} mt-2`} /></label><label className="text-xs font-bold text-slate-500">Phone number<input value={form.phone} onChange={event => setForm(previous => ({ ...previous, phone: event.target.value }))} type="tel" dir="ltr" required maxLength={40} disabled={busy} autoComplete="off" placeholder="06 12 34 56 78" className={`${customerField} mt-2`} /></label><label className="text-xs font-bold text-slate-500">Password<span className="relative mt-2 block"><input value={form.password} onChange={event => setForm(previous => ({ ...previous, password: event.target.value }))} type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} required disabled={busy} autoComplete="new-password" className={`${customerField} pe-12`} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute end-3 top-3.5 text-slate-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label><label className="text-xs font-bold text-slate-500">Repeat password<input value={form.password_confirm} onChange={event => setForm(previous => ({ ...previous, password_confirm: event.target.value }))} type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} required disabled={busy} autoComplete="new-password" className={`${customerField} mt-2`} /></label></div>
      <fieldset><legend className="mb-2 text-xs font-bold text-slate-500">Connect merchants (optional)</legend><div className="max-h-44 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2">{loading ? <p className="p-3 text-xs text-slate-400">Loading merchants…</p> : !merchants.length ? <p className="p-3 text-xs text-slate-400">No merchants available. Refresh after signing in.</p> : merchants.map(merchant => <label key={merchant.ref} className="flex cursor-pointer items-center gap-3 rounded-xl p-3 text-sm hover:bg-emerald-50"><input type="checkbox" checked={selected.includes(merchant.ref)} disabled={busy || (!selected.includes(merchant.ref) && selected.length >= 100)} onChange={event => setSelected(previous => event.target.checked ? [...previous, merchant.ref] : previous.filter(ref => ref !== merchant.ref))} className="h-4 w-4 accent-emerald-700" /><span className="font-semibold">{merchant.name}</span><span className="ms-auto rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">{merchant.kind === 'seller' ? 'Seller' : 'Vendor'}</span></label>)}</div></fieldset><button disabled={busy || loading} className={customerButton}>{busy ? <Loader2 size={17} className="animate-spin" /> : <UserPlus size={17} />}Create customer account</button>
    </form>
    <div className="my-6 border-t border-slate-100 pt-6"><label className="block text-xs font-bold text-slate-500">Prepare a merchant invitation<select value={inviteRef} onChange={event => setInviteRef(event.target.value)} className={`${customerField} mt-2`}><option value="">Choose a merchant</option>{merchants.map(merchant => <option key={merchant.ref} value={merchant.ref}>{merchant.name} · {merchant.kind === 'seller' ? 'Seller' : 'Vendor'}</option>)}</select></label>{selection && inviteMerchant ? <div className="mt-4"><CustomerMerchantTools key={inviteMerchant.ref} kind={inviteMerchant.kind} merchantName={inviteMerchant.name} selection={selection} /></div> : inviteMerchant && <p className="mt-3 text-xs text-amber-700">Refresh merchants to load this account’s invitation details.</p>}</div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-black">Customers <span className="ms-2 text-xs font-medium text-slate-400">{accounts.length}</span></h3><label className="relative"><Search size={15} className="absolute start-3 top-3 text-slate-400" /><input aria-label="Find customer by name or phone" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or phone" className="h-10 rounded-xl border border-slate-200 bg-slate-50 pe-3 ps-9 text-xs outline-none focus:border-emerald-500" /></label></div><div className="max-h-80 overflow-y-auto divide-y divide-slate-100">{loading && !accounts.length ? <div className="flex justify-center py-8"><Loader2 className="animate-spin text-emerald-600" size={24} /></div> : !filtered.length ? <p className="py-7 text-center text-sm text-slate-400">No customer accounts found.</p> : filtered.map(account => <div key={account.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-bold">{account.name || 'Customer'}</p><p dir="ltr" className="mt-1 text-xs text-slate-400">{account.phone}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700">Customer</span></div>)}</div>
  </section>
}
