import assert from "node:assert/strict"
import { test } from "node:test"
import { boardUrl, browserCommand } from "../src/open.ts"

const url = "https://team.atlassian.net/browse/TEAM-5050"

test("opens ticket URLs using argument arrays, never shell interpolation", () => {
  assert.deepEqual(browserCommand(url, "darwin"), ["open", [url]])
  assert.deepEqual(browserCommand(url, "linux"), ["xdg-open", [url]])
  assert.deepEqual(browserCommand(url, "win32"), ["rundll32.exe", ["url.dll,FileProtocolHandler", url]])
})

test("rejects unsafe browser targets", () => {
  for (const target of ["javascript:alert(1)", "https://evil.test/browse/TEAM-1", `${url}?x=1`, `${url}#fragment`, "https://user:secret@team.atlassian.net/browse/TEAM-1", "https://team.atlassian.net/browse/../../bad"]) {
    assert.throws(() => browserCommand(target))
  }
})

test("builds an active-sprints board link using only the configured site and board ID", () => {
  assert.equal(boardUrl("https://team.atlassian.net", 173), "https://team.atlassian.net/secure/RapidBoard.jspa?rapidView=173&view=detail")
  for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => boardUrl("https://team.atlassian.net", id), /Invalid Jira board ID/)
  }
  assert.throws(() => boardUrl("https://evil.test", 173))
  assert.throws(() => boardUrl("http://team.atlassian.net", 173))
})

test("opens validated board links on each platform without a shell", () => {
  const board = boardUrl("https://team.atlassian.net", 173)
  assert.deepEqual(browserCommand(board, "darwin"), ["open", [board]])
  assert.deepEqual(browserCommand(board, "linux"), ["xdg-open", [board]])
  assert.deepEqual(browserCommand(board, "win32"), ["rundll32.exe", ["url.dll,FileProtocolHandler", board]])
})

test("does not broaden the browser allowlist to arbitrary Jira pages or board parameters", () => {
  for (const path of [
    "/secure/RapidBoard.jspa",
    "/secure/RapidBoard.jspa?rapidView=0&view=detail",
    "/secure/RapidBoard.jspa?rapidView=1.5&view=detail",
    "/secure/RapidBoard.jspa?rapidView=9007199254740992&view=detail",
    "/secure/RapidBoard.jspa?rapidView=173&view=planning",
    "/secure/RapidBoard.jspa?rapidView=173&view=detail&redirect=https://evil.test",
    "/secure/RapidBoard.jspa?rapidView=173&view=detail&view=detail",
    "/secure/RapidBoard.jspa?rapidView=173&view=detail#fragment",
    "/plugins/servlet/other?rapidView=173&view=detail",
  ]) assert.throws(() => browserCommand(`https://team.atlassian.net${path}`))
})
