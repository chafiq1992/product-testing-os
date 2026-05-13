"use client"
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, Clipboard, Download, Upload, Sparkles, Globe } from "lucide-react";

// BRAND THEME
const BRAND = {
  primary: "#004AAD",
  primarySoft: "#E8F0FF",
};

// TYPES
export type Localized<T = string> = { ar: T; en: T };
export type LandingInput = {
  classification: string;
  product_title: Localized;
  product_title_variants?: Localized[];
  subtitle: Localized;
  seo: { title: Localized; meta_description: Localized; slug: string };
  landing_page: {
    hero: { hook3: Localized; headline: Localized; subheadline: Localized; primary_cta: Localized; secondary_cta: Localized };
    benefits: { title: Localized; bullets: Localized[] }[];
    size_fit: { note: Localized; size_range: string; layering_tip: Localized };
    materials_care: { materials: string[]; care_instructions: string[]; skin_feel: Localized };
    social_proof: { summary: Localized; review_snippets: Localized[] };
    policies_trust: { delivery: string; payment: string; returns: string; badges: string[] };
    faq: { q: Localized; a: Localized }[];
    guarantee: { text: Localized };
    closing_cta: { headline: Localized; subheadline: Localized; button: Localized };
    gallery_prompts?: string[];
  };
  cta_labels?: { primary: Localized; secondary: Localized };
  keywords?: string[];
  checks?: Record<string, boolean>;
};

// SAMPLE DATA
const LANDING_SAMPLE: LandingInput = {
  classification: "kids",
  product_title: {
    ar: "جاكيت خفيف مطرّز للأطفال — دافئ وأنيق وسهل اللبس",
    en: "Kids Embroidered Light Jacket — Warm, Elegant, Easy-Zip",
  },
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
};

// HELPERS
const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); };
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
const isLandingInput = (x: any): x is LandingInput => {
  try {
    return Boolean(x && x.product_title && x.landing_page && x.seo && x.landing_page.hero);
  } catch {
    return false;
  }
};

// ---------- Normalization helpers: accept flexible non-localized payloads ----------
const toLoc = (v: any): Localized => {
  if (!v && v !== "") return { en: "", ar: "" };
  if (typeof v === "string") return { en: v, ar: v };
  if (typeof v === "object" && ("en" in v || "ar" in v)) {
    return { en: v.en ?? v.ar ?? "", ar: v.ar ?? v.en ?? "" } as Localized;
  }
  return { en: String(v), ar: String(v) };
};
const toLocArray = (arr: any[]): Localized[] => (arr ?? []).map((it) => toLoc(it));
const toStringArray = (arr: any[]): string[] => (arr ?? []).map((it) => (typeof it === "string" ? it : String(it)));
const normalizeChecks = (c: any): Record<string, boolean> => {
  if (!c) return {};
  if (Array.isArray(c)) return Object.fromEntries(c.map((k) => [String(k), true]));
  if (typeof c === "object") return Object.fromEntries(Object.keys(c).map((k) => [k, Boolean(c[k])]))
  return {};
};

function normalizeLandingPayload(raw: any): LandingInput {
  const lp = raw.landing_page ?? {};
  const hero = lp.hero ?? {};
  const materials_care = lp.materials_care ?? {};
  const social = lp.social_proof ?? {};
  const policies = lp.policies_trust ?? {};

  const benefits = (lp.benefits ?? []).map((b: any) => ({
    title: toLoc(b.title ?? ""),
    bullets: Array.isArray(b.bullets)
      ? b.bullets.map((bl: any) => toLoc(bl))
      : [],
  }));

  const faq = (lp.faq ?? []).map((f: any) => ({
    q: toLoc(f.q ?? f.question ?? ""),
    a: toLoc(f.a ?? f.answer ?? ""),
  }));

  const product_title_variants: Localized[] = Array.isArray(raw.product_title_variants)
    ? toLocArray(raw.product_title_variants)
    : [];

  return {
    classification: raw.classification ?? "",
    product_title: toLoc(raw.product_title ?? ""),
    product_title_variants,
    subtitle: toLoc(raw.subtitle ?? ""),
    seo: {
      title: toLoc(raw.seo?.title ?? ""),
      meta_description: toLoc(raw.seo?.meta_description ?? ""),
      slug: raw.seo?.slug ?? "",
    },
    landing_page: {
      hero: {
        hook3: toLoc(hero.hook3 ?? ""),
        headline: toLoc(hero.headline ?? ""),
        subheadline: toLoc(hero.subheadline ?? ""),
        primary_cta: toLoc(hero.primary_cta ?? raw.cta_labels?.primary ?? "Shop Now"),
        secondary_cta: toLoc(hero.secondary_cta ?? raw.cta_labels?.secondary ?? "Size Guide"),
      },
      benefits,
      size_fit: {
        note: toLoc(lp.size_fit?.note ?? ""),
        size_range: lp.size_fit?.size_range ?? "",
        layering_tip: toLoc(lp.size_fit?.layering_tip ?? ""),
      },
      materials_care: {
        materials: toStringArray(materials_care.materials ?? []),
        care_instructions: toStringArray(materials_care.care_instructions ?? []),
        skin_feel: toLoc(materials_care.skin_feel ?? ""),
      },
      social_proof: {
        summary: toLoc(social.summary ?? ""),
        review_snippets: toLocArray(social.review_snippets ?? []),
      },
      policies_trust: {
        delivery: policies.delivery ?? "",
        payment: policies.payment ?? "",
        returns: policies.returns ?? "",
        badges: toStringArray(policies.badges ?? []),
      },
      faq,
      guarantee: { text: toLoc(lp.guarantee?.text ?? "") },
      closing_cta: {
        headline: toLoc(lp.closing_cta?.headline ?? ""),
        subheadline: toLoc(lp.closing_cta?.subheadline ?? ""),
        button: toLoc(lp.closing_cta?.button ?? raw.cta_labels?.primary ?? "Shop Now"),
      },
      gallery_prompts: toStringArray(lp.gallery_prompts ?? []),
    },
    cta_labels: raw.cta_labels
      ? { primary: toLoc(raw.cta_labels.primary ?? "Shop Now"), secondary: toLoc(raw.cta_labels.secondary ?? "Size Guide") }
      : undefined,
    keywords: toStringArray(raw.keywords ?? []),
    checks: normalizeChecks(raw.checks),
  } as LandingInput;
}

// ---------- Shopify Description Builder with Clickable Image Slots (no scripts) ----------
function parseImgToken(raw: string): Record<string, string> | null {
  const m = raw.match(/^\[\[IMG\s+([^\]]+)\]\]$/i);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const part of m[1].match(/([a-zA-Z0-9_-]+)=("[^"]*"|'[^']*')/g) || []) {
    const kv = part.split("=");
    const key = kv[0].trim();
    const val = kv.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
    attrs[key] = val;
  }
  return attrs;
}

function renderImgSlot(attrs: Record<string, string>): string {
  const slot = escapeHtml(attrs.slot || "unnamed_slot");
  const alt = escapeHtml(attrs.alt || "");
  const ratio = escapeHtml(attrs.ratio || "4:3");
  const rec = escapeHtml(attrs.recommended || "");
  return `
  <figure class="img-slot" data-slot="${slot}" data-ratio="${ratio}">
    <div class="img-slot__ph" style="aspect-ratio:${ratio.replace(':',' / ')}">
      <img src="" alt="${alt}" data-slot="${slot}" style="width:100%;height:100%;object-fit:cover;display:block"/>
      <div class="img-slot__label">Click image in Shopify to replace · ${ratio}${rec?` · ${rec}`:""}</div>
    </div>
    ${alt?`<figcaption class="img-slot__caption">${alt}</figcaption>`:""}
  </figure>`;
}

function replaceImgTokensInText(s: string): string {
  // Replace standalone IMG tokens with figure blocks; keep other text intact
  return s.replace(/\[\[IMG\s+[^\]]+\]\]/g, (match) => {
    const attrs = parseImgToken(match);
    return attrs ? renderImgSlot(attrs) : match;
  });
}

function buildShopifyHTML(data: LandingInput, lang: "ar" | "en" = "en") {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = (l: Localized) => l[lang]; // do not escape yet to allow token replacement

  // Sections
  const hero = `
  <section class="s-hero" dir="${dir}">
    <div class="hook">${escapeHtml(t(data.landing_page.hero.hook3))}</div>
    <h1>${escapeHtml(t(data.landing_page.hero.headline))}</h1>
    <div class="sub">${replaceImgTokensInText(t(data.landing_page.hero.subheadline))}</div>
    <div class="cta-row">
      <a href="#" class="btn btn-primary">${escapeHtml(t(data.landing_page.hero.primary_cta))}</a>
      <a href="#" class="btn btn-outline">${escapeHtml(t(data.landing_page.hero.secondary_cta))}</a>
    </div>
  </section>`;

  const benefits = `
  <section class="s-benefits" dir="${dir}">
    <div class="grid">
      ${(data.landing_page.benefits||[]).map((b)=>{
        const items = (b.bullets||[]).map((bl:any)=>{
          const text = bl[lang];
          const attrs = typeof text === 'string' ? parseImgToken(text.trim()) : null;
          if (attrs) return `<li>${renderImgSlot(attrs)}</li>`;
          return `<li>${escapeHtml(String(text))}</li>`;
        }).join("");
        return `<article class="benefit"><h3>${escapeHtml(b.title[lang])}</h3><ul>${items}</ul></article>`;
      }).join("")}
    </div>
  </section>`;

  const sizeFit = `
  <section class="s-size" dir="${dir}">
    <div class="card">
      ${replaceImgTokensInText(data.landing_page.size_fit.note[lang])}
      <p><strong>${escapeHtml(data.landing_page.size_fit.size_range)}</strong></p>
      <p>${escapeHtml(data.landing_page.size_fit.layering_tip[lang])}</p>
    </div>
  </section>`;

  const materials = `
  <section class="s-mat" dir="${dir}">
    <div class="grid">
      <div class="card">
        <ul>
          ${(data.landing_page.materials_care.materials||[]).map((m)=>{
            const attrs = parseImgToken(m.trim());
            return attrs ? `<li>${renderImgSlot(attrs)}</li>` : `<li>${escapeHtml(m)}</li>`;
          }).join("")}
        </ul>
      </div>
      <div class="card">
        <div class="kicker">Care</div>
        <ul>${(data.landing_page.materials_care.care_instructions||[]).map((c)=>`<li>${escapeHtml(c)}</li>`).join("")}</ul>
        <p>${escapeHtml(data.landing_page.materials_care.skin_feel[lang])}</p>
      </div>
    </div>
  </section>`;

  const social = `
  <section class="s-social" dir="${dir}">
    <div class="card">
      ${replaceImgTokensInText(data.landing_page.social_proof.summary[lang])}
      <ul>${(data.landing_page.social_proof.review_snippets||[]).map((r:any)=>`<li>${escapeHtml(r[lang])}</li>`).join("")}</ul>
    </div>
  </section>`;

  const faq = `
  <section class="s-faq" dir="${dir}">
    ${(data.landing_page.faq||[]).map((f)=>`<details><summary>${escapeHtml(f.q[lang])}</summary><div class="a">${escapeHtml(f.a[lang])}</div></details>`).join("")}
  </section>`;

  const closing = `
  <section class="s-closing" dir="${dir}">
    <h3>${escapeHtml(data.landing_page.closing_cta.headline[lang])}</h3>
    <div class="sub">${replaceImgTokensInText(data.landing_page.closing_cta.subheadline[lang])}</div>
    <a href="#" class="btn btn-primary">${escapeHtml(data.landing_page.closing_cta.button[lang])}</a>
  </section>`;

  const badges = (data.landing_page.policies_trust.badges||[]).map((b)=>{
    const attrs = parseImgToken(b.trim());
    return attrs ? renderImgSlot(attrs) : `<span class="badge">${escapeHtml(b)}</span>`;
  }).join(" ");

  // Minimal CSS for Shopify (no scripts)
  const css = `
  <style>
  .hook{color:${BRAND.primary};font-weight:700}
  .btn{padding:10px 16px;border-radius:12px;border:1px solid #e2e8f0;display:inline-block;text-decoration:none}
  .btn-primary{background:${BRAND.primary};color:#fff;border-color:transparent}
  .btn-outline{background:#fff;color:#0f172a}
  .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
  .card{border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff}
  .benefit h3{margin:0 0 8px}
  .img-slot{margin:8px 0}
  .img-slot__ph{border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;display:flex;align-items:center;justify-content:center;position:relative}
  .img-slot__label{position:absolute;bottom:8px;left:8px;right:8px;font-size:12px;color:#475569;background:#ffffffcc;padding:4px 8px;border-radius:8px}
  .img-slot__caption{font-size:12px;color:#64748b;margin-top:6px}
  .badge{display:inline-block;padding:6px 10px;border-radius:999px;background:${BRAND.primarySoft};color:${BRAND.primary};font-size:12px;margin-right:8px}
  details{padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;margin:8px 0}
  details summary{cursor:pointer;font-weight:600}
  </style>`;

  // Final fragment (Shopify-ready HTML)
  return `${css}
  <div class="shopify-desc" dir="${dir}">
    ${hero}
    ${benefits}
    ${sizeFit}
    ${materials}
    <div class="s-policies" dir="${dir}">${badges}</div>
    ${social}
    ${faq}
    ${closing}
  </div>`;
}

// ---------- Full landing HTML (standalone) ----------
function buildLandingHTML(data: LandingInput, lang: "ar" | "en" = "en") {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = (l: Localized) => escapeHtml(l[lang]);
  const title = t(data.seo.title);
  const desc = t(data.seo.meta_description);
  const hook = t(data.landing_page.hero.hook3);
  const headline = t(data.landing_page.hero.headline);
  const subheadline = t(data.landing_page.hero.subheadline);
  const pcta = t(data.landing_page.hero.primary_cta);
  const scta = t(data.landing_page.hero.secondary_cta);
  const subtitle = t(data.subtitle);

  const benefits = (data.landing_page.benefits || []).map((b) => `
    <div class="benefit">
      <h3>${escapeHtml(b.title[lang])}</h3>
      <ul>${(b.bullets || []).map((bl:any)=>`<li>${escapeHtml(bl[lang])}</li>`).join("")}</ul>
    </div>
  `).join("");

  const faq = (data.landing_page.faq || []).map((f)=> `
    <details><summary>${escapeHtml(f.q[lang])}</summary><p>${escapeHtml(f.a[lang])}</p></details>
  `).join("");

  const materials = (data.landing_page.materials_care?.materials || []).map((m)=>`<li>${escapeHtml(m)}</li>`).join("");
  const care = (data.landing_page.materials_care?.care_instructions || []).map((m)=>`<li>${escapeHtml(m)}</li>`).join("");
  const badges = (data.landing_page.policies_trust?.badges || []).map((b)=>`<span class="badge">${escapeHtml(b)}</span>`).join("");

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
<p>${escapeHtml(data.landing_page.size_fit?.note?.[lang] || "")}</p><p><strong>Range:</strong> ${escapeHtml(data.landing_page.size_fit?.size_range || "")}</p>
<p>${escapeHtml(data.landing_page.size_fit?.layering_tip?.[lang] || "")}</p></div>
<div class="card"><div class="kicker">Materials & Care</div><ul>${materials}</ul><ul>${care}</ul>
<p>${escapeHtml(data.landing_page.materials_care?.skin_feel?.[lang] || "")}</p></div></section>
<section class="section card"><div class="kicker">Why parents love it</div>
<p>${escapeHtml(data.landing_page.social_proof?.summary?.[lang] || "")}</p>
<ul>${(data.landing_page.social_proof?.review_snippets || []).map((r:any)=>`<li>${escapeHtml(r[lang])}</li>`).join("")}</ul>
<div style="margin-top:8px">${badges}</div></section>
<section class="section"><h2>${escapeHtml(data.landing_page.closing_cta?.headline?.[lang] || "")}</h2>
<p class="sub">${escapeHtml(data.landing_page.closing_cta?.subheadline?.[lang] || "")}</p>
<div class="cta-row"><a class="btn btn-primary" href="#buy">${escapeHtml(data.landing_page.closing_cta?.button?.[lang] || "")}</a></div></section>
<footer>© Irrakids</footer>
</main></body></html>`;
}

// MAIN COMPONENT (Landing-only UI)
export default function LandingOnlyBuilder() {
  const [payloadRaw, setPayloadRaw] = useState<string>(JSON.stringify(LANDING_SAMPLE, null, 2));
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [srcDoc, setSrcDoc] = useState<string>("");
  const [lastHtml, setLastHtml] = useState<string>("");

  const generateHTML = () => {
    try {
      const raw = JSON.parse(payloadRaw);
      const norm = normalizeLandingPayload(raw);
      if (!isLandingInput(norm)) throw new Error("Normalized payload still invalid");
      const html = buildLandingHTML(norm, lang);
      setSrcDoc(html);
      setLastHtml(html);
      toast.success("Landing HTML generated");
    } catch (e: any) {
      setSrcDoc("");
      toast.error(`Invalid Landing JSON: ${e.message}`);
    }
  };

  const generateShopify = () => {
    try {
      const raw = JSON.parse(payloadRaw);
      const norm = normalizeLandingPayload(raw);
      const html = buildShopifyHTML(norm, lang);
      setSrcDoc(`<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>${html}`);
      setLastHtml(html);
      toast.success("Shopify description HTML generated");
    } catch (e:any) {
      setSrcDoc("");
      toast.error(`Invalid JSON: ${e.message}`);
    }
  };

  const downloadHTML = () => {
    if (!lastHtml) return toast.error("Generate HTML first");
    const blob = new Blob([lastHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `description-${lang}-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-slate-50 text-slate-800">
      {/* HEADER */}
      <div className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl" style={{ background: BRAND.primary }} />
            <div>
              <div className="text-sm text-slate-500">Irrakids Creative</div>
              <h1 className="text-xl font-bold tracking-tight">Landing Page Builder</h1>
            </div>
            <Badge className="ml-3" style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>v4.1</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={lang === 'en' ? 'default' : 'outline'} className="rounded-xl" onClick={() => setLang('en')}><Globe className="h-4 w-4 mr-2"/>English</Button>
            <Button variant={lang === 'ar' ? 'default' : 'outline'} className="rounded-xl" onClick={() => setLang('ar')}>العربية</Button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          {/* Landing JSON */}
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">Landing JSON</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <Button variant="outline" className="rounded-xl" onClick={()=>setPayloadRaw(JSON.stringify(LANDING_SAMPLE, null, 2))}><Upload className="h-4 w-4 mr-2"/>Load sample</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>copy(payloadRaw)}><Clipboard className="h-4 w-4 mr-2"/>Copy</Button>
              </div>
              <Textarea value={payloadRaw} onChange={(e)=>setPayloadRaw(e.target.value)} className="min-h-[420px] rounded-xl font-mono"/>
              <div className="flex items-center gap-2 mt-3">
                <Button className="rounded-xl" onClick={generateShopify}><Sparkles className="h-4 w-4 mr-2"/>Generate Shopify HTML</Button>
                <Button variant="outline" className="rounded-xl" onClick={generateHTML}>Preview as Full Landing</Button>
                <Button variant="outline" className="rounded-xl" onClick={downloadHTML}><Download className="h-4 w-4 mr-2"/>Download HTML</Button>
              </div>
              <div className="text-xs text-slate-500 mt-2">Shopify-friendly HTML (no scripts). Click any placeholder image inside Shopify to replace it. You can also preview as a full landing above.</div>
            </CardContent>
          </Card>

          {/* Quick Tests */}
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">Quick Tests</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-2">
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const obj = JSON.parse(payloadRaw);
                    const norm = normalizeLandingPayload(obj);
                    const ok = isLandingInput(norm);
                    toast[ok?"success":"error"](ok?"L1: normalized payload valid":"L1 failed");
                  }catch(e:any){ toast.error(`L1 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L1</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const html = buildLandingHTML(normalizeLandingPayload(JSON.parse(payloadRaw)), 'en');
                    const ok = html.includes('<title>') && html.includes('canonical');
                    toast[ok?"success":"error"](ok?"L2: HTML has title & canonical":"L2 failed");
                  }catch(e:any){ toast.error(`L2 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L2</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const html = buildLandingHTML(normalizeLandingPayload(JSON.parse(payloadRaw)), 'ar');
                    const ok = html.includes('dir="rtl"');
                    toast[ok?"success":"error"](ok?"L3: Arabic RTL set":"L3 failed");
                  }catch(e:any){ toast.error(`L3 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L3</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const obj = JSON.parse(payloadRaw);
                    const norm = normalizeLandingPayload(obj);
                    const hints = [
                      !!norm.checks?.includes_unisex,
                      !!norm.checks?.mentions_size_range,
                      !!norm.checks?.includes_delivery_cod
                    ];
                    const ok = hints.filter(Boolean).length >= 2;
                    toast[ok?"success":"error"](ok?"L4: checks inferred":"L4 weak checks");
                  }catch(e:any){ toast.error(`L4 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L4</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const html = buildShopifyHTML(normalizeLandingPayload(JSON.parse(payloadRaw)), 'en');
                    const ok = html.includes('img-slot');
                    toast[ok?"success":"error"](ok?"L5: Shopify slots render":"L5 failed");
                  }catch(e:any){ toast.error(`L5 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L5</Button>
                <Button variant="outline" className="rounded-xl" onClick={()=>{
                  try{
                    const norm = normalizeLandingPayload(JSON.parse(payloadRaw));
                    const ok = typeof norm.product_title.en === 'string' && typeof norm.product_title.ar === 'string';
                    toast[ok?"success":"error"](ok?"L6: localization wrap ok":"L6 failed");
                  }catch(e:any){ toast.error(`L6 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L6</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
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

      {/* FOOTER */}
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
  );
}


