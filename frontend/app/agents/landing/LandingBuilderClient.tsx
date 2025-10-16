"use client"
import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Check, Clipboard, Download, Upload, Sparkles, Globe } from "lucide-react"

const BRAND = { primary: "#004AAD", primarySoft: "#E8F0FF" }

export type Localized<T = string> = { ar: T; en: T }
export type LandingInput = {
  classification: string
  product_title: Localized
  product_title_variants?: Localized[]
  subtitle: Localized
  seo: { title: Localized; meta_description: Localized; slug: string }
  landing_page: {
    hero: { hook3: Localized; headline: Localized; subheadline: Localized; primary_cta: Localized; secondary_cta: Localized }
    benefits: { title: Localized; bullets: Localized[] }[]
    size_fit: { note: Localized; size_range: string; layering_tip: Localized }
    materials_care: { materials: string[]; care_instructions: string[]; skin_feel: Localized }
    social_proof: { summary: Localized; review_snippets: Localized[] }
    policies_trust: { delivery: string; payment: string; returns: string; badges: string[] }
    faq: { q: Localized; a: Localized }[]
    guarantee: { text: Localized }
    closing_cta: { headline: Localized; subheadline: Localized; button: Localized }
    gallery_prompts?: string[]
  }
  cta_labels?: { primary: Localized; secondary: Localized }
  keywords?: string[]
  checks?: Record<string, boolean>
}

const LANDING_SAMPLE: LandingInput = {
  classification: "kids",
  product_title: { ar: "جاكيت خفيف مطرّز للأطفال — دافئ وأنيق وسهل اللبس", en: "Kids Embroidered Light Jacket — Warm, Elegant, Easy-Zip" },
  product_title_variants: [
    { ar: "سترة أطفال عملية — خفيفة، دافئة، وسهلة السحاب", en: "Everyday Kids Jacket — Lightweight, Warm, Easy Zip" },
    { ar: "جاكيت أطفال غير محبوك — راحة وأناقة بطبقات ربيعية/خريفية", en: "Kids Layering Jacket — Comfy Elegance for Spring/Autumn" },
  ],
  subtitle: {
    ar: "دفء بلا ثِقل، قماش ناعم لا يسبّب الحكة، وألوان تناسب البنات والأولاد من 9 أشهر حتى 10 سنوات.",
    en: "Warmth without bulk, itch‑free soft feel, and colors for boys and girls from 9m to 10y.",
  },
  seo: {
    title: { ar: "جاكيت أطفال خفيف ودافئ بسحاب سهل | Irrakids", en: "Kids Light Warm Jacket with Easy Zip | Irrakids" },
    meta_description: { ar: "سترة أطفال خفيفة ودافئة بطبقات ربيعية/خريفية، قماش ناعم وتنفس، تطريز فاخر، توصيل سريع 24–48 ساعة والدفع عند الاستلام.", en: "Light, warm kids jacket for spring/autumn layering. Soft, breathable, premium embroidery. 24–48h delivery + Cash on Delivery." },
    slug: "kids-light-warm-embroidered-jacket-easy-zip",
  },
  landing_page: {
    hero: {
      hook3: { ar: "أنيق. مريح. دافئ.", en: "Elegant. Comfy. Warm." },
      headline: { ar: "سترة يومية تُشعر طفلك بالدفء وتُظهر أناقته — للبنات والأولاد", en: "An everyday jacket that keeps kids warm and looking sharp — unisex" },
      subheadline: { ar: "قماش خفيف يتنفّس بلا تعرّق...", en: "Lightweight, breathable warmth without sweat..." },
      primary_cta: { ar: "تسوق الآن", en: "Shop Now" },
      secondary_cta: { ar: "دليل المقاسات", en: "Size Guide" },
    },
    benefits: [
      { title: { ar: "دفء بلا انتفاخ", en: "Warmth without Bulk" }, bullets: [ { ar: "يحارب...", en: "Beats heavy..." }, { ar: "خفيف...", en: "Light with comfy..." } ] },
    ],
    size_fit: { note: { ar: "قياس مريح...", en: "Comfortable fit..." }, size_range: "9m–10y", layering_tip: { ar: "يناسب...", en: "Pairs with..." } },
    materials_care: { materials: ["Soft, durable, breathable fabric"], care_instructions: ["Machine wash cold, gentle cycle"], skin_feel: { ar: "ملمس ناعم...", en: "Soft, skin-kind..." } },
    social_proof: { summary: { ar: "مفضلة لدى الأمهات...", en: "A parent favorite..." }, review_snippets: [ { ar: '"أخيرًا جاكيت..."', en: "“Finally a jacket...”" } ] },
    policies_trust: { delivery: "Fast 24–48h delivery...", payment: "Cash on Delivery...", returns: "Easy exchanges...", badges: ["24–48h Delivery", "Cash on Delivery", "Secure Checkout"] },
    faq: [ { q: { ar: "سؤال؟", en: "Question?" }, a: { ar: "جواب.", en: "Answer." } } ],
    guarantee: { text: { ar: "جرّبوه براحة...", en: "Try it with confidence..." } },
    closing_cta: { headline: { ar: "دفءٌ يليق...", en: "Comfort and elegance..." }, subheadline: { ar: "توصيل سريع...", en: "Fast 24–48h delivery..." }, button: { ar: "تسوق الآن", en: "Shop Now" } },
  },
  cta_labels: { primary: { ar: "تسوق الآن", en: "Shop Now" }, secondary: { ar: "دليل المقاسات", en: "Size Guide" } },
}

const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast.success("Copied to clipboard") }
const escapeHtml = (s: any) => {
  const str = (s ?? "").toString()
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;")
}
const isLandingInput = (x: any): x is LandingInput => { try { return Boolean(x && x.landing_page && x.seo && x.landing_page.hero) } catch { return false } }

// Normalize any value (string or Localized) into a Localized object
const toLocalized = (v: any): Localized<string> => {
  if (v && typeof v === "object" && ("en" in v || "ar" in v)) {
    const en = v.en ?? v.ar ?? ""
    const ar = v.ar ?? v.en ?? ""
    return { en: en?.toString?.() ?? "", ar: ar?.toString?.() ?? "" }
  }
  const s = v?.toString?.() ?? ""
  return { en: s, ar: s }
}

function buildLandingHTML(data: LandingInput, lang: "ar" | "en" = "en") {
  const dir = lang === "ar" ? "rtl" : "ltr"
  const t = (val: any) => escapeHtml(toLocalized(val)[lang])
  const title = t(data.seo?.title)
  const desc = t(data.seo?.meta_description)
  const hook = t(data.landing_page?.hero?.hook3)
  const headline = t(data.landing_page?.hero?.headline)
  const subheadline = t(data.landing_page?.hero?.subheadline)
  const pcta = t(data.landing_page?.hero?.primary_cta)
  const scta = t(data.landing_page?.hero?.secondary_cta)
  const subtitle = t(data.subtitle)

  const benefits = (data.landing_page?.benefits || []).map((b: any) => `
    <div class="benefit">
      <h3>${t(b?.title)}</h3>
      <ul>${(b?.bullets || []).map((bl:any)=>`<li>${t(bl)}</li>`).join("")}</ul>
    </div>
  `).join("")

  const faq = (data.landing_page?.faq || []).map((f:any)=> `
    <details><summary>${t(f?.q)}</summary><p>${t(f?.a)}</p></details>
  `).join("")

  const materials = (data.landing_page?.materials_care?.materials || []).map((m:any)=>`<li>${escapeHtml(m)}</li>`).join("")
  const care = (data.landing_page?.materials_care?.care_instructions || []).map((m:any)=>`<li>${escapeHtml(m)}</li>`).join("")
  const badges = (data.landing_page?.policies_trust?.badges || []).map((b:any)=>`<span class="badge">${escapeHtml(b)}</span>`).join("")

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title><meta name="description" content="${desc}"/>
<link rel="canonical" href="/${escapeHtml(data.seo.slug)}"/>
<style>
:root{--brand:${BRAND.primary};--brand-soft:${BRAND.primarySoft};--ink:#0f172a;--muted:#64748b}
*{box-sizing:border-box} body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;margin:0;color:var(--ink)}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
.hero{display:grid;gap:16px;padding:24px;border-radius:20px;background:linear-gradient(135deg,var(--brand-soft),#fff)}
.hook{font-weight:700;letter-spacing:.02em;color:var(--brand)} h1{margin:4px 0 8px;font-size:clamp(24px,3.6vw,40px)} .sub{color:var(--muted)}
.cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px} .btn{padding:10px 16px;border-radius:12px;border:1px solid transparent;font-weight:600;cursor:pointer}
.btn-primary{background:var(--brand);color:#fff} .btn-outline{background:#fff;border-color:#e2e8f0;color:var(--ink)}
.grid{display:grid;gap:16px} .grid-2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))} .section{margin-top:28px}
.benefit{padding:16px;border:1px solid #e2e8f0;border-radius:16px;background:#fff} .kicker{font-size:12px;color:var(--muted);margin-bottom:6px} .card{padding:16px;border:1px solid #e2e8f0;border-radius:16px;background:#fff}
.badge{display:inline-block;padding:6px 10px;border-radius:999px;background:var(--brand-soft);color:var(--brand);font-size:12px;margin-right:8px}
footer{margin:32px 0;color:var(--muted);font-size:14px}
</style></head>
<body><main class="wrap">
<section class="hero"><span class="hook">${hook}</span><h1>${headline}</h1><p class="sub">${subheadline}</p><p>${subtitle}</p>
<div class="cta-row"><a href="#buy" class="btn btn-primary">${pcta}</a><a href="#size" class="btn btn-outline">${scta}</a></div></section>
<section class="section"><div class="grid grid-2">${benefits}</div></section>
<section id="size" class="section grid grid-2"><div class="card"><div class="kicker">Size & Fit</div>
<p>${t(data.landing_page?.size_fit?.note)}</p><p><strong>Range:</strong> ${escapeHtml(data.landing_page?.size_fit?.size_range || "")}</p>
<p>${t(data.landing_page?.size_fit?.layering_tip)}</p></div>
<div class="card"><div class="kicker">Materials & Care</div><ul>${materials}</ul><ul>${care}</ul>
<p>${t(data.landing_page?.materials_care?.skin_feel)}</p></div></section>
<section class="section card"><div class="kicker">Why parents love it</div>
<p>${t(data.landing_page?.social_proof?.summary)}</p>
<ul>${(data.landing_page?.social_proof?.review_snippets || []).map((r:any)=>`<li>${t(r)}</li>`).join("")}</ul>
<div style="margin-top:8px">${badges}</div></section>
<section class="section"><h2>${t(data.landing_page?.closing_cta?.headline)}</h2>
<p class="sub">${t(data.landing_page?.closing_cta?.subheadline)}</p>
<div class="cta-row"><a class="btn btn-primary" href="#buy">${t(data.landing_page?.closing_cta?.button)}</a></div></section>
<footer>© Irrakids</footer>
</main></body></html>`
}

export default function LandingOnlyBuilder() {
  const [payloadRaw, setPayloadRaw] = useState<string>(JSON.stringify(LANDING_SAMPLE, null, 2))
  const [lang, setLang] = useState<"en" | "ar">("en")
  const [srcDoc, setSrcDoc] = useState<string>("")

  const generateHTML = () => {
    try {
      const obj = JSON.parse(payloadRaw)
      if (!isLandingInput(obj)) {
        // Try to coerce minimal compatible shapes (string fields -> Localized)
        // This keeps UX friendly for simpler agent outputs
        if (!obj?.landing_page || !obj?.seo) throw new Error("Missing landing_page or seo section")
      }
      const html = buildLandingHTML(obj, lang)
      setSrcDoc(html)
      toast.success("Landing HTML generated")
    } catch (e: any) {
      setSrcDoc("")
      toast.error(`Invalid Landing JSON: ${e.message}`)
    }
  }

  const downloadHTML = () => {
    if (!srcDoc) return toast.error("Generate HTML first")
    const blob = new Blob([srcDoc], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `landing-${lang}-${Date.now()}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-slate-50">
      <div className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl" style={{ background: BRAND.primary }} />
            <div>
              <div className="text-sm text-slate-500">Irrakids Creative</div>
              <h1 className="text-xl font-bold tracking-tight">Landing Page Builder</h1>
            </div>
            <Badge className="ml-3" style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>v4.0</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={lang === 'en' ? 'default' : 'outline'} className="rounded-xl" onClick={() => setLang('en')}><Globe className="h-4 w-4 mr-2"/>English</Button>
            <Button variant={lang === 'ar' ? 'default' : 'outline'} className="rounded-xl" onClick={() => setLang('ar')}>العربية</Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">Landing JSON</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <Button variant="outline" className="rounded-xl" onClick={()=>setPayloadRaw(JSON.stringify(LANDING_SAMPLE, null, 2))}><Upload className="h-4 w-4 mr-2"/>Load sample</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>copy(payloadRaw)}><Clipboard className="h-4 w-4 mr-2"/>Copy</Button>
              </div>
              <Textarea value={payloadRaw} onChange={(e)=>setPayloadRaw(e.target.value)} className="min-h-[420px] rounded-xl font-mono"/>
              <div className="flex items-center gap-2 mt-3">
                <Button className="rounded-xl" onClick={generateHTML}><Sparkles className="h-4 w-4 mr-2"/>Generate HTML</Button>
                <Button variant="outline" className="rounded-xl" onClick={downloadHTML}><Download className="h-4 w-4 mr-2"/>Download HTML</Button>
              </div>
              <div className="text-xs text-slate-500 mt-2">Standalone HTML with inline CSS, SEO tags, and RTL for Arabic.</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">Quick Tests</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-2">
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const obj = JSON.parse(payloadRaw) as LandingInput
                    const ok = isLandingInput(obj)
                    toast[ok?"success":"error"](ok?"L1: payload matches LandingInput":"L1 failed")
                  }catch(e:any){ toast.error(`L1 error: ${e.message}`)} }}><Check className="h-4 w-4 mr-2"/>L1</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const html = buildLandingHTML(JSON.parse(payloadRaw), 'en')
                    const ok = html.includes('<title>') && html.includes('canonical')
                    toast[ok?"success":"error"](ok?"L2: HTML has title & canonical":"L2 failed")
                  }catch(e:any){ toast.error(`L2 error: ${e.message}`)} }}><Check className="h-4 w-4 mr-2"/>L2</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const html = buildLandingHTML(JSON.parse(payloadRaw), 'ar')
                    const ok = html.includes('dir="rtl"')
                    toast[ok?"success":"error"](ok?"L3: Arabic RTL set":"L3 failed")
                  }catch(e:any){ toast.error(`L3 error: ${e.message}`)} }}><Check className="h-4 w-4 mr-2"/>L3</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-xl border overflow-hidden">
                {srcDoc ? (
                  <iframe title="Landing Preview" srcDoc={srcDoc} style={{ width: '100%', height: 640, border: '0' }} />
                ) : (
                  <div className="p-6 text-sm text-slate-500">Paste JSON and click <strong>Generate HTML</strong> to see the live preview.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-10 border-t">
        <div className="mx-auto max-w-7xl px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="text-sm text-slate-500">Built for fast product launches · Landing-only workflow</div>
          <div className="flex items-center gap-2 text-xs">
            <Badge style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>Landing</Badge>
            <Badge variant="secondary">Preview</Badge>
          </div>
        </div>
      </div>
    </div>
  )
}


