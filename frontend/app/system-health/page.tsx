"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  systemHealthLogin,
  systemHealthSnapshot,
  systemHealthStatus,
  systemHealthRefreshConfirmation,
  systemHealthClearIncidents,
} from "@/lib/api"

type Level = "ok" | "warn" | "crit"

type StatusResp = {
  level: Level
  reasons: Array<{ level: Level; code: string; msg: string; value?: any; threshold?: any; provider?: string; surface?: string; ids?: string[] }>
  uptime_s?: number
  now?: number
}

function levelColor(l: Level): string {
  if (l === "crit") return "bg-red-600 text-white"
  if (l === "warn") return "bg-amber-500 text-white"
  return "bg-emerald-600 text-white"
}
function levelText(l: Level): string {
  return l.toUpperCase()
}
function fmtMs(n?: number | null): string {
  if (n == null) return "—"
  if (n >= 10000) return `${(n / 1000).toFixed(1)}s`
  return `${Math.round(n)}ms`
}
function fmtPct(n?: number | null): string {
  if (n == null || isNaN(Number(n))) return "—"
  return `${(Number(n) * 100).toFixed(1)}%`
}
function fmtTime(ts?: number | null): string {
  if (!ts) return "—"
  try { return new Date(ts * 1000).toLocaleTimeString() } catch { return "—" }
}
function fmtDuration(s?: number | null): string {
  if (s == null) return "—"
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h${Math.round((s % 3600) / 60)}m`
}
function fmtDateTime(ts?: number | null): string {
  if (!ts) return "—"
  try {
    const d = new Date(ts * 1000)
    return d.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return "—"
  }
}

function Card({ title, right, children, tone = "default" as "default" | "ok" | "warn" | "crit" }: { title: string; right?: React.ReactNode; children: React.ReactNode; tone?: "default" | "ok" | "warn" | "crit" }) {
  const ring = tone === "crit" ? "ring-2 ring-red-300" : tone === "warn" ? "ring-2 ring-amber-300" : ""
  return (
    <div className={`bg-white border rounded-2xl shadow-sm text-slate-800 ${ring}`}>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="font-semibold text-sm text-slate-900">{title}</div>
        <div>{right}</div>
      </div>
      <div className="px-4 pb-4 text-slate-800">{children}</div>
    </div>
  )
}

function SummaryStats({ s }: { s: any }) {
  if (!s || !s.count) return <div className="text-xs text-slate-500">no samples yet</div>
  return (
    <div className="grid grid-cols-4 gap-2 text-xs">
      <Stat label="p50" value={fmtMs(s.p50)} />
      <Stat label="p95" value={fmtMs(s.p95)} />
      <Stat label="p99" value={fmtMs(s.p99)} />
      <Stat label="max" value={fmtMs(s.max)} />
      <Stat label="n" value={String(s.count)} />
      <Stat label="ok" value={String(s.ok)} />
      <Stat label="err" value={String(s.err)} className={s.err > 0 ? "text-red-600 font-semibold" : "text-slate-800"} />
      <Stat label="err%" value={fmtPct(s.err_rate)} className={s.err_rate > 0.1 ? "text-red-600 font-semibold" : s.err_rate > 0 ? "text-amber-700" : "text-slate-800"} />
    </div>
  )
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-slate-50 rounded px-2 py-1 border">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`text-sm tabular-nums text-slate-900 ${className}`}>{value}</div>
    </div>
  )
}

function OpTable({ rows, opCol = "op" }: { rows: any[]; opCol?: string }) {
  if (!rows || rows.length === 0) return <div className="text-xs text-slate-500">no samples yet</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums text-slate-800">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-2 font-normal">{opCol}</th>
            <th className="py-1 px-1 font-normal text-right">n</th>
            <th className="py-1 px-1 font-normal text-right">p50</th>
            <th className="py-1 px-1 font-normal text-right">p95</th>
            <th className="py-1 px-1 font-normal text-right">p99</th>
            <th className="py-1 px-1 font-normal text-right">max</th>
            <th className="py-1 px-1 font-normal text-right">err%</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((r, i) => (
            <tr key={i} className="border-t">
              <td className="py-1 pr-2 truncate max-w-[260px] text-slate-800" title={r.op || ""}>{r.op || "—"}</td>
              <td className="py-1 px-1 text-right">{r.count}</td>
              <td className="py-1 px-1 text-right">{fmtMs(r.p50)}</td>
              <td className="py-1 px-1 text-right">{fmtMs(r.p95)}</td>
              <td className="py-1 px-1 text-right">{fmtMs(r.p99)}</td>
              <td className="py-1 px-1 text-right">{fmtMs(r.max)}</td>
              <td className={`py-1 px-1 text-right ${r.err_rate > 0.1 ? "text-red-600 font-semibold" : r.err_rate > 0 ? "text-amber-700" : "text-slate-500"}`}>{fmtPct(r.err_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ErrorList({ rows }: { rows: Array<{ ts: number; op: string; error: string }> }) {
  if (!rows || rows.length === 0) return <div className="text-xs text-slate-500">no recent errors</div>
  return (
    <div className="space-y-1 max-h-[180px] overflow-y-auto">
      {rows.map((r, i) => (
        <div key={i} className="text-xs border-l-2 border-red-300 pl-2">
          <div className="text-slate-500">{fmtTime(r.ts)} <span className="text-slate-400">·</span> <span className="text-slate-700">{r.op}</span></div>
          <div className="text-red-700 truncate" title={r.error}>{r.error}</div>
        </div>
      ))}
    </div>
  )
}

function IncidentLog({ incidents, onClear }: { incidents: any[]; onClear: () => void }) {
  if (!incidents || incidents.length === 0) {
    return <div className="text-xs text-slate-500">no incidents recorded yet</div>
  }
  const open = incidents.filter((i) => !i.resolved_at)
  const resolved = incidents.filter((i) => i.resolved_at)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <div className="text-slate-600">
          <span className="font-semibold text-slate-900">{open.length}</span> open ·{" "}
          <span className="font-semibold text-slate-900">{resolved.length}</span> resolved
        </div>
        <button onClick={onClear} className="text-[11px] rounded border px-2 py-0.5 hover:bg-slate-50 text-slate-700">
          Clear history
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-slate-800">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-normal">status</th>
              <th className="py-1 pr-2 font-normal">level</th>
              <th className="py-1 pr-2 font-normal">code</th>
              <th className="py-1 pr-2 font-normal">message</th>
              <th className="py-1 pr-2 font-normal">first seen</th>
              <th className="py-1 pr-2 font-normal">last seen</th>
              <th className="py-1 pr-2 font-normal">resolved</th>
              <th className="py-1 pr-2 font-normal text-right">ticks</th>
            </tr>
          </thead>
          <tbody>
            {incidents.slice(0, 50).map((e: any) => (
              <tr key={e.id} className={`border-t ${!e.resolved_at ? (e.level === "crit" ? "bg-red-50" : "bg-amber-50") : ""}`}>
                <td className="py-1 pr-2">
                  {e.resolved_at ? (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">RESOLVED</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-semibold">OPEN</span>
                  )}
                </td>
                <td className="py-1 pr-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${levelColor(e.level)}`}>{e.level?.toUpperCase()}</span>
                </td>
                <td className="py-1 pr-2 font-mono text-[11px] text-slate-700">{e.code}</td>
                <td className="py-1 pr-2 text-slate-800 truncate max-w-[420px]" title={e.msg}>{e.msg}</td>
                <td className="py-1 pr-2 text-slate-600 tabular-nums">{fmtDateTime(e.first_seen)}</td>
                <td className="py-1 pr-2 text-slate-600 tabular-nums">{fmtDateTime(e.last_seen)}</td>
                <td className="py-1 pr-2 text-slate-600 tabular-nums">{e.resolved_at ? fmtDateTime(e.resolved_at) : "—"}</td>
                <td className="py-1 pr-2 text-right tabular-nums text-slate-700">{e.tick_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function SystemHealthPage() {
  const [authed, setAuthed] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loginErr, setLoginErr] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusResp | null>(null)
  const [snap, setSnap] = useState<any | null>(null)
  const [snapErr, setSnapErr] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      const tok = localStorage.getItem("ptos_system_admin_token") || ""
      if (tok) setAuthed(true)
    } catch {}
  }, [])

  const doLogin = useCallback(async () => {
    setLoginErr(null)
    try {
      const res = await systemHealthLogin({ email, password, remember: true })
      if (res?.error) { setLoginErr(res.error + (res.hint ? ` — ${res.hint}` : "")); return }
      const tok = res?.data?.token
      if (!tok) { setLoginErr("missing_token"); return }
      try { localStorage.setItem("ptos_system_admin_token", tok) } catch {}
      setAuthed(true)
    } catch (e: any) {
      setLoginErr(String(e?.response?.data?.error || e?.message || e))
    }
  }, [email, password])

  const doLogout = useCallback(() => {
    try { localStorage.removeItem("ptos_system_admin_token") } catch {}
    setAuthed(false); setStatus(null); setSnap(null)
  }, [])

  const fetchAll = useCallback(async () => {
    try {
      const [st, sn] = await Promise.all([systemHealthStatus(), systemHealthSnapshot()])
      if (st?.error === "unauthorized" || sn?.error === "unauthorized") { doLogout(); return }
      if (st?.data) setStatus(st.data)
      if (sn?.data) { setSnap(sn.data); setSnapErr(null) }
      if (sn?.error) setSnapErr(String(sn.error))
      setLastFetched(Date.now())
    } catch (e: any) {
      setSnapErr(String(e?.response?.data?.error || e?.message || e))
    }
  }, [doLogout])

  useEffect(() => {
    if (!authed) return
    fetchAll()
    if (paused) return
    pollRef.current = window.setInterval(fetchAll, 5000) as unknown as number
    return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null } }
  }, [authed, paused, fetchAll])

  const overallTone: Level = status?.level || "ok"

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-800">
        <div className="bg-white border rounded-2xl shadow p-6 w-[92vw] max-w-md text-slate-800">
          <h1 className="text-lg font-semibold mb-1 text-slate-900">System Health</h1>
          <p className="text-xs text-slate-600 mb-4">Admin-only. Credentials come from <code className="text-slate-800">SYSTEM_ADMIN_USERS</code>.</p>
          <form onSubmit={(e) => { e.preventDefault(); doLogin() }} className="space-y-3">
            <input className="w-full border rounded-lg px-3 py-2 text-sm text-slate-900 bg-white" placeholder="admin@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            <input className="w-full border rounded-lg px-3 py-2 text-sm text-slate-900 bg-white" placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <button className="w-full rounded-lg bg-slate-900 text-white py-2 text-sm font-semibold hover:bg-black">Sign in</button>
            {loginErr && <div className="text-xs text-red-600">{loginErr}</div>}
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white sticky top-0 z-10 text-slate-800">
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-full text-xs font-bold ${levelColor(overallTone)}`}>{levelText(overallTone)}</div>
          <h1 className="font-semibold text-slate-900">System Health</h1>
          {snap && (
            <span className="text-xs text-slate-600">
              uptime {fmtDuration(snap.uptime_s)} · revision {snap.deployment?.cloud_run_revision || "local"} · {snap.deployment?.use_celery_env ? "celery" : "threads"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && <span className="text-xs text-slate-600">last fetch {new Date(lastFetched).toLocaleTimeString()}</span>}
          <button onClick={() => setPaused((p) => !p)} className="text-xs rounded border px-2 py-1 bg-white hover:bg-slate-50 text-slate-800">{paused ? "Resume" : "Pause"} polling</button>
          <button onClick={fetchAll} className="text-xs rounded border px-2 py-1 bg-white hover:bg-slate-50 text-slate-800">Refresh now</button>
          <button onClick={doLogout} className="text-xs rounded border px-2 py-1 bg-white hover:bg-slate-50 text-slate-800">Sign out</button>
        </div>
      </header>

      <div className="p-4 md:p-6 space-y-4 text-slate-800">
        {/* Headline card: reasons */}
        <Card title={`Overall — ${status?.level?.toUpperCase() || "OK"}`} tone={overallTone}>
          {status && status.reasons.length === 0 ? (
            <div className="text-sm text-emerald-700">All checks pass. {snap?.request?.summary?.count ? `(${snap.request.summary.count} requests in last ${Math.round((snap.config?.window_s || 600) / 60)}m)` : ""}</div>
          ) : (
            <ul className="space-y-1 text-sm text-slate-800">
              {status?.reasons?.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${levelColor(r.level)}`}>{r.level.toUpperCase()}</span>
                  <span className="text-slate-800">
                    <span className="font-mono text-xs text-slate-500">{r.code}</span> — {r.msg}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {snapErr && <div className="mt-2 text-xs text-red-600">snapshot error: {snapErr}</div>}
        </Card>

        {/* Incident log — persistent record of past + current issues with timestamps */}
        <Card title="Incident log (past 200 issues)">
          <IncidentLog
            incidents={snap?.incidents || []}
            onClear={() => systemHealthClearIncidents().then(fetchAll)}
          />
        </Card>

        {/* Top row: deployment + cache + process */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="Deployment">
            {snap ? (
              <div className="text-xs space-y-1 text-slate-800">
                <div><span className="text-slate-500">service</span> <span className="text-slate-900">{snap.deployment?.cloud_run_service || "local"}</span></div>
                <div><span className="text-slate-500">revision</span> <span className="text-slate-900">{snap.deployment?.cloud_run_revision || "—"}</span></div>
                <div><span className="text-slate-500">instance</span> <span className="text-slate-900">{snap.deployment?.instance_id || "—"}</span></div>
                <div><span className="text-slate-500">pipeline mode</span> <span className="text-slate-900">{snap.deployment?.use_celery_env ? "celery" : "threads (sync)"}</span></div>
                <div><span className="text-slate-500">db driver</span> <span className="text-slate-900">{snap.db?.driver || "—"}</span>{snap.db?.sqlite_ephemeral_warning && <span className="ml-1 px-1.5 rounded bg-red-600 text-white">SQLite on Cloud Run</span>}</div>
              </div>
            ) : <div className="text-xs text-slate-500">loading…</div>}
          </Card>

          <Card title="Process">
            {snap?.process ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="RSS MB" value={String(snap.process.rss_mb ?? "—")} />
                <Stat label="threads" value={String(snap.process.threads ?? "—")} />
                <Stat label="asyncio tasks" value={String(snap.process.asyncio_tasks ?? "—")} />
                <Stat label="threadpool max" value={String(snap.process.threadpool_max ?? "—")} />
              </div>
            ) : <div className="text-xs text-slate-500">loading…</div>}
          </Card>

          <Card title="In-process caches">
            {snap?.cache ? (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat label="API cache" value={String(snap.cache.api_cache_size ?? "—")} />
                <Stat label="inflight futures" value={String(snap.cache.api_inflight ?? "—")} />
                <Stat label="analysis jobs" value={String(snap.cache.analysis_jobs ?? "—")} />
              </div>
            ) : <div className="text-xs text-slate-500">loading…</div>}
          </Card>
        </div>

        {/* Pipelines + Celery + Confirmation SLA */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title={`Background jobs (${snap?.pipelines?.count ?? 0})`}>
            <div className="text-xs space-y-2 text-slate-800">
              {!snap?.pipelines?.inflight?.length && <div className="text-slate-500">none running</div>}
              {snap?.pipelines?.inflight?.map((p: any) => {
                const stale = (p.age_s ?? 0) >= (snap.config?.pipeline_stale_s ?? 1800)
                return (
                  <div key={p.id} className={`border rounded p-2 ${stale ? "border-red-300 bg-red-50" : "bg-white"}`}>
                    <div className="font-mono text-[10px] text-slate-500">{p.kind}</div>
                    <div className="truncate text-slate-900">{p.label}</div>
                    <div className="text-slate-600">age {fmtDuration(p.age_s)}{p.store ? ` · ${p.store}` : ""}</div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card title="Celery worker">
            {snap?.celery ? (
              <div className="text-xs space-y-1 text-slate-800">
                <div>
                  <span className="text-slate-500">broker:</span>{" "}
                  <span className={snap.celery.broker_ok === true ? "text-emerald-700 font-semibold" : snap.celery.broker_ok === false ? "text-red-600 font-semibold" : "text-slate-600"}>
                    {snap.celery.broker_ok === true ? "ok" : snap.celery.broker_ok === false ? "down" : "?"}
                  </span>
                </div>
                <div className="text-slate-500 truncate" title={snap.celery.broker_url || ""}>{snap.celery.broker_url || "—"}</div>
                <div><span className="text-slate-500">queue depth:</span> <span className="tabular-nums text-slate-900">{snap.celery.queue_depth ?? "—"}</span></div>
                <div><span className="text-slate-500">active workers:</span> <span className="tabular-nums text-slate-900">{snap.celery.active_workers ?? "—"}</span></div>
                {snap.celery.last_error && <div className="text-red-600 truncate" title={snap.celery.last_error}>{snap.celery.last_error}</div>}
              </div>
            ) : <div className="text-xs text-slate-500">loading…</div>}
          </Card>

          <Card title="Confirmation SLA">
            {snap?.confirmation ? (
              <div className="text-xs space-y-1 text-slate-800">
                {snap.confirmation.pending ? (
                  <div className="text-slate-500">first scan in progress…</div>
                ) : snap.confirmation.error ? (
                  <div className="text-red-600 truncate" title={snap.confirmation.error}>{snap.confirmation.error}</div>
                ) : (
                  <>
                    <div className="text-2xl font-bold tabular-nums text-slate-900">{snap.confirmation.stuck_total ?? 0}</div>
                    <div className="text-slate-600">open + assigned orders without n/wtp action older than {snap.confirmation.cutoff_hours}h</div>
                    {snap.confirmation.by_store && (
                      <div className="space-y-0.5 mt-2 text-slate-800">
                        {Object.entries(snap.confirmation.by_store).map(([store, v]: any) => (
                          <div key={store} className="font-mono">{store}: {v.error ? <span className="text-red-600">{v.error}</span> : <>stuck {v.stuck} / scanned {v.scanned}{v.truncated ? " (truncated)" : ""}</>}</div>
                        ))}
                      </div>
                    )}
                    <div className="text-slate-500">checked {fmtTime(snap.confirmation.checked_at)}</div>
                  </>
                )}
                <button onClick={() => systemHealthRefreshConfirmation().then(fetchAll)} className="mt-1 text-[11px] rounded border px-2 py-0.5 hover:bg-slate-50 text-slate-700">Force refresh</button>
              </div>
            ) : <div className="text-xs text-slate-500">loading…</div>}
          </Card>
        </div>

        {/* Providers */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {snap && ["shopify", "meta", "openai", "openai_image", "gemini", "clarity"].map((p) => {
            const data = snap.providers?.[p]
            if (!data) return null
            return (
              <Card key={p} title={`${p}`}>
                <SummaryStats s={data.summary} />
                <div className="mt-3 border-t pt-2">
                  <div className="text-[10px] uppercase text-slate-500 mb-1">slowest / failing ops</div>
                  <OpTable rows={data.by_op} />
                </div>
                <div className="mt-3 border-t pt-2">
                  <div className="text-[10px] uppercase text-slate-500 mb-1">recent errors</div>
                  <ErrorList rows={data.recent_errors} />
                </div>
              </Card>
            )
          })}
        </div>

        {/* DB */}
        <Card title={`Database — ${snap?.db?.driver || "?"}`}>
          {snap?.db?.sqlite_ephemeral_warning && (
            <div className="mb-2 text-xs px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200">
              You are running SQLite on Cloud Run. The /app/data directory is ephemeral; data will not survive instance recycles. Set <code>DATABASE_URL</code> to a managed Postgres.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] uppercase text-slate-500 mb-1">overall</div>
              <SummaryStats s={snap?.db?.summary} />
              {snap?.db?.pool && (
                <div className="mt-2 text-xs space-y-0.5 text-slate-800">
                  <div><span className="text-slate-500">pool class</span> <span className="text-slate-900">{snap.db.pool.class}</span></div>
                  <div><span className="text-slate-500">size</span> <span className="text-slate-900">{snap.db.pool.size ?? "—"}</span> <span className="text-slate-500 ml-2">checked out</span> <span className="text-slate-900">{snap.db.pool.checked_out ?? "—"}</span> <span className="text-slate-500 ml-2">overflow</span> <span className="text-slate-900">{snap.db.pool.overflow ?? "—"}</span></div>
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <div className="text-[10px] uppercase text-slate-500 mb-1">slowest / failing ops</div>
              <OpTable rows={snap?.db?.by_op} />
            </div>
          </div>
        </Card>

        {/* Requests per surface */}
        <Card title="Requests by surface">
          {snap?.request?.by_surface && Object.keys(snap.request.by_surface).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums text-slate-800">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-normal">surface</th>
                    <th className="py-1 px-1 font-normal text-right">n</th>
                    <th className="py-1 px-1 font-normal text-right">p50</th>
                    <th className="py-1 px-1 font-normal text-right">p95</th>
                    <th className="py-1 px-1 font-normal text-right">p99</th>
                    <th className="py-1 px-1 font-normal text-right">max</th>
                    <th className="py-1 px-1 font-normal text-right">err%</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(snap.request.by_surface).map(([surface, s]: any) => (
                    <tr key={surface} className="border-t">
                      <td className="py-1 pr-2 font-mono text-slate-800">{surface}</td>
                      <td className="py-1 px-1 text-right">{s.count}</td>
                      <td className="py-1 px-1 text-right">{fmtMs(s.p50)}</td>
                      <td className="py-1 px-1 text-right">{fmtMs(s.p95)}</td>
                      <td className="py-1 px-1 text-right">{fmtMs(s.p99)}</td>
                      <td className="py-1 px-1 text-right">{fmtMs(s.max)}</td>
                      <td className={`py-1 px-1 text-right ${s.err_rate > 0.1 ? "text-red-600 font-semibold" : s.err_rate > 0 ? "text-amber-700" : "text-slate-500"}`}>{fmtPct(s.err_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-xs text-slate-500">no requests sampled yet</div>}
        </Card>

        {/* Slowest individual routes */}
        <Card title="Slowest / failing routes">
          <OpTable rows={snap?.request?.by_op} opCol="route" />
        </Card>

        {/* Global slow-ops feed */}
        <Card title="Slow ops feed (top 50, sorted by duration)">
          {snap?.slow_ops?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums text-slate-800">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-normal">time</th>
                    <th className="py-1 px-1 font-normal">category</th>
                    <th className="py-1 px-1 font-normal">op</th>
                    <th className="py-1 px-1 font-normal text-right">ms</th>
                    <th className="py-1 px-1 font-normal">store</th>
                    <th className="py-1 px-1 font-normal">error</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.slow_ops.map((r: any, i: number) => (
                    <tr key={i} className={`border-t ${!r.ok ? "bg-red-50" : ""}`}>
                      <td className="py-1 pr-2 text-slate-500">{fmtTime(r.ts)}</td>
                      <td className="py-1 px-1 font-mono text-slate-700">{r.category}</td>
                      <td className="py-1 px-1 truncate max-w-[260px] text-slate-800" title={r.op}>{r.op}</td>
                      <td className="py-1 px-1 text-right text-slate-900">{fmtMs(r.ms)}</td>
                      <td className="py-1 px-1 text-slate-700">{r.store || ""}</td>
                      <td className="py-1 px-1 text-red-600 truncate max-w-[280px]" title={r.error || ""}>{r.error || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="text-xs text-slate-500">no samples yet</div>}
        </Card>

        <div className="text-[10px] text-slate-500 pb-6">
          window: last {Math.round((snap?.config?.window_s || 600) / 60)} min · ring size {snap?.config?.ring_size} · in-memory only (resets on instance recycle)
        </div>
      </div>
    </div>
  )
}
