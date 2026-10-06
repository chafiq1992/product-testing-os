// Sendo merchant workspaces: this app embedded in the delivery app's dashboard.
//
// The delivery app opens /profit-calculator/?embed=1#launch=<token>. The launch
// token is single-use and five minutes long; it is exchanged once for a
// workspace session that every API call then carries in X-Workspace-Token.
// A header, not a cookie: inside a cross-site iframe browsers drop or
// partition cookies. The session lives in sessionStorage so a reload of the
// frame keeps working without a new launch.
import axios from 'axios'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
// Each embeddable page belongs to one service. Same-origin frames in one tab
// share sessionStorage, so the session is stored per service: the True Profit
// and True Manager frames must not overwrite each other's session.
const PAGE_SERVICES: Array<[RegExp, string]> = [
  [/^\/profit-calculator(\/|$)/, 'true_profit'],
  [/^\/ads-management(\/|$)/, 'true_manager'],
]

export function pageService(): string | null {
  if (typeof window === 'undefined') return null
  const match = PAGE_SERVICES.find(([pattern]) => pattern.test(window.location.pathname))
  return match ? match[1] : null
}

function sessionKey(): string {
  return `sendo_workspace_session:${pageService() || 'unknown'}`
}
export const WORKSPACE_HEADER = 'X-Workspace-Token'

export type SendoConnections = {
  meta: { connected: boolean, user_name?: string | null, accounts?: number }
  shopify: { connected: boolean, shop?: string | null }
}

export type SendoSession = {
  token: string
  expires_at: number
  workspace: string
  merchant_name?: string | null
  service: string
  connections?: SendoConnections
}

let active: SendoSession | null = null

function readStored(): SendoSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as SendoSession
    return parsed && parsed.token && parsed.expires_at * 1000 > Date.now() + 60_000 ? parsed : null
  } catch { return null }
}

function activate(session: SendoSession) {
  active = session
  axios.defaults.headers.common[WORKSPACE_HEADER] = session.token
  try { sessionStorage.setItem(sessionKey(), JSON.stringify(session)) } catch {}
  // Some pages read the store from localStorage in their first render. The
  // frame's storage is partitioned from the top-level site, so this never
  // touches an operator's own selection.
  try {
    localStorage.setItem('ptos_store', session.workspace)
    localStorage.removeItem('ptos_stores_multi')
  } catch {}
}

/** True when this page was opened by the delivery app (now or earlier in this frame). */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false
  if (active) return true
  try {
    if (new URLSearchParams(window.location.search).get('embed') === '1') return true
  } catch {}
  return !!readStored()
}

/** The workspace store label while embedded, else null. */
export function embeddedWorkspace(): string | null {
  return active?.workspace || readStored()?.workspace || null
}

export function embeddedSession(): SendoSession | null {
  return active
}

/** Exchange the launch token in the URL fragment, or resume this frame's session. */
export async function startEmbeddedSession(): Promise<SendoSession> {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const launch = hash.get('launch')
  if (launch) {
    // Drop the token from the address bar and history before anything else.
    try { history.replaceState(null, '', window.location.pathname + window.location.search) } catch {}
    const { data } = await axios.post(`${API}/api/sendo/session`, { launch })
    if (!data?.data?.token) throw new Error(data?.error || 'launch_failed')
    if (data.data.service !== pageService()) throw new Error('wrong_service')
    activate(data.data as SendoSession)
    return active as SendoSession
  }
  const stored = readStored()
  if (stored) {
    activate(stored)
    return stored
  }
  throw new Error('session_expired')
}

export async function refreshConnections(): Promise<SendoConnections | null> {
  const ws = embeddedWorkspace()
  if (!ws) return null
  const { data } = await axios.get(`${API}/api/sendo/me`, { params: { store: ws } })
  const connections = data?.data?.connections || null
  if (active && connections) active = { ...active, connections }
  return connections
}

export async function syncStores(): Promise<SendoConnections | null> {
  const ws = embeddedWorkspace()
  if (!ws) return null
  const { data } = await axios.post(`${API}/api/sendo/sync-stores`, null, { params: { store: ws } })
  return data?.data?.connections || null
}

/** Opens Meta's consent screen in a popup; resolves when that popup reports back or closes. */
export async function connectMeta(): Promise<void> {
  const ws = embeddedWorkspace()
  if (!ws) throw new Error('not_embedded')
  // Open synchronously from the click, then point it at Meta, so popup
  // blockers treat it as user-initiated.
  const popup = window.open('', 'sendo-meta-connect', 'popup=yes,width=640,height=760')
  try {
    const { data } = await axios.post(`${API}/api/connections/meta/start`, { store: ws, return_origin: window.location.origin })
    const url = data?.data?.url
    if (!url) throw new Error(data?.error || 'meta_start_failed')
    if (popup) popup.location.href = url
    else window.open(url, '_blank', 'noopener')
  } catch (err) {
    try { popup?.close() } catch {}
    throw err
  }
  await new Promise<void>(resolve => {
    const done = () => { window.removeEventListener('message', onMessage); clearInterval(timer); resolve() }
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'sendo-meta-connect') done()
    }
    window.addEventListener('message', onMessage)
    const timer = setInterval(() => { if (!popup || popup.closed) done() }, 700)
  })
}
