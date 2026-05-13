"use client"
import React, { useMemo, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { Check, Clipboard, Download, FileJson, Smartphone, Wand2, Upload, Sparkles, ChevronDown, CopyCheck, Filter, Loader2, Globe2, NotebookText } from "lucide-react"

const BRAND = { primary: "#004AAD", primarySoft: "#E8F0FF", accent: "#0ea5e9", ok: "#16a34a" }

type AgentOutput = { angles: { angle_title: string; headlines: string[]; ad_copies: string[] }[] }

const SAMPLE: AgentOutput = {
  angles: [
    {
      angle_title: "Elegant Warmth, Zero Itch",
      headlines: [
        "Stand-out warmth, soft on skin",
        "Light yet cozy—morning smiles",
        "One set, endless compliments",
        "Breathe easy, stay toasty",
        "Unisex style that just works",
        "Layer now, love all season",
      ],
      ad_copies: [
        `Elegant. Comfy. Warm.\n\nHe’ll look sharp and feel snug—without the sweat. This fleece-lined three-piece (hoodie, joggers, zip vest) gives breathable warmth that’s light for class and cozy for the ride home. Soft on delicate skin, no itch. The zip vest makes dressing easy, and the modern cut keeps him looking uniquely put‑together on chilly days. Parents love the easy coordination—no more mismatched layers. Made for school, playdates, and weekend outings. Sizes 9m–10y with colors that pair effortlessly. Unisex-friendly styling that’s simple to share across siblings. Not bulky, not thin—just right.\n\nFast 24–48h delivery + Cash on Delivery.`,
        `Elegant. Comfy. Warm.\n\nYour little one stays warm, looks distinct, and moves free. This plush‑lined hoodie set with a thickened zip vest balances heat so he won’t overheat in class, yet won’t feel cold outside. Touchably soft inside, zero scratchy seams. Easy zip = quick mornings. Clean, modern lines mean compliments at school and smiles in photos. Effortless to match; colors designed to mix with sneakers and backpacks. Unisex styling and a full size range 9m–10y so siblings can share. Layer over tees in autumn and under coats in winter—without bulk.\n\nFast 24–48h delivery + Cash on Delivery.`,
      ],
    },
    {
      angle_title: "Confident Style, Everyday Ease",
      headlines: [
        "Watch him walk in confident",
        "Cozy layers, cooler class",
        "Three pieces, zero hassle",
        "Warmth that breathes",
        "Cute today, comfy all day",
        "Style that keeps up",
      ],
      ad_copies: [
        `Elegant. Comfy. Warm.\n\nGive him the winter set that feels as good as it looks. Plush “plus‑velvet” lining brings real warmth—without the heavy, sweaty bulk. The zip vest layers easily for bus rides, classrooms, and playground runs. It’s soft and itch‑free against sensitive skin, with durable fabric that holds shape. Unisex-friendly styling, trendy colors, and sizes 9m–10y make outfit planning simple. Not too thin, not too hot—just right for school, playdates, and weekend outings. Parents feel proud, kids feel confident.\n\nFast 24–48h delivery + Cash on Delivery.`,
        `Elegant. Comfy. Warm.\n\nA coordinated hoodie + jogger + thickened vest set that solves winter dressing: breathable warmth, zero itch, and no bulky overheating. The clean design looks polished for school and fun for play. Easy zip saves time; smart colors mix with everything. Unisex fit works across siblings, with sizes 9m–10y. Perfect for autumn layering and winter warmth—light on the move, cozy at rest. You’ll love the compliments; he’ll love the comfort.\n\nFast 24–48h delivery + Cash on Delivery.`,
      ],
    },
  ],
}

const cls = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ")
const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast.success("Copied to clipboard") }

function isAgentOutput(x: any): x is AgentOutput {
  return x && Array.isArray(x.angles) && x.angles.every((a: any) => typeof a.angle_title === "string" && Array.isArray(a.headlines) && a.headlines.every((h: any) => typeof h === "string") && Array.isArray(a.ad_copies) && a.ad_copies.every((c: any) => typeof c === "string"))
}

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
  )
}

function HeadlineChip({ text, active, onClick }: { text: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cls("px-3 py-2 rounded-full text-sm border transition shadow-sm", active ? "border-transparent text-slate-900" : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700")} style={active ? { backgroundColor: BRAND.primarySoft } : undefined}>
      {text}
    </button>
  )
}

export default function AdsAgentClient({ initial, defaultEndpoint }: { initial?: AgentOutput; defaultEndpoint?: string }) {
  const [data, setData] = useState<AgentOutput>(initial ?? SAMPLE)
  const [selected, setSelected] = useState(0)
  const [headlineIdx, setHeadlineIdx] = useState(0)
  const [copyIdx, setCopyIdx] = useState(0)
  const [raw, setRaw] = useState("")

  const [endpoint, setEndpoint] = useState(defaultEndpoint ?? "/api/chatkit/run")
  const [mode, setMode] = useState<"url" | "text">("url")
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<"idle" | "sending" | "processing" | "received" | "error">("idle")

  type TestResult = { name: string; pass: boolean; message?: string }
  const [tests, setTests] = useState<TestResult[]>([])

  const current = data.angles[selected]
  const currentHeadline = current.headlines[headlineIdx] ?? ""
  const currentCopy = current.ad_copies[copyIdx] ?? ""

  useEffect(() => { setHeadlineIdx(0); setCopyIdx(0) }, [selected])

  const stats = useMemo(() => {
    const totalHeadlines = data.angles.reduce((sum, a) => sum + a.headlines.length, 0)
    const totalCopies = data.angles.reduce((sum, a) => sum + a.ad_copies.length, 0)
    return { angles: data.angles.length, totalHeadlines, totalCopies }
  }, [data])

  const importJSON = () => {
    try {
      const parsed = JSON.parse(raw)
      if (!isAgentOutput(parsed)) throw new Error("JSON does not match expected shape { angles:[{ angle_title, headlines[], ad_copies[] }] }")
      setData(parsed)
      toast.success("Agent output loaded")
    } catch (e: any) {
      toast.error(`Invalid JSON: ${e.message}`)
    }
  }

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ad-angles-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyAllHeadlines = () => { const txt = current.headlines.map((h, i) => `${i + 1}. ${h}`).join("\n"); copy(txt) }
  const copyAllCopies = () => { const txt = current.ad_copies.map((c, i) => `Copy ${i + 1}:\n${c}`).join("\n\n---\n\n"); copy(txt) }

  const runAgent = async () => {
    if (!endpoint) { toast.error("Please provide an agent endpoint URL"); return }
    if (mode === "url" && !url) { toast.error("Please paste a product/landing page URL"); return }
    if (mode === "text" && !text.trim()) { toast.error("Please enter product text"); return }
    setLoading(true)
    setProgress("sending")
    try {
      const payload: any = { mode }
      if (mode === "url") payload.url = url
      if (mode === "text") payload.text = text
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      setProgress("processing")
      const json = await res.json()
      const mapped = mapToAgentOutput(json)
      if (!isAgentOutput(mapped)) throw new Error("Agent response missing required fields.")
      setData(mapped)
      setSelected(0); setHeadlineIdx(0); setCopyIdx(0)
      toast.success("Agent output received")
      setProgress("received")
    } catch (err: any) {
      console.error(err)
      toast.error(`Agent call failed: ${err.message ?? err}`)
      setProgress("error")
    } finally { setLoading(false) }
  }

  function mapToAgentOutput(resp: any): AgentOutput {
    if (isAgentOutput(resp)) return resp
    if (resp?.angles) {
      const norm = resp.angles.map((a: any) => ({
        angle_title: a.angle_title ?? a.title ?? a.angle ?? "Untitled Angle",
        headlines: Array.isArray(a.headlines) ? a.headlines : Array.isArray(a.titles) ? a.titles : [],
        ad_copies: Array.isArray(a.ad_copies) ? a.ad_copies : Array.isArray(a.copies) ? a.copies : Array.isArray(a.descriptions) ? a.descriptions : [],
      }))
      return { angles: norm } as AgentOutput
    }
    if (resp?.angle_title || resp?.headlines || resp?.ad_copies) {
      return { angles: [{ angle_title: resp.angle_title ?? resp.title ?? resp.angle ?? "Untitled Angle", headlines: Array.isArray(resp.headlines) ? resp.headlines : Array.isArray(resp.titles) ? resp.titles : [], ad_copies: Array.isArray(resp.ad_copies) ? resp.ad_copies : Array.isArray(resp.copies) ? resp.copies : Array.isArray(resp.descriptions) ? resp.descriptions : [] }] }
    }
    return SAMPLE
  }

  const runDevTests = () => {
    const results: TestResult[] = []
    try { const ok = isAgentOutput(SAMPLE); results.push({ name: "T1: SAMPLE matches AgentOutput", pass: ok, message: ok ? "OK" : "Shape mismatch" }) } catch (e: any) { results.push({ name: "T1: SAMPLE matches AgentOutput", pass: false, message: e.message }) }
    try {
      const near = { angles: [{ title: "Angle A", titles: ["H1"], descriptions: ["C1"] }, { angle: "Angle B", headlines: ["H2"], copies: ["C2"] }] }
      const mapped = mapToAgentOutput(near)
      const ok2 = isAgentOutput(mapped) && mapped.angles.length === 2 && mapped.angles[0].headlines[0] === "H1" && mapped.angles[1].ad_copies[0] === "C2"
      results.push({ name: "T2: map variant shapes", pass: ok2, message: ok2 ? "OK" : "Mapping failed" })
    } catch (e: any) { results.push({ name: "T2: map variant shapes", pass: false, message: e.message }) }
    try { const single = { angle_title: "Solo", headlines: ["H"], ad_copies: ["C"] }; const mapped = mapToAgentOutput(single); const ok3 = isAgentOutput(mapped) && mapped.angles.length === 1 && mapped.angles[0].angle_title === "Solo"; results.push({ name: "T3: wrap single angle", pass: ok3, message: ok3 ? "OK" : "Wrap failed" }) } catch (e: any) { results.push({ name: "T3: wrap single angle", pass: false, message: e.message }) }
    try { const bad = { nope: true }; const mapped = mapToAgentOutput(bad); const ok4 = isAgentOutput(mapped) && mapped.angles.length === SAMPLE.angles.length; results.push({ name: "T4: fallback to SAMPLE on invalid", pass: ok4, message: ok4 ? "OK" : "Fallback failed" }) } catch (e: any) { results.push({ name: "T4: fallback to SAMPLE on invalid", pass: false, message: e.message }) }
    try { const minimal = { angles: [{ angle_title: "A", headlines: [], ad_copies: [] }] }; const ok5 = isAgentOutput(minimal); results.push({ name: "T5: minimal valid payload", pass: ok5, message: ok5 ? "OK" : "Rejected minimal" }) } catch (e: any) { results.push({ name: "T5: minimal valid payload", pass: false, message: e.message }) }
    try { const tricky = { angles: [{ angle_title: "A", headlines: "H1", ad_copies: "C1" }] } as any; const mapped = mapToAgentOutput(tricky); const ok6 = isAgentOutput(mapped); results.push({ name: "T6: non-arrays become []", pass: ok6, message: ok6 ? "OK" : "Did not coerce" }) } catch (e: any) { results.push({ name: "T6: non-arrays become []", pass: false, message: e.message }) }
    setTests(results)
    toast.success("Tests executed")
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-slate-50">
      <div className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl" style={{ background: BRAND.primary }} />
            <div>
              <div className="text-sm text-slate-500">Irrakids Creative</div>
              <h1 className="text-xl font-bold tracking-tight">Ad Angles Studio</h1>
            </div>
            <Badge className="ml-3" style={{ backgroundColor: BRAND.primarySoft, color: BRAND.primary }}>v1.5</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-xl" onClick={downloadJSON}><Download className="h-4 w-4 mr-2" /> Export JSON</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="rounded-xl" style={{ backgroundColor: BRAND.primary }}>
                  <Sparkles className="h-4 w-4 mr-2" /> Actions <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => copy(JSON.stringify(current, null, 2))}><FileJson className="h-4 w-4 mr-2" /> Copy current angle JSON</DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyAllHeadlines()}><CopyCheck className="h-4 w-4 mr-2" /> Copy all headlines</DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyAllCopies()}><CopyCheck className="h-4 w-4 mr-2" /> Copy all ad copies</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Agent input</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <label className="text-xs text-slate-500">Agent Endpoint</label>
                <div className="flex gap-2">
                  <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-agent-endpoint/run" className="rounded-xl" />
                </div>
                <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="mt-2">
                  <TabsList className="grid w-full grid-cols-2 rounded-xl">
                    <TabsTrigger value="url" className="rounded-xl"><Globe2 className="h-4 w-4 mr-2" /> URL</TabsTrigger>
                    <TabsTrigger value="text" className="rounded-xl"><NotebookText className="h-4 w-4 mr-2" /> Text</TabsTrigger>
                  </TabsList>
                  <TabsContent value="url" className="mt-3">
                    <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-landing-page" className="rounded-xl" onKeyDown={(e) => { if ((e as any).key === 'Enter') runAgent() }} />
                  </TabsContent>
                  <TabsContent value="text" className="mt-3">
                    <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste product details, features, sizes, offers…" className="min-h-[120px] rounded-xl" />
                  </TabsContent>
                </Tabs>
                {/* Inline progress animation */}
                <div className="mt-2 min-h-[48px]">
                  {progress !== "idle" && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 overflow-hidden">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-600 truncate">
                          {mode === 'url' && url ? url : (mode === 'text' ? 'Text input' : '')}
                        </div>
                        <div className="text-xs font-medium text-slate-700">
                          {progress === 'sending' && 'Sending'}
                          {progress === 'processing' && 'Processing'}
                          {progress === 'received' && 'Received'}
                          {progress === 'error' && 'Error'}
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                        <div className={"h-1.5 rounded-full transition-all duration-700 " + (
                          progress === 'sending' ? 'w-1/3 bg-sky-400 animate-pulse' :
                          progress === 'processing' ? 'w-2/3 bg-indigo-500 animate-pulse' :
                          progress === 'received' ? 'w-full bg-emerald-500' :
                          progress === 'error' ? 'w-full bg-rose-500' : 'w-0')}></div>
                      </div>
                      {progress === 'processing' && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="relative h-5 w-5">
                            <span className="absolute inset-0 rounded-full border-2 border-indigo-500/30"></span>
                            <span className="absolute inset-0 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"></span>
                          </div>
                          <div className="text-xs text-slate-500">Agent is analyzing and generating outputs…</div>
                        </div>
                      )}
                      {progress === 'received' && (
                        <div className="mt-2 text-xs text-emerald-600">Outputs returned successfully</div>
                      )}
                      {progress === 'error' && (
                        <div className="mt-2 text-xs text-rose-600">There was an error running the agent</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button className="rounded-xl" style={{ backgroundColor: BRAND.primary }} onClick={runAgent} disabled={loading}>
                    {loading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…</>) : (<><Sparkles className="h-4 w-4 mr-2" /> Run Agent</>)}
                  </Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => { setUrl(""); setText("") }}>Clear</Button>
                </div>
                <div className="text-xs text-slate-500">Expects response shape: {'{'} angles: [{'{'} angle_title, headlines[], ad_copies[] {'}'}] {'}'}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Angles ({stats.angles})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {data.angles.map((a, i) => (
                  <button key={i} onClick={() => setSelected(i)} className={cls("w-full text-left p-3 rounded-xl border transition", i === selected ? "bg-white border-transparent shadow-sm ring-2" : "bg-slate-50 hover:bg-white border-slate-200")} style={i === selected ? { boxShadow: `0 0 0 2px ${BRAND.primarySoft}` } : {}}>
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
              <div className="mt-4 text-xs text-slate-500">Headlines total: {stats.totalHeadlines} · Copies total: {stats.totalCopies}</div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl mt-6 border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Dev Tests</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600">Quick runtime checks for mapping & shape validation.</p>
              <div className="mt-3 flex gap-2"><Button className="rounded-xl" variant="outline" onClick={runDevTests}><Check className="h-4 w-4 mr-2" /> Run Tests</Button></div>
              {tests.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {tests.map((t, i) => (
                    <li key={i} className="flex items-center justify-between rounded-xl border p-2">
                      <span className="text-sm">{t.name}</span>
                      <Badge style={{ backgroundColor: t.pass ? BRAND.primarySoft : "#fee2e2", color: t.pass ? BRAND.primary : "#991b1b" }}>{t.pass ? "PASS" : "FAIL"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-8">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-500">Selected angle</div>
                  <CardTitle className="text-2xl">{current.angle_title}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="rounded-xl" onClick={() => copyAllHeadlines()}><Clipboard className="h-4 w-4 mr-2" /> Copy headlines</Button>
                  <Button className="rounded-xl" style={{ backgroundColor: BRAND.primary }} onClick={() => copyAllCopies()}><Clipboard className="h-4 w-4 mr-2" /> Copy ad copies</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div>
                  <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Headlines</h3><Badge variant="secondary">{current.headlines.length}</Badge></div>
                  <div className="flex flex-wrap gap-2">
                    {current.headlines.map((h, i) => (<HeadlineChip key={i} text={h} active={i === headlineIdx} onClick={() => setHeadlineIdx(i)} />))}
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
                      <Button size="sm" variant="ghost" onClick={() => copy(currentCopy)}><Clipboard className="h-4 w-4 mr-2" /> Copy</Button>
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{currentCopy}</pre>
                  </div>
                </div>
                <div className="xl:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2"><Smartphone className="h-4 w-4" /><h3 className="font-semibold">Mobile Ad Preview</h3></div>
                    <div className="flex items-center gap-2 text-xs text-slate-500"><span>Headline {headlineIdx + 1} / {current.headlines.length}</span><span className="mx-2">·</span><span>Copy {copyIdx + 1} / {current.ad_copies.length}</span></div>
                  </div>
                  <MobileAd title={current.angle_title} headline={currentHeadline} body={currentCopy} />
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
            <Card className="rounded-2xl">
              <CardHeader><CardTitle className="text-base">Quick polish</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button variant="outline" className="rounded-xl justify-start" onClick={() => copy(`${currentHeadline}\n\n${currentCopy}`)}><Wand2 className="h-4 w-4 mr-2" /> Copy headline + copy</Button>
                <Button variant="outline" className="rounded-xl justify-start" onClick={() => copy(current.headlines.join(" | "))}><Filter className="h-4 w-4 mr-2" /> Copy headlines (one line)</Button>
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader><CardTitle className="text-base">Variants</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600">Duplicate the selected angle in your editor and tweak for A/B tests (CTA, first 3 words, emoji usage, length).</p>
                <div className="mt-3 flex gap-2">
                  <Button className="rounded-xl" style={{ backgroundColor: BRAND.primary }} onClick={() => copy(`A) ${currentHeadline}\nB) ${currentHeadline.replace(/\\b\\w+\\b/g, (w) => w)}`)}><Sparkles className="h-4 w-4 mr-2" /> Suggest alt headline</Button>
                  <Button variant="outline" className="rounded-xl" onClick={() => copy(currentCopy.replace(/\n\n/g, " "))}><Sparkles className="h-4 w-4 mr-2" /> One‑paragraph version</Button>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent><Textarea placeholder="Add creative notes… (audience, hook, visuals, CTA)" className="rounded-xl" /></CardContent>
            </Card>
          </div>
        </div>
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
  )
}
