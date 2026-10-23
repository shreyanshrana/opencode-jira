import assert from "node:assert/strict"
import { test } from "node:test"
import { browserCommand } from "../src/open.ts"

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
