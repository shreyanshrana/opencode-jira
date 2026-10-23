import { Buffer } from "node:buffer"
import { parseCloudId, type Config } from "./config.ts"
import { statusCategory, type Category } from "./tickets.ts"

export interface Ticket {
  key: string
  title: string
  url: string
  category: Category
  status: string
  issueType?: string
}

export interface SprintTickets {
  sprints: { id: number; name: string }[]
  tickets: Ticket[]
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>
type RecordValue = Record<string, unknown>

function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected Jira response.")
  return value as RecordValue
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Unexpected Jira response.")
  return value
}

export function plainText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()
}

export class JiraError extends Error {
  readonly retryAfterSeconds?: number

  constructor(message: string, retryAfterSeconds?: number) {
    super(message)
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class JiraClient {
  private cloudId?: string
  private readonly config: Config
  private readonly fetcher: Fetch

  constructor(config: Config, fetcher: Fetch = fetch) {
    this.config = config
    this.fetcher = fetcher
    this.cloudId = config.cloudId
  }

  private async json(url: string, signal: AbortSignal, authenticated: boolean): Promise<RecordValue> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(authenticated ? { Authorization: `Basic ${Buffer.from(`${this.config.email}:${this.config.token}`).toString("base64")}` } : {}),
        },
      })
    } catch {
      if (signal.aborted) throw new Error("Jira request cancelled.")
      throw new Error("Could not reach Jira. Check your connection and try refreshing.")
    }
    if (!response.ok) {
      if (response.status === 401) throw new JiraError("Jira authentication failed. Check your email and API token.")
      if (response.status === 403) throw new JiraError("Jira access denied. Check token scopes and board permissions.")
      if (response.status === 404) throw new JiraError("Jira board or sprint not found. Check your board URL and access.")
      if (response.status === 429) {
        const header = response.headers.get("retry-after")
        const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? (Date.parse(header) - Date.now()) / 1000 : 60
        throw new JiraError("Jira rate limit reached. Waiting before retrying.", Number.isFinite(seconds) ? Math.max(30, seconds) : 60)
      }
      throw new JiraError(`Jira returned HTTP ${response.status}. Try refreshing later.`)
    }
    try {
      return object(await response.json())
    } catch {
      throw new Error("Unexpected Jira response. Expected a JSON object.")
    }
  }

  private async api(path: string, query: Record<string, string>, signal: AbortSignal): Promise<RecordValue> {
    if (!this.cloudId) {
      const tenant = await this.json(`${this.config.site}/_edge/tenant_info`, signal, false)
      if (typeof tenant.cloudId !== "string") throw new Error("Could not discover cloudId. Set it in plugin options or JIRA_CLOUD_ID.")
      this.cloudId = parseCloudId(tenant.cloudId)
    }
    const url = new URL(`https://api.atlassian.com/ex/jira/${this.cloudId}${path}`)
    url.search = new URLSearchParams(query).toString()
    return this.json(url.toString(), signal, true)
  }

  async load(signal: AbortSignal): Promise<SprintTickets> {
    const sprints: SprintTickets["sprints"] = []
    let startAt = 0
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("Too many Jira sprint pages. Refresh to try again.")
      const result = await this.api(`/rest/agile/1.0/board/${this.config.boardId}/sprint`, {
        state: "active", startAt: String(startAt), maxResults: "50",
      }, signal)
      const values = array(result.values)
      for (const value of values) {
        const sprint = object(value)
        if (!Number.isSafeInteger(sprint.id) || Number(sprint.id) <= 0 || typeof sprint.name !== "string") {
          throw new Error("Unexpected Jira sprint response.")
        }
        sprints.push({ id: Number(sprint.id), name: plainText(sprint.name) })
      }
      if (result.isLast === true || (typeof result.total === "number" && startAt + values.length >= result.total)) break
      if (!values.length) {
        if (result.isLast === false) throw new Error("Jira sprint pagination did not advance.")
        break
      }
      startAt += values.length
    }

    const tickets = new Map<string, Ticket>()
    for (const sprint of sprints) {
      let nextPageToken: string | undefined
      const seenTokens = new Set<string>()
      for (let page = 0; ; page++) {
        if (page >= 100) throw new Error("Too many Jira ticket pages. Refresh to try again.")
        const result = await this.api(`/rest/software/1.0/sprint/${sprint.id}/issue`, {
          jql: "assignee = currentUser()", fields: "summary,status,issuetype", maxResults: "100",
          ...(nextPageToken ? { nextPageToken } : {}),
        }, signal)
        for (const value of array(result.issues)) {
          const issue = object(value)
          const fields = object(issue.fields)
          if (typeof issue.key !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(issue.key) || typeof fields.summary !== "string") {
            throw new Error("Unexpected Jira ticket response.")
          }
          const status = fields.status && typeof fields.status === "object" ? fields.status as RecordValue : {}
          const category = status.statusCategory && typeof status.statusCategory === "object" ? status.statusCategory as RecordValue : {}
          const issueType = fields.issuetype && typeof fields.issuetype === "object" ? fields.issuetype as RecordValue : {}
          tickets.set(issue.key, {
            key: issue.key,
            title: plainText(fields.summary),
            url: `${this.config.site}/browse/${issue.key}`,
            category: statusCategory(category.key),
            status: typeof status.name === "string" ? plainText(status.name) : "Unknown status",
            issueType: typeof issueType.name === "string" ? plainText(issueType.name) || undefined : undefined,
          })
        }
        if (result.isLast === true) break
        if (typeof result.nextPageToken !== "string" || !result.nextPageToken) {
          if (result.isLast === false) throw new Error("Jira ticket pagination did not advance.")
          break
        }
        nextPageToken = result.nextPageToken
        if (seenTokens.has(nextPageToken)) throw new Error("Jira returned a repeated page token.")
        seenTokens.add(nextPageToken)
      }
    }
    return { sprints, tickets: [...tickets.values()] }
  }
}
