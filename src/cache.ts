import { createHash } from "node:crypto"
import type { Config } from "./config.ts"
import { JiraError, type SprintTickets } from "./jira.ts"

export const RATE_LIMIT_MESSAGE = "Jira rate limit reached. Waiting before retrying."

export interface CacheSnapshot {
  fetchedAt: number
  data: SprintTickets
}

export interface CacheState {
  snapshot: CacheSnapshot | null
  retryAt: number
}

export interface CacheStore {
  state: CacheState
  update: (mutation: (draft: CacheState) => void) => Promise<void>
}

interface RefreshResult {
  snapshot?: CacheSnapshot
  retryAt: number
  warning?: string
}

export function cacheKey(config: Config): string {
  const identity = JSON.stringify([config.site, config.boardId, config.cloudId ?? null, config.email, config.token])
  return `cache-v1-${createHash("sha256").update(identity).digest("hex")}`
}

export function retryDeadline(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function readSnapshot(value: unknown, site: string, now = Date.now()): CacheSnapshot | undefined {
  if (!object(value) || !retryDeadline(value.fetchedAt) || Number(value.fetchedAt) > now || !object(value.data)) return
  const { sprints, tickets } = value.data
  if (!Array.isArray(sprints) || !Array.isArray(tickets)) return
  if (!sprints.every((sprint) => object(sprint) && Number.isSafeInteger(sprint.id) && Number(sprint.id) > 0 && typeof sprint.name === "string")) return
  if (!tickets.every((ticket) => object(ticket)
    && typeof ticket.key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(ticket.key)
    && ticket.url === `${site}/browse/${ticket.key}`
    && typeof ticket.title === "string" && typeof ticket.status === "string"
    && ["todo", "in-progress", "done", "other"].includes(String(ticket.category))
    && (ticket.issueType === undefined || typeof ticket.issueType === "string"))) return
  return value as unknown as CacheSnapshot
}

export async function refreshCache(
  cache: CacheStore,
  config: Config,
  load: (signal: AbortSignal) => Promise<SprintTickets>,
  signal: AbortSignal,
  force = false,
  now = Date.now,
): Promise<RefreshResult> {
  signal.throwIfAborted()
  const startedAt = now()
  const snapshot = readSnapshot(cache.state.snapshot, config.site, startedAt)
  const retryAt = retryDeadline(cache.state.retryAt)
  if (retryAt > startedAt) return { snapshot, retryAt, warning: RATE_LIMIT_MESSAGE }
  if (!force && snapshot && startedAt - snapshot.fetchedAt < config.refreshSeconds * 1000) return { snapshot, retryAt }

  let data: SprintTickets
  try {
    data = await load(signal)
  } catch (cause) {
    if (!signal.aborted && cause instanceof JiraError && cause.retryAfterSeconds) {
      const deadline = Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(now() + cause.retryAfterSeconds * 1000))
      try {
        await cache.update((draft) => { draft.retryAt = Math.max(retryDeadline(draft.retryAt), deadline) })
      } catch {
        // The caller still enforces the cooldown locally if persistence fails.
      }
    }
    throw cause
  }
  signal.throwIfAborted()
  const fresh = { data, fetchedAt: now() }
  try {
    await cache.update((draft) => {
      const current = readSnapshot(draft.snapshot, config.site, now())
      if (!current || current.fetchedAt <= startedAt) draft.snapshot = fresh
    })
  } catch {
    return { snapshot: fresh, retryAt: retryDeadline(cache.state.retryAt), warning: "Jira updated, but the shared cache could not be saved." }
  }
  return { snapshot: readSnapshot(cache.state.snapshot, config.site, now()) ?? fresh, retryAt: retryDeadline(cache.state.retryAt) }
}
