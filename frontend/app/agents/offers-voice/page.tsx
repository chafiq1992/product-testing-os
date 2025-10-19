"use client"
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, Clipboard, Download, Upload, Sparkles } from "lucide-react";

// THEME
const BRAND = { primary: "#004AAD", primarySoft: "#E8F0FF" } as const;

// ===== OFFERS TYPES (Agent schema) =====
export type OfferAdCopy = { stopper: string; benefit_line: string; cta: string; full_text: string };
export type OfferImagePrompt = { prompt: string; overlay_text?: string[]; banner_note?: string };
export type OfferItem = { offer_id: string; label: string; type: string; ad_copies: OfferAdCopy[]; headlines: string[]; image_prompt: OfferImagePrompt };
export type OffersInput = { source?: { from_agent?: string; offer_count?: number }; brand?: { name?: string }; items: OfferItem[] };

// ===== VOICEOVER TYPES =====
export type StoryboardStep = {
  t_start: number; t_end: number; voiceover: string; visual_type?: string; shot_instructions?: string;
  images_to_show?: string[]; on_screen_text?: string; motion?: string; transition?: string; sfx?: string; music_cue?: string;
};
export type VoiceItem = {
  offer_id: string; label?: string; type?: string; duration_seconds?: number; aspect_ratio?: string;
  storyboard?: StoryboardStep[]; broll_checklist?: string[]; image_pack?: { slot_or_desc: string; notes?: string }[];
  captions?: { t_start: number; t_end: number; text: string }[]; music_sfx?: any; export_settings?: any; compliance?: any;
};
export type VoiceInput = { source?: { from_agent?: string; offer_count?: number }; brand?: { name?: string }; items: VoiceItem[] };

// ===== HELPERS =====
const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); };
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function normalizeOffersPayload(raw: any): OffersInput {
  return {
    source: raw?.source ?? {},
    brand: raw?.brand ?? {},
    items: Array.isArray(raw?.items)
      ? raw.items.map((it: any) => ({
          offer_id: String(it.offer_id ?? ""),
          label: String(it.label ?? ""),
          type: String(it.type ?? ""),
          ad_copies: Array.isArray(it.ad_copies)
            ? it.ad_copies.map((ac: any) => ({
                stopper: String(ac.stopper ?? ""),
                benefit_line: String(ac.benefit_line ?? ""),
                cta: String(ac.cta ?? ""),
                full_text: String(ac.full_text ?? ""),
              }))
            : [],
          headlines: Array.isArray(it.headlines) ? it.headlines.map((h: any) => String(h)) : [],
          image_prompt: {
            prompt: String(it.image_prompt?.prompt ?? ""),
            overlay_text: Array.isArray(it.image_prompt?.overlay_text)
              ? it.image_prompt.overlay_text.map((o: any) => String(o))
              : [],
            banner_note: String(it.image_prompt?.banner_note ?? ""),
          },
        }))
      : [],
  };
}

function normalizeVoicePayload(raw: any): VoiceInput {
  return {
    source: raw?.source ?? {},
    brand: raw?.brand ?? {},
    items: Array.isArray(raw?.items)
      ? raw.items.map((it: any) => ({
          offer_id: String(it.offer_id ?? ""),
          label: typeof it.label === 'string' ? it.label : "",
          type: typeof it.type === 'string' ? it.type : "",
          duration_seconds: Number(it.duration_seconds ?? 0),
          aspect_ratio: typeof it.aspect_ratio === 'string' ? it.aspect_ratio : "9:16",
          storyboard: Array.isArray(it.storyboard)
            ? it.storyboard.map((s: any) => ({
                t_start: Number(s.t_start ?? 0), t_end: Number(s.t_end ?? 0),
                voiceover: String(s.voiceover ?? ""), visual_type: String(s.visual_type ?? ""),
                shot_instructions: String(s.shot_instructions ?? ""),
                images_to_show: Array.isArray(s.images_to_show) ? s.images_to_show.map((x: any) => String(x)) : [],
                on_screen_text: String(s.on_screen_text ?? ""), motion: String(s.motion ?? ""), transition: String(s.transition ?? ""), sfx: String(s.sfx ?? ""), music_cue: String(s.music_cue ?? ""),
              }))
            : [],
          broll_checklist: Array.isArray(it.broll_checklist) ? it.broll_checklist.map((x: any) => String(x)) : [],
          image_pack: Array.isArray(it.image_pack) ? it.image_pack.map((x: any) => ({ slot_or_desc: String(x.slot_or_desc ?? ""), notes: String(x.notes ?? "") })) : [],
          captions: Array.isArray(it.captions) ? it.captions.map((c: any) => ({ t_start: Number(c.t_start ?? 0), t_end: Number(c.t_end ?? 0), text: String(c.text ?? "") })) : [],
          music_sfx: it.music_sfx, export_settings: it.export_settings, compliance: it.compliance,
        }))
      : [],
  };
}

// Image placeholder used inside Shopify content (clickable when pasted in Shopify editor)
function renderImgSlot(attrs: Record<string, string>): string {
  const slot = escapeHtml(attrs.slot || "slot");
  const alt = escapeHtml(attrs.alt || "");
  const ratio = escapeHtml(attrs.ratio || "4:3");
  const rec = escapeHtml(attrs.recommended || "");
  const transparent = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  return `
  <figure class="img-slot" data-slot="${slot}" data-ratio="${ratio}">
    <div class="img-slot__ph" style="aspect-ratio:${ratio.replace(":", " / ")}">
      <img src="${transparent}" alt="${alt}" title="Click to replace with a Shopify image" data-slot="${slot}" draggable="false" style="width:100%;height:100%;object-fit:cover;display:block;cursor:pointer"/>
      <div class="img-slot__label">Click to choose from Shopify Files · ${ratio}${rec ? ` · ${rec}` : ""}</div>
    </div>
    ${alt ? `<figcaption class="img-slot__caption">${alt}</figcaption>` : ""}
  </figure>`;
}

function buildOffersShopifyHTML(data: OffersInput, opts: { preview?: boolean } = {}) {
  const { preview = false } = opts;
  const css = `
  <style>
    :root{--brand:${BRAND.primary};--brand-soft:${BRAND.primarySoft};--ink:#0f172a;--muted:#64748b}
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Emoji,Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif;color:var(--ink)}
    .offers-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
    .offer-card{border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff}
    .offer-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
    .offer-type{font-size:12px;color:var(--muted)}
    .overlay-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
    .tag{font-size:12px;border:1px solid #e2e8f0;border-radius:999px;padding:4px 8px;background:var(--brand-soft);color:var(--brand)}
    .hlist{margin:8px 0 0 0;padding:0;list-style:none}
    .hlist li{display:flex;gap:8px;align-items:center;margin:6px 0;padding:8px;border:1px dashed #e2e8f0;border-radius:10px}
    .copies{margin:8px 0 0 0;padding:0;list-style:none}
    .copies li{display:flex;gap:8px;align-items:flex-start;margin:6px 0;padding:8px;border:1px solid #eef2f7;border-radius:10px;background:#fafcff}
    .copy-btn{border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
    .copy-btn.copied{background:var(--brand-soft);border-color:var(--brand);}
    .copy-btn svg{width:16px;height:16px}
    .img-slot{margin:8px 0}
    .img-slot__ph{border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;display:flex;align-items:center;justify-content:center;position:relative}
    .img-slot__label{position:absolute;bottom:8px;left:8px;right:8px;font-size:12px;color:#475569;background:#ffffffcc;padding:4px 8px;border-radius:8px}
    .img-slot__caption{font-size:12px;color:#64748b;margin-top:6px}
  </style>`;

  const iconCopy = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  const cards = (data.items || [])
    .map((it) => {
      const slot = renderImgSlot({ slot: `offer_${it.offer_id}_image`, alt: it.label || it.type, ratio: "4:3", recommended: it.image_prompt?.banner_note || "" });
      const headlines = it.headlines?.length ? `<ul class="hlist">${it.headlines.map((h) => {
        const text = escapeHtml(h);
        return `<li><button class="copy-btn" type="button" ${preview ? `data-copy="${text}"` : ''} aria-label="Copy headline">${iconCopy}</button><span>${text}</span></li>`;
      }).join("")}</ul>` : "";

      const adList = Array.isArray(it.ad_copies) && it.ad_copies.length
        ? `<ul class="copies">${it.ad_copies.map((ac) => {
            const full = escapeHtml(ac.full_text || `${ac.stopper} ${ac.benefit_line} ${ac.cta}`.trim());
            return `<li><button class="copy-btn" type="button" ${preview ? `data-copy="${full}"` : ''} aria-label="Copy ad copy">${iconCopy}</button><div><div><strong>${escapeHtml(ac.stopper)}</strong></div><div>${escapeHtml(ac.benefit_line)}</div><em>${escapeHtml(ac.cta)}</em><div style="margin-top:4px;color:#475569;font-size:12px">Full: ${full}</div></div></li>`;
          }).join("")}</ul>`
        : "";

      const overlays = (it.image_prompt?.overlay_text || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
      return `<article class="offer-card">
        <div class="offer-head">
          <div><strong>${escapeHtml(it.label || `Offer ${it.offer_id}`)}</strong></div>
          <div class="offer-type">${escapeHtml(it.type)}</div>
        </div>
        ${slot}
        ${overlays ? `<div class="overlay-tags">${overlays}</div>` : ""}
        ${headlines}
        ${adList}
      </article>`;
    })
    .join("");

  const section = `<section class="offers"><h2 style="margin:0 0 8px 0">${escapeHtml(data.brand?.name || "Offers")}</h2><div class="offers-grid">${cards}</div></section>`;

  if (!preview) return `${css}${section}`;

  const js = `
  <script>
    document.addEventListener('click', function(e){
      var btn = e.target.closest && e.target.closest('[data-copy]');
      if(!btn) return;
      var text = btn.getAttribute('data-copy') || '';
      navigator.clipboard.writeText(text).then(function(){
        btn.classList.add('copied');
        setTimeout(function(){ btn.classList.remove('copied'); }, 800);
      });
    });
  <\/script>`;

  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body>${section}${js}</body></html>`;
  return doc;
}

function buildVoicePreviewHTML(data: VoiceInput, opts: { preview?: boolean } = {}) {
  const css = `
  <style>
    :root{--brand:${BRAND.primary};--soft:${BRAND.primarySoft};--ink:#0f172a;--muted:#64748b}
    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Emoji,Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif;color:var(--ink)}
    .grid{display:grid;gap:16px}
    .item{border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff}
    .head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--soft)}
    .head .label{font-weight:600}
    .row{display:grid;grid-template-columns:120px 1fr 1fr;gap:12px;align-items:start;padding:12px 14px;border-top:1px solid #eef2f7}
    .time{font-variant-numeric:tabular-nums;color:#0f172a;font-weight:600}
    .vo{font-size:15px;line-height:1.5}
    .ins{font-size:13px;color:var(--muted)}
    .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
    .chip{font-size:12px;border:1px solid #e2e8f0;border-radius:999px;padding:2px 8px;background:#fff}
    .copy-btn{border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:4px 6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin-right:8px}
    .copy-btn.copied{background:var(--soft);border-color:var(--brand)}
    .bar{height:4px;background:linear-gradient(90deg,var(--brand),#7aa8ff);border-radius:999px;margin-top:4px}
    .img-slot{margin-top:8px}
  </style>`;

  const iconCopy = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  const items = (data.items||[]).map((it)=>{
    const total = Math.max(...(it.storyboard||[]).map(s=>Number(s.t_end||0)), 0);
    const rows = (it.storyboard||[]).map(s=>{
      const t0 = Number(s.t_start||0).toFixed(1);
      const t1 = Number(s.t_end||0).toFixed(1);
      const dur = Math.max(0, Number(s.t_end||0) - Number(s.t_start||0));
      const width = total>0? Math.max(6, (dur/total)*100): 0;
      const imgs = (s.images_to_show||[]).map(name=>renderImgSlot({slot:`${it.offer_id}_${name}`, alt:name, ratio:"4:3", recommended:"Frame/asset placeholder"})).join("");
      const copyVO = escapeHtml(s.voiceover||"");
      const copyINS = escapeHtml(s.shot_instructions||"");
      return `<div class="row">
        <div>
          <div class="time">${t0}s → ${t1}s</div>
          <div class="bar" style="width:${width}%"></div>
        </div>
        <div class="vo">
          <button class="copy-btn" data-copy="${copyVO}">${iconCopy}<span>Copy VO</span></button>
          ${copyVO || '<em style="color:#64748b">(no voiceover text)</em>'}
          ${s.on_screen_text ? `<div class="chips"><span class="chip">Text: ${escapeHtml(s.on_screen_text)}</span></div>`: ''}
        </div>
        <div class="ins">
          <button class="copy-btn" data-copy="${copyINS}">${iconCopy}<span>Copy Instr.</span></button>
          ${copyINS || '<em style="color:#94a3b8">(no instructions)</em>'}
          ${s.visual_type? `<div class="chips"><span class="chip">${escapeHtml(s.visual_type)}</span>${s.motion?`<span class="chip">${escapeHtml(s.motion)}</span>`:''}${s.transition?`<span class="chip">${escapeHtml(s.transition)}</span>`:''}${s.sfx?`<span class="chip">SFX: ${escapeHtml(s.sfx)}</span>`:''}${s.music_cue?`<span class="chip">Music: ${escapeHtml(s.music_cue)}</span>`:''}</div>`: ''}
          ${imgs}
        </div>
      </div>`
    }).join("");

    const checklist = (it.broll_checklist||[]).map(x=>`<span class="chip">${escapeHtml(x)}</span>`).join("");

    return `<section class="item">
      <div class="head"><div class="label">${escapeHtml(it.label||it.offer_id)}</div><div class="meta">${escapeHtml(it.aspect_ratio||"9:16")} • ${total?sToMMSS(total):"0:00"}</div></div>
      <div class="grid">${rows}</div>
      ${checklist? `<div style="padding:8px 14px;border-top:1px solid #eef2f7"><div class="chips">${checklist}</div></div>`: ''}
    </section>`
  }).join("");

  const js = `
  <script>
    document.addEventListener('click', function(e){
      var btn = e.target.closest && e.target.closest('[data-copy]');
      if(!btn) return;
      var text = btn.getAttribute('data-copy') || '';
      navigator.clipboard.writeText(text).then(function(){
        btn.classList.add('copied');
        setTimeout(function(){ btn.classList.remove('copied'); }, 800);
      });
    });
  <\/script>`;

  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><h2 style="margin:0 0 12px 0">${escapeHtml(data.brand?.name || 'Voiceover')}</h2>${items}${js}</body></html>`;
  return doc;
}

function sToMMSS(s:number){
  const m = Math.floor(s/60); const sec = Math.round(s%60); return `${m}:${sec.toString().padStart(2,'0')}`;
}

export default function OffersAndVoiceStudio() {
  // Tabs
  const [tab, setTab] = useState<'offers'|'voice'>('offers');

  // Offers-only UI
  const [offersRaw, setOffersRaw] = useState<string>(JSON.stringify({
    source: { from_agent: "kids_marketing_lp_response_en", offer_count: 6 },
    brand: { name: "IRRAKIDS" },
    items: [],
  }, null, 2));
  const [jsonCollapsed, setJsonCollapsed] = useState<boolean>(true);
  const [srcDoc, setSrcDoc] = useState<string>("");
  const [lastHtml, setLastHtml] = useState<string>("");

  // Voice-over UI
  const [voiceRaw, setVoiceRaw] = useState<string>(JSON.stringify({ source:{from_agent:"ADS_PACK_V1", offer_count:0}, brand:{name:"IRRAKIDS"}, items:[] }, null, 2));
  const [voiceCollapsed, setVoiceCollapsed] = useState<boolean>(true);
  const [voiceDoc, setVoiceDoc] = useState<string>("");
  const [voiceExport, setVoiceExport] = useState<string>("");

  const generateOffers = () => {
    try {
      const raw = JSON.parse(offersRaw);
      const norm = normalizeOffersPayload(raw);
      const htmlPreview = buildOffersShopifyHTML(norm, { preview: true });
      const htmlExport = buildOffersShopifyHTML(norm, { preview: false });
      setSrcDoc(htmlPreview);
      setLastHtml(htmlExport);
      toast.success("Offers HTML generated");
    } catch (e: any) {
      setSrcDoc("");
      toast.error(`Invalid Offers JSON: ${e.message}`);
    }
  };

  const generateVoice = () => {
    try {
      const raw = JSON.parse(voiceRaw);
      const norm = normalizeVoicePayload(raw);
      const htmlPreview = buildVoicePreviewHTML(norm, { preview: true });
      setVoiceDoc(htmlPreview);
      setVoiceExport(htmlPreview); // export identical for now
      toast.success("Voiceover preview generated");
    } catch (e: any) {
      setVoiceDoc("");
      toast.error(`Invalid Voice JSON: ${e.message}`);
    }
  };

  const downloadHTML = () => {
    const toSave = tab==='offers' ? lastHtml : voiceExport;
    if (!toSave) return toast.error("Generate HTML first");
    const blob = new Blob([toSave], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tab}-` + Date.now() + `.html`;
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
              <h1 className="text-xl font-bold tracking-tight">Offers + Voiceover Preview</h1>
            </div>
            <Badge className="ml-3" style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>v5.0</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>{tab==='offers'? 'Offers' : 'Voiceover'}</Badge>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <div className="inline-flex rounded-xl border bg-white overflow-hidden">
          <button className={`px-4 py-2 text-sm ${tab==='offers'? 'bg-[var(--brand-soft)] font-semibold' : ''}`} style={{['--brand-soft' as any]: BRAND.primarySoft}} onClick={()=>setTab('offers')}>Offers</button>
          <button className={`px-4 py-2 text-sm ${tab==='voice'? 'bg-[var(--brand-soft)] font-semibold' : ''}`} style={{['--brand-soft' as any]: BRAND.primarySoft}} onClick={()=>setTab('voice')}>Voiceover</button>
        </div>
      </div>

      {/* CONTENT */}
      {tab==='offers' ? (
        <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-6">
            {/* Offers JSON (Agent output) */}
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="flex items-center justify-between"><CardTitle className="text-base">Offers JSON (Agent output)</CardTitle><Button variant="outline" className="rounded-xl" onClick={() => setJsonCollapsed(v => !v)}>{jsonCollapsed ? 'Expand' : 'Minimize'}</Button></CardHeader>
              <CardContent className={jsonCollapsed ? 'hidden' : ''}>
                <div className="flex items-center gap-2 mb-2">
                  <Button variant="outline" className="rounded-xl" onClick={() => setOffersRaw(JSON.stringify({
                    source: { from_agent: "kids_marketing_lp_response_en", offer_count: 6 },
                    brand: { name: "IRRAKIDS" },
                    items: [
                      {
                        offer_id: "O1",
                        label: "Free Beanie with Set",
                        type: "gift_with_purchase",
                        ad_copies: [
                          { stopper: "Gift Inside", benefit_line: "Free warm beanie when you get the cozy 3‑piece set—24–48h city delivery + Cash on Delivery.", cta: "Shop Now", full_text: "Gift Inside Free warm beanie when you get the cozy 3‑piece set—24–48h city delivery + Cash on Delivery. Shop Now 🎁🧒🧣🚚" },
                        ],
                        headlines: ["Free Beanie With 3‑Piece Set"],
                        image_prompt: { prompt: "Toddler boy (2–5 years) ...", overlay_text: ["Free Beanie Today", "Warm Set + Gift"], banner_note: "Top-left ribbon" },
                      },
                    ],
                  }, null, 2))}><Upload className="h-4 w-4 mr-2" />Load sample</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => copy(offersRaw)}><Clipboard className="h-4 w-4 mr-2" />Copy</Button>
                </div>
                <Textarea value={offersRaw} onChange={(e) => setOffersRaw(e.target.value)} className="min-h-[140px] rounded-xl font-mono" />
              </CardContent>
            </Card>

            {/* Quick Tests */}
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader><CardTitle className="text-base">Quick Tests</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-2 flex-wrap">
                  <Button variant="outline" className="rounded-xl" onClick={() => {
                    try { const norm = normalizeOffersPayload(JSON.parse(offersRaw)); const ok = Array.isArray(norm.items) && norm.items.length >= 1; toast[ok ? "success" : "error"](ok ? "L7: offers schema ok" : "L7 failed"); } catch (e: any) { toast.error(`L7 error: ${e.message}`); }
                  }}><Check className="h-4 w-4 mr-2" />L7</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => {
                    try { const html = buildOffersShopifyHTML(normalizeOffersPayload(JSON.parse(offersRaw))); const ok = html.includes("offers-grid") && html.includes("offer-card"); toast[ok ? "success" : "error"](ok ? "L8: offers HTML renders" : "L8 failed"); } catch (e: any) { toast.error(`L8 error: ${e.message}`); }
                  }}><Check className="h-4 w-4 mr-2" />L8</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => {
                    try { const html = buildOffersShopifyHTML(normalizeOffersPayload(JSON.parse(offersRaw))); const bad = /\\[A-Za-z]/.test(html); toast[!bad ? "success" : "error"](!bad ? "L10: no stray backslashes in HTML" : "L10: stray backslashes found"); } catch (e: any) { toast.error(`L10 error: ${e.message}`); }
                  }}><Check className="h-4 w-4 mr-2" />L10</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => {
                    try { const html = buildOffersShopifyHTML(normalizeOffersPayload(JSON.parse(offersRaw)), { preview: true }); const ok = html.includes('data-copy='); toast[ok ? "success" : "error"](ok ? "L11: copy buttons wired (preview)" : "L11 failed"); } catch (e: any) { toast.error(`L11 error: ${e.message}`); }
                  }}><Check className="h-4 w-4 mr-2" />L11</Button>
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
                    <iframe title="Offers Preview" srcDoc={srcDoc} style={{ width: "100%", height: 640, border: "0" }} />
                  ) : (
                    <div className="p-6 text-sm text-slate-500">Paste offers JSON and click <strong>Generate Offers HTML</strong> to see the live preview.</div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Button className="rounded-xl" onClick={generateOffers}><Sparkles className="h-4 w-4 mr-2" />Generate Offers HTML</Button>
                  <Button variant="outline" className="rounded-xl" onClick={downloadHTML}><Download className="h-4 w-4 mr-2" />Download HTML</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        // VOICEOVER TAB
        <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-6">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="flex items-center justify-between"><CardTitle className="text-base">Voiceover JSON (Agent output)</CardTitle><Button variant="outline" className="rounded-xl" onClick={() => setVoiceCollapsed(v => !v)}>{voiceCollapsed ? 'Expand' : 'Minimize'}</Button></CardHeader>
              <CardContent className={voiceCollapsed ? 'hidden' : ''}>
                <div className="flex items-center gap-2 mb-2">
                  <Button variant="outline" className="rounded-xl" onClick={() => setVoiceRaw(JSON.stringify({
                    source: { from_agent: "ADS_PACK_V1", offer_count: 1 }, brand: { name: "IRRAKIDS" }, items: [
                      { offer_id: "OF1-GWP-SOCKS", label: "Free Socks Pack with Sneakers", duration_seconds: 15, aspect_ratio: "9:16", storyboard: [
                        { t_start:0, t_end:2.5, voiceover:"Gift inside! Free socks with any pair of IRRAKIDS sneakers.", visual_type:"lifestyle_recording", shot_instructions:"Exterior school steps. Kid swings feet; parent reveals socks bundle.", images_to_show:["hero_main","gift_socks_bundle"], on_screen_text:"Free Socks Today", motion:"Push-in", transition:"Cut", sfx:"Whoosh", music_cue:"Upbeat in" },
                        { t_start:2.5, t_end:6.5, voiceover:"Breathable, cushioned, and easy to clean for all‑day play.", visual_type:"product_recording", shot_instructions:"Macro mesh + insole press, wipe-clean demo.", images_to_show:["macro_mesh_breathable","insole_press","wipe_clean_demo"], on_screen_text:"Comfy. Breathable.", motion:"Macro sweep", transition:"Match", sfx:"Cloth swipe", music_cue:"Beat continues" },
                        { t_start:10.5, t_end:15, voiceover:"Order now with Cash on Delivery. Fast 24–48 hour city delivery!", visual_type:"lifestyle_recording", shot_instructions:"Doorstep handoff; kid runs off.", images_to_show:["delivery_handoff","try_on_run"], on_screen_text:"COD + 24–48h", motion:"Follow cam", transition:"End card", sfx:"Door chime", music_cue:"Button" }
                      ]}
                    ] }, null, 2))}><Upload className="h-4 w-4 mr-2" />Load sample</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => copy(voiceRaw)}><Clipboard className="h-4 w-4 mr-2" />Copy</Button>
                </div>
                <Textarea value={voiceRaw} onChange={(e) => setVoiceRaw(e.target.value)} className="min-h-[140px] rounded-xl font-mono" />
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader><CardTitle className="text-base">Quick Tests (Voiceover)</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-2 flex-wrap">
                  <Button variant="outline" className="rounded-xl" onClick={() => {
                    try { const norm = normalizeVoicePayload(JSON.parse(voiceRaw)); const ok = Array.isArray(norm.items) && norm.items.length>0 && Array.isArray(norm.items[0].storyboard); toast[ok?"success":"error"](ok?"L12: voice schema ok":"L12 failed"); } catch(e:any){ toast.error(`L12 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L12</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => {
                    try { const html = buildVoicePreviewHTML(normalizeVoicePayload(JSON.parse(voiceRaw))); const ok = html.includes('class="row"'); toast[ok?"success":"error"](ok?"L13: storyboard rows render":"L13 failed"); } catch(e:any){ toast.error(`L13 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L13</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => {
                    try { const v = normalizeVoicePayload(JSON.parse(voiceRaw)); const sb=v.items?.[0]?.storyboard||[]; const total = Math.max(...sb.map(s=>Number(s.t_end||0)),0); const ok = total>0; toast[ok?"success":"error"](ok?`L14: total duration ${total}s`:"L14 failed"); } catch(e:any){ toast.error(`L14 error: ${e.message}`);} }}><Check className="h-4 w-4 mr-2"/>L14</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-7">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader><CardTitle className="text-base">Voiceover Preview</CardTitle></CardHeader>
              <CardContent>
                <div className="rounded-xl border overflow-hidden">
                  {voiceDoc ? (
                    <iframe title="Voiceover Preview" srcDoc={voiceDoc} style={{ width: "100%", height: 640, border: "0" }} />
                  ) : (
                    <div className="p-6 text-sm text-slate-500">Paste voiceover JSON and click <strong>Generate Voiceover</strong> to see an easy-to-read VO + Instructions board.</div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Button className="rounded-xl" onClick={generateVoice}><Sparkles className="h-4 w-4 mr-2" />Generate Voiceover</Button>
                  <Button variant="outline" className="rounded-xl" onClick={downloadHTML}><Download className="h-4 w-4 mr-2" />Download HTML</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <div className="mt-10 border-t">
        <div className="mx-auto max-w-7xl px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="text-sm text-slate-500">Built for fast promos · Offers + Voiceover workflow</div>
          <div className="flex items-center gap-2 text-xs">
            <Badge style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>{tab==='offers'?'Offers':'Voiceover'}</Badge>
            <Badge variant="secondary">Preview</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}


