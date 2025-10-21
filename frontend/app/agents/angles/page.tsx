"use client"
import React, { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Check, Clipboard, Download, FileJson, Smartphone, Wand2, Upload, Sparkles, ChevronDown, CopyCheck, Filter, Loader2 } from "lucide-react";
import axios from "axios";
import { translateTexts } from "@/lib/api";
import ChatKitWidget from "../ChatKitWidget";

const BRAND = { primary: "#004AAD", primarySoft: "#E8F0FF", accent: "#0ea5e9", ok: "#16a34a" };

type AgentOutput = { angles: { angle_title: string; headlines: string[]; ad_copies: string[] }[] };

const SAMPLE: AgentOutput = { angles: [ { angle_title: "Start by entering a URL or description", headlines: [""], ad_copies: ["Paste a product URL or write a short description, then Generate."] } ] };

const cls = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); };

function MobileAd({ title, headline, body }: { title: string; headline: string; body: string }) {
  return (
    <div className="w-full max-w-[380px] rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="h-40 bg-gradient-to-br from-[#004AAD] to-[#2563eb]" />
      <div className="p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Sponsored · Irrakids</div>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm font-medium text-slate-800">{headline}</p>
        <p className="mt-2 text-sm text-slate-600 line-clamp-5 whitespace-pre-line">{body}</p>
        <div className="mt-4 flex items-center gap-2">
          <Button className="rounded-xl" style={{ backgroundColor: BRAND.primary }}>Shop Now</Button>
          <Button variant="outline" className="rounded-xl">Learn More</Button>
        </div>
      </div>
    </div>
  );
}

function HeadlineChip({ text, active, onClick }: { text: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cls(
        "px-3 py-2 rounded-full text-sm border transition shadow-sm",
        active ? "bg-[var(--chip-bg,#E8F0FF)] border-transparent text-slate-900" : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
      )}
      style={{ ['--chip-bg' as any]: BRAND.primarySoft }}
    >
      {text}
    </button>
  );
}

export default function AdAnglesStudio(){
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AgentOutput>(SAMPLE);
  type Lang = 'en'|'ar'|'fr'
  const [lang, setLang] = useState<Lang>('en')
  const [localized, setLocalized] = useState<{ ar?: AgentOutput, fr?: AgentOutput }>({})
  const [translating, setTranslating] = useState<{ ar?: boolean, fr?: boolean }>({})
  const [translateError, setTranslateError] = useState<{ ar?: string, fr?: string }>({})
  const [selected, setSelected] = useState(0);
  const [headlineIdx, setHeadlineIdx] = useState(0);
  const [copyIdx, setCopyIdx] = useState(0);
  const [raw, setRaw] = useState("");

  const displayData = useMemo(()=>{
    if(lang==='ar' && localized.ar) return localized.ar
    if(lang==='fr' && localized.fr) return localized.fr
    return data
  }, [lang, localized, data])

  const current = displayData.angles[selected] || { angle_title: "", headlines: [""], ad_copies: [""] };
  const currentHeadline = current.headlines[headlineIdx] ?? "";
  const currentCopy = current.ad_copies[copyIdx] ?? "";

  useEffect(() => { setHeadlineIdx(0); setCopyIdx(0); }, [selected]);

  const stats = useMemo(() => {
    const totalHeadlines = (data.angles||[]).reduce((sum, a) => sum + (a.headlines||[]).length, 0);
    const totalCopies = (data.angles||[]).reduce((sum, a) => sum + (a.ad_copies||[]).length, 0);
    return { angles: data.angles.length, totalHeadlines, totalCopies };
  }, [data]);

  async function generate(){
    if(!url.trim() && !text.trim()) { toast.error("Enter a URL or some text"); return }
    setLoading(true)
    try{
      const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
      const inputText = url.trim()? url.trim() : text.trim()
      const { data: res } = await axios.post(`${base}/api/chatkit/run`, {
        mode: url.trim()? 'url' : 'text',
        url: url.trim() || undefined,
        text: text.trim() || undefined,
        require_workflow: true,
        // Provide chat Start node input array for Agent Builder workflows
        workflow_input: inputText ? {
          input: [
            {
              type: "message",
              role: "user",
              content: [ { type: "input_text", text: inputText } ]
            }
          ]
        } : undefined,
        debug: true,
      })
      const angles = Array.isArray(res?.angles)? res.angles : []
      if (res?.debug) {
        // eslint-disable-next-line no-console
        console.debug('ChatKit debug:', res.debug)
      }
      if(!angles.length){ toast.error(res?.error || "No angles from workflow"); setData(SAMPLE); return }
      setData({ angles })
      setSelected(0); setHeadlineIdx(0); setCopyIdx(0)
      toast.success("Generated from Agent Builder workflow")
    }catch(e:any){ toast.error(e?.message||"Failed to run workflow") }
    finally{ setLoading(false) }
  }

  function flattenAgentOutput(a: AgentOutput){
    const items: string[] = []
    const indexMap: Array<{ kind:'angle'|'headline'|'copy', angleIndex:number, subIndex?:number }> = []
    (a.angles||[]).forEach((ang, i)=>{
      items.push(String(ang.angle_title||'')); indexMap.push({ kind:'angle', angleIndex:i })
      ;(ang.headlines||[]).forEach((h, hi)=>{ items.push(String(h||'')); indexMap.push({ kind:'headline', angleIndex:i, subIndex:hi }) })
      ;(ang.ad_copies||[]).forEach((c, ci)=>{ items.push(String(c||'')); indexMap.push({ kind:'copy', angleIndex:i, subIndex:ci }) })
    })
    return { items, indexMap }
  }

  function reconstructFromTranslations(base: AgentOutput, translated: string[], indexMap: Array<{ kind:'angle'|'headline'|'copy', angleIndex:number, subIndex?:number }>): AgentOutput{
    const out: AgentOutput = { angles: base.angles.map(a=>({ angle_title: a.angle_title, headlines: [...a.headlines], ad_copies: [...a.ad_copies] })) }
    for(let i=0;i<indexMap.length;i++){
      const m = indexMap[i]
      const t = translated[i] ?? ''
      if(m.kind==='angle') out.angles[m.angleIndex].angle_title = t
      if(m.kind==='headline' && m.subIndex!=null) out.angles[m.angleIndex].headlines[m.subIndex] = t
      if(m.kind==='copy' && m.subIndex!=null) out.angles[m.angleIndex].ad_copies[m.subIndex] = t
    }
    return out
  }

  async function translateAll(target: 'ar'|'fr', base?: AgentOutput){
    try{
      const src = base || data
      const { items, indexMap } = flattenAgentOutput(src)
      if(items.length===0){
        if(target==='ar') setLocalized(p=>({ ...p, ar: { angles: [] } }))
        if(target==='fr') setLocalized(p=>({ ...p, fr: { angles: [] } }))
        return
      }
      setTranslating(p=>({ ...p, [target]: true }))
      setTranslateError(p=>({ ...p, [target]: undefined }))
      const res = await translateTexts({ texts: items, target, domain: 'ads' })
      const arr = Array.isArray(res?.translations)? res.translations : []
      if(arr.length !== items.length){
        throw new Error("Translation count mismatch")
      }
      const localizedOut = reconstructFromTranslations(src, arr, indexMap)
      setLocalized(p=> target==='ar'? { ...p, ar: localizedOut } : { ...p, fr: localizedOut })
    }catch(e:any){
      setTranslateError(p=>({ ...p, [target]: e?.message||'Translate failed' }))
      toast.error(`Translate ${target.toUpperCase()} failed`)
    }finally{
      setTranslating(p=>({ ...p, [target]: false }))
    }
  }

  const importJSON = async () => {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.angles) throw new Error("Missing 'angles' array");
      setData(parsed);
      setSelected(0); setHeadlineIdx(0); setCopyIdx(0); setLang('en')
      toast.success("Agent output loaded");
      await Promise.allSettled([
        translateAll('ar', parsed),
        translateAll('fr', parsed),
      ])
    } catch (e: any) {
      toast.error(`Invalid JSON: ${e.message}`);
    }
  };

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `ad-angles-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const copyAllHeadlines = () => { const txt = (current.headlines||[]).map((h, i) => `${i + 1}. ${h}`).join("\n"); copy(txt); };
  const copyAllCopies = () => { const txt = (current.ad_copies||[]).map((c, i) => `Copy ${i + 1}:\n${c}`).join("\n\n---\n\n"); copy(txt); };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-slate-50 text-slate-800">
      {/* HEADER */}
      <div className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl" style={{ background: BRAND.primary }} />
            <div>
              <div className="text-sm text-slate-500">Irrakids Creative</div>
              <h1 className="text-xl font-bold tracking-tight">Ad Angles Studio</h1>
            </div>
            <Badge className="ml-3" style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>v1.1</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-xl" onClick={downloadJSON}>
              <Download className="h-4 w-4 mr-2" /> Export JSON
            </Button>
          </div>
        </div>
      </div>

      {/* URL/TEXT INPUT BAR */}
      <div className="mx-auto max-w-7xl px-4 pt-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <Input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://your-landing-page... (optional)" className="rounded-xl" />
          </div>
          <div className="md:col-span-6">
            <Input value={text} onChange={e=>setText(e.target.value)} placeholder="Describe the product or offer... (optional)" className="rounded-xl" />
          </div>
          <div className="md:col-span-1">
            <Button className="w-full rounded-xl" style={{ backgroundColor: BRAND.primary }} disabled={loading} onClick={generate}>
              {loading? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* SIDEBAR */}
        <div className="lg:col-span-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Angles ({stats.angles})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {displayData.angles.map((a, i) => (
                  <button key={i} onClick={() => setSelected(i)} className={cls("w-full text-left p-3 rounded-xl border transition", i===selected? "bg-white border-transparent shadow-sm ring-2": "bg-slate-50 hover:bg-white border-slate-200")} style={i===selected? { boxShadow: `0 0 0 2px ${BRAND.primarySoft}` } : {}}>
                    <div className="text-sm font-semibold">{a.angle_title}</div>
                    <div className="mt-1 text-xs text-slate-500 line-clamp-2">{a.headlines[0]}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl mt-6">
            <CardHeader>
              <CardTitle className="text-base">Import agent output</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder='Paste JSON {"angles": [...]}' className="min-h-[140px] rounded-xl" />
              <div className="mt-3 flex gap-2">
                <Button className="rounded-xl" onClick={importJSON}><Upload className="h-4 w-4 mr-2" /> Load JSON</Button>
                <Button variant="outline" className="rounded-xl" onClick={() => setRaw("")}>Clear</Button>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <div>Headlines total: {stats.totalHeadlines} · Copies total: {stats.totalCopies}</div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Translations:</span>
                  <span className={["inline-flex items-center gap-1", translating.ar?"text-sky-600":"text-slate-500"].join(" ")}>{translating.ar? <Loader2 className="h-3.5 w-3.5 animate-spin"/>: null} AR {localized.ar? 'ready': (translating.ar? '…' : (translateError.ar? 'error' : '–'))}</span>
                  <span className="mx-1">·</span>
                  <span className={["inline-flex items-center gap-1", translating.fr?"text-sky-600":"text-slate-500"].join(" ")}>{translating.fr? <Loader2 className="h-3.5 w-3.5 animate-spin"/>: null} FR {localized.fr? 'ready': (translating.fr? '…' : (translateError.fr? 'error' : '–'))}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* MAIN */}
        <div className="lg:col-span-9">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-500">Selected angle</div>
                  <CardTitle className="text-2xl">{current.angle_title}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="rounded-xl" onClick={() => copyAllHeadlines()}>
                    <Clipboard className="h-4 w-4 mr-2" /> Copy headlines
                  </Button>
                  <Button className="rounded-xl" style={{ backgroundColor: BRAND.primary }} onClick={() => copyAllCopies()}>
                    <Clipboard className="h-4 w-4 mr-2" /> Copy ad copies
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <Tabs value={lang} onValueChange={v=>setLang(v as Lang)}>
                  <TabsList className="rounded-xl">
                    <TabsTrigger value="en" className="rounded-xl">English</TabsTrigger>
                    <TabsTrigger value="ar" className="rounded-xl">العربية</TabsTrigger>
                    <TabsTrigger value="fr" className="rounded-xl">Français</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent>
              <div className={cls("grid grid-cols-1 xl:grid-cols-2 gap-6", lang==='ar' ? 'rtl text-right' : 'ltr text-left')} dir={lang==='ar'? 'rtl':'ltr'}>
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Headlines</h3>
                    <Badge variant="secondary">{current.headlines.length}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {current.headlines.map((h, i) => (
                      <HeadlineChip key={i} text={h} active={i === headlineIdx} onClick={() => setHeadlineIdx(i)} />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Ad copies</h3>
                    <div className="flex items-center gap-2">
                      {current.ad_copies.map((_, i) => (
                        <Button key={i} variant={i === copyIdx ? "default" : "outline"} className="rounded-xl h-8 px-3" onClick={() => setCopyIdx(i)}>Copy {i + 1}</Button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border p-4 bg-white shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-slate-500">Characters: {currentCopy.length}</div>
                      <Button size="sm" variant="ghost" onClick={() => copy(currentCopy)}>
                        <Clipboard className="h-4 w-4 mr-2" /> Copy
                      </Button>
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{currentCopy}</pre>
                  </div>
                </div>

                <div className="xl:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4" />
                      <h3 className="font-semibold">Mobile Ad Preview</h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>Headline {headlineIdx + 1} / {current.headlines.length}</span>
                      <span className="mx-2">·</span>
                      <span>Copy {copyIdx + 1} / {current.ad_copies.length}</span>
                    </div>
                  </div>
                  <MobileAd title={current.angle_title} headline={currentHeadline} body={currentCopy} />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">Quick polish</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button variant="outline" className="rounded-xl justify-start" onClick={() => copy(`${currentHeadline}\n\n${currentCopy}`)}>
                  <Wand2 className="h-4 w-4 mr-2" /> Copy headline + copy
                </Button>
                <Button variant="outline" className="rounded-xl justify-start" onClick={() => copy(current.headlines.join(" | "))}>
                  <Filter className="h-4 w-4 mr-2" /> Copy headlines (one line)
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">Variants</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600">Duplicate the selected angle and tweak for A/B tests (CTA, first 3 words, emoji usage, length).</p>
                <div className="mt-3 flex gap-2">
                  <Button className="rounded-xl" style={{ backgroundColor: BRAND.primary }} onClick={() => copy(`A) ${currentHeadline}\nB) ${currentHeadline.replace(/\\b\\w+\\b/g, (w, idx) => (idx < 1 ? "Cozy" : w))}`)}>
                    <Sparkles className="h-4 w-4 mr-2" /> Suggest alt headline
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => copy(currentCopy.replace(/\n\n/g, " "))}>
                    <Sparkles className="h-4 w-4 mr-2" /> One‑paragraph version
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea placeholder="Add creative notes… (audience, hook, visuals, CTA)" className="rounded-xl" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ChatKit (Agent Builder) */}
      <div className="mx-auto max-w-7xl px-4 pb-10">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Agent Builder Chat</CardTitle>
          </CardHeader>
          <CardContent>
            <ChatKitWidget />
          </CardContent>
        </Card>
      </div>

      <div className="mt-10 border-t">
        <div className="mx-auto max-w-7xl px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="text-sm text-slate-500">Built for high‑converting ads · Designed for Irrakids</div>
          <div className="flex items-center gap-2 text-xs">
            <Badge style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>Headlines</Badge>
            <Badge variant="outline">Ad Copy</Badge>
            <Badge variant="secondary">Preview</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}


