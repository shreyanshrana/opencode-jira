import assert from "node:assert/strict"
import { test } from "node:test"
import { cacheKey, readSnapshot, refreshCache, retryDeadline, type CacheState, type CacheStore } from "../src/cache.ts"
import { readConfig } from "../src/config.ts"
import { JiraError, type SprintTickets } from "../src/jira.ts"

const config = readConfig({ boardUrl: "https://team.atlassian.net/jira/software/c/projects/TEAM/boards/173" }, {
  JIRA_EMAIL: "fixture@example.com", JIRA_API_TOKEN: "fixture-token",
})
const data: SprintTickets = {
  sprints: [{ id: 1, name: "Sprint 42" }],
  tickets: [{ key: "TEAM-1", title: "Fixture ticket", url: "https://team.atlassian.net/browse/TEAM-1", category: "todo", status: "Ready", issueType: "Task" }],
}
const signal = () => new AbortController().signal
function memory(initial: CacheState = { snapshot: null, retryAt: 0 }): CacheStore {
  const state = structuredClone(initial)
  return { state, update: async (mutate) => mutate(state) }
}

test("cache identity isolates tenants, boards, accounts, tokens, and cloud overrides without exposing credentials", () => {
  const key = cacheKey(config)
  assert.match(key, /^cache-v1-[a-f0-9]{64}$/)
  assert.equal(key.includes(config.email), false)
  assert.equal(key.includes(config.token), false)
  assert.equal(cacheKey({ ...config, maxHeight: 20, refreshSeconds: 300 }), key)
  for (const change of [{ site: "https://other.atlassian.net" }, { boardId: 42 }, { email: "other@example.com" }, { token: "rotated-token" }, { cloudId: "11111111-2222-3333-4444-555555555555" }]) {
    assert.notEqual(cacheKey({ ...config, ...change }), key)
  }
})

test("a second window reuses the first window's fresh result", async () => {
  const cache = memory()
  let calls = 0
  const load = async () => { calls++; return data }
  await refreshCache(cache, config, load, signal(), false, () => 1000)
  const result = await refreshCache(cache, config, load, signal(), false, () => 2000)
  assert.equal(calls, 1)
  assert.deepEqual(result.snapshot, { fetchedAt: 1000, data })
  assert.equal(JSON.stringify(cache.state).includes(config.token), false)
  assert.equal(JSON.stringify(cache.state).includes(config.email), false)
})

test("stale results remain readable while a fresh Jira result replaces them", async () => {
  const cache = memory({ snapshot: { fetchedAt: 1000, data }, retryAt: 0 })
  assert.deepEqual(readSnapshot(cache.state.snapshot, config.site, 200000)?.data, data)
  const updated = { sprints: data.sprints, tickets: [] }
  const result = await refreshCache(cache, config, async () => updated, signal(), false, () => 200000)
  assert.deepEqual(result.snapshot, { fetchedAt: 200000, data: updated })
  assert.deepEqual(cache.state.snapshot?.data.tickets, [])
})

test("manual refresh bypasses freshness but never a shared rate-limit cooldown", async () => {
  const cache = memory({ snapshot: { fetchedAt: 1000, data }, retryAt: 0 })
  let calls = 0
  const load = async () => { calls++; return data }
  await refreshCache(cache, config, load, signal(), true, () => 2000)
  assert.equal(calls, 1)
  cache.state.retryAt = 6000
  const result = await refreshCache(cache, config, load, signal(), true, () => 3000)
  assert.equal(calls, 1)
  assert.equal(result.retryAt, 6000)
  assert.match(result.warning!, /rate limit/)
  await refreshCache(cache, config, load, signal(), true, () => 6000)
  assert.equal(calls, 2)
})

test("each window applies its configured polling interval to shared freshness", async () => {
  const cache = memory({ snapshot: { fetchedAt: 1000, data }, retryAt: 0 })
  let calls = 0
  const load = async () => { calls++; return data }
  await refreshCache(cache, { ...config, refreshSeconds: 300 }, load, signal(), false, () => 200000)
  assert.equal(calls, 0)
  await refreshCache(cache, config, load, signal(), false, () => 200000)
  assert.equal(calls, 1)
})

test("shares Retry-After with other windows and retains the previous successful snapshot", async () => {
  const cache = memory({ snapshot: { fetchedAt: 1000, data }, retryAt: 0 })
  await assert.rejects(refreshCache(cache, config, async () => { throw new JiraError("Rate limited", 300) }, signal(), false, () => 200000), /Rate limited/)
  assert.equal(cache.state.retryAt, 500000)
  assert.equal(cache.state.snapshot?.fetchedAt, 1000)
  const result = await refreshCache(cache, config, async () => { throw new Error("Must not fetch") }, signal(), true, () => 250000)
  assert.equal(result.snapshot?.fetchedAt, 1000)
  assert.equal(result.retryAt, 500000)
})

test("failed requests do not replace or advance the successful cache", async () => {
  const cache = memory({ snapshot: { fetchedAt: 1000, data }, retryAt: 0 })
  await assert.rejects(refreshCache(cache, config, async () => { throw new Error("Offline") }, signal(), false, () => 200000), /Offline/)
  assert.deepEqual(cache.state, { snapshot: { fetchedAt: 1000, data }, retryAt: 0 })
})

test("a slow request does not overwrite a result another window finished during it", async () => {
  const cache = memory()
  let clock = 1000
  let resolve!: (value: SprintTickets) => void
  const slow = refreshCache(cache, config, () => new Promise((done) => { resolve = done }), signal(), false, () => clock)
  clock = 2000
  const newer = { ...data, tickets: [] }
  await refreshCache(cache, config, async () => newer, signal(), false, () => clock)
  clock = 3000
  resolve(data)
  const result = await slow
  assert.deepEqual(result.snapshot, { fetchedAt: 2000, data: newer })
  assert.deepEqual(cache.state.snapshot?.data, newer)
})

test("success never clears a cooldown set by a different window", async () => {
  const cache = memory()
  await refreshCache(cache, config, async () => {
    cache.state.retryAt = 500000
    return data
  }, signal(), false, () => 1000)
  assert.equal(cache.state.retryAt, 500000)
})

test("storage failures still return newly fetched tickets with a warning", async () => {
  const cache = memory()
  cache.update = async () => { throw new Error("Disk unavailable") }
  const result = await refreshCache(cache, config, async () => data, signal(), false, () => 1000)
  assert.deepEqual(result.snapshot, { fetchedAt: 1000, data })
  assert.match(result.warning!, /cache could not be saved/)
  await assert.rejects(refreshCache(cache, config, async () => { throw new JiraError("Rate limited", 60) }, signal(), false, () => 1000), /Rate limited/)
})

test("cancelled work never persists a successful result", async () => {
  const cache = memory()
  const controller = new AbortController()
  await assert.rejects(refreshCache(cache, config, async () => {
    controller.abort()
    return data
  }, controller.signal, false, () => 1000), { name: "AbortError" })
  assert.equal(cache.state.snapshot, null)
})

test("invalid, foreign-tenant, and future-dated snapshots are ignored", () => {
  const snapshot = { fetchedAt: 1000, data }
  assert.deepEqual(readSnapshot(snapshot, config.site, 2000), snapshot)
  for (const value of [null, {}, { fetchedAt: -1, data }, { fetchedAt: 3000, data }, { fetchedAt: 1000, data: { sprints: [], tickets: [{}] } }]) {
    assert.equal(readSnapshot(value, config.site, 2000), undefined)
  }
  assert.equal(readSnapshot(snapshot, "https://other.atlassian.net", 2000), undefined)
  assert.equal(retryDeadline("5000"), 0)
  assert.equal(retryDeadline(Infinity), 0)
  assert.equal(retryDeadline(-1), 0)
})

test("simultaneous stale checks may fetch twice without locks, as documented", async () => {
  const cache = memory()
  let calls = 0
  const load = async () => { calls++; return data }
  await Promise.all([
    refreshCache(cache, config, load, signal(), false, () => 1000),
    refreshCache(cache, config, load, signal(), false, () => 1000),
  ])
  assert.equal(calls, 2)
  assert.deepEqual(cache.state.snapshot?.data, data)
})
