import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

export function browserCommand(url: string, platform = process.platform): [string, string[]] {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\.atlassian\.net$/.test(parsed.hostname) || !/^\/browse\/[A-Z][A-Z0-9_]*-\d+$/.test(parsed.pathname) || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("Refusing to open an invalid Jira ticket URL.")
  }
  if (platform === "darwin") return ["open", [url]]
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
  return ["xdg-open", [url]]
}

export async function openTicket(url: string): Promise<void> {
  const [command, args] = browserCommand(url)
  await run(command, args, { timeout: 10_000, windowsHide: true })
}
