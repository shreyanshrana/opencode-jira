import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parseSite } from "./config.ts"

const run = promisify(execFile)

export function boardUrl(site: string, boardId: number): string {
  if (!Number.isSafeInteger(boardId) || boardId < 1) throw new Error("Invalid Jira board ID.")
  return `${parseSite(site)}/secure/RapidBoard.jspa?rapidView=${boardId}&view=detail`
}

export function browserCommand(url: string, platform = process.platform): [string, string[]] {
  const parsed = new URL(url)
  const ticket = /^\/browse\/[A-Z][A-Z0-9_]*-\d+$/.test(parsed.pathname) && !parsed.search
  const id = parsed.searchParams.get("rapidView") ?? ""
  const board = parsed.pathname === "/secure/RapidBoard.jspa"
    && parsed.searchParams.size === 2 && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
    && parsed.searchParams.get("view") === "detail"
  if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\.atlassian\.net$/.test(parsed.hostname) || (!ticket && !board) || parsed.username || parsed.password || parsed.port || parsed.hash) {
    throw new Error("Refusing to open an invalid Jira ticket or board URL.")
  }
  if (platform === "darwin") return ["open", [url]]
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
  return ["xdg-open", [url]]
}

export async function openJiraUrl(url: string): Promise<void> {
  const [command, args] = browserCommand(url)
  await run(command, args, { timeout: 10_000, windowsHide: true })
}
