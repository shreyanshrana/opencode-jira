import assert from "node:assert/strict"
import { test } from "node:test"
import { parseBoardUrl, readConfig } from "../src/config.ts"

const boardUrl = "https://team.atlassian.net/jira/software/c/projects/TEAM/boards/173"
const env = { JIRA_EMAIL: "user@example.com", JIRA_API_TOKEN: "test-token" }

test("parses modern and legacy board URLs", () => {
  assert.deepEqual(parseBoardUrl(boardUrl), { site: "https://team.atlassian.net", boardId: 173 })
  assert.deepEqual(parseBoardUrl("https://team.atlassian.net/secure/RapidBoard.jspa?rapidView=42"), {
    site: "https://team.atlassian.net", boardId: 42,
  })
})

test("uses user options and environment credentials without hardcoded tenant values", () => {
  const config = readConfig({ boardUrl }, env)
  assert.equal(config.boardId, 173)
  assert.equal(config.site, "https://team.atlassian.net")
  assert.equal(config.token, "test-token")
  assert.equal(config.refreshSeconds, 120)
  assert.equal(config.maxHeight, 12)
  assert.equal(config.cloudId, undefined)
})

test("supports environment-only configuration and custom credential variable names", () => {
  const config = readConfig({ emailEnv: "WORK_EMAIL", tokenEnv: "WORK_TOKEN", maxHeight: 8 }, {
    JIRA_SITE: "https://other.atlassian.net/", JIRA_BOARD_ID: "5",
    WORK_EMAIL: "other@example.com", WORK_TOKEN: "other-token",
    JIRA_CLOUD_ID: "11111111-2222-3333-4444-555555555555",
  })
  assert.equal(config.site, "https://other.atlassian.net")
  assert.equal(config.boardId, 5)
  assert.equal(config.email, "other@example.com")
  assert.equal(config.maxHeight, 8)
  assert.equal(config.cloudId, "11111111-2222-3333-4444-555555555555")
})

test("rejects unsafe origins and invalid settings", () => {
  for (const site of ["http://team.atlassian.net", "https://evil.test", "https://team.atlassian.net.evil.test", "https://user:secret@team.atlassian.net", "https://team.atlassian.net:8443"]) {
    assert.throws(() => readConfig({ site, boardId: 1 }, env), /HTTPS Jira Cloud/)
  }
  assert.throws(() => readConfig({ boardUrl, refreshSeconds: 0 }, env), /refreshSeconds/)
  assert.throws(() => readConfig({ boardUrl, maxHeight: 41 }, env), /maxHeight/)
  assert.throws(() => readConfig({ boardUrl, cloudId: "../bad" }, env), /UUID/)
  assert.throws(() => parseBoardUrl("https://team.atlassian.net/projects/TEAM"), /must contain/)
})

test("never accepts token or email in plugin options", () => {
  assert.throws(() => readConfig({ boardUrl, token: "secret", email: "user@example.com" }, {}), /Set JIRA_EMAIL and JIRA_API_TOKEN/)
})
