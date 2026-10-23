import assert from "node:assert/strict"
import { test } from "node:test"
import { readConfig } from "../src/config.ts"
import { JiraClient, JiraError } from "../src/jira.ts"

const cloudId = "11111111-2222-3333-4444-555555555555"
const config = readConfig({ boardUrl: "https://team.atlassian.net/jira/software/c/projects/TEAM/boards/173", cloudId }, {
  JIRA_EMAIL: "user@example.com", JIRA_API_TOKEN: "test-token",
})
const signal = () => new AbortController().signal
const json = (body: unknown) => Response.json(body)
const issue = (key: string, summary = "Collect all pokemon", category = "new", status = "Backlog") => ({
  key, fields: { summary, status: { name: status, statusCategory: { key: category } }, issuetype: { name: "Task" } },
})

test("discovers cloud ID without sending credentials, then uses the scoped-token gateway", async () => {
  const calls: { url: URL; init: RequestInit }[] = []
  const client = new JiraClient({ ...config, cloudId: undefined }, async (input, init) => {
    const url = new URL(input)
    calls.push({ url, init })
    if (url.pathname === "/_edge/tenant_info") return json({ cloudId })
    return json({ values: [], isLast: true })
  })
  assert.deepEqual(await client.load(signal()), { sprints: [], tickets: [] })
  assert.equal(calls[0].url.origin, config.site)
  assert.equal(new Headers(calls[0].init.headers).has("Authorization"), false)
  assert.equal(calls[1].url.origin, "https://api.atlassian.com")
  assert.equal(calls[1].url.pathname, `/ex/jira/${cloudId}/rest/agile/1.0/board/173/sprint`)
  assert.equal(calls[1].url.searchParams.get("state"), "active")
  assert.equal(new Headers(calls[1].init.headers).get("Authorization"), `Basic ${Buffer.from("user@example.com:test-token").toString("base64")}`)
  assert.equal(calls[1].init.redirect, "error")
  await client.load(signal())
  assert.equal(calls.filter((call) => call.url.pathname === "/_edge/tenant_info").length, 1)
})

test("paginates active sprints and assigned-user tickets, deduplicating shared issues", async () => {
  const calls: URL[] = []
  const client = new JiraClient(config, async (input) => {
    const url = new URL(input)
    calls.push(url)
    if (url.pathname.endsWith("/sprint")) {
      return url.searchParams.get("startAt") === "0"
        ? json({ values: [{ id: 1, name: "Sprint 1" }], isLast: false })
        : json({ values: [{ id: 2, name: "Sprint 2" }], isLast: true })
    }
    assert.equal(url.searchParams.get("jql"), "assignee = currentUser()")
    assert.equal(url.searchParams.get("fields"), "summary,status,issuetype")
    if (url.pathname.endsWith("/sprint/2/issue")) return json({ issues: [issue("TEAM-5050")], isLast: true })
    return url.searchParams.has("nextPageToken")
      ? json({ issues: [issue("TEAM-5051", "Fix\nlogin\u001b[31m")], isLast: true })
      : json({ issues: [issue("TEAM-5050")], nextPageToken: "page-two", isLast: false })
  })
  const result = await client.load(signal())
  assert.equal(result.sprints.length, 2)
  assert.equal(result.tickets.length, 2)
  assert.deepEqual(result.tickets[0], { key: "TEAM-5050", title: "Collect all pokemon", url: "https://team.atlassian.net/browse/TEAM-5050", category: "todo", status: "Backlog", issueType: "Task" })
  assert.equal(result.tickets[1].title.includes("\u001b"), false)
  assert.equal(calls[1].searchParams.get("startAt"), "1")
  assert.equal(calls[3].searchParams.get("nextPageToken"), "page-two")
})

test("does not request issues when there is no active sprint", async () => {
  let count = 0
  const client = new JiraClient(config, async () => { count++; return json({ values: [], isLast: true }) })
  assert.deepEqual((await client.load(signal())).tickets, [])
  assert.equal(count, 1)
})

test("maps custom workflow statuses by Jira category, not by their names", async () => {
  const client = new JiraClient(config, async (url) => url.includes("/board/")
    ? json({ values: [{ id: 1, name: "Sprint" }], isLast: true })
    : json({ issues: [
      issue("TEAM-1", "Review", "indeterminate", "Code review"),
      issue("TEAM-2", "Ready", "new", "Ready for development"),
      issue("TEAM-3", "Finished", "done", "Released"),
      { key: "TEAM-4", fields: { summary: "No status returned" } },
    ], isLast: true }))
  const result = await client.load(signal())
  assert.deepEqual(result.tickets.map(({ category }) => category), ["in-progress", "todo", "done", "other"])
  assert.equal(result.tickets[0].status, "Code review")
  assert.equal(result.tickets[3].status, "Unknown status")
})

test("reads standard and custom issue types and tolerates missing metadata", async () => {
  const types = [{ name: "Bug" }, { name: "Story" }, { name: "Custom\nRequest" }, null, {}, { name: "  " }]
  const client = new JiraClient(config, async (url) => url.includes("/board/")
    ? json({ values: [{ id: 1, name: "Sprint" }], isLast: true })
    : json({ issues: types.map((issuetype, index) => ({
      key: `TEAM-${index + 1}`, fields: { summary: "Ticket", issuetype },
    })), isLast: true }))
  assert.deepEqual((await client.load(signal())).tickets.map(({ issueType }) => issueType), [
    "Bug", "Story", "Custom Request", undefined, undefined, undefined,
  ])
})

test("reports authentication, permission, and service errors without reflecting sensitive response bodies", async () => {
  for (const [status, message] of [[401, /authentication failed/], [403, /access denied/], [404, /not found/], [500, /HTTP 500/]] as const) {
    const client = new JiraClient(config, async () => new Response("test-token private server details", { status }))
    await assert.rejects(client.load(signal()), (error: Error) => {
      assert.match(error.message, message)
      assert.equal(error.message.includes("test-token"), false)
      return true
    })
  }
})

test("exposes rate-limit retry delay", async () => {
  const client = new JiraClient(config, async () => new Response(null, { status: 429, headers: { "Retry-After": "300" } }))
  await assert.rejects(client.load(signal()), (error: Error) => error instanceof JiraError && error.retryAfterSeconds === 300)
})

test("rejects malformed responses and repeated pagination tokens", async () => {
  const invalid = new JiraClient(config, async () => json({ values: [{ id: "not-an-id", name: "Sprint" }], isLast: true }))
  await assert.rejects(invalid.load(signal()), /Unexpected Jira sprint response/)
  const repeated = new JiraClient(config, async (url) => url.includes("/board/")
    ? json({ values: [{ id: 1, name: "Sprint" }], isLast: true })
    : json({ issues: [], isLast: false, nextPageToken: "same-token" }))
  await assert.rejects(repeated.load(signal()), /repeated page token/)
  const missing = new JiraClient(config, async (url) => url.includes("/board/")
    ? json({ values: [{ id: 1, name: "Sprint" }], isLast: true })
    : json({ issues: [], isLast: false }))
  await assert.rejects(missing.load(signal()), /did not advance/)
})

test("propagates cancellation to requests and hides network error details", async () => {
  const controller = new AbortController()
  const client = new JiraClient(config, async (_url, init) => {
    controller.abort()
    assert.equal(init.signal?.aborted, true)
    throw new Error("test-token")
  })
  await assert.rejects(client.load(controller.signal), /cancelled/)
  const offline = new JiraClient(config, async () => { throw new Error("test-token") })
  await assert.rejects(offline.load(signal()), /Could not reach Jira/)
})
