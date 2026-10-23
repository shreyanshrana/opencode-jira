export interface Config {
  site: string
  boardId: number
  cloudId?: string
  email: string
  token: string
  refreshSeconds: number
  maxHeight: number
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function integer(value: unknown, name: string, fallback?: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const result = value === undefined ? fallback : Number(value)
  if (result === undefined || !Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`)
  }
  return result
}

export function parseBoardUrl(value: string): { site: string; boardId: number } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Enter a valid Jira Cloud board URL.")
  }
  const site = parseSite(url.origin)
  const id = url.pathname.match(/\/boards\/(\d+)(?:\/|$)/)?.[1] ?? url.searchParams.get("rapidView")
  if (!id) throw new Error("The board URL must contain /boards/<id> or ?rapidView=<id>.")
  return { site, boardId: integer(id, "boardId") }
}

export function parseSite(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("site must be an HTTPS Jira Cloud URL.")
  }
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.atlassian\.net$/.test(url.hostname) || url.port || url.username || url.password) {
    throw new Error("site must be an HTTPS Jira Cloud URL such as https://team.atlassian.net.")
  }
  return url.origin
}

export function parseCloudId(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new Error("cloudId must be a Jira Cloud UUID.")
  }
  return value
}

export function readConfig(options: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Config {
  const boardUrl = text(options.boardUrl) ?? text(env.JIRA_BOARD_URL)
  const board = boardUrl ? parseBoardUrl(boardUrl) : undefined
  const site = board?.site ?? parseSite(text(options.site) ?? text(env.JIRA_SITE) ?? "")
  const boardId = board?.boardId ?? integer(options.boardId ?? env.JIRA_BOARD_ID, "boardId")
  const emailEnv = text(options.emailEnv) ?? "JIRA_EMAIL"
  const tokenEnv = text(options.tokenEnv) ?? "JIRA_API_TOKEN"
  const email = text(env[emailEnv])
  const token = text(env[tokenEnv])
  if (!email || !token) throw new Error(`Set ${emailEnv} and ${tokenEnv}, then restart OpenCode.`)
  const cloudId = text(options.cloudId) ?? text(env.JIRA_CLOUD_ID)
  return {
    site,
    boardId,
    cloudId: cloudId ? parseCloudId(cloudId) : undefined,
    email,
    token,
    refreshSeconds: integer(options.refreshSeconds, "refreshSeconds", 120, 30, 86400),
    maxHeight: integer(options.maxHeight, "maxHeight", 12, 3, 40),
  }
}
